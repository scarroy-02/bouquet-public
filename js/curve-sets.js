// ========== Exact PHT Sets of a Parametrized Curve ==========
// For a closed C³ curve Γ with exact derivatives Γ', Γ'', Γ''', the two sets of the PHT on the
// sphere of directions, computed here instead of on the server:
//   inflection set:   v = ±Γ' × Γ''/|Γ' × Γ''|, the binormals (the height h_v has a
//                     degenerate critical point at t exactly when v ⊥ Γ'(t) and v ⊥ Γ''(t));
//   simultaneity set: v ⊥ Γ'(t), Γ'(s) and Γ(t) - Γ(s), the normals of the planes tangent to the
//                     curve at two points, traced as the zero set of
//                     F(t, s) = det(Γ'(t), Γ'(s), Γ(t) - Γ(s)) / (2 sin((s - t)/2))⁴ (curveSimultaneitySet).
// Both come as segments of unit directions, 6 numbers each (one of each ±v), as from the server;
// the simultaneity set also gives the matching segments of contact points.
//
// A plane curve γ has no such sets of its own (every height normal to its plane is constant), so it
// is lifted to the paraboloid z = λ|γ|² (parabolicLift). On the lift, the height in the direction
// (-2λc, 1) is λ(|γ - c|² - |c|²), so its PHT contains the radial transform of γ: the direction v
// is the center c = -(v_x, v_y)/(2λ v_z), the inflection and simultaneity sets in the upper
// hemisphere are the focal set and the symmetry set of γ, and the equator holds the centers at
// infinity. For a lift, both sets also come with these centers, in the plane z = 0.
//
// Curves are objects { period, at(u) → { p, d1, d2, d3 } } (3 coordinates, or 2 with planar: true).

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
const det3 = (a, b, c) => dot(a, cross(b, c));
const TAU = 2 * Math.PI;
const circ = x => x - TAU * Math.round(x / TAU); // in [-π, π]
const MAX_TURN = 0.03; // longest step of the simultaneity set drawn on the sphere, between unit directions (about 2°)

