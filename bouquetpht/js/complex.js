// ========== Simplicial Complexes ==========
// What the persistence server sees: vertex coordinates and simplices (vertex
// index lists, up to tetrahedra); the faces of each simplex are implied.

const sortedKey = s => [...s].sort((a, b) => a - b).join(',');

// Clean up parsed geometry ({ positions, simplices }) and collect what the
// viewport and the statistics need. Vertices in no simplex are dropped. With
// `weld`, vertices with identical coordinates are merged (meshes split at seams,
// a curve whose last point repeats the first) and simplices that become
// degenerate are dropped; without it the input is taken as is.
export function buildComplex({ positions, simplices }, { weld = true } = {}) {
    const n0 = positions.length / 3;
    if (!Number.isInteger(n0) || n0 === 0) throw new Error('no vertices');
    if (!positions.every(Number.isFinite)) throw new Error('non-numeric vertex coordinate');
    for (const s of simplices) {
        for (const i of s) {
            if (!Number.isInteger(i) || i < 0 || i >= n0) {
                throw new Error(`vertex index ${i} out of range (${n0} vertices, counting from 0)`);
            }
        }
    }

    const map = Int32Array.from({ length: n0 }, (_, i) => i);
    let merged = 0;
    if (weld) {
        const seen = new Map();
        for (let i = 0; i < n0; i++) {
            const key = `${positions[3 * i]},${positions[3 * i + 1]},${positions[3 * i + 2]}`;
            const j = seen.get(key);
            if (j === undefined) seen.set(key, i);
            else { map[i] = j; merged++; }
        }
    }
    const kept = simplices.map(s => s.map(i => map[i])).filter(s => new Set(s).size === s.length);
    if (kept.length === 0) throw new Error('no simplices (faces, edges or points) found');

    // Renumber the vertices that are used
    const index = new Int32Array(n0).fill(-1);
    const pos = [];
    let n = 0;
    const renumber = v => {
        if (index[v] < 0) {
            index[v] = n++;
            pos.push(positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]);
        }
        return index[v];
    };
    const all = kept.map(s => s.map(renumber));

    // Closure: unique tetrahedra, triangles (as given, for orientation) and edges
    const tets = new Set();
    const triangles = new Map();
    const addTriangle = t => {
        const k = sortedKey(t);
        if (!triangles.has(k)) triangles.set(k, t);
    };
    const edgeKey = (a, b) => (a < b ? a * n + b : b * n + a);
    const edgeCount = new Map(); // edge -> number of triangles containing it
    const inEdge = new Uint8Array(n);
    let dimension = 0;
    for (const s of all) {
        dimension = Math.max(dimension, s.length - 1);
        if (s.length === 4) {
            tets.add(sortedKey(s));
            const [a, b, c, d] = s;
            [[a, b, c], [a, b, d], [a, c, d], [b, c, d]].forEach(addTriangle);
        } else if (s.length === 3) {
            addTriangle(s);
        }
        for (let i = 0; i < s.length; i++) {
            for (let j = i + 1; j < s.length; j++) {
                edgeCount.set(edgeKey(s[i], s[j]), 0);
                inEdge[s[i]] = inEdge[s[j]] = 1;
            }
        }
    }
    for (const [a, b, c] of triangles.values()) {
        for (const k of [edgeKey(a, b), edgeKey(b, c), edgeKey(a, c)]) edgeCount.set(k, edgeCount.get(k) + 1);
    }

    const allEdges = new Uint32Array(2 * edgeCount.size);
    const freeEdges = [];
    let boundaryEdges = 0, nonManifoldEdges = 0, i = 0;
    for (const [k, count] of edgeCount) {
        const a = Math.floor(k / n), b = k % n;
        allEdges[i++] = a;
        allEdges[i++] = b;
        if (count === 0) freeEdges.push(a, b);
        else if (count === 1) boundaryEdges++;
        else if (count > 2) nonManifoldEdges++;
    }
    const isolated = [];
    for (let v = 0; v < n; v++) if (!inEdge[v]) isolated.push(v);

    // Orient the triangles consistently (by flipping some), when every edge is in
    // at most two triangles and there are no tetrahedra; a conflict means the
    // surface is non-orientable.
    const tris = [...triangles.values()];
    let orientable = null;
    if (tris.length && nonManifoldEdges === 0 && tets.size === 0) {
        const byEdge = new Map();
        tris.forEach((t, k) => {
            for (let e = 0; e < 3; e++) {
                const key = edgeKey(t[e], t[(e + 1) % 3]);
                if (!byEdge.has(key)) byEdge.set(key, []);
                byEdge.get(key).push(k);
            }
        });
        const flip = new Int8Array(tris.length).fill(-1);
        orientable = true;
        for (let start = 0; start < tris.length; start++) {
            if (flip[start] >= 0) continue;
            flip[start] = 0;
            const stack = [start];
            while (stack.length) {
                const k = stack.pop(), t = tris[k];
                for (let e = 0; e < 3; e++) {
                    const a = t[e], b = t[(e + 1) % 3];
                    for (const m of byEdge.get(edgeKey(a, b))) {
                        if (m === k) continue;
                        // consistent neighbours traverse the shared edge in opposite directions
                        const u = tris[m];
                        const same = (u[0] === a && u[1] === b) || (u[1] === a && u[2] === b) || (u[2] === a && u[0] === b);
                        const want = flip[k] ^ same;
                        if (flip[m] < 0) {
                            flip[m] = want;
                            stack.push(m);
                        } else if (flip[m] !== want) {
                            orientable = false;
                        }
                    }
                }
            }
        }
        if (orientable) tris.forEach((t, k) => { if (flip[k]) [t[1], t[2]] = [t[2], t[1]]; });
    }

    // Connected components (union-find)
    const parent = Int32Array.from({ length: n }, (_, v) => v);
    const find = v => {
        while (parent[v] !== v) v = parent[v] = parent[parent[v]];
        return v;
    };
    let components = n;
    for (let k = 0; k < allEdges.length; k += 2) {
        const ra = find(allEdges[k]), rb = find(allEdges[k + 1]);
        if (ra !== rb) { parent[ra] = rb; components--; }
    }

    const nt = triangles.size;
    const pure = isolated.length === 0 && tets.size === 0;
    return {
        positions: new Float64Array(pos),
        simplices: all.filter(s => s.length > 1), // every vertex is sent anyway
        triangles: Uint32Array.from(tris.flat()),
        allEdges,
        freeEdges: Uint32Array.from(freeEdges),
        isolated: Uint32Array.from(isolated),
        dimension,
        orientable, // null unless every edge is in at most two triangles and there are no tetrahedra
        kind: pure && nt > 0 && freeEdges.length === 0 ? 'surface' : pure && nt === 0 ? 'curve' : 'complex',
        stats: {
            vertices: n,
            edges: edgeCount.size,
            triangles: nt,
            tetrahedra: tets.size,
            euler: n - edgeCount.size + nt - tets.size,
            components,
            boundaryEdges,
            nonManifoldEdges,
            merged,
        },
    };
}

// A space curve through the points in order; closed joins the last to the first.
export function curveComplex(points, closed) {
    if (points.length < 2) throw new Error('a curve needs at least 2 points');
    const n = points.length, edges = [];
    for (let i = 0; i + 1 < n; i++) edges.push([i, i + 1]);
    if (closed && n > 2) edges.push([n - 1, 0]);
    return buildComplex({ positions: points.flat(), simplices: edges });
}
