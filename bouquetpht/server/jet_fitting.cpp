// Jet fitting at every vertex (jet_fitting.h).

#include "jet_fitting.h"

#include <CGAL/IO/OFF.h>

#include <mutex>
#include <sstream>
#include <stdexcept>

namespace {

// The example's fitting parameters are globals; one request at a time sets them.
std::mutex jet_mutex;

}  // namespace

std::vector<JetResult> fit_jets(const Mesh& mesh, const nlohmann::json& data) {
  const int rings = data.value("rings", static_cast<int>(nb_rings)), degree = data.value("degree", 2);
  if (rings < 0 || rings > 20) throw std::invalid_argument("rings: expected 0 to 20");
  if (degree < 2 || degree > 4) throw std::invalid_argument("degree: expected 2 to 4");
  std::stringstream off;
  CGAL::IO::write_OFF(off, mesh, CGAL::parameters::stream_precision(17));
  std::vector<JetResult> jet;
  {
    // The example's settings are globals: set them for this request, then restore them
    std::lock_guard<std::mutex> lock(jet_mutex);
    const unsigned int saved[4] = {nb_rings, d_fitting, d_monge, min_nb_points};
    nb_rings = static_cast<unsigned int>(rings);
    d_fitting = d_monge = static_cast<unsigned int>(degree);
    min_nb_points = (d_fitting + 1) * (d_fitting + 2) / 2;
    jet = jet_fitting_as_in_example(off);
    nb_rings = saved[0], d_fitting = saved[1], d_monge = saved[2], min_nb_points = saved[3];
  }
  if (jet.size() != num_vertices(mesh)) throw std::invalid_argument("jet fitting could not read the surface");
  return jet;
}