// Bouquet2D's closed curve through the points (2 or 3 coordinates): the uniform cubic B-spline
// whose control points solve C[i-1] + 4 C[i] + C[i+1] = 6 P[i], by its 20 Gauss-Seidel sweeps from
// C = P (js/geometry.js, solveControlPoints), so that it is the same curve. u runs over [0, n).
// It is C², so Γ''' is constant on each piece and a vertex can fall at a join.
export function bouquet2dSpline(points) {
    const n = points.length, dim = points[0].length;
    const C = points.map(p => p.slice());
    for (let it = 0; it < 20; it++) {
        for (let i = 0; i < n; i++) {
            const a = C[(i + n - 1) % n], b = C[(i + 1) % n];
            C[i] = points[i].map((x, k) => (6 * x - a[k] - b[k]) / 4);
        }
    }
    return {
        period: n,
        planar: dim === 2,
        at(u) {
            u = ((u % n) + n) % n;
            const i = Math.floor(u), t = u - i, t2 = t * t, t3 = t2 * t;
            const ctrl = [0, 1, 2, 3].map(j => C[(i + j - 1 + n) % n]);
            const mix = w => Array.from({ length: dim }, (_, k) => ctrl.reduce((sum, c, j) => sum + w[j] * c[k], 0));
            return {
                p: mix([(-t3 + 3 * t2 - 3 * t + 1) / 6, (3 * t3 - 6 * t2 + 4) / 6, (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, t3 / 6]),
                d1: mix([(-3 * t2 + 6 * t - 3) / 6, (9 * t2 - 12 * t) / 6, (-9 * t2 + 6 * t + 3) / 6, (3 * t2) / 6]),
                d2: mix([1 - t, 3 * t - 2, 1 - 3 * t, t]),
                d3: mix([-1, 3, -3, 1]),
            };
        },
    };
}

// The plane curve on the paraboloid z = λ(x² + y²), with exact derivatives
export function parabolicLift(curve, lambda) {
    const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
    return {
        period: curve.period,
        lambda,
        at(u) {
            const { p, d1, d2, d3 } = curve.at(u);
            return {
                p: [p[0], p[1], lambda * dot2(p, p)],
                d1: [d1[0], d1[1], 2 * lambda * dot2(p, d1)],
                d2: [d2[0], d2[1], 2 * lambda * (dot2(d1, d1) + dot2(p, d2))],
                d3: [d3[0], d3[1], 2 * lambda * (3 * dot2(d1, d2) + dot2(p, d3))],
            };
        },
    };
}

// The same curve with t in [0, 2π)
function onCircle(curve) {
    const k = curve.period / TAU;
    return {
        at(t) {
            const { p, d1, d2, d3 } = curve.at(t * k);
            return { p, d1: d1.map(x => x * k), d2: d2.map(x => x * k * k), d3: d3.map(x => x * k * k * k) };
        },
    };
}

// For a lift: the centers of directions, c = -(v_x, v_y)/(2λ v_z), as segments in the plane z = 0
// (6 numbers each), left out where v_z is near 0 or c is beyond `clip`
function centerSegments(directions, lambda, clip) {
    const out = [];
    const center = v => (Math.abs(v[2]) > 1e-3 ? [-v[0] / (2 * lambda * v[2]), -v[1] / (2 * lambda * v[2]), 0] : null);
    for (let i = 0; i < directions.length; i += 6) {
        const a = center(directions.slice(i, i + 3)), b = center(directions.slice(i + 3, i + 6));
        if (a && b && Math.hypot(...a) < clip && Math.hypot(...b) < clip) out.push(...a, ...b);
    }
    return out;
}

// ±the binormals, at `samples` points around the curve; for a lift, also the focal set of γ (the
// centers of these directions) in the plane z = 0
export function curveInflectionSet(curve, samples = 8192) {
    const c = onCircle(curve), normals = [];
    let prev = null, radius = 0;
    for (let k = 0; k <= samples; k++) {
        const { p, d1, d2 } = c.at((k / samples) * TAU);
        radius = Math.max(radius, Math.hypot(p[0], p[1]));
        let b = unit(cross(d1, d2));
        if (prev && dot(prev, b) < 0) b = b.map(x => -x); // one of ±v, continuous along the curve
        if (prev) normals.push(...prev, ...b);
        prev = b;
    }
    const points = curve.lambda ? centerSegments(normals, curve.lambda, 3 * radius) : null;
    return { normals, points, segments: normals.length / 6 };
}

// The simultaneity set: the curves of pairs (t, s), t ≠ s, with the same tangent plane, as the zero
// set of F (above), which is symmetric in t and s, on a grid of m × m points of [0, 2π)².
// det(Γ'(t), Γ'(s), Γ(t) - Γ(s)) vanishes to fourth order on the diagonal, like the weight, so F
// tends there to diag(t) = det(Γ', Γ'', Γ''')/12, which is 0 exactly where the torsion is (for a
// lift, at the vertices of γ): the curves of pairs end there.
// 1. F on the grid (half of it, mirrored); a 0 counts as positive.
// 2. Marching squares on the cells (i, j), i ≤ j: the cell (j, i) is the mirror. An edge and its
//    mirror are one node (key); a segment from an edge to its own mirror (only in a diagonal cell)
//    crosses the diagonal, and makes its key an end.
// 3. The nodes joined into paths, from the ends first, then the cycles; each point is taken as
//    (t, s) or (s, t), whichever is nearer to the last one, so that both contact points move
//    continuously along a path.
// 4. Each point with |s - t| beyond one cell moved onto F = 0 by minimum-norm Newton steps (kept
//    as it was if that moves it more than a cell: another branch), and each end at a diagonal
//    cell closed with the vertex in that cell, the root of diag by bisection.
// Returns { directions, first, second, centers (for a lift), segments, curves, ends, unclosed }.
export function curveSimultaneitySet(curve, m = 1024) {
    const c = onCircle(curve), h = TAU / m;
    const w = d => (2 * Math.sin(d / 2)) ** 4;
    const w1 = d => 4 * (2 * Math.sin(d / 2)) ** 3 * Math.cos(d / 2);
    const diag = t => { const a = c.at(t); return det3(a.d1, a.d2, a.d3) / 12; };
    const F = (t, s) => {
        if (circ(s - t) === 0) return diag(t);
        const a = c.at(t), b = c.at(s);
        return det3(a.d1, b.d1, sub(a.p, b.p)) / w(s - t);
    };
    const gradF = (t, s) => {
        const a = c.at(t), b = c.at(s), e = sub(a.p, b.p), W = w(s - t), r = w1(s - t) / W;
        const D = det3(a.d1, b.d1, e), Dt = det3(a.d2, b.d1, e), Ds = det3(a.d1, b.d2, e);
        return [(Dt + r * D) / W, (Ds - r * D) / W];
    };
    // 1. the grid
    const A = Array.from({ length: m }, (_, k) => c.at(k * h));
    const G = new Float64Array(m * m);
    for (let i = 0; i < m; i++) {
        for (let j = i; j < m; j++) {
            let g = i === j ? det3(A[i].d1, A[i].d2, A[i].d3) / 12 : det3(A[i].d1, A[j].d1, sub(A[i].p, A[j].p)) / w((j - i) * h);
            if (g === 0) g = Number.MIN_VALUE;
            G[i * m + j] = G[j * m + i] = g;
        }
    }
    const val = (i, j) => G[(i % m) * m + (j % m)];
    // 2. marching squares on the swap quotient. Edge (i, j, 0) runs from (i, j) to (i + 1, j), edge
    // (i, j, 1) from (i, j) to (i, j + 1); the mirror of (i, j, d) is (j, i, 1 - d).
    const id = (i, j, d) => ((i % m) * m + (j % m)) * 2 + d;
    const key = (i, j, d) => Math.min(id(i, j, d), id(j, i, 1 - d));
    const point = new Map(), adj = new Map(), ends = new Map();
    const crossing = (i, j, d) => {
        const g0 = val(i, j), g1 = d ? val(i, j + 1) : val(i + 1, j), f = g0 / (g0 - g1);
        return d ? [i * h, (j + f) * h] : [(i + f) * h, j * h];
    };
    const link = (a, b) => {
        if (!adj.has(a)) adj.set(a, new Set());
        adj.get(a).add(b);
    };
    for (let i = 0; i < m; i++) {
        for (let j = i; j < m; j++) {
            const v = [val(i, j), val(i + 1, j), val(i + 1, j + 1), val(i, j + 1)];
            const edges = [[i, j, 0], [i + 1, j, 1], [i, j + 1, 0], [i, j, 1]]; // edge k joins corners k and k + 1
            const cut = [0, 1, 2, 3].filter(k => Math.sign(v[k]) !== Math.sign(v[(k + 1) % 4]));
            if (cut.length < 2) continue;
            let pairs = [[cut[0], cut[1]]];
            if (cut.length === 4) { // a saddle: decided by F at the center of the cell
                const centre = F((i + 0.5) * h, (j + 0.5) * h);
                pairs = Math.sign(centre) === Math.sign(v[0]) ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]];
            }
            for (const [x, y] of pairs) {
                const kx = key(...edges[x]), ky = key(...edges[y]);
                if (!point.has(kx)) point.set(kx, crossing(...edges[x]));
                if (!point.has(ky)) point.set(ky, crossing(...edges[y]));
                if (kx === ky) ends.set(kx, i);
                else {
                    link(kx, ky);
                    link(ky, kx);
                }
            }
        }
    }
    // 3. paths, from the ends first
    const apart = (a, b) => Math.hypot(circ(a[0] - b[0]), circ(a[1] - b[1]));
    const visited = new Set(), paths = [];
    for (const k0 of [...ends.keys(), ...adj.keys()]) {
        if (visited.has(k0)) continue;
        const keys = [k0];
        visited.add(k0);
        for (let k = k0; ;) {
            const next = [...(adj.get(k) ?? [])].find(x => !visited.has(x));
            if (next === undefined) break;
            keys.push(next);
            visited.add(next);
            k = next;
        }
        const pts = [point.get(k0)];
        for (const k of keys.slice(1)) {
            const [t, s] = point.get(k), last = pts[pts.length - 1];
            pts.push(apart([t, s], last) <= apart([s, t], last) ? [t, s] : [s, t]);
        }
        const kn = keys[keys.length - 1];
        const cycle = !ends.has(k0) && keys.length > 2 && adj.get(kn).has(k0);
        if (cycle) pts.push(pts[0]);
        paths.push({ pts, first: k0, last: kn, cycle });
    }
    // 4. refine, close the ends
    const refine = ([t, s]) => {
        if (Math.abs(circ(s - t)) <= h) return [t, s];
        let x = t, y = s;
        for (let it = 0; it < 10; it++) {
            const g = gradF(x, y), f = F(x, y), n2 = g[0] * g[0] + g[1] * g[1];
            if (!(n2 > 0)) break;
            const dx = (-f * g[0]) / n2, dy = (-f * g[1]) / n2;
            x += dx;
            y += dy;
            if (Math.hypot(dx, dy) < 1e-12) break;
        }
        return Number.isFinite(x + y) && Math.hypot(circ(x - t), circ(y - s)) <= h ? [x, y] : [t, s];
    };
    // the root of diag in [t_i, t_{i+1}] (an end of the cell if diag is 0 there up to rounding, as for
    // a symmetric curve with a vertex on the grid); null if diag has one sign at both ends
    const diagScale = Math.max(...A.map(a => Math.abs(det3(a.d1, a.d2, a.d3) / 12)));
    const vertex = i => {
        let lo = i * h, hi = (i + 1) * h, dlo = diag(lo);
        const dhi = diag(hi);
        if (Math.abs(dlo) <= 1e-9 * diagScale) return lo;
        if (Math.abs(dhi) <= 1e-9 * diagScale) return hi;
        if (Math.sign(dlo) === Math.sign(dhi)) return null;
        for (let it = 0; it < 60; it++) {
            const mid = (lo + hi) / 2, dm = diag(mid);
            if (Math.sign(dm) === Math.sign(dlo)) { lo = mid; dlo = dm; } else hi = mid;
        }
        return (lo + hi) / 2;
    };
    let closedEnds = 0, unclosed = 0;
    for (const path of paths) {
        path.pts = path.pts.map(refine);
        const sides = path.first === path.last ? [[path.first, true]] : [[path.first, true], [path.last, false]];
        for (const [k, atStart] of sides) {
            if (path.cycle || !ends.has(k)) continue;
            const t = vertex(ends.get(k));
            if (t === null) { unclosed++; continue; } // two vertices in one cell: m is too small
            closedEnds++;
            if (atStart) path.pts.unshift([t, t]);
            else path.pts.push([t, t]);
        }
    }
    // output: the direction at each pair, continuous along a path, and its contact points. Beyond the
    // steps above, for the drawing: where the direction turns more than MAX_TURN between two points,
    // the middle pair is moved onto F = 0 as in step 4 and put in between, at most 6 times over.
    const direction = (t, s) => {
        const a = c.at(t);
        if (circ(s - t) === 0) return unit(cross(a.d1, a.d2)); // a curve end: the binormal
        const b = c.at(s), e = sub(a.p, b.p);
        let n = cross(b.d1, e);
        if (Math.hypot(...n) < 1e-14 * Math.hypot(...e)) n = cross(a.d1, e);
        return unit(n);
    };
    const directions = [], first = [], second = [];
    const pair = (ts, along) => { // a pair, its direction turned to agree with `along`
        const v = direction(...ts);
        return { ts, v: along && dot(along, v) < 0 ? v.map(x => -x) : v, p: c.at(ts[0]).p, q: c.at(ts[1]).p };
    };
    const emit = (a, b, depth) => {
        if (depth < 6 && Math.hypot(...sub(a.v, b.v)) > MAX_TURN) {
            const mid = refine([a.ts[0] + circ(b.ts[0] - a.ts[0]) / 2, a.ts[1] + circ(b.ts[1] - a.ts[1]) / 2]);
            const pm = pair(mid, a.v);
            emit(a, pm, depth + 1);
            emit(pm, b, depth + 1);
            return;
        }
        directions.push(...a.v, ...b.v);
        first.push(...a.p, ...b.p);
        second.push(...a.q, ...b.q);
    };
    for (const { pts } of paths) {
        let prev = null;
        for (const ts of pts) {
            const cur = pair(ts, prev?.v);
            if (prev) emit(prev, cur, 0);
            prev = cur;
        }
    }
    const radius = Math.max(...A.map(a => Math.hypot(a.p[0], a.p[1])));
    return {
        directions, first, second, segments: directions.length / 6, curves: paths.length, ends: closedEnds, unclosed,
        centers: curve.lambda ? centerSegments(directions, curve.lambda, 3 * radius) : null,
    };
}
