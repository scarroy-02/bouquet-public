# Bouquet2D

A desktop app for the symmetry set, the focal set and the persistent homology of plane curves. Draw a curve, or
several, or open one, and Bouquet2D draws its focal set (the centers of its osculating circles) and its symmetry
set (the centers of the circles tangent to it at two points). A center moving along a loop gives a family of
distance functions on the curve: Bouquet2D computes the extended persistence diagram of the squared distance from
each center and stacks them into a vineyard. It is the desktop version of
[bouquet2d.rohitroy.me](https://bouquet2d.rohitroy.me), and the 2D counterpart of [BouquetPHT](../bouquetpht).

To download it, see the [main README](../README.md#download).

## Using it

1. Click in the canvas to add points: the curve is the closed spline through them (check *Open* under *Curves*
   for an arc). Or pick a *Preset*, import a `.csv` with `x` and `y` columns, or *Load* a `.sspl` figure saved
   with *Save*. *+ Curve* starts another curve.
2. The focal set follows the curve as you edit it. *Compute SS* computes the symmetry set, at the resolution
   set by *Low*–*High*. *Focal Animation* and *SS Animation* step along the two sets with their circles.
3. Under *Vineyard*, click *Place Center*, then a point: the observation loop is the circle of the given
   *Radius* around it, or a loop you draw (*Loop ▸ Custom Spline*, *Draw Loop*). *Compute Vineyard* computes one
   diagram for each of the *Samples* centers along the loop, shown in the *Vineyard 3D* and *Persistence
   Diagram* windows, and the player steps through them.
4. *Radius Sweep* computes the vineyards of the circles of radius *Start R* to *End R*. *Spline Sweep* deforms a
   drawn loop from a start shape to an end shape, capturing each with *Capture Start Loop* and *Capture End
   Loop*.
5. *Export* saves the canvas and the plots as PNG, and the 3D vineyard as OBJ or PLY.

| Input | Action |
|---|---|
| Click, drag | Add a point, move a point |
| Right drag, `Alt` + drag | Pan |
| Wheel | Zoom |
| `Del` | Delete the selected point, or the hovered point of a drawn loop |
| `Ctrl Z` | Undo |
| `Esc` | Stop placing the center or drawing the loop |

## Building from source

Needs a C++17 compiler, Boost and Node.js 22.12 or later. From this folder:

```bash
cd server && make PORTABLE=1
cd ../desktop && npm ci
npm start                      # run the app
npx electron-builder           # package it for this system, in desktop/dist
```

`server/server` on its own also serves the app, at http://localhost:7860. `make test` (in `server/`, with Python,
`numpy` and `gudhi`) checks its diagrams against GUDHI. Pushing a tag `bouquet2d-vX.Y.Z` (the version in
`desktop/package.json`) builds the app for all three systems and attaches it to that release.
