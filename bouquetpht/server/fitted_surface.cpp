// The jet blend of a mesh, the surface fitted through it for the "jets" method (the blend itself is
// make_blended_surface, in implicit.cpp), Newton's method onto a surface, and the exact surface of a
// request (surface.h).

#include "surface.h"
#include "jet_fitting.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>

bool project_onto(const ImplicitSurface& s, double reach, Eigen::Vector3d& x) {
  const Eigen::Vector3d start = x;
  for (int it = 0; it < 30; ++it) {
    const Derivatives d = eval(s, x);
    const Eigen::Vector3d g = vec(d.g), step = -d.f / g.squaredNorm() * g;
    x += step;
    if (!((x - start).norm() <= reach)) return false;  // also when F is undefined (NaN)
    if (step.norm() < 1e-12 * s.radius) return true;
  }
  return false;
}

std::shared_ptr<const ImplicitSurface> fitted_surface(const Mesh& mesh, const nlohmann::json& data, double& reach) {
  const double support = data.value("support", 4.0);
  if (!(support > 0)) throw std::invalid_argument("support: expected a number > 0");
  const auto jet = fit_jets(mesh, data);
  std::vector<LocalJet> fits;
  reach = 0;
  for (vertex_descriptor v : vertices(mesh)) {
    const JetResult& r = jet[v];
    if (std::isnan(r.normal[0])) continue;  // jet fitting skipped it
    double spacing = 0;
    int edges = 0;
    for (auto hd : halfedges_around_target(halfedge(v, mesh), mesh)) {
      spacing += std::sqrt(CGAL::squared_distance(mesh.point(source(hd, mesh)), mesh.point(v)));
      ++edges;
    }
    const double radius = support * spacing / std::max(edges, 1);
    reach = std::max(reach, radius);
    fits.push_back({r.origin, r.d1, r.d2, r.normal, r.coefficients, radius});
  }
  return make_blended_surface(fits);
}

namespace {

// The implicit surface the request names, or nullptr
const ImplicitSurface* implicit_surface(const nlohmann::json& data) {
  if (!data.contains("implicit") || data.at("implicit").is_null()) return nullptr;
  const ImplicitSurface* s = find_implicit(data.at("implicit").get<std::string>());
  if (!s) throw std::invalid_argument("implicit: unknown surface");
  return s;
}

// Moves every vertex of the mesh onto F = 0; returns how many could not be (they stay)
std::size_t project_vertices(Mesh& mesh, const ImplicitSurface& s, double reach) {
  std::size_t unprojected = 0;
  for (vertex_descriptor v : vertices(mesh)) {
    const Point& p = mesh.point(v);
    Eigen::Vector3d x(p.x(), p.y(), p.z());
    if (project_onto(s, reach, x)) mesh.point(v) = Point(x[0], x[1], x[2]);
    else ++unprojected;
  }
  return unprojected;
}

}  // namespace

std::shared_ptr<const ImplicitSurface> exact_surface(Mesh& mesh, const nlohmann::json& data, std::size_t& unprojected) {
  unprojected = 0;
  if (const ImplicitSurface* s = implicit_surface(data)) return {s, [](const ImplicitSurface*) {}};  // not owned
  if (data.value("method", "jet") != "jets") return nullptr;
  double reach = 0;
  auto s = fitted_surface(mesh, data, reach);
  unprojected = project_vertices(mesh, *s, reach);
  return s;
}
