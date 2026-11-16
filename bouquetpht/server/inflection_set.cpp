// Inflection set of the PHT (cgal_surface.h): the parabolic curve, where K = 0, and its Gauss image.
// K and the normals are at the vertices (estimate.cpp).
// The zero set of the piecewise-linear interpolation of K is traced through the triangles whose
// vertices change sign: one segment per such triangle, between the zero crossings on its two
// edges, with the normals interpolated (and renormalized) at the crossings. The normals are the
// points of the Gauss image; the inflection set on the sphere is that image and its antipode.
// On an exact surface (an implicit preset, or the jet blend for "jets"), the segments
// only give starting points: they are moved onto the exact curve, and the curves through them are
// traced exactly (exact_curves.cpp).

#include "cgal_surface.h"
#include "surface.h"

#include <array>
#include <cmath>
#include <set>
#include <vector>

nlohmann::json inflection_set(const nlohmann::json& data) {
  Mesh mesh = read_surface(data);
  std::size_t unprojected = 0;
  const auto surface = exact_surface(mesh, data, unprojected);
  const auto [K, N] = estimate(mesh, data, surface.get());
  const std::size_t n = num_vertices(mesh);
  std::vector<double> points, normals;
  std::size_t negative = 0, skipped = 0;
  for (std::size_t i = 0; i < n; ++i) {
    if (std::isnan(K[i])) ++skipped;
    else if (K[i] < 0) ++negative;
  }
  // Zero crossing on the edge ab, where K changes sign; computed from the lower vertex index, so
  // that both triangles on the edge get exactly the same point and the segments join up
  auto crossing = [&](vertex_descriptor a, vertex_descriptor b) {
    if (b < a) std::swap(a, b);
    const double t = K[a] / (K[a] - K[b]);
    const Point &p = mesh.point(a), &q = mesh.point(b);
    for (int k = 0; k < 3; ++k) points.push_back((1 - t) * p[k] + t * q[k]);
    std::array<double, 3> m;
    for (int k = 0; k < 3; ++k) m[k] = (1 - t) * N[a][k] + t * N[b][k];
    const double len = std::sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
    for (int k = 0; k < 3; ++k) normals.push_back(len > 0 ? m[k] / len : 0);
  };
  for (auto f : faces(mesh)) {
    std::array<vertex_descriptor, 3> v;
    int k = 0, neg = 0;
    bool valid = true;
    for (auto u : vertices_around_face(halfedge(f, mesh), mesh)) {
      v[k++] = u;
      if (std::isnan(K[u])) valid = false;
      else if (K[u] < 0) ++neg;
    }
    if (!valid || neg == 0 || neg == 3) continue;
    for (int e = 0; e < 3; ++e) {
      const vertex_descriptor a = v[e], b = v[(e + 1) % 3];
      if ((K[a] < 0) != (K[b] < 0)) crossing(a, b);
    }
    // Both crossings at a vertex where K = 0 exactly: no segment
    const std::size_t m = points.size();
    if (points[m - 1] == points[m - 4] && points[m - 2] == points[m - 5] && points[m - 3] == points[m - 6]) {
      points.resize(m - 6);
      normals.resize(m - 6);
    }
  }

  // Exact surface: the segments only give starting points. Each of their ends is moved onto the
  // exact parabolic curve by Newton's method (once: an end is shared by two triangles; in parallel),
  // and the curves through these points are then traced exactly, with the exact normals
  std::size_t dropped = 0, curves = 0;
  if (const ImplicitSurface* s = surface.get()) {
    const double h = PMP::average_edge_length(mesh);
    std::set<std::array<double, 3>> ends;
    std::vector<Eigen::Vector3d> starts;
    for (std::size_t i = 0; i < points.size(); i += 3) {
      const std::array<double, 3> key = {points[i], points[i + 1], points[i + 2]};
      if (ends.insert(key).second) starts.emplace_back(key[0], key[1], key[2]);
    }
    std::vector<char> converged(starts.size());
    parallel_for(starts.size(), [&](std::size_t i) { converged[i] = refine_parabolic(*s, 6 * h, starts[i]); });
    std::vector<Eigen::Vector3d> seeds;
    for (std::size_t i = 0; i < starts.size(); ++i) {
      if (converged[i]) seeds.push_back(starts[i]);
      else ++dropped;
    }
    const auto traced = trace_parabolic(*s, seeds, h, 1000000);
    curves = traced.size();
    points.clear();
    normals.clear();
    for (const auto& curve : traced)
      for (std::size_t i = 0; i + 1 < curve.size(); ++i)
        for (std::size_t e : {i, i + 1}) {
          const Eigen::Vector3d g = vec(eval(*s, curve[e]).g).normalized();
          for (int k = 0; k < 3; ++k) points.push_back(curve[e][k]), normals.push_back(g[k]);
        }
  }
  return {{"points", points}, {"normals", normals}, {"segments", points.size() / 6}, {"vertices", n},
          {"negative", negative}, {"skipped", skipped}, {"dropped", dropped}, {"curves", curves},
          {"unprojected", unprojected}};
}
