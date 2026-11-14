/*
 * BouquetPHT persistence server (C++)
 * Computes vineyards of extended persistence on a simplicial complex given by
 * vertex coordinates and simplices of any dimension (a triangulated surface, a
 * space curve, a solid, or any mix), for one of two families of functions:
 *   - radial: the (squared) distance from a center moving in R^3;
 *   - height: the height x -> <x, v> in a direction v moving on the sphere
 *     (the persistent homology transform along a loop of directions).
 * Uses GUDHI's Simplex_tree directly.
 *
 * This generalizes the Bouquet2D server (closed plane curves, H0 and H1) to
 * simplicial complexes with homology in every dimension. As there, the coned
 * (extended) complex is built once and reused for every center or direction;
 * only the filtration values are reassigned, and the work is spread over
 * native threads.
 *
 * Endpoints:
 *   GET  /health   - Health check
 *   POST /vineyard - Extended persistence for every center
 *   POST /inflection   - Inflection set of the height functions (inflection_set.cpp, CGAL)
 *   POST /simultaneity - Simultaneity set of the height functions (simultaneity_set.cpp, CGAL)
 *   POST /implicit     - Mesh of an implicit surface preset (implicit.cpp, CGAL Mesh_3)
 *   POST /subdivide    - A finer mesh of a surface fitted through a mesh (subdivide.cpp)
 * Any other GET serves the frontend (the repository root) when it is present
 * next to this directory, so `./server` is all that is needed to run the app.
 */

#include <gudhi/Simplex_tree.h>
#include <gudhi/Persistent_cohomology.h>

#include <httplib.h>
#include <nlohmann/json.hpp>

#include "cgal_surface.h"
#include "implicit.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <type_traits>
#include <vector>

using json = nlohmann::json;
using ST = Gudhi::Simplex_tree<>;
using Filtration_value = ST::Filtration_value;
using Vertex_handle = ST::Vertex_handle;
using Field_Zp = Gudhi::persistent_cohomology::Field_Zp;
using Pcoh = Gudhi::persistent_cohomology::Persistent_cohomology<ST, Field_Zp>;
using Gudhi::Extended_simplex_type;

static_assert(std::is_same_v<Filtration_value, double>,
              "extended persistence needs double filtration values");

// One persistence pair: dgm is the subdiagram index (0 Ordinary, 1 Relative,
// 2 Extended+, 3 Extended-), dim the dimension of the birth simplex.
struct PairOut {
  int dgm;
  int dim;
  double birth;
  double death;
};

// Vertex coordinates (x, y, z per vertex) and simplices as vertex index lists.
// Every vertex is a 0-simplex, and the faces of each simplex are implied.
struct Complex {
  int n = 0;
  int dim = 0;
  std::vector<double> xyz;
  std::vector<std::vector<Vertex_handle>> simplices;
};

static Complex parse_complex(const json& data) {
  Complex cx;
  cx.xyz = data.at("vertices").get<std::vector<double>>();
  if (cx.xyz.empty() || cx.xyz.size() % 3 != 0)
    throw std::invalid_argument("vertices: need a flat array of x, y, z triples");
  cx.n = static_cast<int>(cx.xyz.size() / 3);
  if (data.contains("simplices"))
    cx.simplices = data.at("simplices").get<std::vector<std::vector<Vertex_handle>>>();
  for (size_t s = 0; s < cx.simplices.size(); ++s) {
    const auto& simplex = cx.simplices[s];
    std::string where = "simplices[" + std::to_string(s) + "]: ";
    if (simplex.empty()) throw std::invalid_argument(where + "empty simplex");
    for (size_t k = 0; k < simplex.size(); ++k) {
      if (simplex[k] < 0 || simplex[k] >= cx.n)
        throw std::invalid_argument(where + "vertex index out of range");
      for (size_t l = 0; l < k; ++l)
        if (simplex[l] == simplex[k])
          throw std::invalid_argument(where + "repeated vertex");
    }
    cx.dim = std::max(cx.dim, static_cast<int>(simplex.size()) - 1);
  }
  return cx;
}

