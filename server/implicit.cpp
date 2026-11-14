// Implicit surfaces F(x) = 0 for the presets with exact normals and curvature.
//
// Each F is written once as a template; Eigen's AutoDiff (nested, for second derivatives) gives
// its exact gradient and Hessian. Meshes come from CGAL's Mesh_3 on the implicit domain, surface
// only. Chair and tanglecube are from CGAL's examples/Mesh_3/implicit_functions.cpp.

#include "implicit.h"

#include <CGAL/Exact_predicates_inexact_constructions_kernel.h>
#include <CGAL/Labeled_mesh_domain_3.h>
#include <CGAL/Mesh_complex_3_in_triangulation_3.h>
#include <CGAL/Mesh_criteria_3.h>
#include <CGAL/Mesh_triangulation_3.h>
#include <CGAL/Surface_mesh.h>
#include <CGAL/facets_in_complex_3_to_triangle_mesh.h>
#include <CGAL/make_mesh_3.h>

#include <Eigen/Dense>
#include <unsupported/Eigen/AutoDiff>

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <unordered_map>
#include <vector>

namespace {

// ---------- The surfaces ----------
// Round torus about the z axis, R = 3, r = 1.2 (as the Torus mesh preset)
struct Torus {
  template <class T>
  T operator()(const T& x, const T& y, const T& z) const {
    const double R = 3, r = 1.2;
    const T s = x * x + y * y + z * z + (R * R - r * r);
    return s * s - 4 * R * R * (x * x + y * y);
  }
};

// Two equal Gaussian blobs joined by a neck, symmetric under x -> -x
struct TwoBlobs {
  template <class T>
  T operator()(const T& x, const T& y, const T& z) const {
    using std::exp;
    const T r2 = y * y + z * z;
    return 0.5 - exp(-((x - 1.1) * (x - 1.1) + r2)) - exp(-((x + 1.1) * (x + 1.1) + r2));
  }
};

// Three unequal blobs, with no symmetry
struct ThreeBlobs {
  template <class T>
  T operator()(const T& x, const T& y, const T& z) const {
    using std::exp;
    const T a = (x - 1.125) * (x - 1.125) + y * y + z * z;
    const T b = (x + 0.9) * (x + 0.9) + (y - 0.54) * (y - 0.54) + (z - 0.18) * (z - 0.18);
    const T c = (x - 0.09) * (x - 0.09) + (y + 1.125) * (y + 1.125) + (z - 0.36) * (z - 0.36);
    return 0.5 - exp(-a) - exp(-b / 0.81) - 0.9 * exp(-c / 0.64);
  }
};

// Double torus: a tube about the figure eight x^4 - x^2 + y^2 = 0. Its thickness varies along the
// curve; with a constant one, the top would be a ridge at one height (degenerate, like the round
// torus)
struct DoubleTorus {
  template <class T>
  T operator()(const T& x, const T& y, const T& z) const {
    const T f = x * x * x * x - x * x + y * y;
    return f * f + z * z - (0.03 + 0.008 * x + 0.004 * y);
  }
};

// "Chair" (CGAL)
struct Chair {
  template <class T>
  T operator()(const T& x, const T& y, const T& z) const {
    const T x2 = x * x, y2 = y * y, z2 = z * z;
    return x2 * x2 - 1.2 * x2 * y2 + 3.6 * x2 * z2 - 7.50 * x2 + y2 * y2 + 3.6 * y2 * z2 - 7.50 * y2 + .2 * z2 * z2 -
           7.50 * z2 + 64.0625 - 16.0 * z * y2 + 16.0 * x2 * z;
  }
};

// "Tanglecube" (CGAL), genus 5
struct Tanglecube {
  template <class T>
  T operator()(const T& x, const T& y, const T& z) const {
    const T x2 = x * x, y2 = y * y, z2 = z * z;
    return x2 * x2 - 5 * x2 + y2 * y2 - 5 * y2 + z2 * z2 - 5 * z2 + 11.8;
  }
};

// ---------- Exact derivatives ----------
using A1 = Eigen::AutoDiffScalar<Eigen::Vector3d>;
using A2 = Eigen::AutoDiffScalar<Eigen::Matrix<A1, 3, 1>>;

template <class S>
Derivatives derivatives(double x, double y, double z) {
  const double p[3] = {x, y, z};
  A2 v[3];
  for (int i = 0; i < 3; ++i) {
    v[i] = A2(A1(p[i], 3, i), 3, i);
    for (int j = 0; j < 3; ++j) v[i].derivatives()(j).derivatives().setZero();
  }
  const A2 f = S{}(v[0], v[1], v[2]);
  Derivatives d;
  d.f = f.value().value();
  for (int i = 0; i < 3; ++i) {
    d.g[i] = f.value().derivatives()(i);
    for (int j = 0; j < 3; ++j) d.H[i][j] = f.derivatives()(i).derivatives()(j);
  }
  return d;
}

template <class S>
double value(double x, double y, double z) {
  return S{}(x, y, z);
}

struct Entry {
  ImplicitSurface surface;
  double (*value)(double, double, double);
};

const Entry SURFACES[] = {
    {{"torus", 4.5, &derivatives<Torus>}, &value<Torus>},
    {{"two-blobs", 2.4, &derivatives<TwoBlobs>}, &value<TwoBlobs>},
    {{"three-blobs", 2.4, &derivatives<ThreeBlobs>}, &value<ThreeBlobs>},
    {{"double-torus", 1.6, &derivatives<DoubleTorus>}, &value<DoubleTorus>},
    {{"chair", 6, &derivatives<Chair>}, &value<Chair>},
    {{"tanglecube", 4, &derivatives<Tanglecube>}, &value<Tanglecube>},
};

const Entry* find_entry(const std::string& name) {
  for (const Entry& e : SURFACES)
    if (e.surface.name == name) return &e;
  return nullptr;
}

// ---------- Meshing (Mesh_3) ----------
using K = CGAL::Exact_predicates_inexact_constructions_kernel;
using Mesh_domain = CGAL::Labeled_mesh_domain_3<K>;
using Tr = CGAL::Mesh_triangulation_3<Mesh_domain, CGAL::Default, CGAL::Sequential_tag>::type;
using C3t3 = CGAL::Mesh_complex_3_in_triangulation_3<Tr>;
using Mesh_criteria = CGAL::Mesh_criteria_3<Tr>;

}  // namespace

