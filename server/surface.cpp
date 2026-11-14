// The mesh of a request (surface.h).

#include "surface.h"

#include <CGAL/Polygon_mesh_processing/orient_polygon_soup.h>
#include <CGAL/Polygon_mesh_processing/polygon_soup_to_polygon_mesh.h>
#include <CGAL/Polygon_mesh_processing/repair_polygon_soup.h>

#include <stdexcept>

Mesh read_surface(const nlohmann::json& data) {
  const auto xyz = data.at("vertices").get<std::vector<double>>();
  if (xyz.empty() || xyz.size() % 3 != 0)
    throw std::invalid_argument("vertices: need a flat array of x, y, z triples");
  std::vector<Point> points;
  for (std::size_t i = 0; i < xyz.size(); i += 3) points.emplace_back(xyz[i], xyz[i + 1], xyz[i + 2]);
  std::vector<std::array<std::size_t, 3>> triangles;
  for (const auto& s : data.at("simplices").get<std::vector<std::vector<long>>>()) {
    if (s.size() != 3) continue;  // only the triangles make the surface
    std::array<std::size_t, 3> t;
    for (int k = 0; k < 3; ++k) {
      if (s[k] < 0 || s[k] >= static_cast<long>(points.size()))
        throw std::invalid_argument("simplices: vertex index out of range");
      t[k] = static_cast<std::size_t>(s[k]);
    }
    triangles.push_back(t);
  }
  if (triangles.empty()) throw std::invalid_argument("needs a surface (triangles)");
  PMP::remove_isolated_points_in_polygon_soup(points, triangles);
  // Duplicates vertices where needed so that the result is an oriented 2-manifold.
  PMP::orient_polygon_soup(points, triangles);
  Mesh mesh;
  PMP::polygon_soup_to_polygon_mesh(points, triangles, mesh);
  return mesh;
}
