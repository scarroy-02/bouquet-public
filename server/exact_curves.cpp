// The exact curves on an implicit surface F = 0 (surface.h), from points near them: Newton's method
// onto the parabolic curve {F = 0, K = 0} (inflection set), and onto the pairs (p, q) with
// F(p) = F(q) = 0, grad F(p) parallel to grad F(q) and <p - q, grad F(p)> = 0 (simultaneity set);
// then the curves through these points, by continuation.

#include "surface.h"

#include <array>
#include <cmath>
#include <map>
#include <optional>
#include <vector>

namespace {

// grad K by central differences: K itself is exact, so this only affects the speed of Newton's
// method and the direction of the predictor steps
Eigen::Vector3d curvature_gradient(const ImplicitSurface& s, const Eigen::Vector3d& x) {
  const double h = 1e-6 * s.radius;
  Eigen::Vector3d gK;
  for (int k = 0; k < 3; ++k) {
    const Eigen::Vector3d e = h * Eigen::Vector3d::Unit(k);
    gK[k] = (gaussian_curvature(eval(s, x + e)) - gaussian_curvature(eval(s, x - e))) / (2 * h);
  }
  return gK;
}

using PairResidual = Eigen::Matrix<double, 5, 1>;
using PairJacobian = Eigen::Matrix<double, 5, 6>;

// The equations of a pair (p, q) with equal tangent planes, and their Jacobian in (p, q):
// F(p) = F(q) = 0, grad F(q) parallel to grad F(p), <p - q, grad F(p)> = 0. The parallel condition
// is taken in the plane normal to grad F(p) (2 equations), so the 5 equations are independent.
void pair_system(const ImplicitSurface& s, const Eigen::Vector3d& p, const Eigen::Vector3d& q, PairResidual& r,
                 PairJacobian& J) {
  const Derivatives dp = eval(s, p), dq = eval(s, q);
  const Eigen::Vector3d gp = vec(dp.g), gq = vec(dq.g);
  Eigen::Matrix3d Hp, Hq;
  for (int i = 0; i < 3; ++i)
    for (int j = 0; j < 3; ++j) Hp(i, j) = dp.H[i][j], Hq(i, j) = dq.H[i][j];
  const double np = gp.norm(), nq = gq.norm();
  // u, w: an orthonormal basis of the plane normal to grad F(p)
  const Eigen::Vector3d n = gp / np;
  const Eigen::Vector3d u = n.unitOrthogonal(), w = n.cross(u);
  J.setZero();
  r(0) = dp.f / np;
  J.block<1, 3>(0, 0) = gp.transpose() / np;
  r(1) = dq.f / nq;
  J.block<1, 3>(1, 3) = gq.transpose() / nq;
  // <grad F(q), u> and <grad F(q), w>. u and w turn with n as p moves: since <u, n> = 0,
  // <grad F(q), du> = -<grad F(q), n> <dn, u> + (terms that vanish on the solutions), with
  // dn = (I - n n^T) Hp dp / |grad F(p)|
  r(2) = gq.dot(u) / nq;
  J.block<1, 3>(2, 0) = -gq.dot(n) / np * (Hp * u).transpose() / nq;
  J.block<1, 3>(2, 3) = (Hq * u).transpose() / nq;
  r(3) = gq.dot(w) / nq;
  J.block<1, 3>(3, 0) = -gq.dot(n) / np * (Hp * w).transpose() / nq;
  J.block<1, 3>(3, 3) = (Hq * w).transpose() / nq;
  r(4) = (p - q).dot(gp) / np;
  J.block<1, 3>(4, 0) = (gp + Hp * (p - q)).transpose() / np;
  J.block<1, 3>(4, 3) = -gp.transpose() / np;
}

// Curves through the seeds, by continuation: step along the unit tangent, correct with Newton's
// method, repeat. A curve ends where the corrector fails (e.g. where p and q of a pair meet), where
// the tangent is undefined (the equations degenerate), or where it closes or runs into a curve
// traced before; it then ends exactly on that curve's point, so that the two join up. Seeds on a
// curve traced before are skipped. Points are in R^3 (a point) or R^6 (a pair), compared block by
// block of 3 coordinates.
//   other(z): the same point written another way (the pair (q, p) for (p, q)), or nothing
//   tangent(z): the unit tangent at z, or zero where the equations degenerate
//   correct(z, reach): Newton's method from z; false if it does not converge within reach
template <int D, class Other, class Tangent, class Correct>
std::vector<std::vector<Eigen::Matrix<double, D, 1>>> trace_curves(const std::vector<Eigen::Matrix<double, D, 1>>& seeds,
                                                                   double step, std::size_t max_points, Other other,
                                                                   Tangent tangent, Correct correct) {
  using Vec = Eigen::Matrix<double, D, 1>;
  struct Mark {
    int trace, index;
    Vec z;
  };
  std::map<std::array<long long, 3>, std::vector<Mark>> grid;  // by the first 3 coordinates, in cells of size step
  auto cell = [&](const Vec& z) {
    return std::array<long long, 3>{static_cast<long long>(std::floor(z[0] / step)),
                                    static_cast<long long>(std::floor(z[1] / step)),
                                    static_cast<long long>(std::floor(z[2] / step))};
  };
  auto mark = [&](const Vec& z, int trace, int index) { grid[cell(z)].push_back({trace, index, z}); };
  auto close = [&](const Vec& a, const Vec& b) {
    for (int k = 0; k < D; k += 3)
      if ((a.template segment<3>(k) - b.template segment<3>(k)).norm() > step / 2) return false;
    return true;
  };
  // The nearest traced point within step / 2 of z (or of z written the other way), other than the
  // last points of the same trace and the start of the trace the other way from the same seed (traces
  // 2k, 2k + 1)
  struct Met {
    Vec z;
    int trace, index;
  };
  auto meets = [&](const Vec& z, int trace, int index) -> std::optional<Met> {
    std::optional<Met> best;
    double best_distance = 0;
    for (int alt = 0; alt < 2; ++alt) {
      const std::optional<Vec> w = alt ? other(z) : std::optional<Vec>(z);
      if (!w) continue;
      const auto c = cell(*w);
      for (int dx = -1; dx <= 1; ++dx)
        for (int dy = -1; dy <= 1; ++dy)
          for (int dz = -1; dz <= 1; ++dz) {
            const auto it = grid.find({c[0] + dx, c[1] + dy, c[2] + dz});
            if (it == grid.end()) continue;
            for (const Mark& m : it->second) {
              if (!close(m.z, *w)) continue;
              if (m.trace == trace && m.index > index - 5) continue;
              if ((m.trace ^ 1) == trace && m.index < 5 && index < 5) continue;
              const double distance = (m.z - *w).norm();
              if (!best || distance < best_distance) {
                best = Met{alt ? *other(m.z) : m.z, m.trace, m.index};  // written as z is
                best_distance = distance;
              }
            }
          }
    }
    return best;
  };

  std::vector<std::vector<Vec>> curves;
  std::size_t points = 0;
  int traced = 0;
  for (const Vec& seed : seeds) {
    if (points >= max_points) break;
    if (meets(seed, -1, 0)) continue;
    const Vec t0 = tangent(seed);
    if (t0.isZero()) continue;
    std::vector<Vec> halves[2];
    std::size_t first = 0;  // where the curve starts in halves[0] (after its own start, for a loop)
    bool closed = false;
    for (int dir = 0; dir < 2 && !closed; ++dir) {
      const int trace = 2 * traced + dir;
      Vec z = seed, t = dir ? Vec(-t0) : t0;
      halves[dir].push_back(seed);
      mark(seed, trace, 0);
      for (int index = 1; points < max_points; ++index) {
        Vec next;
        bool ok = false;
        for (double ds = step; ds > step / 16 && !ok; ds /= 2) {
          next = z + ds * t;
          ok = correct(next, 2 * ds);
        }
        if (!ok) break;
        Vec tn = tangent(next);
        if (tn.isZero()) break;
        if (tn.dot(t) < 0) tn = -tn;
        ++points;
        if (const auto met = meets(next, trace, index)) {
          halves[dir].push_back(met->z);
          // Back at its own start: a closed loop, from the point it joined (no other half to trace)
          if (met->trace == trace) {
            closed = true;
            first = static_cast<std::size_t>(met->index);
          }
          break;
        }
        halves[dir].push_back(next);
        mark(next, trace, index);
        z = next;
        t = tn;
      }
    }
    ++traced;
    // One curve: the half traced backwards, reversed, then the half traced forwards
    std::vector<Vec> curve(halves[1].rbegin(), halves[1].rend());
    curve.insert(curve.end(), halves[0].begin() + (curve.empty() ? first : 1), halves[0].end());
    if (curve.size() > 1) curves.push_back(std::move(curve));
  }
  return curves;
}

}  // namespace