const ImplicitSurface* find_implicit(const std::string& name) {
  const Entry* e = find_entry(name);
  return e ? &e->surface : nullptr;
}

double gaussian_curvature(const Derivatives& d) {
  const auto& H = d.H;
  const auto& g = d.g;
  // adj(H), H symmetric
  const double a00 = H[1][1] * H[2][2] - H[1][2] * H[1][2], a11 = H[0][0] * H[2][2] - H[0][2] * H[0][2],
               a22 = H[0][0] * H[1][1] - H[0][1] * H[0][1], a01 = H[0][2] * H[1][2] - H[0][1] * H[2][2],
               a02 = H[0][1] * H[1][2] - H[0][2] * H[1][1], a12 = H[0][1] * H[0][2] - H[0][0] * H[1][2];
  const double gag = a00 * g[0] * g[0] + a11 * g[1] * g[1] + a22 * g[2] * g[2] +
                     2 * (a01 * g[0] * g[1] + a02 * g[0] * g[2] + a12 * g[1] * g[2]);
  const double g2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
  return gag / (g2 * g2);
}

nlohmann::json implicit_mesh(const nlohmann::json& data) {
  const Entry* e = find_entry(data.at("surface").get<std::string>());
  if (!e) throw std::invalid_argument("surface: unknown implicit surface");
  const int level = data.value("level", 4);
  if (level < 3 || level > 6) throw std::invalid_argument("level: expected 3 to 6");
  const double radius = e->surface.radius;
  const auto F = [e](const K::Point_3& p) { return e->value(p.x(), p.y(), p.z()); };
  const Mesh_domain domain = Mesh_domain::create_implicit_mesh_domain(
      F, K::Sphere_3(CGAL::ORIGIN, radius * radius), CGAL::parameters::relative_error_bound(1e-10));
  // Each level halves the facet size, so about 4 times the triangles
  const double size = radius * 0.64 * std::ldexp(1.0, -level);
  const Mesh_criteria criteria(CGAL::parameters::facet_angle(30).facet_size(size).facet_distance(size / 10));
  const C3t3 c3t3 = CGAL::make_mesh_3<C3t3>(domain, criteria, CGAL::parameters::surface_only().manifold());
  CGAL::Surface_mesh<K::Point_3> mesh;
  CGAL::facets_in_complex_3_to_triangle_mesh(c3t3, mesh);

  std::vector<double> xyz;
  for (auto v : vertices(mesh))
    for (int k = 0; k < 3; ++k) xyz.push_back(mesh.point(v)[k]);
  std::vector<std::array<std::size_t, 3>> triangles;
  for (auto f : faces(mesh)) {
    std::array<std::size_t, 3> t;
    int k = 0;
    for (auto u : vertices_around_face(halfedge(f, mesh), mesh)) t[k++] = u;
    triangles.push_back(t);
  }
  return {{"vertices", xyz}, {"simplices", triangles}};
}

