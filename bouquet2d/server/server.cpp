/*
 * Extended Persistence Server (C++)
 * Drop-in replacement for server.py: computes extended persistence for
 * radial filtrations on closed curves, using GUDHI's Simplex_tree directly.
 *
 * Endpoints (same JSON schemas as the previous Flask implementation):
 *   GET  /health      - Health check
 *   POST /persistence - Single center persistence
 *   POST /vineyard    - Persistence over multiple centers
 *
 * Speed comes from two things the Python bindings cannot express:
 *   - the coned (extended) complex is built once and reused for every center;
 *     only filtration values are reassigned per center, whereas
 *     Simplex_tree::extend_filtration() copies the whole tree on every call;
 *   - centers are processed by native threads (no process pool, no pickling).
 *
 * It also serves Bouquet2D itself, from the parent of this binary's directory, when the
 * app is there (as in the desktop app, ../desktop/).
 */

#include <gudhi/Simplex_tree.h>
#include <gudhi/Persistent_cohomology.h>

#include <httplib.h>
#include <nlohmann/json.hpp>

#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <type_traits>
#include <utility>
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

struct Input {
  int n = 0;
  std::vector<double> xs, ys;
  std::vector<std::pair<Vertex_handle, Vertex_handle>> edges;
};

// Parse points and group them into closed loops per curveId, like server.py.
static Input parse_points(const json& points) {
  Input in;
  in.n = static_cast<int>(points.size());
  in.xs.reserve(in.n);
  in.ys.reserve(in.n);
  std::map<std::string, std::vector<int>> groups;
  for (int i = 0; i < in.n; ++i) {
    const json& pt = points.at(i);
    in.xs.push_back(pt.at("x").get<double>());
    in.ys.push_back(pt.at("y").get<double>());
    json cid = pt.contains("curveId") ? pt["curveId"] : json(0);
    groups[cid.dump()].push_back(i);
  }
  for (const auto& [cid, idx] : groups) {
    int m = static_cast<int>(idx.size());
    for (int j = 0; j < m; ++j) {
      Vertex_handle v1 = idx[j];
      Vertex_handle v2 = idx[(j + 1) % m];
      if (v1 != v2) in.edges.emplace_back(v1, v2);
    }
  }
  return in;
}

static std::vector<double> radial_distances(const Input& in, double cx, double cy,
                                            bool squared) {
  std::vector<double> d(in.n);
  for (int i = 0; i < in.n; ++i) {
    double dx = in.xs[i] - cx, dy = in.ys[i] - cy;
    d[i] = squared ? dx * dx + dy * dy : std::sqrt(dx * dx + dy * dy);
  }
  return d;
}

// Build the coned complex once. Values are placeholders; the cone vertex is n.
static ST build_extended_prototype(const Input& in) {
  ST st;
  for (Vertex_handle i = 0; i < in.n; ++i) st.insert_simplex({i}, 0.0);
  for (const auto& [v1, v2] : in.edges) st.insert_simplex({v1, v2}, 0.0);
  st.extend_filtration();
  return st;
}

// Reassign the extended filtration for one center's vertex values, reusing the
// coned structure. Mirrors the value assignment of extend_filtration():
// vertices in [-2,-1] ascending, coned vertex-edges in [1,2] descending,
// everything else to -3 and then propagated by make_filtration_non_decreasing.
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

