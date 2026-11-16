// A finer mesh of a loaded surface (cgal_surface.h): a new mesh of its jet blend, traced with GUDHI's
// manifold tracing (the Coxeter scheme), or midpoint subdivisions moved onto the jet blend
// (fitted_surface.cpp); or the mesh itself, remeshed isotropically with CGAL, keeping its sharp edges.

#include "cgal_surface.h"
#include "surface.h"

#include <CGAL/AABB_face_graph_triangle_primitive.h>
#include <CGAL/AABB_traits_3.h>
#include <CGAL/AABB_tree.h>
#include <CGAL/Polygon_mesh_processing/detect_features.h>
#include <CGAL/Polygon_mesh_processing/remesh.h>
#include <CGAL/Side_of_triangle_mesh.h>

#include <gudhi/Coxeter_triangulation.h>
#include <gudhi/Coxeter_triangulation/Cell_complex/Cell_complex.h>
#include <gudhi/IO/build_mesh_from_cell_complex.h>
#include <gudhi/Implicit_manifold_intersection_oracle.h>
#include <gudhi/Manifold_tracing.h>

#include <array>
#include <cmath>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

// The input mesh, for its distance (AABB tree) and its inside (Side_of_triangle_mesh)
using MeshTree = CGAL::AABB_tree<CGAL::AABB_traits_3<Kernel, CGAL::AABB_face_graph_triangle_primitive<Mesh>>>;
using MeshSide = CGAL::Side_of_triangle_mesh<Mesh, Kernel>;

// F as GUDHI's manifold tracing sees it (a model of its FunctionForImplicitManifold): the distance
// F/|grad F|, moved to at least `clamp` from 0 with its sign kept. Without the clamp, F = 0 passing
// near a vertex of the ambient triangulation puts the crossings of the edges at that vertex almost
// on top of each other, leaving slivers; with it no crossing lies closer than about a fifth of an
// edge to a vertex, and the edges that cross (so the mesh's connectivity) are the same.
// Where F is undefined (beyond the support of the fits), it is the signed distance to the input
// mesh (closed), so that every polygon the tracing reaches is complete. The value is kept for each
// vertex of the triangulation, which the tracing asks for many times; past `budget` vertices it
// throws, as the traced surface is then not closing up.
struct TracedSurface {
  const ImplicitSurface* s;
  double clamp;
  std::shared_ptr<const MeshTree> tree;
  std::shared_ptr<const MeshSide> side;
  std::size_t budget;
  std::shared_ptr<std::map<std::array<double, 3>, double>> cache;
  Eigen::VectorXd operator()(const Eigen::VectorXd& p) const {
    auto [it, fresh] = cache->try_emplace({p(0), p(1), p(2)});
    if (fresh) {
      if (cache->size() > budget) throw std::runtime_error("the traced surface does not close up; try the midpoint scheme");
      const Derivatives d = eval(*s, p.head<3>());
      double distance = d.f / vec(d.g).norm();
      if (std::isnan(distance)) {
        const Point x(p(0), p(1), p(2));
        distance = std::sqrt(tree->squared_distance(x)) * ((*side)(x) == CGAL::ON_BOUNDED_SIDE ? -1 : 1);
      }
      it->second = std::fabs(distance) < clamp ? std::copysign(clamp, distance) : distance;
    }
    return Eigen::VectorXd::Constant(1, it->second);
  }
  std::size_t amb_d() const { return 3; }
  std::size_t cod_d() const { return 1; }
};