// ---------- Blended local fits (the jet blend of a mesh) ----------
// F = A / B with A = sum_i w_i g_i, B = sum_i w_i. With u = x - o_i, R = R_i and s = |u|^2 / R^2 < 1:
// w = (1 - s)^5,  grad w = -(10 / R^2) (1 - s)^4 u,  Hess w = (80 / R^4) (1 - s)^3 u u^T - (10 / R^2) (1 - s)^4 I.
// With X, Y, Z the coordinates of u in the fit's frame: g = Z - J(X, Y),
// grad g = n - J_X d1 - J_Y d2,  Hess g = -(J_XX d1 d1^T + J_XY (d1 d2^T + d2 d1^T) + J_YY d2 d2^T).
// The weights are polynomials in |u|^2 and C^4 where they reach 0, so F is smooth and a neighbour
// search finds every term: each fit is listed in the grid cells its ball meets. F is left undefined
// where the total weight B is under a fifth of its median at the origins: further out, F is a ratio
// of a few small weights, close to a single fit, and has zero sets of its own.
namespace {

// J and its derivatives up to order 2 at (X, Y), for Monge coefficients k1, k2, b0..b3, c0..c4
struct JetValues {
  double J, JX, JY, JXX, JXY, JYY;
};

JetValues jet_values(const std::vector<double>& c, double X, double Y) {
  JetValues v{0, 0, 0, 0, 0, 0};
  const auto k = [&](std::size_t i) { return i < c.size() ? c[i] : 0.0; };
  const double k1 = k(0), k2 = k(1), b0 = k(2), b1 = k(3), b2 = k(4), b3 = k(5);
  const double c0 = k(6), c1 = k(7), c2 = k(8), c3 = k(9), c4 = k(10);
  const double X2 = X * X, Y2 = Y * Y, XY = X * Y;
  v.J = (k1 * X2 + k2 * Y2) / 2 + (b0 * X2 * X + 3 * b1 * X2 * Y + 3 * b2 * X * Y2 + b3 * Y2 * Y) / 6 +
        (c0 * X2 * X2 + 4 * c1 * X2 * XY + 6 * c2 * X2 * Y2 + 4 * c3 * XY * Y2 + c4 * Y2 * Y2) / 24;
  v.JX = k1 * X + (b0 * X2 + 2 * b1 * XY + b2 * Y2) / 2 + (c0 * X2 * X + 3 * c1 * X2 * Y + 3 * c2 * X * Y2 + c3 * Y2 * Y) / 6;
  v.JY = k2 * Y + (b1 * X2 + 2 * b2 * XY + b3 * Y2) / 2 + (c1 * X2 * X + 3 * c2 * X2 * Y + 3 * c3 * X * Y2 + c4 * Y2 * Y) / 6;
  v.JXX = k1 + b0 * X + b1 * Y + (c0 * X2 + 2 * c1 * XY + c2 * Y2) / 2;
  v.JXY = b1 * X + b2 * Y + (c1 * X2 + 2 * c2 * XY + c3 * Y2) / 2;
  v.JYY = k2 + b2 * X + b3 * Y + (c2 * X2 + 2 * c3 * XY + c4 * Y2) / 2;
  return v;
}

class BlendedSurface {
 public:
  explicit BlendedSurface(const std::vector<LocalJet>& fits) {
    const auto vec = [](const std::array<double, 3>& a) { return Eigen::Vector3d(a[0], a[1], a[2]); };
    std::vector<double> radii;
    for (const auto& f : fits) radii.push_back(f.radius);
    std::nth_element(radii.begin(), radii.begin() + radii.size() / 2, radii.end());
    cell_ = radii[radii.size() / 2];
    for (std::size_t i = 0; i < fits.size(); ++i) {
      o_.push_back(vec(fits[i].origin));
      n_.push_back(vec(fits[i].n).normalized());
      d1_.push_back(vec(fits[i].d1));
      d2_.push_back(vec(fits[i].d2));
      c_.push_back(fits[i].coefficients);
      R_.push_back(fits[i].radius);
      // every cell the fit's ball meets
      const auto lo = cell(o_.back() - Eigen::Vector3d::Constant(R_.back()));
      const auto hi = cell(o_.back() + Eigen::Vector3d::Constant(R_.back()));
      for (long long a = lo[0]; a <= hi[0]; ++a)
        for (long long b = lo[1]; b <= hi[1]; ++b)
          for (long long d = lo[2]; d <= hi[2]; ++d) grid_[{a, b, d}].push_back(static_cast<int>(i));
    }
    std::vector<double> B(o_.size());
    for (std::size_t i = 0; i < o_.size(); ++i) B[i] = total_weight(o_[i]);
    std::nth_element(B.begin(), B.begin() + B.size() / 2, B.end());
    min_weight_ = 0.2 * B[B.size() / 2];
  }

