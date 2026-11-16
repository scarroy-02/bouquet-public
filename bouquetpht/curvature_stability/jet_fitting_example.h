// Jet fitting on a surface mesh exactly as in CGAL's example
// examples/Jet_fitting_3/Mesh_estimation.cpp (CGAL 6.2.1). Its helper headers PolyhedralSurf*.h
// are copied next to this file unchanged; the code between the two markers below is the
// example's, with `inline` added so that it can live in a header, and 3 rings by default
// instead of the example's 0 (the fewest rings giving enough points).
// Used by gaussian_curvature.cpp and by the BouquetPHT server (inflection set of the PHT).

#ifndef JET_FITTING_EXAMPLE_H
#define JET_FITTING_EXAMPLE_H

#include <CGAL/Simple_cartesian.h>
#include <CGAL/Monge_via_jet_fitting.h>
#include <CGAL/property_map.h>

#include <array>
#include <istream>
#include <limits>
#include <map>
#include <vector>

#include "PolyhedralSurf.h"
#include "PolyhedralSurf_operations.h"
#include "PolyhedralSurf_rings.h"

// ========== From examples/Jet_fitting_3/Mesh_estimation.cpp (CGAL 6.2.1) ==========
//Kernel of the PolyhedralSurf
typedef double                DFT;
typedef CGAL::Simple_cartesian<DFT>  Data_Kernel;
typedef Data_Kernel::Point_3  DPoint;
typedef Data_Kernel::Vector_3 DVector;

//HDS
typedef PolyhedralSurf::Vertex_handle Vertex_handle;
typedef PolyhedralSurf::Vertex Vertex;
typedef PolyhedralSurf::Halfedge_handle Halfedge_handle;
typedef PolyhedralSurf::Halfedge Halfedge;
typedef PolyhedralSurf::Vertex_iterator Vertex_iterator;
typedef PolyhedralSurf::Facet_handle Facet_handle;
typedef PolyhedralSurf::Facet Facet;

struct Facet_cmp{
  bool operator()(Facet_handle a, Facet_handle b) const{
    return &*a < &*b;
  }
};

//Vertex property map, with std::map
typedef std::map<Vertex*, int> Vertex2int_map_type;
typedef boost::associative_property_map< Vertex2int_map_type > Vertex_PM_type;
typedef T_PolyhedralSurf_rings<PolyhedralSurf, Vertex_PM_type > Poly_rings;

//Facet PM, with std::map
typedef std::map<Facet_handle, Vector_3, Facet_cmp> Facet2normal_map_type;
typedef boost::associative_property_map<Facet2normal_map_type> Facet_PM_type;
typedef T_PolyhedralSurf_facet_ops<PolyhedralSurf, Facet_PM_type> Poly_facet_ops;

typedef CGAL::Monge_via_jet_fitting<Data_Kernel> My_Monge_via_jet_fitting;
typedef My_Monge_via_jet_fitting::Monge_form My_Monge_form;

// default parameter values and global variables
inline unsigned int d_fitting = 2;
inline unsigned int d_monge = 2;
inline unsigned int nb_rings = 3;//0: seek min # of rings to get the required #pts (the example's default)
inline unsigned int nb_points_to_use = 0;//
inline unsigned int min_nb_points = (d_fitting + 1) * (d_fitting + 2) / 2;

//gather points around the vertex v using rings on the
//polyhedralsurf. the collection of points resorts to 3 alternatives:
// 1. the exact number of points to be used
// 2. the exact number of rings to be used
// 3. nothing is specified
inline void gather_fitting_points(Vertex* v,
                                  std::vector<DPoint> &in_points,
                                  Vertex_PM_type& vpm)
{
  //container to collect vertices of v on the PolyhedralSurf
  std::vector<Vertex*> gathered;
  //initialize
  in_points.clear();

  //OPTION -p nb_points_to_use, with nb_points_to_use != 0. Collect
  //enough rings and discard some points of the last collected ring to
  //get the exact "nb_points_to_use"
  if ( nb_points_to_use != 0 ) {
    Poly_rings::collect_enough_rings(v, nb_points_to_use, gathered, vpm);
    if ( gathered.size() > nb_points_to_use ) gathered.resize(nb_points_to_use);
  }
  else { // nb_points_to_use=0, this is the default and the option -p is not considered;
    // then option -a nb_rings is checked. If nb_rings=0, collect
    // enough rings to get the min_nb_points required for the fitting
    // else collect the nb_rings required
    if ( nb_rings == 0 )
      Poly_rings::collect_enough_rings(v, min_nb_points, gathered, vpm);
    else Poly_rings::collect_i_rings(v, nb_rings, gathered, vpm);
  }

  //store the gathered points
  std::vector<Vertex*>::iterator
    itb = gathered.begin(), ite = gathered.end();
  CGAL_For_all(itb,ite) in_points.push_back((*itb)->point());
}
// ========== End of the code from the example ==========