static std::vector<double> radial_distances(const Complex& cx, const double* c, bool squared) {
  std::vector<double> d(cx.n);
  for (int i = 0; i < cx.n; ++i) {
    double dx = cx.xyz[3 * i] - c[0], dy = cx.xyz[3 * i + 1] - c[1], dz = cx.xyz[3 * i + 2] - c[2];
    double d2 = dx * dx + dy * dy + dz * dz;
    d[i] = squared ? d2 : std::sqrt(d2);
  }
  return d;
}

static std::vector<double> heights(const Complex& cx, const double* v) {
  std::vector<double> h(cx.n);
  for (int i = 0; i < cx.n; ++i) h[i] = cx.xyz[3 * i] * v[0] + cx.xyz[3 * i + 1] * v[1] + cx.xyz[3 * i + 2] * v[2];
  return h;
}

// Read data[key] as a non-empty flat array of x, y, z triples.
static std::vector<double> read_triples(const json& data, const char* key) {
  auto xyz = data.at(key).get<std::vector<double>>();
  if (xyz.empty() || xyz.size() % 3 != 0)
    throw std::invalid_argument(std::string(key) + ": need a flat array of x, y, z triples");
  return xyz;
}

// Build the coned complex once. Values are placeholders; the cone vertex is n.
static ST build_extended_prototype(const Complex& cx) {
  ST st;
  for (Vertex_handle v = 0; v < cx.n; ++v) st.insert_simplex({v}, 0.0);
  for (const auto& simplex : cx.simplices) st.insert_simplex_and_subfaces(simplex, 0.0);
  st.extend_filtration();
  return st;
}

// Reassign the extended filtration for one center's vertex values, reusing the
// coned structure. Mirrors the value assignment of extend_filtration():
// vertices in [-2,-1] ascending, coned vertex-edges in [1,2] descending,
// everything else (higher simplices and their cones) to -3 and then propagated
// by make_filtration_non_decreasing.
static void assign_extended_values(ST& st, Vertex_handle cone,
                                   const std::vector<double>& dist, double minv,
                                   double maxv) {
  double scale = (maxv > minv) ? 1.0 / (maxv - minv) : 0.0;
  for (auto sh : st.complex_simplex_range()) {
    int dim = st.dimension(sh);
    if (dim == 0) {
      Vertex_handle v = *st.simplex_vertex_range(sh).begin();
      st.assign_filtration(sh, v == cone ? -3.0 : -2.0 + (dist[v] - minv) * scale);
    } else if (dim == 1) {
      auto rng = st.simplex_vertex_range(sh);
      auto it = rng.begin();
      Vertex_handle a = *it++;
      Vertex_handle b = *it;
      if (a == cone || b == cone)
        st.assign_filtration(sh, 2.0 - (dist[a == cone ? b : a] - minv) * scale);
      else
        st.assign_filtration(sh, -3.0);
    } else {
      st.assign_filtration(sh, -3.0);
    }
  }
  st.clear_filtration();
  st.make_filtration_non_decreasing();
}

// Extended persistence of one center on a reusable coned tree.
static std::vector<PairOut> compute_center(ST& st, Vertex_handle cone,
                                           const std::vector<double>& dist) {
  double minv = dist[0], maxv = dist[0];
  for (double v : dist) {
    minv = std::min(minv, v);
    maxv = std::max(maxv, v);
  }
  assign_extended_values(st, cone, dist, minv, maxv);

  Pcoh pcoh(st);
  pcoh.init_coefficients(11);
  pcoh.compute_persistent_cohomology();

  ST::Extended_filtration_data efd(minv, maxv);
  std::vector<PairOut> out;
  for (const auto& pr : pcoh.get_persistent_pairs()) {
    auto sb = std::get<0>(pr);
    auto sd = std::get<1>(pr);
    if (sd == st.null_simplex()) continue;  // essential class of the cone point
    auto pb = st.decode_extended_filtration(st.filtration(sb), efd);
    auto pd = st.decode_extended_filtration(st.filtration(sd), efd);
    // min_persistence = 0 filter, NaN-safe (matches the Python interface)
    if (!(std::abs(pb.first - pd.first) > 0.0)) continue;
    int dgm;
    if (pb.second == Extended_simplex_type::UP && pd.second == Extended_simplex_type::UP)
      dgm = 0;
    else if (pb.second == Extended_simplex_type::DOWN && pd.second == Extended_simplex_type::DOWN)
      dgm = 1;
    else
      dgm = (pb.first < pd.first) ? 2 : 3;
    out.push_back({dgm, st.dimension(sb), pb.first, pd.first});
  }
  return out;
}

