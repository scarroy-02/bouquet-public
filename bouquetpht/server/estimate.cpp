// Gaussian curvature K and unit normal at every vertex (surface.h): k1 * k2 from jet fitting exactly as
// in CGAL's example Mesh_estimation.cpp (../curvature_stability/jet_fitting_example.h), on `rings` rings
// of neighbours (its option -a), with its Monge normal; or exact on an implicit surface, from the
// gradient and Hessian of F.

#include "surface.h"
#include "jet_fitting.h"

#include <stdexcept>
#include <string>

Estimates estimate(Mesh& mesh, const nlohmann::json& data, const ImplicitSurface* exact) {
  if (const ImplicitSurface* s = exact) {
    Estimates e{std::vector<double>(num_vertices(mesh)), std::vector<std::array<double, 3>>(num_vertices(mesh))};
    for (vertex_descriptor v : vertices(mesh)) {
      const Point& p = mesh.point(v);
      const Derivatives d = s->eval(p.x(), p.y(), p.z());
      const double len = vec(d.g).norm();
      e.K[v] = gaussian_curvature(d);
      e.N[v] = {d.g[0] / len, d.g[1] / len, d.g[2] / len};
    }
    return e;
  }
  const std::string method = data.value("method", "jet");
  if (method != "jet" && method != "jets") throw std::invalid_argument("method: expected \"jet\" or \"jets\"");
  const std::size_t n = num_vertices(mesh);
  std::vector<double> K(n);
  std::vector<std::array<double, 3>> N(n);
  const auto jet = fit_jets(mesh, data);
  for (std::size_t i = 0; i < n; ++i) {
    K[i] = jet[i].k1 * jet[i].k2;
    N[i] = jet[i].normal;
  }
  return {K, N};
}