// F = 0 triangulated with GUDHI's manifold tracing (S. Kachanovich, Coxeter_triangulation module):
// the edges of a Coxeter triangulation of R^3 with longest edge L that cross the surface, found by
// spreading from the seeds (points on F = 0); then the polygon each tetrahedron cuts out of the
// surface, fanned from its barycenter (build_mesh_from_cell_complex). The points are on the
// piecewise-linear surface, not yet on F = 0. `mesh` is the closed mesh F was fitted to, used where
// F is undefined (see TracedSurface), and at most `budget` vertices of the triangulation are evaluated.
void coxeter_mesh(const ImplicitSurface& s, const Mesh& mesh, double L, std::size_t budget,
                  const std::vector<Eigen::Vector3d>& seeds, std::vector<Eigen::Vector3d>& points,
                  std::vector<std::array<std::size_t, 3>>& triangles) {
  namespace ct = Gudhi::coxeter_triangulation;
  ct::Coxeter_triangulation<> lattice(3);
  lattice.change_matrix(L / std::sqrt(2.0) * lattice.matrix());  // unscaled, its longest edge is sqrt(2)
  lattice.change_offset(L * Eigen::Vector3d(0.1371, 0.2913, 0.4187));  // generic, and the same every time
  auto tree = std::make_shared<MeshTree>(faces(mesh).first, faces(mesh).second, mesh);
  tree->accelerate_distance_queries();
  const auto side = std::make_shared<const MeshSide>(*tree);
  const auto oracle = ct::make_oracle(TracedSurface{&s, 0.25 * L, tree, side, budget,
                                                    std::make_shared<std::map<std::array<double, 3>, double>>()});
  using Tracing = ct::Manifold_tracing<ct::Coxeter_triangulation<>>;
  Tracing::Out_simplex_map crossings;
  std::vector<Eigen::VectorXd> starts(seeds.begin(), seeds.end());
  ct::manifold_tracing_algorithm(starts, lattice, oracle, crossings);
  ct::Cell_complex<Tracing::Out_simplex_map> cells(2);
  cells.construct_complex(crossings);
  const ct::Mesh_medit traced = ct::build_mesh_from_cell_complex(cells, ct::Configuration(false, true, false, 1, 1, 1));
  points.clear();
  triangles.clear();
  for (const Eigen::VectorXd& p : traced.vertex_points) points.emplace_back(p(0), p(1), p(2));
  for (const auto& [t, label] : traced.triangles) triangles.push_back({t[0] - 1, t[1] - 1, t[2] - 1});  // 1-based
}

// Turns the triangles of a manifold mesh so that neighbours agree (each edge used once in each
// direction), then each connected component so that it faces along grad F, by an area-weighted vote
// of its triangles (where the fit is poor, single triangles can disagree with it)
void orient_along(const ImplicitSurface& s, const std::vector<Eigen::Vector3d>& points,
                  std::vector<std::array<std::size_t, 3>>& triangles) {
  std::map<std::pair<std::size_t, std::size_t>, std::vector<std::size_t>> at_edge;
  for (std::size_t i = 0; i < triangles.size(); ++i)
    for (int k = 0; k < 3; ++k) at_edge[std::minmax(triangles[i][k], triangles[i][(k + 1) % 3])].push_back(i);
  auto has = [&](std::size_t i, std::size_t a, std::size_t b) {  // the directed edge a -> b
    for (int k = 0; k < 3; ++k)
      if (triangles[i][k] == a && triangles[i][(k + 1) % 3] == b) return true;
    return false;
  };
  std::vector<bool> seen(triangles.size(), false);
  for (std::size_t start = 0; start < triangles.size(); ++start) {
    if (seen[start]) continue;
    std::vector<std::size_t> component{start};
    seen[start] = true;
    for (std::size_t c = 0; c < component.size(); ++c) {
      const auto t = triangles[component[c]];
      for (int k = 0; k < 3; ++k)
        for (std::size_t j : at_edge[std::minmax(t[k], t[(k + 1) % 3])]) {
          if (seen[j]) continue;
          if (has(j, t[k], t[(k + 1) % 3])) std::swap(triangles[j][1], triangles[j][2]);
          seen[j] = true;
          component.push_back(j);
        }
    }
    double vote = 0;
    for (std::size_t i : component) {
      const auto& t = triangles[i];
      const Eigen::Vector3d g = vec(eval(s, (points[t[0]] + points[t[1]] + points[t[2]]) / 3).g);
      const double v = (points[t[1]] - points[t[0]]).cross(points[t[2]] - points[t[0]]).dot(g.normalized());
      if (!std::isnan(v)) vote += v;
    }
    if (vote < 0)
      for (std::size_t i : component) std::swap(triangles[i][1], triangles[i][2]);
  }
}

// The mesh remeshed on itself with CGAL's isotropic remeshing (after Botsch and Kobbelt, 2004): edges
// split, collapsed and flipped towards length `target`, then tangential relaxation, with every new or
// moved vertex projected back onto the input mesh. The sharp edges (faces meeting at more than 45
// degrees) and the boundary stay polylines on the input, with their corners kept.
void isotropic_remesh(Mesh& mesh, double target) {
  auto sharp = get(CGAL::edge_is_feature, mesh);
  PMP::detect_sharp_edges(mesh, 45, sharp);
  PMP::isotropic_remeshing(faces(mesh), target, mesh,
                           CGAL::parameters::number_of_iterations(3).edge_is_constrained_map(sharp));
  mesh.collect_garbage();  // contiguous vertex indices
}

}  // namespace

