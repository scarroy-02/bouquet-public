// Jet fitting at the vertices of a mesh (jet_fitting.cpp), with the code of CGAL's example
// Mesh_estimation.cpp (../curvature_stability/jet_fitting_example.h): the estimated curvature and
// normals (estimate.cpp), and the jets the jet blend is made of (fitted_surface.cpp).
#pragma once

#include "surface.h"

#include "jet_fitting_example.h"

#include <vector>

// Jet fitting at every vertex as in CGAL's example (jet_fitting_example.h), on `rings` rings, with a
// jet and a Monge form of degree `degree`
std::vector<JetResult> fit_jets(const Mesh& mesh, const nlohmann::json& data);