bool refine_parabolic(const ImplicitSurface& s, double reach, Eigen::Vector3d& x) {
  const Eigen::Vector3d start = x;
  for (int it = 0; it < 30; ++it) {
    const Derivatives d = eval(s, x);
    Eigen::Matrix<double, 2, 3> J;
    J.row(0) = vec(d.g).transpose();
    J.row(1) = curvature_gradient(s, x).transpose();
    const Eigen::Vector3d step = J.completeOrthogonalDecomposition().solve(-Eigen::Vector2d(d.f, gaussian_curvature(d)));
    x += step;
    if (!((x - start).norm() <= reach)) return false;  // also when F is undefined (NaN)
    if (step.norm() < 1e-12 * s.radius) return true;
  }
  return false;
}

bool refine_pair(const ImplicitSurface& s, double reach, double apart, Eigen::Vector3d& p, Eigen::Vector3d& q,
                 int iterations) {
  const Eigen::Vector3d p0 = p, q0 = q;
  PairResidual r;
  PairJacobian J;
  for (int it = 0; it < iterations; ++it) {
    pair_system(s, p, q, r, J);
    const Vector6d step = J.completeOrthogonalDecomposition().solve(-r);
    p += step.head<3>();
    q += step.tail<3>();
    if (!((p - p0).norm() <= reach && (q - q0).norm() <= reach)) return false;  // also when F is undefined
    if ((p - q).norm() < apart) return false;
    if (step.norm() < 1e-12 * s.radius) return true;
  }
  return false;
}

