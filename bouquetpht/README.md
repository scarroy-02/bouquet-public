# BouquetPHT

A desktop app for the persistent homology transform (PHT) of shapes in R³: surfaces, space curves and any
simplicial complex. A direction moves along a loop on the sphere, and BouquetPHT computes the extended
persistence diagram of the height in each direction and stacks them into a vineyard. For a surface, it also
draws the inflection and simultaneity sets: the directions where the height has a degenerate critical point, or
two critical points at the same height, which is where the vineyard can change. A radial mode does the same for
the squared distance from a center moving along a loop. It is the 3D counterpart of [Bouquet2D](../bouquet2d).

To download it, see the [main README](../README.md#download).

## Using it

1. Pick a shape from *Preset* in the toolbar, or open your own (`Ctrl O`, formats below).
2. The *Directions* window shows the loop of directions on the sphere. Drag its handles or the loop itself, or
   click *Draw Loop* and click points on the sphere (`Esc` stops drawing). *Transform ▸ Radial* switches to
   centers moving along a loop in space.
3. *Compute Vineyard* (`Ctrl Enter`) computes one diagram for each of the *Samples* directions along the loop.
   The timeline steps through them.
4. For a surface, *Inflection Set* and *Simultaneity Set* draw the two sets, on the sphere and on the surface.
   They are computed for the PHT only, not yet for the radial transform.

| Shape | File |
|---|---|
| Surface | Triangle mesh, `.obj` or `.off` |
| Space curve | `.csv` of `x,y,z` points, joined in order (closed by default) |
| Simplicial complex | `.json`, see below |
| Bouquet2D figure | `.sspl` with one closed curve |
| Loop of centers (radial) | A circle, or a `.csv` of `x,y,z` points |

A simplicial complex lists the vertex coordinates and the simplices as 0-based vertex indices. Faces are
implied, so the maximal simplices are enough, and every vertex is a point of the complex (here vertex 5 is
isolated):

```json
{
  "vertices": [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [2, 2, 2], [3, 0, 0]],
  "simplices": [[0, 1, 2, 3], [3, 4]]
}
```

| Input | Action |
|---|---|
| Left or middle drag | Orbit |
| Shift + drag, right drag | Pan |
| Wheel | Zoom |
| `1` / `3` / `7` | Front / right / top view; `9` the opposite side |
| `5` | Perspective / orthographic |
| `Home` | Frame all |
| `Alt Z` | X-ray (see the loop inside the surface) |
| `Space`, `←` / `→` | Play / pause, previous / next direction or center (`Shift` for first / last) |
| `Del` | Remove the hovered handle of the loop |

## Building from source

Needs a C++17 compiler, Boost, CGAL 6.2.1, Eigen 3 and Node.js 22.12 or later. From this folder:

```bash
cd server && make PORTABLE=1   # add CGAL_INCLUDE=... EIGEN_INCLUDE=... if they aren't in /usr/local/include, /usr/include/eigen3
cd ../desktop && npm ci
npm start                      # run the app
npx electron-builder           # package it for this system, in desktop/dist
```

`server/server` on its own also serves the app, at http://localhost:7860. `make test` (in `server/`, with Python,
`numpy` and `gudhi`) checks its diagrams against GUDHI. Pushing a tag `bouquetpht-vX.Y.Z` (the version in
`desktop/package.json`) builds the app for all three systems and attaches it to that release.
