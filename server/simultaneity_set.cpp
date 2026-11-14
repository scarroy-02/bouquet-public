// Simultaneity set of the PHT: the directions v for which two critical points of the height have the
// same value, i.e. the normals of the planes tangent to the surface at two points. Every vertex is
// mapped to its tangent plane (N, <p - o, N>) in S^2 x R, the image triangles are put in R^3 by
// (v, d) -> (R + d) v together with their antipodal copy, and CGAL's PMP::self_intersections finds
// where the image crosses itself.
// On an exact surface (an implicit preset, or the jet blend for "jets"), the crossings
// only give starting points: they are moved onto exact pairs, and the curves of pairs through them
// are traced exactly (exact_curves.cpp).

#include "cgal_surface.h"
#include "surface.h"

#include <CGAL/Polygon_mesh_processing/self_intersections.h>
#include <CGAL/intersections.h>

#include <array>
#include <cmath>
#include <map>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

nlohmann::json simultaneity_set(const nlohmann::json& data) {
  constexpr std::size_t max_segments = 100000;
  Mesh mesh = read_surface(data);
  std::size_t unprojected = 0;
  const auto surface = exact_surface(mesh, data, unprojected);
  const auto N = estimate(mesh, data, surface.get()).N;
  const std::size_t n = num_vertices(mesh);

  // Phi(p) = (N(p), d(p)), d(p) = <p - o, N(p)>; o = the centroid of the vertices (any origin gives
  // the same set; a central one keeps |d| small, so the linear image triangles stay close to the
  // true image)
  std::vector<Kernel::Vector_3> normal(n);
  std::vector<double> d(n);
  std::vector<bool> valid(n);
  Kernel::Vector_3 o(0, 0, 0);
  for (vertex_descriptor v : vertices(mesh)) o = o + (mesh.point(v) - CGAL::ORIGIN) / static_cast<double>(n);
  double D = 0;
  for (vertex_descriptor v : vertices(mesh)) {
    valid[v] = !std::isnan(N[v][0]);  // jet fitting skipped it
    if (!valid[v]) continue;
    normal[v] = Kernel::Vector_3(N[v][0], N[v][1], N[v][2]);
    d[v] = (mesh.point(v) - CGAL::ORIGIN - o) * normal[v];
    D = std::max(D, std::abs(d[v]));
  }
  const double h = PMP::average_edge_length(mesh);
  const double R = 2 * D + h;  // R > |d|, so the shell embedding below is one-to-one

  // The image in S^2 x R, embedded in R^3 by (v, d) -> (R + d) v, as a triangle mesh: copy 0 is
  // Phi(M), copy 1 the same tangent planes written as (-N, -d), for pairs with opposite normals
  std::vector<std::array<vertex_descriptor, 3>> tri;
  for (auto f : faces(mesh)) {
    std::array<vertex_descriptor, 3> t;
    int k = 0;
    for (auto u : vertices_around_face(halfedge(f, mesh), mesh)) t[k++] = u;
    if (valid[t[0]] && valid[t[1]] && valid[t[2]]) tri.push_back(t);
  }
  const std::size_t m = tri.size();
  Mesh image;
  for (int copy = 0; copy < 2; ++copy)
    for (vertex_descriptor v : vertices(mesh)) {
      const double sign = copy ? -1 : 1;
      image.add_vertex(valid[v] ? CGAL::ORIGIN + (R + sign * d[v]) * (sign * normal[v]) : CGAL::ORIGIN);
    }
  for (std::size_t copy = 0; copy < 2; ++copy)
    for (const auto& t : tri)
      image.add_face(vertex_descriptor(t[0] + copy * n), vertex_descriptor(t[1] + copy * n),
                     vertex_descriptor(t[2] + copy * n));

  std::vector<std::pair<Mesh::Face_index, Mesh::Face_index>> pairs;
  PMP::self_intersections(image, std::back_inserter(pairs));

  auto image_triangle = [&](std::size_t f) {
    const auto& t = tri[f % m];
    const std::size_t shift = f < m ? 0 : n;
    return Kernel::Triangle_3(image.point(vertex_descriptor(t[0] + shift)), image.point(vertex_descriptor(t[1] + shift)),
                              image.point(vertex_descriptor(t[2] + shift)));
  };
  auto centroid = [&](std::size_t f) {
    const auto& t = tri[f % m];
    return CGAL::centroid(mesh.point(t[0]), mesh.point(t[1]), mesh.point(t[2]));
  };
  // The point of M with the barycentric coordinates of x in the image triangle f
  auto preimage = [&](std::size_t f, const Point& x) {
    const auto T = image_triangle(f);
    const Kernel::Vector_3 e0 = T[1] - T[0], e1 = T[2] - T[0], e2 = x - T[0];
    const double d00 = e0 * e0, d01 = e0 * e1, d11 = e1 * e1, d20 = e2 * e0, d21 = e2 * e1;
    const double den = d00 * d11 - d01 * d01;
    const double b = (d11 * d20 - d01 * d21) / den, c = (d00 * d21 - d01 * d20) / den;
    const auto& t = tri[f % m];
    return mesh.point(t[0]) + b * (mesh.point(t[1]) - mesh.point(t[0])) + c * (mesh.point(t[2]) - mesh.point(t[0]));
  };

  const ImplicitSurface* exact = surface.get();
  // Exact surface: the crossings only give starting points. Each end of a crossing segment becomes
  // an exact pair by Newton's method (once: an end is shared by two segments; in parallel), and the
  // curves through these pairs are then traced exactly (trace_pairs)
  std::map<std::array<long long, 3>, Vector6d> seeds;
  std::vector<double> directions, first, second;
  std::size_t segments = 0, folds = 0, dropped = 0;
  for (auto [fa, fb] : pairs) {
    const std::size_t a = fa, b = fb;
    if (a == b) continue;  // a degenerate image triangle
    // Each pair is found twice, once per orientation of the planes: keep one
    if (a >= m && b >= m) continue;
    if ((a < m) != (b < m) && (a < m ? a : b) % m >= (a < m ? b : a) % m) continue;
    // Nearby triangles of M: the image folds over along the parabolic curve, not two critical points
    if (CGAL::squared_distance(centroid(a), centroid(b)) < 9 * h * h) {
      ++folds;
      continue;
    }
    const auto crossing = CGAL::intersection(image_triangle(a), image_triangle(b));
    const auto* s = crossing ? std::get_if<Kernel::Segment_3>(&*crossing) : nullptr;
    if (!s) continue;  // they only touch, or overlap in a plane
    // Both ends: the direction, and the contact points on the two triangles
    Eigen::Vector3d v[2], p[2], q[2];
    const Point ends[2] = {s->source(), s->target()};
    int k = 0;
    for (const Point& x : ends) {
      v[k] = Eigen::Vector3d(x.x(), x.y(), x.z()).normalized();
      const Point pa = preimage(a, x), pb = preimage(b, x);
      p[k] = {pa.x(), pa.y(), pa.z()};
      q[k++] = {pb.x(), pb.y(), pb.z()};
    }
    if (exact) {
      for (int e = 0; e < 2; ++e) {
        const double grid = 1e-12 * R;
        const std::array<long long, 3> key = {std::llround(ends[e].x() / grid), std::llround(ends[e].y() / grid),
                                              std::llround(ends[e].z() / grid)};
        seeds.emplace(key, (Vector6d() << p[e], q[e]).finished());
      }
      continue;
    }
    if (++segments > max_segments) continue;
    for (int e = 0; e < 2; ++e)
      for (int k = 0; k < 3; ++k) {
        directions.push_back(v[e][k]);
        first.push_back(p[e][k]);
        second.push_back(q[e][k]);
      }
  }
  std::size_t curves = 0;
  if (exact) {
    std::vector<Vector6d> starts;
    for (const auto& [key, z] : seeds) starts.push_back(z);
    std::vector<char> converged(starts.size());
    parallel_for(starts.size(), [&](std::size_t i) {
      Eigen::Vector3d p = starts[i].head<3>(), q = starts[i].tail<3>();
      converged[i] = refine_pair(*exact, 6 * h, h, p, q);
      starts[i] << p, q;
    });
    std::vector<Vector6d> pairs;
    for (std::size_t i = 0; i < starts.size(); ++i) {
      if (converged[i]) pairs.push_back(starts[i]);
      else ++dropped;
    }
    const auto traced = trace_pairs(*exact, pairs, h, h, max_segments + 1);
    curves = traced.size();
    for (const auto& curve : traced) {
      // Directions: the normal at p, on one side along the whole curve
      std::vector<Eigen::Vector3d> v;
      for (const Vector6d& z : curve) {
        Eigen::Vector3d n = vec(eval(*exact, z.head<3>()).g).normalized();
        if (!v.empty() && n.dot(v.back()) < 0) n = -n;
        v.push_back(n);
      }
      for (std::size_t i = 0; i + 1 < curve.size(); ++i, ++segments)
        for (std::size_t e : {i, i + 1})
          for (int k = 0; k < 3; ++k) {
            directions.push_back(v[e][k]);
            first.push_back(curve[e][k]);
            second.push_back(curve[e][3 + k]);
          }
    }
  }
  if (segments > max_segments)
    throw std::invalid_argument("the simultaneity set has " + std::to_string(segments) + " segments, more than the " +
                                std::to_string(max_segments) + " that can be shown; try a coarser mesh");
  // Single precision is plenty for estimated sets and keeps large ones small; exact ones are sent
  // in full
  const auto out = [&](const std::vector<double>& a) {
    return exact ? nlohmann::json(a) : nlohmann::json(std::vector<float>(a.begin(), a.end()));
  };
  return {{"directions", out(directions)}, {"first", out(first)}, {"second", out(second)}, {"segments", segments},
          {"folds", folds}, {"vertices", n}, {"dropped", dropped}, {"curves", curves}, {"unprojected", unprojected}};
}
