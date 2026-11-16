// Implicit surfaces F(x) = 0, F < 0 inside, with exact derivatives (implicit.cpp): the presets, and
// the jet blend of a mesh. For these the normals and curvature are computed from F instead of
// being estimated from a mesh.
#pragma once

#include <array>
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

// F, its gradient and its Hessian at a point
struct Derivatives {
  double f;
  std::array<double, 3> g;
  std::array<std::array<double, 3>, 3> H;
};

struct ImplicitSurface {
  std::string name;
  double radius;  // the surface lies in the ball of this radius about the origin
  std::function<Derivatives(double x, double y, double z)> eval;
};

// nullptr if there is no surface with that name
const ImplicitSurface* find_implicit(const std::string& name);

// Gaussian curvature of the level set through the point: K = g^T adj(H) g / |g|^4 (Goldman 2005)
double gaussian_curvature(const Derivatives& d);

// Mesh of an implicit surface, with CGAL's Mesh_3 (surface only, vertices on the surface).
// Request:  {"surface": name, "level": 3 to 6 (each level has about 4 times the triangles)}
// Response: {"vertices": [x,y,z,...], "simplices": [[a,b,c], ...]}
// Throws std::invalid_argument on bad input.
nlohmann::json implicit_mesh(const nlohmann::json& data);

// A local fit at a point: the surface z = J(x, y) in the orthonormal frame (origin; d1, d2, n), with
// J given by Monge coefficients k1, k2, b0..b3, c0..c4 in the order of CGAL's Monge_via_jet_fitting:
//   J = (k1 x^2 + k2 y^2) / 2 + (b0 x^3 + 3 b1 x^2 y + 3 b2 x y^2 + b3 y^3) / 6
//       + (c0 x^4 + 4 c1 x^3 y + 6 c2 x^2 y^2 + 4 c3 x y^3 + c4 y^4) / 24.
// Fewer coefficients mean a lower degree.
struct LocalJet {
  std::array<double, 3> origin, d1, d2, n;
  std::vector<double> coefficients;
  double radius;  // of the fit's weight
};

// The implicit surface blending local fits (a partition of unity, as in Ohtake et al., "Multi-level
// partition of unity implicits", 2003): F(x) = sum_i w_i(x) g_i(x) / sum_i w_i(x), where
// g_i(x) = z - J_i(x, y) in the frame of fit i (zero on its surface), with the compactly supported
// weights w_i(x) = (1 - |x - o_i|^2 / R_i^2)^5, R_i the fit's radius. Where the total weight is under
// a fifth of its median at the origins (away from the surface), F is NaN.
std::shared_ptr<const ImplicitSurface> make_blended_surface(const std::vector<LocalJet>& fits);