nlohmann::json subdivide(const nlohmann::json& data) {
  const int steps = data.value("steps", 1);
  if (steps < 1 || steps > 3) throw std::invalid_argument("steps: expected 1 to 3");
  const std::string scheme = data.value("scheme", "coxeter");
  if (scheme != "coxeter" && scheme != "midpoint" && scheme != "isotropic")
    throw std::invalid_argument("scheme: expected \"coxeter\", \"midpoint\" or \"isotropic\"");
  Mesh mesh = read_surface(data);
  const long euler = long(num_vertices(mesh)) - long(num_edges(mesh)) + long(num_faces(mesh));  // as read, to compare
  // The isotropic scheme stays on the mesh itself, with no fitted surface: for meshes whose triangles
  // are too poorly shaped, or whose edges too sharp, for a good fit. Edges of h / 2^steps (h the mean
  // edge length) give about as many triangles as `steps` midpoint subdivisions.
  const bool fit = scheme != "isotropic";
  if (!fit) isotropic_remesh(mesh, PMP::average_edge_length(mesh) / (1 << steps));
  double reach = 0;
  const auto surface = fit ? fitted_surface(mesh, data, reach) : nullptr;
  std::vector<Eigen::Vector3d> points;
  for (vertex_descriptor v : vertices(mesh)) points.emplace_back(mesh.point(v).x(), mesh.point(v).y(), mesh.point(v).z());
  std::vector<std::array<std::size_t, 3>> triangles;
  if (scheme == "coxeter") {
    // Past the boundary of an open mesh the fit fades out and the traced surface frays, so the mesh
    // must be closed
    if (!CGAL::is_closed(mesh)) throw std::invalid_argument("scheme: the Coxeter scheme needs a closed mesh; this one has a boundary, use \"midpoint\"");
    // A new mesh of the fitted surface, traced from the vertices moved onto it. A lattice edge of
    // 3.6 h / 2^steps (h the mean edge length) gives about as many triangles as `steps` midpoint
    // subdivisions, for which a closed surface evaluates about 0.1 * 4^steps vertices of the
    // lattice per input triangle; the budget is 40 times that
    std::vector<Eigen::Vector3d> seeds;
    for (Eigen::Vector3d x : points)
      if (project_onto(*surface, reach, x)) seeds.push_back(x);
    coxeter_mesh(*surface, mesh, 3.6 * PMP::average_edge_length(mesh) / (1 << steps),
                 4 * (std::size_t(1) << (2 * steps)) * num_faces(mesh), seeds, points, triangles);
    if (triangles.empty()) throw std::invalid_argument("the fitted surface could not be traced");
  } else {
    for (auto f : faces(mesh)) {
      std::array<std::size_t, 3> t;
      int k = 0;
      for (auto u : vertices_around_face(halfedge(f, mesh), mesh)) t[k++] = u;
      triangles.push_back(t);
    }
    // Each midpoint step splits every triangle into four at the midpoints of its edges (one new vertex
    // per edge); the isotropic mesh is used as it is
    const int splits = scheme == "midpoint" ? steps : 0;
    for (int step = 0; step < splits; ++step) {
      std::map<std::pair<std::size_t, std::size_t>, std::size_t> midpoint;
      auto mid = [&](std::size_t a, std::size_t b) {
        const auto key = std::minmax(a, b);
        auto it = midpoint.find(key);
        if (it != midpoint.end()) return it->second;
        points.push_back((points[a] + points[b]) / 2);
        return midpoint[key] = points.size() - 1;
      };
      std::vector<std::array<std::size_t, 3>> finer;
      for (const auto& t : triangles) {
        const std::size_t ab = mid(t[0], t[1]), bc = mid(t[1], t[2]), ca = mid(t[2], t[0]);
        finer.push_back({t[0], ab, ca});
        finer.push_back({t[1], bc, ab});
        finer.push_back({t[2], ca, bc});
        finer.push_back({ab, bc, ca});
      }
      triangles.swap(finer);
    }
  }
  // Every vertex onto the fitted surface, if any (one that cannot be stays where it is)
  std::size_t unprojected = 0;
  if (surface)
    for (Eigen::Vector3d& p : points) {
      Eigen::Vector3d x = p;
      if (project_onto(*surface, reach, x)) p = x;
      else ++unprojected;
    }
  // The traced triangles come with their corners in any order; the midpoint and isotropic ones keep the input's
  if (scheme == "coxeter") orient_along(*surface, points, triangles);
  std::vector<double> xyz;
  for (const Eigen::Vector3d& p : points) xyz.insert(xyz.end(), {p[0], p[1], p[2]});
  return {{"vertices", xyz}, {"simplices", triangles}, {"unprojected", unprojected}, {"input_euler", euler}};
}