std::vector<std::vector<Vector6d>> trace_pairs(const ImplicitSurface& s, const std::vector<Vector6d>& seeds,
                                                double step, double apart, std::size_t max_points) {
  auto other = [](const Vector6d& z) -> std::optional<Vector6d> {
    Vector6d w;
    w << z.tail<3>(), z.head<3>();
    return w;
  };
  auto tangent = [&](const Vector6d& z) -> Vector6d {
    PairResidual r;
    PairJacobian J;
    pair_system(s, z.head<3>(), z.tail<3>(), r, J);
    if (!J.allFinite()) return Vector6d::Zero();
    const Eigen::JacobiSVD<PairJacobian> svd(J, Eigen::ComputeFullV);
    if (svd.singularValues()(4) < 1e-8 * svd.singularValues()(0)) return Vector6d::Zero();
    return svd.matrixV().col(5);
  };
  auto correct = [&](Vector6d& z, double reach) {
    Eigen::Vector3d p = z.head<3>(), q = z.tail<3>();
    const bool ok = refine_pair(s, reach, apart, p, q, 20);
    z << p, q;
    return ok;
  };
  return trace_curves<6>(seeds, step, max_points, other, tangent, correct);
}

std::vector<std::vector<Eigen::Vector3d>> trace_parabolic(const ImplicitSurface& s, const std::vector<Eigen::Vector3d>& seeds,
                                                          double step, std::size_t max_points) {
  auto other = [](const Eigen::Vector3d&) -> std::optional<Eigen::Vector3d> { return std::nullopt; };
  auto tangent = [&](const Eigen::Vector3d& x) -> Eigen::Vector3d {
    const Eigen::Vector3d g = vec(eval(s, x).g), gK = curvature_gradient(s, x), t = g.cross(gK);
    if (!t.allFinite() || t.norm() < 1e-8 * g.norm() * gK.norm()) return Eigen::Vector3d::Zero();
    return t.normalized();
  };
  auto correct = [&](Eigen::Vector3d& x, double reach) { return refine_parabolic(s, reach, x); };
  return trace_curves<3>(seeds, step, max_points, other, tangent, correct);
}
