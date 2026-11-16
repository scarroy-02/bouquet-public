// ========== File Parsers ==========
// Geometry comes back as { positions, simplices }: flat x, y, z coordinates and
// simplices as lists of 0-based vertex indices. Polygons are fan-triangulated.
// Validation and cleanup happen in buildComplex (complex.js).

// Simplicial complex as JSON:
//   {"vertices": [[x, y, z], ...], "simplices": [[i, j], [i, j, k], [i, j, k, l], ...]}
// Every vertex is a 0-simplex, and the faces of each simplex are implied, so
// listing the maximal simplices is enough. Simplices have at most 4 vertices
// (tetrahedra), the most that can be realized in R^3.
export function parseComplexJSON(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch (err) {
        throw new Error(`invalid JSON (${err.message})`);
    }
    const vertices = data?.vertices, simplices = data?.simplices ?? [];
    if (!Array.isArray(vertices) || vertices.length === 0) {
        throw new Error('"vertices" must be a non-empty list of [x, y, z] points');
    }
    if (!Array.isArray(simplices)) throw new Error('"simplices" must be a list of vertex index lists');

    const positions = [];
    vertices.forEach((p, i) => {
        if (!Array.isArray(p) || p.length < 2 || p.length > 3) throw new Error(`vertices[${i}]: expected [x, y, z]`);
        positions.push(p[0], p[1], p.length === 3 ? p[2] : 0);
    });
    simplices.forEach((s, i) => {
        if (!Array.isArray(s) || s.length === 0 || s.length > 4) {
            throw new Error(`simplices[${i}]: expected 1 to 4 vertex indices (up to a tetrahedron)`);
        }
        if (new Set(s).size !== s.length) throw new Error(`simplices[${i}]: repeated vertex`);
    });
    return { positions, simplices: [...vertices.map((_, i) => [i]), ...simplices] };
}

// Wavefront OBJ: `v` vertices; `p` points, `l` polylines and `f` faces become
// 0-, 1- and 2-simplices. Vertices used by none of them are dropped.
export function parseOBJ(text) {
    const positions = [], simplices = [];
    let nv = 0;
    // "7", "7/2", "7//3", "-1" (relative to the vertices read so far)
    const vertexIndex = token => {
        const i = parseInt(token, 10);
        if (!Number.isInteger(i) || i === 0) throw new Error(`bad vertex index "${token}"`);
        return i > 0 ? i - 1 : nv + i;
    };
    for (const line of text.split('\n')) {
        const parts = line.trim().split(/\s+/);
        const ids = () => parts.slice(1).map(vertexIndex);
        if (parts[0] === 'v') {
            positions.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
            nv++;
        } else if (parts[0] === 'p') {
            for (const i of ids()) simplices.push([i]);
        } else if (parts[0] === 'l') {
            const l = ids();
            for (let k = 0; k + 1 < l.length; k++) simplices.push([l[k], l[k + 1]]);
        } else if (parts[0] === 'f') {
            const f = ids();
            for (let k = 1; k + 1 < f.length; k++) simplices.push([f[0], f[k], f[k + 1]]);
        }
    }
    if (nv === 0) throw new Error('no vertices ("v" lines) found');
    return { positions, simplices };
}

// Object File Format (OFF, also COFF/NOFF): counts line, vertices, faces.
// Faces with one or two vertices are read as points and edges.
export function parseOFF(text) {
    const lines = text.split('\n').map(l => l.replace(/#.*/, '').trim()).filter(Boolean);
    let li = 0;
    let head = lines[li].split(/\s+/);
    if (/OFF$/i.test(head[0])) {
        head = head.slice(1);
        if (head.length === 0) head = lines[++li].split(/\s+/);
    }
    const nv = parseInt(head[0], 10), nf = parseInt(head[1], 10);
    if (!(nv > 0) || !(nf >= 0)) throw new Error('missing vertex/face counts');
    if (lines.length < li + 1 + nv + nf) throw new Error('file ends before all vertices and faces');

    const positions = [], simplices = [];
    for (let i = 1; i <= nv; i++) {
        const p = lines[li + i].split(/\s+/);
        positions.push(Number(p[0]), Number(p[1]), Number(p[2]));
    }
    for (let i = 1; i <= nf; i++) {
        const p = lines[li + nv + i].split(/\s+/).map(Number);
        const ids = p.slice(1, 1 + p[0]);
        if (ids.length === 1 || ids.length === 2) simplices.push(ids);
        for (let k = 1; k + 1 < ids.length; k++) simplices.push([ids[0], ids[k], ids[k + 1]]);
    }
    return { positions, simplices };
}

// Points as CSV (or whitespace/semicolon separated) with columns x, y, z.
// The header row is optional; without one the first columns are x, y, z.
// A missing z column (e.g. a Bouquet2D curve) means z = 0.
export function parseCSVPoints(text) {
    const split = line => line.split(/[,;\s]+/).filter(s => s !== '');
    const rows = text.split('\n')
        .map((line, i) => ({ fields: split(line.trim()), line: i + 1 }))
        .filter(r => r.fields.length && !r.fields[0].startsWith('#'));
    if (rows.length === 0) throw new Error('no data rows');

    let cols = [0, 1, 2];
    if (rows[0].fields.some(s => !Number.isFinite(Number(s)))) {
        const header = rows.shift().fields.map(s => s.replace(/["']/g, '').toLowerCase());
        cols = ['x', 'y', 'z'].map(c => header.indexOf(c));
        if (cols[0] < 0 || cols[1] < 0) throw new Error('header must name the x, y (and z) columns');
        if (rows.length === 0) throw new Error('no data rows');
    } else if (rows[0].fields.length < 3) {
        cols[2] = -1;
    }

    return rows.map(({ fields, line }) => {
        const p = cols.map(c => (c < 0 ? 0 : Number(fields[c])));
        if (!p.every(Number.isFinite)) throw new Error(`line ${line}: expected numbers`);
        return p;
    });
}

// A Bouquet2D figure (.sspl: {"format": "symmetry-set-spline", "curves": [[{x, y}, ...]],
// "curveOpen": [...]}): the points of its one curve, which must be closed, as [x, y] pairs.
// Bouquet2D draws the closed spline through them, as bouquet2dSpline (curve-sets.js) does.
export function parseSSPL(text) {
    const data = JSON.parse(text);
    if (data.format !== 'symmetry-set-spline' || !Array.isArray(data.curves)) throw new Error('not a Bouquet2D figure');
    const curves = data.curves.filter(c => c.length);
    if (curves.length !== 1) throw new Error(`expected one curve, found ${curves.length}`);
    if (data.curveOpen?.[data.curves.indexOf(curves[0])]) throw new Error('the curve is open; only closed curves are read');
    const points = curves[0].map(p => [Number(p.x), Number(p.y)]);
    if (points.length < 3 || !points.flat().every(Number.isFinite)) throw new Error('expected at least 3 points with x and y');
    return points;
}