static const char* bucket_name(int dgm, int dim) {
  static const char* names[3][2] = {
      {"ord0", "ord1"}, {"rel0", "rel1"}, {"ext0", "ext1"}};
  return names[dgm < 2 ? dgm : 2][dim == 0 ? 0 : 1];
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

  svr.Get("/", [](const httplib::Request&, httplib::Response& res) {
    set_json(res, {{"service", "Extended Persistence Server (C++)"},
                   {"endpoints", {"GET /health", "POST /persistence", "POST /vineyard"}}});
  });

  // "/+" tolerates duplicate leading slashes (e.g. a base URL configured with a
  // trailing slash), which werkzeug used to merge silently.
  svr.Get("/+health", [](const httplib::Request&, httplib::Response& res) {
    set_json(res, {{"status", "ok"}, {"gudhi_version", "gudhi-devel headers (C++)"}});
  });

  svr.Post("/+persistence", [](const httplib::Request& req, httplib::Response& res) {
    try {
      json data = json::parse(req.body);
      Input in = parse_points(data.at("points"));
      if (in.n < 3) {
        set_json(res, {{"error", "Need at least 3 points"}}, 400);
        return;
      }
      double cx = data.at("center").at("x").get<double>();
      double cy = data.at("center").at("y").get<double>();
      bool squared = data.value("use_squared_distance", true);

      std::vector<double> dist = radial_distances(in, cx, cy, squared);
      double r_min = dist[0], r_max = dist[0];
      for (double v : dist) {
        r_min = std::min(r_min, v);
        r_max = std::max(r_max, v);
      }

      ST st = build_extended_prototype(in);
      Vertex_handle cone = in.n;
      std::vector<PairOut> pairs = compute_center(st, cone, dist);

      json out = {{"ord0", json::array()}, {"ord1", json::array()},
                  {"rel0", json::array()}, {"rel1", json::array()},
                  {"ext0", json::array()}, {"ext1", json::array()},
                  {"r_min", r_min},        {"r_max", r_max}};
      for (const PairOut& p : pairs)
        out[bucket_name(p.dgm, p.dim)].push_back({p.birth, p.death});
      set_json(res, out);
    } catch (const std::exception& e) {
      set_json(res, {{"error", e.what()}}, 500);
    }
  });

  svr.Post("/+vineyard", [](const httplib::Request& req, httplib::Response& res) {
    try {
      json data = json::parse(req.body);
      Input in = parse_points(data.at("points"));
      if (in.n < 3) {
        set_json(res, {{"error", "Need at least 3 points"}}, 400);
        return;
      }
      const json& centers = data.at("centers");
      bool squared = data.value("use_squared_distance", true);
      int num_centers = static_cast<int>(centers.size());

      std::vector<std::vector<double>> all_dist(num_centers);
      double max_dist_global = 0.0;
      for (int ci = 0; ci < num_centers; ++ci) {
        double cx = centers.at(ci).at("x").get<double>();
        double cy = centers.at(ci).at("y").get<double>();
        all_dist[ci] = radial_distances(in, cx, cy, squared);
        for (double v : all_dist[ci]) max_dist_global = std::max(max_dist_global, v);
      }
      double infinityY = max_dist_global * 1.15;

      const ST proto = build_extended_prototype(in);
      Vertex_handle cone = in.n;

      std::vector<std::vector<PairOut>> results(num_centers);
      std::atomic<int> next{0};
      std::string worker_error;
      std::mutex error_mutex;
      int nthreads = std::min(num_workers(), std::max(num_centers, 1));
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

      static const char* type_names[4] = {"ord", "rel", "ext", "ext"};
      json out = {{"ord0", json::array()}, {"ord1", json::array()},
                  {"rel0", json::array()}, {"rel1", json::array()},
                  {"ext0", json::array()}, {"ext1", json::array()},
                  {"infinityY", infinityY}};
      for (int ci = 0; ci < num_centers; ++ci) {
        for (const PairOut& p : results[ci]) {
          out[bucket_name(p.dgm, p.dim)].push_back({{"birth", p.birth},
                                                    {"death", p.death},
                                                    {"centerIdx", ci},
                                                    {"isInfinite", false},
                                                    {"type", type_names[p.dgm]}});
        }
      }
      set_json(res, out);
    } catch (const std::exception& e) {
      set_json(res, {{"error", e.what()}}, 500);
    }
  });

  // Serve the app from the parent of this binary's directory (bouquet2d/), if it is there. The file
  // handler comes before the routes above, so "/" is then the app's index.html.
  std::error_code ec;
  auto root = std::filesystem::canonical(argv[0], ec).parent_path().parent_path();
  bool serve_frontend = !ec && std::filesystem::exists(root / "index.html");
  if (serve_frontend) svr.set_mount_point("/", root.string());

  int port = 7860;
  if (const char* env = std::getenv("PORT")) {
    int p = std::atoi(env);
    if (p > 0) port = p;
  }
  // Loopback only by default, since this also serves files; set HOST=0.0.0.0 to expose it (e.g. in a
  // container).
  const char* host = std::getenv("HOST") ? std::getenv("HOST") : "127.0.0.1";
  std::printf("Extended Persistence Server (C++) listening on %s:%d\n", host, port);
  std::printf("  GET  /health      - Health check\n");
  std::printf("  POST /persistence - Single center persistence\n");
  std::printf("  POST /vineyard    - Vineyard computation\n");
  if (serve_frontend)
    std::printf("  Open http://localhost:%d/ in a browser for the app (%s)\n", port, root.string().c_str());
  std::fflush(stdout);
  // For the desktop app (../desktop/main.js), which keeps this server's stdin open: with EXIT_ON_STDIN_EOF
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
