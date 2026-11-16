// ========== Presets ==========
// Presets with `file` are files in assets/, loaded as if opened (main.js), as in Bouquet2D; `lift`
// puts a plane curve on the paraboloid z = lift (x² + y²), `method` selects a method. Presets with
// `implicit` are surfaces F = 0 that the server meshes (CGAL Mesh_3) and for which it computes the
// inflection and simultaneity sets exactly, from F.
export const PRESETS = {
    ellipsoid: { file: 'assets/ellipsoid.obj' },
    torus: { file: 'assets/torus.obj' },
    peanut: { file: 'assets/peanut.obj' },
    'lifted-tube': { file: 'assets/lifted_tube.obj', method: 'jets' }, // the method that follows this thin tube best
    'bumpy-torus': { file: 'assets/bumpy_torus.obj' },
    'mobius-band': { file: 'assets/mobius_band.json' },
    trefoil: { file: 'assets/trefoil.csv' },
    ellipse: { file: 'assets/ellipse.csv' },
    'lifted-ellipse': { file: 'assets/deformed_ellipse.sspl', lift: 0.2 },
    'figure-eight-knot': { file: 'assets/figure_eight_knot.csv' },
    bouquet: { file: 'assets/bouquet.json' },
    'solid-cube': { file: 'assets/solid_cube.json' },
    'implicit-torus': { label: 'Torus', implicit: 'torus' },
    'two-blobs': { label: 'Two Blobs', implicit: 'two-blobs' },
    'three-blobs': { label: 'Three Blobs', implicit: 'three-blobs' },
    'double-torus': { label: 'Double Torus', implicit: 'double-torus' },
    chair: { label: 'Chair', implicit: 'chair' },
    tanglecube: { label: 'Tanglecube', implicit: 'tanglecube' },
};

// Mesh level of the implicit presets: level 4 is the default, and each level up halves the facet size.
export const RESOLUTION = { min: 3, max: 6, default: 4 };