struct JetResult {
  double k1, k2;                  // Monge coefficients 0 and 1 (k_max, k_min); nan if the vertex was skipped
  std::size_t points;             // number of points used for the fit
  double condition;               // condition number of the least-squares fit
  std::array<double, 3> normal;   // Monge normal (after comply_wrt_given_normal)
  // The whole Monge form: the fitted surface is z = J(x, y) in the frame (origin; d1, normal) with
  // y along d2, and coefficients k1, k2, b0..b3, c0..c4 up to the Monge degree (CGAL's order)
  std::array<double, 3> origin, d1, d2;
  std::vector<double> coefficients;
};

// The example's main loop, on a PolyhedralSurf read from `off` exactly as the example reads its file.
// Results are in the order of the vertices in the OFF data.
inline std::vector<JetResult> jet_fitting_as_in_example(std::istream& off) {
  const double nan = std::numeric_limits<double>::quiet_NaN();
  PolyhedralSurf P;
  off >> P;

  //create property maps
  //Vertex, using a std::map
  Vertex2int_map_type vertex2props;
  Vertex_PM_type vpm(vertex2props);
  //Facet PM, with std::map
  Facet2normal_map_type facet2props;
  Facet_PM_type fpm(facet2props);
  //initialize Polyhedral data : normal of facets
  Poly_facet_ops::compute_facets_normals(P, fpm);

  //MAIN LOOP: perform calculation for each vertex
  std::vector<JetResult> results;
  std::vector<DPoint> in_points;  //container for data points
  Vertex_iterator vitb, vite;
  //initialize the tag of all vertices to -1
  vitb = P.vertices_begin(); vite = P.vertices_end();
  CGAL_For_all(vitb,vite) put(vpm, &(*vitb), -1);

  vitb = P.vertices_begin(); vite = P.vertices_end();
  for (; vitb != vite; vitb++) {
    //initialize
    Vertex* v = &(*vitb);
    in_points.clear();
    My_Monge_form monge_form;

    //gather points around the vertex using rings
    gather_fitting_points(v, in_points, vpm);

    //skip if the nb of points is to small
    if ( in_points.size() < min_nb_points ) {
      results.push_back({nan, nan, in_points.size(), nan, {nan, nan, nan}, {nan, nan, nan}, {nan, nan, nan}, {nan, nan, nan}, {}});
      continue;
    }

    // perform the fitting
    My_Monge_via_jet_fitting monge_fit;
    monge_form = monge_fit(in_points.begin(), in_points.end(),
                           d_fitting, d_monge);
    //switch min-max ppal curv/dir wrt the mesh orientation
    const DVector normal_mesh = Poly_facet_ops::compute_vertex_average_unit_normal(v, fpm);
    monge_form.comply_wrt_given_normal(normal_mesh);

    const DVector n = monge_form.normal_direction(), d1 = monge_form.maximal_principal_direction(),
                  d2 = monge_form.minimal_principal_direction();
    const DPoint o = monge_form.origin();
    results.push_back({monge_form.coefficients()[0], monge_form.coefficients()[1],
                       in_points.size(), monge_fit.condition_number(), {n.x(), n.y(), n.z()},
                       {o.x(), o.y(), o.z()}, {d1.x(), d1.y(), d1.z()}, {d2.x(), d2.y(), d2.z()},
                       monge_form.coefficients()});
  }
  return results;
}

#endif
