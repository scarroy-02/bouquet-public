// Steps shared by the surface computations of cgal_surface.h (inflection_set.cpp,
// simultaneity_set.cpp, subdivide.cpp), one file each: the mesh of a request (surface.cpp), the
// normals and curvature at its vertices (estimate.cpp, with jet_fitting.cpp), the surface fitted
// through it (fitted_surface.cpp), and the exact curves on an implicit surface (exact_curves.cpp).
#pragma once

#include "implicit.h"

#include <CGAL/Exact_predicates_inexact_constructions_kernel.h>
#include <CGAL/Polygon_mesh_processing/measure.h>
#include <CGAL/Surface_mesh.h>

#include <Eigen/Dense>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <atomic>
#include <cstddef>
#include <memory>
#include <thread>
#include <vector>

using Kernel = CGAL::Exact_predicates_inexact_constructions_kernel;
using Point = Kernel::Point_3;
using Mesh = CGAL::Surface_mesh<Point>;
using vertex_descriptor = Mesh::Vertex_index;
namespace PMP = CGAL::Polygon_mesh_processing;

inline Eigen::Vector3d vec(const std::array<double, 3>& a) { return {a[0], a[1], a[2]}; }

inline Derivatives eval(const ImplicitSurface& s, const Eigen::Vector3d& x) { return s.eval(x[0], x[1], x[2]); }

// Runs f(0), ..., f(n - 1) on all hardware threads; f must be safe to call concurrently
template <class F>
void parallel_for(std::size_t n, F f) {
  std::atomic<std::size_t> next{0};
  std::vector<std::thread> threads(std::max(1u, std::thread::hardware_concurrency()));
  for (std::thread& t : threads)
    t = std::thread([&] {
      for (std::size_t i; (i = next.fetch_add(1)) < n;) f(i);
    });
  for (std::thread& t : threads) t.join();
}

// ========== surface.cpp ==========
// The triangles of the request ("vertices", "simplices") as an oriented 2-manifold mesh, with
// vertices duplicated where needed
Mesh read_surface(const nlohmann::json& data);

// ========== estimate.cpp ==========
// Gaussian curvature and unit normal at every vertex: exact on the exact surface if there is one,
// otherwise estimated by jet fitting, with the request's rings and degree
struct Estimates {
  std::vector<double> K;
  std::vector<std::array<double, 3>> N;
};

Estimates estimate(Mesh& mesh, const nlohmann::json& data, const ImplicitSurface* exact);

// ========== fitted_surface.cpp ==========
// Newton's method along the gradient, from x onto F = 0; false if it does not converge within
// `reach` of the start
bool project_onto(const ImplicitSurface& s, double reach, Eigen::Vector3d& x);

// The jet blend of the mesh (implicit.h): the blend of the jets fitted at its vertices, with the
// request's rings and degree. The weight of a vertex reaches `support` (default 4) times the mean
// length of its edges, so that unevenly sampled meshes are covered everywhere. `reach` is set to the
// largest of these radii.
std::shared_ptr<const ImplicitSurface> fitted_surface(const Mesh& mesh, const nlohmann::json& data, double& reach);

// The exact surface for the request, or nullptr for estimated sets: the implicit preset it names, or
// for "method": "jets" the jet blend of the mesh (fitted_surface), onto which the vertices are then
// moved; `unprojected` counts those that could not be.
std::shared_ptr<const ImplicitSurface> exact_surface(Mesh& mesh, const nlohmann::json& data, std::size_t& unprojected);

// ========== exact_curves.cpp ==========
using Vector6d = Eigen::Matrix<double, 6, 1>;

// Newton's method with minimum-norm steps, from x onto the parabolic curve {F = 0, K = 0}; false
// if it does not converge within `reach` of the start
bool refine_parabolic(const ImplicitSurface& s, double reach, Eigen::Vector3d& x);

// Newton's method with minimum-norm steps, from (p, q) onto the pairs with equal tangent planes.
// False if it does not converge within `reach` of the start, or if p and q come within `apart`
// (the diagonal p = q solves the equations too).
bool refine_pair(const ImplicitSurface& s, double reach, double apart, Eigen::Vector3d& p, Eigen::Vector3d& q,
                 int iterations = 40);

// The curves of exact pairs through the seeds (pairs found by refine_pair). The tangent is the
// null vector of the Jacobian; a curve also ends where p and q come within `apart`.
std::vector<std::vector<Vector6d>> trace_pairs(const ImplicitSurface& s, const std::vector<Vector6d>& seeds,
                                                double step, double apart, std::size_t max_points);

// The curves of the parabolic set {F = 0, K = 0} through the seeds (points found by
// refine_parabolic). The tangent is grad F x grad K; it vanishes where grad K is normal to the
// surface (K has a critical point on the surface there).
std::vector<std::vector<Eigen::Vector3d>> trace_parabolic(const ImplicitSurface& s, const std::vector<Eigen::Vector3d>& seeds,
                                                          double step, std::size_t max_points);