static int num_workers() {
  if (const char* env = std::getenv("VINEYARD_WORKERS")) {
    int w = std::atoi(env);
    if (w > 0) return w;
  }
  unsigned hc = std::thread::hardware_concurrency();
  return hc > 0 ? static_cast<int>(hc) : 2;
}

static const char* const KINDS[3] = {"ord", "rel", "ext"};

// Response key for a pair: Extended+ and Extended- share the "ext" buckets.
static std::string bucket_name(int dgm, int dim) {
  return KINDS[dgm < 2 ? dgm : 2] + std::to_string(dim);
}

static void set_json(httplib::Response& res, const json& j, int status = 200) {
  res.status = status;
  res.set_content(j.dump(), "application/json");
}

int main(int, char** argv) {
  httplib::Server svr;

  svr.set_post_routing_handler([](const httplib::Request&, httplib::Response& res) {
    res.set_header("Access-Control-Allow-Origin", "*");
  });
  svr.Options(R"(/.*)", [](const httplib::Request&, httplib::Response& res) {
    res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set_header("Access-Control-Allow-Headers", "Content-Type");
  });

  svr.Get("/+health", [](const httplib::Request&, httplib::Response& res) {
    set_json(res, {{"status", "ok"}, {"service", "BouquetPHT persistence server (C++)"}});
  });

  // Request:  {"vertices": [x,y,z,...], "simplices": [[a,b], [a,b,c], ...], and either
  //              "function": "radial" (default), "centers": [x,y,z,...], "use_squared_distance": true
  //            or
  //              "function": "height", "directions": [x,y,z,...]   (normalized here)
  // Response: {"ord0": [{"birth", "death", "centerIdx"}, ...], "rel0": [...], "ext0": [...],
  //            ... up to the complex's dimension, "dimension": d,
  //            "minValue", "maxValue": range of the function over all centers/directions}
  // centerIdx is the index of the center or direction.
  svr.Post("/+vineyard", [](const httplib::Request& req, httplib::Response& res) {
    try {
      json data = json::parse(req.body);
      Complex cx = parse_complex(data);
      std::string function = data.value("function", "radial");
      std::vector<std::vector<double>> all_dist;
      if (function == "radial") {
        auto centers = read_triples(data, "centers");
        bool squared = data.value("use_squared_distance", true);
        for (size_t c = 0; c < centers.size(); c += 3) all_dist.push_back(radial_distances(cx, &centers[c], squared));
      } else if (function == "height") {
        auto directions = read_triples(data, "directions");
        for (size_t c = 0; c < directions.size(); c += 3) {
          double* v = &directions[c];
          double norm = std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
          if (!(norm > 0)) throw std::invalid_argument("directions: zero vector");
          for (int k = 0; k < 3; ++k) v[k] /= norm;
          all_dist.push_back(heights(cx, v));
        }
      } else {
        throw std::invalid_argument("function: expected \"radial\" or \"height\"");
      }
      int num_centers = static_cast<int>(all_dist.size());
      double min_value = all_dist[0][0], max_value = all_dist[0][0];
      for (const auto& values : all_dist)
        for (double v : values) {
          min_value = std::min(min_value, v);
          max_value = std::max(max_value, v);
        }

      const ST proto = build_extended_prototype(cx);
      Vertex_handle cone = cx.n;

      std::vector<std::vector<PairOut>> results(num_centers);
      std::atomic<int> next{0};
      std::string worker_error;
      std::mutex error_mutex;
      int nthreads = std::min(num_workers(), num_centers);
      std::vector<std::thread> threads;
      threads.reserve(nthreads);
      for (int t = 0; t < nthreads; ++t) {
        threads.emplace_back([&]() {
          try {
            ST st(proto);  // one reusable coned tree per thread
            for (int ci; (ci = next.fetch_add(1)) < num_centers;)
              results[ci] = compute_center(st, cone, all_dist[ci]);
          } catch (const std::exception& e) {
            std::lock_guard<std::mutex> lock(error_mutex);
            worker_error = e.what();
          }
        });
      }
      for (auto& th : threads) th.join();
      if (!worker_error.empty()) throw std::runtime_error(worker_error);

      json out = {{"dimension", cx.dim}, {"minValue", min_value}, {"maxValue", max_value}};
      for (int d = 0; d <= cx.dim; ++d)
        for (const char* kind : KINDS) out[kind + std::to_string(d)] = json::array();
      for (int ci = 0; ci < num_centers; ++ci)
        for (const PairOut& p : results[ci])
          out[bucket_name(p.dgm, p.dim)].push_back(
              {{"birth", p.birth}, {"death", p.death}, {"centerIdx", ci}});
      set_json(res, out);
    } catch (const json::exception& e) {
      set_json(res, {{"error", e.what()}}, 400);
    } catch (const std::invalid_argument& e) {
      set_json(res, {{"error", e.what()}}, 400);
    } catch (const std::exception& e) {
      set_json(res, {{"error", e.what()}}, 500);
    }
  });

  // See cgal_surface.h
  for (auto [path, compute] : {std::pair{"/+inflection", &inflection_set}, std::pair{"/+simultaneity", &simultaneity_set},
                               std::pair{"/+implicit", &implicit_mesh}, std::pair{"/+subdivide", &subdivide}}) {
    svr.Post(path, [compute = compute](const httplib::Request& req, httplib::Response& res) {
      try {
        set_json(res, compute(json::parse(req.body)));
      } catch (const json::exception& e) {
        set_json(res, {{"error", e.what()}}, 400);
      } catch (const std::invalid_argument& e) {
        set_json(res, {{"error", e.what()}}, 400);
      } catch (const std::exception& e) {
        set_json(res, {{"error", e.what()}}, 500);
      }
    });
  }

  // Serve the frontend from the repository root (the parent of this binary's
  // directory). Absent in API-only deployments, e.g. a Docker image.
  std::error_code ec;
  auto root = std::filesystem::canonical(argv[0], ec).parent_path().parent_path();
  bool serve_frontend = !ec && std::filesystem::exists(root / "index.html");
  if (serve_frontend) svr.set_mount_point("/", root.string());

  int port = 7860;
  if (const char* env = std::getenv("PORT")) {
    int p = std::atoi(env);
    if (p > 0) port = p;
  }
  // Loopback only by default, since this also serves files; set HOST=0.0.0.0
  // to expose it (e.g. in a container).
  const char* host = std::getenv("HOST") ? std::getenv("HOST") : "127.0.0.1";
  std::printf("BouquetPHT persistence server listening on http://%s:%d\n", host, port);
  std::printf("  GET  /health   - Health check\n");
  std::printf("  POST /vineyard - Vineyard computation (radial or height)\n");
  std::printf("  POST /inflection - Inflection set of the PHT\n");
  std::printf("  POST /simultaneity - Simultaneity set of the PHT\n");
  std::printf("  POST /implicit - Mesh of an implicit surface\n");
  std::printf("  POST /subdivide - A finer mesh of a surface fitted through a mesh\n");
  if (serve_frontend)
    std::printf("  Open http://localhost:%d/ in a browser for the app (%s)\n", port,
                root.string().c_str());
  std::fflush(stdout);
  // For the desktop app (desktop/main.js), which keeps this server's stdin open: with EXIT_ON_STDIN_EOF
  // set, exit when stdin closes, that is, when the app exits, even if it crashed
  if (std::getenv("EXIT_ON_STDIN_EOF")) {
    std::thread([] {
      while (std::cin.get() != EOF) {
      }
      std::_Exit(0);
    }).detach();
  }
  if (!svr.listen(host, port)) {
    std::fprintf(stderr, "Failed to bind %s:%d\n", host, port);
    return 1;
  }
  return 0;
}
