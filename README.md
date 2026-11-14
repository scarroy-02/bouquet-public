# BouquetPHT

The 3D counterpart of [Bouquet2D](https://bouquet2d.rohitroy.me), for the persistent homology transform (PHT):
vineyards of extended persistence for the height in a direction moving along a loop on the sphere, for surfaces,
space curves and any simplicial complex in R³. As a bonus, it also does the radial transform: the squared
distance from a center moving along an observation loop. The interface uses Bouquet2D's look, with a 3D viewport whose navigation follows the
usual 3D-modeling conventions (Z up, orbit/pan/zoom, numpad views).

**Status (v0.1):** input of the complex and of the observation loop or direction loop, and the vineyard with
the persistence diagram of each center or direction. For PHT, the inflection and simultaneity sets of a surface
(the analogues of the focal and symmetry sets): estimated on meshes, exact on implicit surfaces. They are not
computed yet for the radial transform.

## Run

```bash
cd server
make            # needs g++, Boost, CGAL 6.2.1 (in /usr/local/include), Eigen 3, GMP and MPFR;
                # GUDHI, cpp-httplib and nlohmann/json are vendored
./server        # then open http://localhost:7860
```

The server computes the persistence and also serves the app. Run `make test` (needs Python with `numpy` and
`gudhi`) to check its diagrams, for both functions, against GUDHI's Python `extended_persistence()`.

## Desktop app

[`desktop/`](desktop) packages the app and its server as one program for Linux (`.AppImage`), Windows (a
portable `.exe`) and macOS (`.dmg`). It is an Electron window, whose own Chromium shows the app the same way
on every computer, around the server built with `make PORTABLE=1`, which needs no libraries: CGAL then uses
Boost.Multiprecision instead of GMP and MPFR, with the same results. The app starts the server on a free local
port and stops it when it quits, and it works offline (three.js, Plotly and the fonts are in
[`vendor/`](vendor)).

**Builds.** The workflow [`.github/workflows/desktop.yml`](.github/workflows/desktop.yml) builds the three,
after checking each server with `test_server.py`. Pushing a tag such as `v0.1.0` (the version in
`desktop/package.json`) attaches them to the GitHub release of that tag; *Actions → Desktop app → Run
workflow* builds them without a release, as artifacts of the run.

**First launch.** The apps are not signed with an Apple or Windows certificate, so the systems ask once:
- macOS: open it, then *System Settings → Privacy & Security → Open Anyway* (or run
  `xattr -dr com.apple.quarantine /Applications/BouquetPHT.app`);
- Windows: *Windows protected your PC → More info → Run anyway*;
- Linux: make the AppImage executable (`chmod +x BouquetPHT-*.AppImage`) and run it.

**Build it here** (needs Node.js 22.12 or later):

```bash
cd server && make clean && make PORTABLE=1 && cd ../desktop
npm ci
npm start                   # the app from this repository
npx electron-builder        # the app for this system, in desktop/dist
```

## Inputs

| What | How |
|---|---|
| Simplicial complex | `.json` with vertex coordinates and simplices, see below |
| Surface | Triangle mesh, `.obj` or `.off`; polygons are fan-triangulated, OBJ `l` and `p` lines become edges and points |
| Space curve | `.csv` of `x,y,z` points, joined in order (closed by default) |
| Bouquet2D figure | `.sspl` with one closed curve: Bouquet2D's spline through its points, sampled 16 times per point |
| Observation loop | A circle (center, radius, normal), or a `.csv` of `x,y,z` points: a smooth spline through them, closed or open |

### Simplicial complexes (`.json`)

```json
{
  "vertices": [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [2, 2, 2], [3, 0, 0]],
  "simplices": [[0, 1, 2, 3], [3, 4]]
}
```

Every vertex is a 0-simplex (here vertex 5 is an isolated point). A simplex is a list of 0-based vertex
indices, from a point up to a tetrahedron, and its faces are implied, so listing the maximal simplices is
enough. The file is taken literally: vertices are never merged. To write one from Python with GUDHI, or from
Mathematica:

```python
json.dump({"vertices": points.tolist(), "simplices": [s for s, _ in st.get_simplices()]},
          open("complex.json", "w"))
```

```mathematica
Export["complex.json", <|"vertices" -> points, "simplices" -> simplices - 1|>]
```

### Meshes and curves

CSV files may have a header naming the `x`, `y`, `z` columns. Without a header, the first three columns are
used, and two columns mean `z = 0`, so Bouquet2D curves load as planar curves. In meshes and curves, vertices
with identical coordinates are merged, so meshes split at seams still have the right topology. The
Statistics section shows the dimension, Euler characteristic, components, orientability and boundary edges.

### Examples

The toolbar's presets are files in [`assets/`](assets), as in Bouquet2D, and load as if opened, so *Subdivide*
(Complex section) refines a preset surface. The implicit surfaces are the exception: the server meshes them, at
the level of the *Mesh* slider (see below). `assets/` has:
- `ellipsoid.obj` (semi-axes 4, 2.5, 1.6) and `peanut.obj`, 5,120 triangles each from a subdivided icosahedron,
  and `torus.obj` (R = 3, r = 1.2, 4,608 triangles);
- `trefoil.csv` and `ellipse.csv` (in the plane z = 0): 240 points of their formulas;
- `deformed_ellipse.sspl`, Bouquet2D's deformed ellipse, and `lifted_tube.obj`, a tube around its lift (see below);
- `bouquet.json`: a sphere with two circles attached at single vertices (S² ∨ S¹ ∨ S¹);
- `mobius_band.json`: non-orientable, with one boundary circle;
- `solid_cube.json`: a cube cut into tetrahedra;
- `bumpy_torus.obj` with `meridian_loop.csv`, a loop around its tube;
- `figure_eight_knot.csv`, a space curve.

The *Deformed Ellipse, lifted* preset (Curve) is Bouquet2D's deformed ellipse, whose radial transform has
monodromy, on the paraboloid z = 0.2 (x² + y²), with x and y as in Bouquet2D. On the lift, the height in the
direction (−0.4 c, 1) is 0.2 (|γ − c|² − |c|²), so its PHT contains Bouquet2D's radial transform: the center c
is the direction (−0.4 c, 1)/|(−0.4 c, 1)| of the upper hemisphere, and the persistence diagrams agree after that
change of values (on the server's diagrams of the two meshes, for 12 centers and every kind of pair, to 3·10⁻¹⁵).
The equator holds the centers at infinity, where the radial transform cannot go: the heights of the planar
curve. Its sets are the image of the evolute (focal set), which crosses the equator at the curve's 4
inflections, and of the symmetry set.

### Exact sets of curves

For a closed curve with a smooth parametrization, *Inflection Set* and *Simultaneity Set* are computed exactly on
the page (`js/curve-sets.js`), whatever the method: the inflection set is ± the binormals Γ′ × Γ″, and the
simultaneity set is traced as the zero set of F(t, s) = det(Γ′(t), Γ′(s), Γ(t) − Γ(s)) / (2 sin((s − t)/2))⁴ on the
swap quotient of the torus of pairs (marching squares, joined into paths, minimum-norm Newton onto F = 0, the ends
closed at the zeros of F(t, t) = det(Γ′, Γ″, Γ‴)/12, the torsion zeros, which for a lift are the vertices of γ).
They are drawn on the sphere only. The curve is Bouquet2D's closed spline through the points of a closed `.csv`
curve or of a Bouquet2D figure (`.sspl`, one closed curve), as the curve presets are, so a Bouquet2D curve is the
same curve here. It is C², so its vertices can fall at the joins.

A plane curve (the Ellipse preset, a 2-column `.csv`, an `.sspl`) has degenerate sets of its own: every height
normal to its plane is constant. *Lift to z = λ (x² + y²)* (Complex section) puts it on the paraboloid, λ by
default such that the lift is about as high as the curve is wide (any λ > 0 gives the same sets, up to a change
of directions). Then the direction (−2λc, 1) is the center c of the radial transform, and in the upper hemisphere
the two sets are those of the plane curve, its focal set and its symmetry set. On the Ellipse they are the evolute
and the two axes between its cusps.

*Deformed Ellipse, lifted tube* (Surface) thickens that curve into a closed surface: a tube of radius 0.1 around
it (`assets/lifted_tube.obj`), narrower where the curve comes close to itself so that it stays embedded.
At the tip of the finger the radius of curvature is only 0.014, and the tube narrows to 0.008 there. A tube's
parabolic curves are where its normal is ± the binormal of the curve, so its inflection set is the curve's
bifurcation set (exactly where the radius is constant). Its simultaneity set contains the curve's (two points on
the same side of the tube) and pairs on opposite sides, whose heights on the curve differ by twice the radius:
nearby copies of the curve's set. With 16 vertices around (44,160 triangles), measured against the
curve's exact sets:
- the *Jet blend* (which the preset selects) breaks the parabolic curves into many short pieces on this thin
  tube (283 curves; 74 % within 2°, and fewer with 32 vertices around), and its simultaneity set has 20,718
  segments in 428 curves (13 s);
- *Jet fitting* finds 36 % of the inflection set within 2° (90 % with 32 vertices around), and its simultaneity
  set has too many segments to show (132,478).

## Vineyard

The loop is sampled at *Samples* centers, uniformly by arc length. For each center *c*, the server builds the
lower-star filtration of *f(x) = |x − c|²* on the complex and computes its extended persistence with GUDHI.
The diagrams are stacked along the loop: *birth* and *death* on the horizontal axes, *time* (the center's
index) vertically. The timeline scrubs through the centers.

Colors follow Bouquet2D, with H₂ and H₃ added; within each dimension they are ordinary/relative/extended:
- H₀: red/orange/yellow
- H₁: blue/cyan/purple
- H₂: green/lime/pink
- H₃: grays

The marker shape also gives the kind: circle, square or diamond.

**Min pers.** (Vineyard section) hides pairs with |death − birth| below a fraction of the largest
function value. Nothing is recomputed. On a triangulation, the piecewise-linear function has extra critical
points within about one triangle of the true ones. They show up as short pairs on the diagonal that blink on
and off along the loop. On the ellipsoid preset they are at most 3·10⁻⁴ of the range, so 0.1 % hides them,
while real vines only lose their tips at the diagonal.

As in Bouquet2D's server, the coned complex is built once and only the filtration values change per center,
with centers split across threads (a 40k-vertex mesh with 64 centers takes about 2 s).

## PHT (persistent homology transform)

PHT is the transform the app opens in (**Transform ▸ Radial** in the toolbar switches to centers). A
*Directions* window shows the unit sphere of directions and a closed loop on it, starting on the equator. It can
be dragged, resized and closed (*Show Sphere* reopens it).
- *Draw Loop* starts a new loop, as Bouquet2D's custom loop: each click on the sphere adds a point at its end,
  and the loop closes through the points from 3 on. Dragging still orbits, and `Esc` (or *Stop Drawing*) ends
  the drawing. Scroll on the sphere to zoom in: a small loop around a singularity is easiest to draw there.
- Drag a handle to move it over the sphere.
- Drag the loop itself to slide all of it.
- Double-click the loop to add a handle; `Del` on a handle removes it.

The loop, the inflection and simultaneity sets, the handles and the short arrow of the current direction keep
their size on screen when zooming, so the sets stay thin and nearby curves can be told apart.

The loop is a smooth spline through the handles projected onto the sphere, so it is always on the sphere and
closed. Two neighbouring handles can't be nearly opposite, since the loop would have no defined path between
them. The loop is sampled evenly by arc length into *Samples* directions v. For each one, the server computes
the extended persistence of the lower-star filtration of the height *h(x) = ⟨x, v⟩*. The vineyard stacks the
diagrams along the loop, as in the radial case.

The sphere uses the same world axes as the complex (red X, green Y, blue Z through it). Its view is locked to
the main view: orbiting either one turns the other, so a direction on the sphere points the same way in the
scene. The main viewport shows the current direction as an arrow from the center of the complex, with the
plane through the center normal to it.

### Inflection set

In PHT mode, *Inflection Set* (in the *Inflection & Simultaneity* section) computes, for a surface, the
directions v where the height *h(x) = ⟨x, v⟩* is not Morse. The height has a critical point at p exactly
when v = ±N(p), and that critical point is degenerate exactly when the Gaussian curvature K(p) is 0. So the inflection set is the image of the
parabolic curve {K = 0} under the Gauss map N and its antipode. It plays the role of the focal set in
Bouquet2D. In singularity theory it is the bifurcation set of the family of height functions. The violet
curves are the parabolic curve on the surface and ±N of it on the sphere of directions.

The server estimates K at every vertex by jet fitting (*Method ▸ Jet fitting*): k₁k₂ from CGAL's example
`Mesh_estimation.cpp` as is (in
[`curvature_stability/jet_fitting_example.h`](curvature_stability/jet_fitting_example.h)), with its Monge
normal. *Degree* (2 to 4, default 2) is the degree of the polynomial fitted at each vertex. Degree 3 and 4
also fit the derivatives of the curvature, which the singular points of both sets depend on, but follow
noise more.

*Rings* (default 3) sets the neighbourhood each estimate uses. A larger neighbourhood averages out noise, so the parabolic curve has fewer
spurious small loops. It also blurs the curvature, which moves the curve where the curvature changes quickly
compared to the neighbourhood. On the 1,280-triangle peanut, whose parabolic circles are at |x| = 0.869, 6 rings
put them at 1.31 instead of 1.05 with 3 rings. The zero set of the linear interpolation of K is traced through the
triangles where K changes sign, and the normals are interpolated along it. Only the triangles of the complex
are used. Nothing in this computation depends on the loop of directions.

### Simultaneity set

*Simultaneity Set*, in the same section, computes the directions v where two critical points of the height have
the same value. These are the normals of the planes tangent to the surface at two points, and they play the
role of Bouquet2D's symmetry set. In singularity theory it is the Maxwell set of the family of height functions
(in the broad sense: any two critical points, not only two global minima). It is drawn in blue: on the sphere, the directions (with their antipodes);
on the surface, the two curves of contact points. *Sets on surface* (Display) turns both sets off on the surface and
keeps them on the sphere.

Every vertex p is mapped to its tangent plane (N(p), ⟨p − o, N(p)⟩) in S² × R. Two points with the same
tangent plane are a self-intersection of the image of the surface. Since h₋ᵥ = −hᵥ, the plane (−v, −d) is the
same as (v, d), which catches pairs with opposite normals, such as the two saddles of a torus. The origin o
does not change the result; the server takes the centroid of the vertices. To find the self-intersections:
1. S² × R is put in R³ by (v, d) ↦ (R + d) v, with R > max |d|. This is one-to-one onto a spherical shell.
2. The image triangles and their antipodal copy form one triangle mesh.
3. CGAL's `PMP::self_intersections` finds the pairs of triangles that cross.
4. `intersection(Triangle_3, Triangle_3)` gives the segment where two triangles cross. Barycentric coordinates
   map it back to the two contact points on the surface.

The image folds over itself along the parabolic curve, where nearby triangles cross without being two
separate critical points. Crossings between triangles within 3 average edge lengths of each other are
dropped (*Fold crossings dropped*). This also shortens the curves slightly near their ends, where the two
contact points meet. The normals are jet fitting's (with *Rings*).

On the round torus (preset) with R = 3, r = 1.2, the two saddles have equal heights exactly when
|v_z| = √(1 − (r/R)²) = 0.9165, and on the peanut the two lobes match when v_x = 0. Both are found. The round
torus is degenerate at ±z, where whole circles are critical. On organic meshes (e.g. CGAL's `cow.off`, about 50,000 segments) the simultaneity set covers much of
the sphere, and it is not yet known how much of it is noise in the normals. The server refuses results above
100,000 segments.

### Implicit surfaces (exact sets)

The *Implicit surface* presets are surfaces given by an equation F(x) = 0 (F < 0 inside). For them both sets are
computed from F instead of being estimated from a mesh:

| Preset | F | Genus |
|---|---|---|
| Torus | (\|x\|² + R² − r²)² − 4R²(x² + y²), R = 3, r = 1.2 (as the mesh preset) | 1 |
| Two Blobs | ½ − e^(−\|x − c₁\|²) − e^(−\|x − c₂\|²), c = (±1.1, 0, 0) | 0 |
| Three Blobs | three unequal Gaussian blobs, no symmetry | 0 |
| Double Torus | (x⁴ − x² + y²)² + z² − (0.03 + 0.008x + 0.004y): a tube about a figure eight | 2 |
| Chair, Tanglecube | from CGAL's `examples/Mesh_3/implicit_functions.cpp` | 3, 5 |

How the exact sets are computed:
- **Mesh.** The server meshes F = 0 with CGAL's Mesh_3 (`make_mesh_3` with `surface_only()`), so the vertices
  lie on the surface. The *Mesh* slider sets the level: each step halves the facet size.
- **Derivatives.** The gradient and Hessian of F are exact, from Eigen's automatic differentiation (`AutoDiff`,
  nested). The normal is ∇F/|∇F|, and the Gaussian curvature is K = ∇Fᵀ adj(H) ∇F / |∇F|⁴ (Goldman 2005). The
  *Curvature* settings do not apply and are hidden.
- **Inflection set.** The segments of the zero set of K on the mesh only give starting points. Each of their
  ends is moved onto the curve {F = 0, K = 0} by Newton's method. The curves through these points are then
  traced by continuation along the tangent ∇F × ∇K, as for the simultaneity set below, with the normal
  ∇F/|∇F| at every point. This follows the curve through narrow regions of K < 0, where the crossings found on
  the mesh can be several edge lengths off.
- **Simultaneity set.** The crossings found on the mesh only give starting points. Each is moved by Newton's
  method onto an exact pair (p, q) with F(p) = F(q) = 0, ∇F(p) ∥ ∇F(q) and ⟨p − q, ∇F(p)⟩ = 0. These are 5
  independent equations in 6 unknowns, so their solutions form curves. The curves through these pairs are then
  traced by continuation: step along the tangent, then correct with Newton's method. A curve ends where p and q
  meet, where the equations degenerate, or where it closes or runs into another curve. The starting points of
  both sets are refined in parallel, on all cores.

The results agree with the exact answers to rounding error. On the torus, |v_z| = √0.84 to 10⁻¹⁵ off the poles;
on the two blobs, v_x = 0 to 10⁻¹⁶. The two contact points of each pair have equal heights to 10⁻¹³.

*Crossings with no exact pair* counts mesh crossings that Newton's method could not move onto an exact pair
within 6 edge lengths. On the three blobs (75 at level 4), most have their two contact points a few edge
lengths apart, on either side of the parabolic curve. Along it, the image of the surface in S² × R folds into a
cuspidal edge, and the flat image triangles cross spuriously next to it; the fold filter removes only the
nearest of these false crossings. The simultaneity set of a mesh, with estimated normals, can contain such
false crossings too.

The round torus is degenerate in the directions ±z (circles of critical points), so its exact simultaneity set
stops short of the poles.

### Fitted surfaces (exact sets on a mesh)

*Method ▸ Jet blend (exact)* computes both sets exactly on a smooth surface F = 0 fitted through the mesh, the
jet blend. Any mesh can then be compared with *Jet fitting* and, on the implicit presets, with *Exact (from F)*.

The jet blend is a partition of unity of the jets (as in Ohtake et al.'s multi-level partition of unity): it
blends local fits gᵢ, one per vertex, with compactly supported weights,

  F(x) = Σᵢ wᵢ(x) gᵢ(x) / Σᵢ wᵢ(x),  wᵢ(x) = (1 − |x − oᵢ|²/Rᵢ²)⁵ for |x − oᵢ| < Rᵢ, else 0,

with gᵢ = Z − Jᵢ(X, Y), where (X, Y, Z) are the coordinates of x in the Monge frame of vertex i (origin oᵢ, the
principal directions and the normal) and Jᵢ is the jet CGAL fitted there (*Rings*, *Degree*). Near a vertex,
F = 0 is that jet, so it keeps the fitted curvature and, at degree 3 or 4, its derivatives.

Rᵢ is the *Fit radius* (default 3) times the mean length of the edges at vertex i,
so it follows the vertex spacing on uneven meshes. The weights are polynomials in |x − oᵢ|² and are C⁴ where they
reach 0. So F is smooth, and a hash grid finds every term. F, ∇F and the Hessian are computed in closed form. F is
left undefined where the total weight is under a fifth of its median at the vertices. Further out, F is a ratio
of a few small weights, close to a single fit, and has zero sets of its own. The vertices are moved onto F = 0
by Newton's method along ∇F. Then the inflection and simultaneity sets are computed exactly as for the implicit
presets.

These are the sets of the fitted surface, which lies close to the mesh but is not the mesh. The radius trades
detail against smoothness. A small radius follows the mesh but adds bumps at the scale of the vertex spacing,
and these bumps bring small spurious parabolic loops. A large radius moves the surface and loses thin parts.

### Subdividing loaded meshes

For a loaded mesh, *Subdivide* (0 to 3 steps) makes a finer mesh, on the jet blend (with the current jet settings)
or on the loaded mesh itself. *Scheme* chooses how:
- *Coxeter (GUDHI)*, the default: a new mesh of the fitted surface F = 0, traced with the manifold tracing of
  GUDHI's Coxeter triangulation module (by Siargey Kachanovich). Space is cut into the tetrahedra of a Coxeter
  triangulation with longest edge 3.6 h / 2^steps (h the mean edge length, which gives about as many triangles
  as that many midpoint steps), the edges that cross F = 0 are found by spreading from the loaded vertices, and
  the polygon each tetrahedron cuts out is fanned from its barycenter. Where F is undefined, the tracing uses the
  signed distance to the loaded mesh instead, and at the vertices of the triangulation the value is kept at
  least a quarter edge from 0, so that no crossing lies next to a vertex and leaves a sliver. It needs a closed
  mesh (past a boundary the fit fades out), so it is off for meshes with a boundary.
- *Midpoint*: every triangle split into four at its edge midpoints, that many times.
- *Isotropic (CGAL)*: the loaded mesh itself remeshed by CGAL's isotropic remeshing, with edges of h / 2^steps
  (about as many triangles as that many midpoint steps). Edges are split, collapsed and flipped, then the
  vertices relaxed, and every vertex stays on the loaded mesh. The sharp edges (faces meeting at more than 45°)
  and the boundary are kept as they are, with their corners. There is no fitted surface.

With Coxeter and Midpoint, every vertex is then moved onto the surface by Newton's method; one that cannot be keeps its position
(*unprojected* in the status). The surface is fitted once, to the loaded mesh, so subdividing adds no detail
that is not in the fit. It gives the crossings that start the exact tracing a finer mesh, and gives the
jet fitting vertices on a smooth surface.

Midpoint keeps the loaded triangles' shapes and topology; the Coxeter triangles do not depend on the loaded ones.
On CGAL's cow (smallest angle 2.8°, jet blend at degree 3), one step leaves 0.6 % of the triangles with an angle
under 10° by Coxeter against 5.5 % by midpoint, and a ratio of longest to shortest edge of 122 against 2,752. On
a mesh that is already good, midpoint is better: on `assets/bumpy_torus.obj` its smallest angle stays 23°,
Coxeter's is 12°. Coxeter follows F = 0 itself, so it also shows the fit's own topology: the cow's jet blend at
degree 2 has extra handles that finer steps resolve (Euler characteristic 2, 0, −6 after 1, 2, 3 steps), and the
status bar says so when the topology differs from the loaded mesh's.

Isotropic is for meshes no smooth surface fits well: CAD models with flat faces and sharp edges, whose triangles
are long and thin. On CGAL's `spool.off` every vertex lies on a sharp edge and the faces are spanned by chords up
to the full diameter, so the fit radius spans both sides of each disc and Coxeter and Midpoint project onto a
surface with spikes and blobs. One isotropic step takes it from 1,294 to 5,758 triangles, the median smallest angle
from 16° to 50°, and the triangles with an angle under 10° from 24 % to none, with its shape and sharp edges kept;
the jet blend of the result then reaches every vertex. The sets of such a mesh are still those of a polyhedron:
K = 0 on the flat faces, so the inflection set there follows the noise in the sign of K.

On the cow (5,804 triangles, jet blend at degree 3), 2 midpoint steps take the simultaneity set from 1,491 to 4,824 curves.
That takes 137 s instead of 6 s, on 28 threads. Thin parts limit the fit. Some vertices land up to 2.5 edge
lengths off the mesh near the tail. When the twice-subdivided cow is fitted again for the sets, 1,927 of its
46,434 vertices cannot be moved onto the surface, all in one patch at the top of the head. The likely cause is
that the fit radius spans both sides of these parts, so fits from the far side enter the blend.

### Comparing the methods

[`server/compare_methods.py`](server/compare_methods.py) measures every method against the exact sets of the
implicit presets. For each method, it reports:
- the distance from its curves to the exact ones and back, on the surface and on the sphere (median and 95th
  percentile, after densifying both);
- the share of each set within tolerance of the other (complete, true);
- the number of separate pieces;
- the error at the cusps of the inflection set, and at the free ends of the simultaneity curves (where these
  should meet the cusps), with the missed and extra ones.

Vertex noise (a fraction of the edge length h) can be added. Run it with
`python3 server/compare_methods.py [--surfaces ...] [--levels ...] [--noise ...]`.

On the three blobs at level 5 (12,626 triangles), without noise:
- **Jet blend, degree 3 or 4.** Matches the exact sets, singular points included: cusp error 0.06–0.07° (the
  exact method's own error against the level-6 reference is 0.07°), the 4 simultaneity curves with no missed or
  extra ends. At degree 4 its surface is within 10⁻⁴ to 10⁻⁵ h of the true one.
- **Jet fitting.** Finds the inflection set about as well, but its simultaneity set breaks into 400 to 500
  pieces with 750 to 940 extra ends.

With noise of 0.05 h, degree 2 is the best jet blend: degree 3 and 4 fit the noise. The jet blend then still has
far fewer pieces and extra ends than jet fitting (12 simultaneity pieces against 526 to 766, and 12 extra ends
against 968 to 1,390), and its cusps are 0.7° off. The double torus is a thin tube whose small parabolic loops even the exact method finds differently at
each mesh level, so it does not rank the methods.

## Controls

| Input | Action |
|---|---|
| Left or middle drag | Orbit |
| Shift + drag, right drag | Pan |
| Wheel | Zoom |
| Axis triad (top right) | Click an axis letter (or a hollow dot, for the opposite side) to look along it, drag to orbit |
| `1` / `3` / `7` (numpad or digit row) | Front / right / top view; `9` the opposite side |
| `5` | Perspective / orthographic |
| `Home` | Frame all |
| `Alt Z` | X-ray (see the loop inside the surface) |
| `Space`, `←` / `→` | Play / pause, previous / next center or direction (`Shift` for first / last) |
| `Del` | Remove the hovered handle of the direction loop (PHT) |
| `Esc` | Stop drawing the direction loop (PHT) |
| `Ctrl Enter`, `Ctrl O` | Compute the vineyard, open a complex |

## Server API

`POST /vineyard` takes `{"vertices": [x,y,z,...], "simplices": [[a,b], [a,b,c], ...]}` plus either
`"function": "radial", "centers": [x,y,z,...], "use_squared_distance": true` (the default) or
`"function": "height", "directions": [x,y,z,...]` (directions are normalized). Vertices, centers and directions
are flat arrays, indices are 0-based, and simplices can have any dimension. It returns
`{"ord0": [{"birth", "death", "centerIdx"}, ...], "rel0": [...], "ext0": [...], ...}` up to the complex's
dimension, where `centerIdx` is the index of the center or direction, plus `"dimension"`, `"minValue"` and
`"maxValue"`. `POST /inflection` takes `{"vertices", "simplices", "method": "jet"}` (with `"rings"` and
`"degree"` for jet fitting) and
returns the parabolic curve as `"points"` (6 numbers per segment) with the unit normals at the same ends in
`"normals"`, plus the counts `"segments"`, `"vertices"`, `"negative"` (vertices with K < 0) and `"skipped"`
(vertices jet fitting skipped). `POST /simultaneity` takes `{"vertices", "simplices", "method", "rings", "degree"}` and returns
`"directions"` (one of each ±v), `"first"` and `"second"` (the contact points), with 6 numbers per segment in
each, plus `"segments"`, `"folds"` and `"vertices"`. With `"implicit": name` (an implicit preset, whose mesh the
request sends), both sets are exact. The inflection set then also returns `"dropped"`; the simultaneity set
returns `"curves"` and `"dropped"`. `"method": "jets"`, with `"support"` (the fit radius in mean edge
lengths, default 4), `"rings"` and `"degree"`, computes both sets exactly on the jet blend of the
mesh, and both responses also return `"unprojected"`, the number of vertices that could not be moved onto it.
`POST /subdivide` takes `{"vertices", "simplices", "steps": 1 to 3, "scheme": "coxeter" | "midpoint" | "isotropic"}`
and the jet blend's settings `"rings"`, `"degree"` and `"support"` (`"isotropic"` uses none), and returns the finer mesh as
`{"vertices", "simplices", "unprojected", "input_euler"}`, the last the Euler characteristic of the mesh as read.
The Coxeter scheme (the default) needs a closed mesh. `POST /implicit` takes `{"surface": name, "level": 3 to 6}` and returns its mesh as
`{"vertices", "simplices"}`. `GET /health` checks that it is up.

The server listens on `127.0.0.1:7860`. Set `PORT` and `HOST` to change that (e.g. `HOST=0.0.0.0` in a
container), and `VINEYARD_WORKERS` for the number of threads. To host the page elsewhere (e.g. GitHub Pages),
set `PERSISTENCE_API_URL` in [`js/api.js`](js/api.js) to the server's URL.
