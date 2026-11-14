// ========== Persistence Computation via the C++ API ==========
// All persistence is computed by the GUDHI-based server in server/.

// The server also serves this page, so by default the API is the page's own
// origin. When the page is hosted elsewhere (e.g. GitHub Pages), set this to
// the server's URL, e.g. 'http://localhost:7860'.
export const PERSISTENCE_API_URL = '';

export const SERVER_HINT = 'Start it with "cd server && make && ./server" and open http://localhost:7860';

export async function checkServer() {
    try {
        return (await fetch(`${PERSISTENCE_API_URL}/health`)).ok;
    } catch {
        return false;
    }
}

// Extended persistence at every frame, of either the squared distance from each
// of `centers` (radial) or the height x -> <x, v> for each of `directions`
// (PHT). Returns the pairs bucketed as ord0, rel0, ext0, ... (kind × homology
// dimension, up to the complex's dimension), each entry { birth, death,
// centerIdx } (centerIdx: index of the center or direction), plus minValue and
// maxValue (the range of the function).
export async function computeVineyardAPI(complex, { centers, directions }) {
    const xyz = points => points.flatMap(p => [p.x, p.y, p.z]);
    const body = { vertices: Array.from(complex.positions), simplices: complex.simplices };
    if (directions) Object.assign(body, { function: 'height', directions: xyz(directions) });
    else Object.assign(body, { function: 'radial', centers: xyz(centers), use_squared_distance: true });
    return post('vineyard', body);
}

// Inflection set of the heights on the surface (the triangles of the complex),
// with the Gaussian curvature estimated by jet fitting (method 'jet'), on
// `rings` rings of neighbours, with jets of degree `degree`. Returns { points, normals, segments, vertices, negative,
// skipped }: the parabolic curve as segments (6 numbers each) and the unit
// normals at their ends; the inflection set is ±normals. With `implicit` (the
// name of the implicit surface the mesh lies on), the segments are the exact
// curves, traced from the crossings (`curves` of them), and `dropped` counts
// the crossings with no exact point nearby.
// Method 'jets' blends the jets fitted at the vertices into a smooth surface
// (weights reaching `support` average edge lengths) and computes both sets
// exactly on it.
export async function computeInflectionAPI(complex, { method, rings, degree, implicit, support }) {
    return post('inflection', { vertices: Array.from(complex.positions), simplices: complex.simplices, method, rings, degree, implicit, support });
}

// Simultaneity set of the heights on the surface, with normals estimated by
// `method`, `rings` and `degree` as for the inflection set. Returns { directions, first, second, segments,
// folds, vertices }: 6 numbers per segment in each array, a piece of the
// simultaneity set on the sphere (draw it with its antipode) and the matching
// pieces of the two contact curves on the surface. `implicit` as for the
// inflection set; the segments are then the exact curves, traced from the
// crossings (`curves` of them), and `dropped` counts the crossings with no
// exact pair nearby.
export async function computeSimultaneityAPI(complex, { method, rings, degree, implicit, support }) {
    return post('simultaneity', { vertices: Array.from(complex.positions), simplices: complex.simplices, method, rings, degree, implicit, support });
}

// The surface refined `steps` times (each triangle into four), with every
// vertex moved onto its jet blend (with rings, degree and support). Returns
// { vertices, simplices, unprojected }.
export async function subdivideAPI(complex, steps, scheme, { rings, degree, support }) {
    return post('subdivide', { vertices: Array.from(complex.positions), simplices: complex.simplices, steps, scheme, rings, degree, support });
}

// Mesh of an implicit surface preset at a level (3 to 6, each about 4 times
// the triangles). Returns { vertices: [x, y, z, ...], simplices: [[a, b, c], ...] }.
export async function implicitMeshAPI(surface, level) {
    return post('implicit', { surface, level });
}

async function post(path, body) {
    let response;
    try {
        response = await fetch(`${PERSISTENCE_API_URL}/${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    } catch {
        throw new Error(`Cannot reach the persistence server. ${SERVER_HINT}.`);
    }
    if (!response.ok) {
        let message;
        try {
            message = (await response.json()).error;
        } catch {
            // Not the persistence server (e.g. the page is served by another web server)
            message = `${response.statusText || 'no persistence server here'}. ${SERVER_HINT}`;
        }
        throw new Error(`Server error ${response.status}: ${message}`);
    }
    return response.json();
}
