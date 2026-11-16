// Computations on a triangulated surface with CGAL: inflection_set.cpp, simultaneity_set.cpp, subdivide.cpp.
#pragma once

#include <nlohmann/json.hpp>

// Inflection set of the height functions (the PHT analogue of the focal set; the bifurcation set
// of the family in singularity theory): the directions v for which x -> <x, v> has a degenerate
// critical point. These are +-N(p) for the points p of the parabolic curve, where the Gaussian
// curvature K vanishes.
// K and the normals are estimated by jet fitting.
// Request:  {"vertices": [x,y,z,...], "simplices": [[a,b,c], ...], "method": "jet" | "jets",
//            "rings": a (rings of neighbours fitted, 0 = the fewest giving enough points; default 3),
//            "degree": d (of the jets, 2 to 4; default 2)}
// Response: {"points": [...], "normals": [...], "segments": n, "vertices": m, "negative": k, "skipped": s,
//            "dropped": d, "curves": c}
// With "method": "jets", the sets are computed exactly, as below, on the jet blend of the mesh
// (implicit.h): the jets fitted at the vertices ("rings", "degree"), with weights reaching "support"
// average edge lengths (default 4); the vertices are first moved onto it, and "unprojected" counts
// those that could not be.
// With "implicit": name (implicit.h), the surface is that implicit surface (the mesh must lie on it):
// normals and K are exact, the segments' ends are moved onto the exact curve by Newton's method,
// and the curves through them are traced exactly. "curves" counts them, and "dropped" counts the
// ends where Newton's method did not converge.
// Throws std::invalid_argument on bad input.
nlohmann::json inflection_set(const nlohmann::json& data);

// Simultaneity set of the height functions (the PHT analogue of the symmetry set; the Maxwell set
// of the family in singularity theory): the directions v for which x -> <x, v> has two critical
// points with the same value, i.e. the normals of the planes tangent to the surface at two points. Normals are estimated as for inflection_set
// (jet fitting on `rings` rings).
// Request:  {"vertices", "simplices", "method", "rings", "degree", "support", "implicit"} as for inflection_set
// Response: {"directions": [...], "first": [...], "second": [...], "segments": n, "folds": f, "vertices": m,
//            "dropped": d}
//   6 numbers per segment in each array: a piece of the simultaneity set on S^2 (one of each +-v pair),
//   and the two matching pieces of contact points on the surface. "folds" counts the crossings
//   dropped because the two triangles are within 3 average edge lengths (the image folds there).
// Throws std::invalid_argument on bad input, or past 100,000 segments.
nlohmann::json simultaneity_set(const nlohmann::json& data);

// A finer mesh of the jet blend of the mesh (with "rings", "degree" and "support", as for
// inflection_set), with every vertex on that surface. "scheme":
//   "coxeter"  (default): a new mesh, traced through a Coxeter triangulation of R^3 with GUDHI's
//              manifold tracing, as fine as `steps` midpoint subdivisions (closed meshes only);
//   "midpoint": `steps` (1 to 3) midpoint subdivisions of the mesh (each triangle into four);
//   "isotropic": the mesh itself remeshed with CGAL's isotropic remeshing, as fine as `steps` midpoint
//              subdivisions, keeping its sharp edges and boundary, and not moved onto the jet blend
//              (its fields are then not used).
// Request:  {"vertices", "simplices", "steps", "scheme", "rings", "degree", "support"}
// Response: {"vertices": [x,y,z,...], "simplices": [[a,b,c], ...], "unprojected": n, "input_euler": chi}
//   "input_euler" is the Euler characteristic of the mesh as read (non-manifold vertices split), to
//   compare with the result's: the Coxeter mesh follows F = 0, which can have other topology.
// Throws std::invalid_argument on bad input.
nlohmann::json subdivide(const nlohmann::json& data);