  // The sum of the weights at x
  double total_weight(const Eigen::Vector3d& x) const {
    double B = 0;
    for_neighbours(x, [&](int i) {
      const double s = (x - o_[i]).squaredNorm() / (R_[i] * R_[i]);
      if (s < 1) B += std::pow(1 - s, 5);
    });
    return B;
  }

  Derivatives operator()(double x0, double y0, double z0) const {
    const Eigen::Vector3d x(x0, y0, z0);
    double A = 0, B = 0;
    Eigen::Vector3d gA = Eigen::Vector3d::Zero(), gB = Eigen::Vector3d::Zero();
    Eigen::Matrix3d HA = Eigen::Matrix3d::Zero(), HB = Eigen::Matrix3d::Zero();
    for_neighbours(x, [&](int i) {
      const Eigen::Vector3d u = x - o_[i];
      const double R2 = R_[i] * R_[i];
      const double s = u.squaredNorm() / R2;
      if (s >= 1) return;
      const double a = 1 - s, a3 = a * a * a, a4 = a3 * a, w = a4 * a;
      const Eigen::Vector3d gw = -(10 / R2) * a4 * u;
      const Eigen::Matrix3d Hw = (80 / (R2 * R2)) * a3 * u * u.transpose() - (10 / R2) * a4 * Eigen::Matrix3d::Identity();
      // The fit's g and its derivatives
      double g = u.dot(n_[i]);
      Eigen::Vector3d gg = n_[i];
      Eigen::Matrix3d Hg = Eigen::Matrix3d::Zero();
      if (!c_[i].empty()) {
        const JetValues J = jet_values(c_[i], u.dot(d1_[i]), u.dot(d2_[i]));
        const Eigen::Vector3d &d1 = d1_[i], &d2 = d2_[i];
        g -= J.J;
        gg -= J.JX * d1 + J.JY * d2;
        Hg = -(J.JXX * d1 * d1.transpose() + J.JXY * (d1 * d2.transpose() + d2 * d1.transpose()) + J.JYY * d2 * d2.transpose());
      }
      A += w * g;
      B += w;
      gA += gw * g + w * gg;
      gB += gw;
      HA += Hw * g + gw * gg.transpose() + gg * gw.transpose() + w * Hg;
      HB += Hw;
    });
    Derivatives r;
    if (!(B >= min_weight_)) {  // too far from the fits (also if x is not finite)
      const double nan = std::numeric_limits<double>::quiet_NaN();
      r.f = nan;
      r.g = {nan, nan, nan};
      for (auto& row : r.H) row = {nan, nan, nan};
      return r;
    }
    const double F = A / B;
    const Eigen::Vector3d g = (gA - F * gB) / B;
    const Eigen::Matrix3d H = (HA - F * HB - g * gB.transpose() - gB * g.transpose()) / B;
    r.f = F;
    for (int i = 0; i < 3; ++i) {
      r.g[i] = g[i];
      for (int j = 0; j < 3; ++j) r.H[i][j] = H(i, j);
    }
    return r;
  }

 private:
  // Calls f(i) for the fits i listed in the grid cell of x (all those whose ball contains x, and more)
  template <class Function>
  void for_neighbours(const Eigen::Vector3d& x, Function f) const {
    if (!x.allFinite()) return;
    const auto it = grid_.find(cell(x));
    if (it != grid_.end())
      for (int i : it->second) f(i);
  }

  struct CellHash {
    std::size_t operator()(const std::array<long long, 3>& k) const {
      return std::hash<long long>()(k[0] * 73856093LL ^ k[1] * 19349663LL ^ k[2] * 83492791LL);
    }
  };
  std::array<long long, 3> cell(const Eigen::Vector3d& x) const {
    return {static_cast<long long>(std::floor(x[0] / cell_)), static_cast<long long>(std::floor(x[1] / cell_)),
            static_cast<long long>(std::floor(x[2] / cell_))};
  }

  double cell_ = 1, min_weight_ = 0;
  std::vector<double> R_;
  std::vector<Eigen::Vector3d> o_, n_, d1_, d2_;
  std::vector<std::vector<double>> c_;
  std::unordered_map<std::array<long long, 3>, std::vector<int>, CellHash> grid_;
};

}  // namespace

std::shared_ptr<const ImplicitSurface> make_blended_surface(const std::vector<LocalJet>& fits) {
  if (fits.empty()) throw std::invalid_argument("blended surface: no fits");
  auto blend = std::make_shared<const BlendedSurface>(fits);
  double radius = 0;
  for (const auto& f : fits)
    radius = std::max(radius, std::sqrt(f.origin[0] * f.origin[0] + f.origin[1] * f.origin[1] + f.origin[2] * f.origin[2]) + f.radius);
  return std::make_shared<const ImplicitSurface>(
      ImplicitSurface{"blend", radius, [blend](double x, double y, double z) { return (*blend)(x, y, z); }});
}
