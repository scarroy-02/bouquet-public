#!/usr/bin/env python3
"""
Check the C++ server against GUDHI's Python extended persistence.

Starts ./server on a free port, sends a few complexes (closed surfaces, a
surface with boundary, closed and open space curves, a solid cube made of
tetrahedra, an abstract 3-sphere, a wedge with an isolated vertex) with random
centers (radial function: squared distance) and random directions (height
function, as in the persistent homology transform), and compares each diagram
with SimplexTree.extend_filtration() + extended_persistence() on the
lower-star filtration of the same function.

Usage: make && python3 test_server.py      (needs numpy and gudhi)
"""

import itertools
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import gudhi as gd
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
KINDS = ["ord", "rel", "ext", "ext"]  # GUDHI subdiagrams: Ord, Rel, Ext+, Ext-


def icosphere(subdiv):
    t = (1 + 5 ** 0.5) / 2
    V = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t),
         (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
    F = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4),
         (11, 10, 2), (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8),
         (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    V = [np.array(v, float) / np.linalg.norm(v) for v in V]
    for _ in range(subdiv):
        mid, F2 = {}, []

        def m(a, b):
            key = (min(a, b), max(a, b))
            if key not in mid:
                p = V[a] + V[b]
                V.append(p / np.linalg.norm(p))
                mid[key] = len(V) - 1
            return mid[key]

        for a, b, c in F:
            ab, bc, ca = m(a, b), m(b, c), m(c, a)
            F2 += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        F = F2
    return np.array(V), np.array(F)


def torus(nu=24, nv=12, R=2.0, r=0.7):
    u, v = np.meshgrid(np.arange(nu) * 2 * np.pi / nu, np.arange(nv) * 2 * np.pi / nv, indexing="ij")
    V = np.stack([(R + r * np.cos(v)) * np.cos(u), (R + r * np.cos(v)) * np.sin(u), r * np.sin(v)], -1)
    idx = lambda i, j: (i % nu) * nv + (j % nv)  # noqa: E731
    F = []
    for i in range(nu):
        for j in range(nv):
            F += [(idx(i, j), idx(i + 1, j), idx(i + 1, j + 1)), (idx(i, j), idx(i + 1, j + 1), idx(i, j + 1))]
    return V.reshape(-1, 3), np.array(F)


def polyline(n, closed):
    t = np.arange(n) * 2 * np.pi / n
    V = np.stack([np.sin(t) + 2 * np.sin(2 * t), np.cos(t) - 2 * np.cos(2 * t), -np.sin(3 * t)], -1)  # trefoil
    E = [(i, (i + 1) % n) for i in range(n if closed else n - 1)]
    return V, np.array(E)


def solid_cube(n=4, size=2.0):
    """[-size, size]^3 cut into n^3 cubes, each split into 6 tetrahedra (Freudenthal)."""
    g = np.linspace(-size, size, n + 1)
    V = np.stack(np.meshgrid(g, g, g, indexing="ij"), -1).reshape(-1, 3)
    idx = lambda i, j, k: (i * (n + 1) + j) * (n + 1) + k  # noqa: E731
    T = []
    for i, j, k in itertools.product(range(n), repeat=3):
        for perm in itertools.permutations(range(3)):
            p = [i, j, k]
            tet = [idx(*p)]
            for axis in perm:
                p[axis] += 1
                tet.append(idx(*p))
            T.append(tet)
    return V, T


def cases(rng):
    sphere_v, sphere_f = icosphere(3)
    sphere_f = sphere_f.tolist()
    ellipsoid = sphere_v * [3.0, 2.0, 1.2]
    # Ellipsoid with a bumpy radius, so centers see many critical points
    bumpy = sphere_v * (1 + 0.15 * np.sin(5 * sphere_v[:, :1]) * np.cos(4 * sphere_v[:, 1:2]))
    # Cap with boundary: drop the triangles below z = -0.3
    cap = [t for t in sphere_f if sphere_v[t].mean(0)[2] > -0.3]
    tv, tf = torus()
    cv, ce = polyline(90, closed=True)
    ov, oe = polyline(90, closed=False)
    # Ellipsoid plus a dangling edge to an extra vertex (mixed dimensions)
    mixed_v = np.vstack([ellipsoid, [[4.0, 0.0, 0.0]]])
    tip = int(np.argmax(ellipsoid[:, 0]))
    # Sphere wedge a circle through its top vertex, plus an isolated vertex
    top = int(np.argmax(sphere_v[:, 2]))
    t = np.linspace(0, 2 * np.pi, 31)[1:-1]
    circle = np.stack([0.8 * np.sin(t), np.zeros_like(t), sphere_v[top, 2] + 0.8 * (1 - np.cos(t))], -1)
    wedge_v = np.vstack([sphere_v, circle, [[3.0, 0.0, 0.0]]])
    ring = [top] + list(range(len(sphere_v), len(sphere_v) + len(circle)))
    wedge = sphere_f + [[ring[i], ring[(i + 1) % len(ring)]] for i in range(len(ring))]
    # Boundary of the 4-simplex: an abstract 3-sphere with vertices in R^3
    s3_v = rng.normal(size=(5, 3))
    s3 = [list(c) for c in itertools.combinations(range(5), 4)]
    cube_v, cube_t = solid_cube()
    return [
        ("ellipsoid", ellipsoid, sphere_f),
        ("bumpy sphere", bumpy, sphere_f),
        ("cap with boundary", sphere_v, cap),
        ("torus", tv, tf.tolist()),
        ("closed space curve", cv, ce.tolist()),
        ("open space curve", ov, oe.tolist()),
        ("surface + dangling edge", mixed_v, sphere_f + [[tip, len(ellipsoid)]]),
        ("sphere v circle + point", wedge_v, wedge),
        ("solid cube (tetrahedra)", cube_v, cube_t),
        ("abstract 3-sphere", s3_v, s3),
    ]


def reference(simplices, f):
    """Extended persistence of the vertex function f with GUDHI's Python interface."""
    st = gd.SimplexTree()
    for i in range(len(f)):
        st.insert([i])
    for s in simplices:
        st.insert(list(map(int, s)))
    for s, _ in st.get_simplices():  # lower-star filtration
        st.assign_filtration(s, max(f[v] for v in s))
    st.extend_filtration()
    out = {}
    for kind, dgm in zip(KINDS, st.extended_persistence()):
        for dim, (b, d) in dgm:
            out.setdefault(f"{kind}{dim}", []).append((b, d))
    return out


def post(port, payload, path="vineyard"):
    req = urllib.request.Request(f"http://127.0.0.1:{port}/{path}", json.dumps(payload).encode(),
                                 {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def same(a, b):
    a, b = sorted(a), sorted(b)
    return len(a) == len(b) and (not a or np.allclose(a, b, rtol=1e-9, atol=1e-12))


def main():
    # The checks print ‖x‖∞, which Windows' default encoding for a pipe (cp1252) cannot write
    sys.stdout.reconfigure(encoding="utf-8")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = subprocess.Popen([os.path.join(HERE, "server")], env={**os.environ, "PORT": str(port)},
                              stdout=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/health")
                break
            except OSError:
                time.sleep(0.05)

        rng = np.random.default_rng(0)
        failures = 0
        for name, V, simplices in cases(rng):
            lo, hi = V.min(0), V.max(0)
            centers = rng.uniform(lo - 0.5, hi + 0.5, size=(12, 3))
            centers[0] = V.mean(0)
            directions = rng.normal(size=(12, 3))
            directions /= np.linalg.norm(directions, axis=1, keepdims=True)
            runs = [
                ("radial", {"centers": centers.ravel().tolist()}, [((V - c) ** 2).sum(1) for c in centers]),
                ("height", {"function": "height", "directions": (3 * directions).ravel().tolist()},  # normalized by the server
                 [V @ v for v in directions]),
            ]
            for function, extra, values in runs:
                t0 = time.time()
                status, got = post(port, {"vertices": V.ravel().tolist(), "simplices": simplices, **extra})
                elapsed = time.time() - t0
                if status != 200:
                    print(f"FAIL {name} ({function}): HTTP {status} {got}")
                    failures += 1
                    continue
                dim = max(len(s) for s in simplices) - 1
                buckets = [f"{k}{d}" for k in ("ord", "rel", "ext") for d in range(dim + 1)]
                bad = int(got["dimension"] != dim or set(got) != set(buckets) | {"dimension", "minValue", "maxValue"}
                          or not np.isclose(got["minValue"], min(map(min, values)))
                          or not np.isclose(got["maxValue"], max(map(max, values))))
                if bad:
                    print(f"  {name} ({function}): response keys {sorted(got)}, range {got['minValue']}..{got['maxValue']}")
                counts = {b: 0 for b in buckets}
                for ci, f in enumerate(values):
                    ref = reference(simplices, f)
                    for b in buckets:
                        mine = [(e["birth"], e["death"]) for e in got[b] if e["centerIdx"] == ci]
                        counts[b] += len(mine)
                        if not same(mine, ref.pop(b, [])):
                            bad += 1
                            print(f"  {name} ({function}), #{ci}, {b}: server {sorted(mine)} != gudhi")
                    if ref:
                        bad += 1
                        print(f"  {name} ({function}), #{ci}: GUDHI has pairs in {sorted(ref)} the server did not return")
                failures += bad > 0
                summary = " ".join(f"{b}:{n}" for b, n in counts.items() if n)
                print(f"{'FAIL' if bad else 'ok  '} {name:<24} {function:<6} {len(V):>5} verts  {elapsed * 1000:5.0f} ms  {summary}")

        status, got = post(port, {"vertices": [0, 0, 0, 1, 0, 0], "simplices": [[0, 2]], "centers": [0, 0, 0]})
        ok = status == 400 and "out of range" in got.get("error", "")
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} invalid index -> HTTP {status} {got.get('error')}")

        # Inflection set: none on an ellipsoid (K > 0); on a torus, the top and bottom circles of the
        # tube (z = +-r), where the normal is +-z
        S, F = icosphere(4)
        r = 0.7
        T, G = torus(96, 30, 2.0, r)  # 30 rows: the parabolic circles fall between rows
        status, got = post(port, {"vertices": (S * [4, 2.5, 1.6]).ravel().tolist(), "simplices": F.tolist(),
                                  "method": "jet"}, "inflection")
        ok = status == 200 and got["segments"] == 0 and got["negative"] == 0
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} inflection jet ellipsoid: {got.get('segments')} segments")
        status, got = post(port, {"vertices": T.ravel().tolist(), "simplices": G.tolist(), "method": "jet"},
                           "inflection")
        P, N = np.reshape(got.get("points", []), (-1, 3)), np.reshape(got.get("normals", []), (-1, 3))
        ok = (status == 200 and got["segments"] >= 2 * 96 and np.allclose(np.abs(P[:, 2]), r, atol=0.05 * r)
              and np.all(np.abs(N[:, 2]) > 0.98))
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} inflection jet torus: {got.get('segments')} segments, "
              f"|z| in [{np.abs(P[:, 2]).min():.3f}, {np.abs(P[:, 2]).max():.3f}], min |n_z| {np.abs(N[:, 2]).min():.4f}")
        # Only jet fitting and the jet blend are offered
        for method in ("icc", "discrete", "mls"):
            status, got = post(port, {"vertices": S.ravel().tolist(), "simplices": F.tolist(), "method": method}, "inflection")
            ok = status == 400 and "method" in got.get("error", "")
            failures += not ok
            print(f"{'ok  ' if ok else 'FAIL'} inflection {method} -> HTTP {status} {got.get('error')}")
        # Simultaneity set: none on the ellipsoid (only a max and a min); on the torus, the two saddles have
        # the same height exactly when cos(elevation of v) = r / R, i.e. |v_z| = sqrt(1 - (r / R)^2).
        # The round torus is degenerate at +-z (circles of critical points, and the parabolic circles
        # map to the poles), so crossings there are not checked.
        status, got = post(port, {"vertices": (S * [4, 2.5, 1.6]).ravel().tolist(), "simplices": F.tolist()}, "simultaneity")
        ok = status == 200 and got["segments"] == 0
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} simultaneity ellipsoid: {got.get('segments')} segments")
        z = np.sqrt(1 - (r / 2.0) ** 2)
        status, got = post(port, {"vertices": T.ravel().tolist(), "simplices": G.tolist(), "method": "jet"}, "simultaneity")
        v, p, q = (np.reshape(got.get(k, []), (-1, 3)) for k in ("directions", "first", "second"))
        pole = np.abs(v[:, 2]) > 0.99
        v, p, q = v[~pole], p[~pole], q[~pole]
        # heights of the two contact points, relative to the size of the torus
        gap = np.abs(np.einsum("ij,ij->i", p - q, v)).max() / np.ptp(T, 0).max() if len(v) else np.inf
        ok = status == 200 and len(v) >= 2 * 96 and np.allclose(np.abs(v[:, 2]), z, atol=0.002) and gap < 0.005
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} simultaneity jet torus: {len(v) // 2} segments, |v_z| in "
              f"[{np.abs(v[:, 2]).min():.4f}, {np.abs(v[:, 2]).max():.4f}] (exact {z:.4f}), height gap {gap:.1e}; "
              f"{pole.sum() // 2} at the poles")
        # Implicit surfaces: exact sets. Torus (R = 3, r = 1.2): parabolic circles z = +-r on rho = R
        # with normals +-z, simultaneity at |v_z| = sqrt(1 - (r / R)^2); two blobs (symmetric under
        # x -> -x): simultaneity on v_x = 0
        status, mesh = post(port, {"surface": "torus", "level": 4}, "implicit")
        F_ = np.array(mesh.get("simplices", []))
        edges = {tuple(sorted(e)) for t in F_.tolist() for e in ((t[0], t[1]), (t[1], t[2]), (t[0], t[2]))}
        ok = status == 200 and len(mesh["vertices"]) // 3 - len(edges) + len(F_) == 0
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} implicit torus mesh: {len(F_)} triangles, Euler characteristic 0")
        status, got = post(port, {**mesh, "implicit": "torus"}, "inflection")
        P, N = np.reshape(got["points"], (-1, 3)), np.reshape(got["normals"], (-1, 3))
        err = max(np.abs(np.abs(P[:, 2]) - 1.2).max(), np.abs(np.hypot(P[:, 0], P[:, 1]) - 3).max(), (1 - np.abs(N[:, 2])).max())
        ok = status == 200 and got["segments"] > 100 and err < 1e-12
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} exact inflection torus: {got['segments']} segments, error {err:.1e}")
        status, got = post(port, {**mesh, "implicit": "torus"}, "simultaneity")
        v = np.reshape(got["directions"], (-1, 3))
        v = v[np.abs(v[:, 2]) < 0.99]
        err = np.abs(np.abs(v[:, 2]) - np.sqrt(0.84)).max()
        ok = status == 200 and len(v) > 100 and err < 1e-12
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} exact simultaneity torus: {len(v) // 2} segments off the poles, error {err:.1e}")
        status, mesh = post(port, {"surface": "two-blobs", "level": 4}, "implicit")
        status, got = post(port, {**mesh, "implicit": "two-blobs"}, "simultaneity")
        err = np.abs(np.reshape(got["directions"], (-1, 3))[:, 0]).max()
        ok = status == 200 and got["segments"] > 20 and err < 1e-12
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} exact simultaneity two blobs: {got['segments']} segments, max |v_x| {err:.1e}")
        # Jet blend through the two blobs' mesh: close to the exact sets (inflection at |x| = 0.3512,
        # simultaneity at v_x = 0), with exact equal heights on the jet blend itself
        status, mesh = post(port, {"surface": "two-blobs", "level": 5}, "implicit")
        Vb, Fb = np.reshape(mesh["vertices"], (-1, 3)), np.array(mesh["simplices"])
        h = np.linalg.norm(Vb[Fb[:, 0]] - Vb[Fb[:, 1]], axis=1).mean()
        status, got = post(port, {**mesh, "method": "jets", "degree": 3, "support": 3}, "inflection")
        P = np.reshape(got["points"], (-1, 3))
        err = np.median(np.abs(np.abs(P[:, 0]) - 0.3512)) / h if len(P) else np.inf
        ok = status == 200 and got["segments"] > 20 and err < 0.05 and np.isfinite(P).all()
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} jet blend inflection two blobs: {got['segments']} segments in {got['curves']} curves, "
              f"median ||x| - 0.3512| = {err:.3f} edge lengths")
        status, got = post(port, {**mesh, "method": "jets", "degree": 3, "support": 3}, "simultaneity")
        v, p, q = (np.reshape(got[k], (-1, 3)) for k in ("directions", "first", "second"))
        vx = np.degrees(np.median(np.abs(np.arcsin(np.clip(v[:, 0], -1, 1))))) if len(v) else np.inf
        gap = np.abs(np.einsum("ij,ij->i", p - q, v)).max() if len(v) else np.inf
        ok = status == 200 and got["segments"] > 20 and vx < 0.1 and gap < 1e-9 and np.isfinite(v).all()
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} jet blend simultaneity two blobs: {got['segments']} segments in {got['curves']} curves, "
              f"median |angle to v_x = 0| {vx:.3f} degrees, height gap {gap:.0e}")
        # Subdivide-and-project: 4^k times the triangles, vertices on the jet blend (of a sphere)
        S, F = icosphere(2)
        status, got = post(port, {"vertices": S.ravel().tolist(), "simplices": F.tolist(), "steps": 2, "scheme": "midpoint",
                                  "degree": 3, "support": 3}, "subdivide")
        W = np.reshape(got.get("vertices", []), (-1, 3))
        err = np.abs(np.linalg.norm(W, axis=1) - 1).max() if len(W) else np.inf
        ok = status == 200 and len(got["simplices"]) == 16 * len(F) and np.isfinite(W).all() and err < 0.02
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} subdivide sphere twice: {len(got.get('simplices', []))} triangles, "
              f"max ||x| - 1| {err:.1e}, {got.get('unprojected')} unprojected")
        # Coxeter remeshing (GUDHI's manifold tracing): a closed sphere again (chi = 2, each edge in two
        # triangles, used once in each direction), about as fine as two midpoint steps, on the surface
        status, got = post(port, {"vertices": S.ravel().tolist(), "simplices": F.tolist(), "steps": 2, "scheme": "coxeter",
                                  "degree": 3, "support": 3}, "subdivide")
        W, T = np.reshape(got.get("vertices", []), (-1, 3)), got.get("simplices", [])
        directed = {(t[k], t[(k + 1) % 3]) for t in T for k in range(3)}
        closed = len(directed) == 3 * len(T) and all((b, a) in directed for a, b in directed)
        chi = len(W) - len(directed) // 2 + len(T)
        err = np.abs(np.linalg.norm(W, axis=1) - 1).max() if len(W) else np.inf
        ok = status == 200 and closed and chi == 2 and 0.7 < len(T) / (16 * len(F)) < 1.3 and err < 0.02
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} Coxeter remesh of the sphere: {len(T)} triangles, chi {chi}, "
              f"{'closed and oriented' if closed else 'NOT closed or oriented'}, max ||x| - 1| {err:.1e}")
        status, got = post(port, {"vertices": S.ravel().tolist(), "simplices": F[1:].tolist(), "steps": 1, "scheme": "coxeter"},
                           "subdivide")
        ok = status == 400 and "closed" in got.get("error", "")
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} Coxeter remesh of an open mesh -> HTTP {status} {got.get('error')}")
        # Isotropic remeshing (CGAL) of a cube: on the cube itself, its sharp edges and corners kept,
        # well-shaped triangles; and an open mesh is accepted
        C = np.array([[x, y, z] for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)], float)
        Q = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]
        CF = [[q[0], q[1], q[2]] for q in Q] + [[q[0], q[2], q[3]] for q in Q]
        status, got = post(port, {"vertices": C.ravel().tolist(), "simplices": CF, "steps": 2, "scheme": "isotropic"}, "subdivide")
        W, T = np.reshape(got.get("vertices", []), (-1, 3)), np.array(got.get("simplices", []))
        err = np.abs(np.abs(W).max(1) - 1).max() if len(W) else np.inf
        corners = sum(bool(np.isclose(W, c).all(1).any()) for c in C) if len(W) else 0
        chi = len(W) - len({tuple(sorted(e)) for t in T.tolist() for e in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0]))}) + len(T)
        smallest = min((np.degrees(np.arccos(np.dot(W[t[(k + 1) % 3]] - W[t[k]], W[t[(k + 2) % 3]] - W[t[k]])
                                              / np.linalg.norm(W[t[(k + 1) % 3]] - W[t[k]]) / np.linalg.norm(W[t[(k + 2) % 3]] - W[t[k]])))
                        for t in T for k in range(3)), default=0)
        ok = status == 200 and len(T) > 8 * len(CF) and err < 1e-12 and corners == 8 and chi == 2 and smallest > 20
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} isotropic remesh of a cube: {len(T)} triangles, max |‖x‖∞ - 1| {err:.0e}, "
              f"{corners} corners kept, chi {chi}, smallest angle {smallest:.0f} degrees")
        status, got = post(port, {"vertices": S.ravel().tolist(), "simplices": F[1:].tolist(), "steps": 1, "scheme": "isotropic"},
                           "subdivide")
        ok = status == 200 and len(got.get("simplices", [])) > len(F)
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} isotropic remesh of an open mesh -> HTTP {status}, {len(got.get('simplices', []))} triangles")
        status, got = post(port, {"surface": "nothing"}, "implicit")
        ok = status == 400 and "unknown" in got.get("error", "")
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} unknown implicit surface -> HTTP {status} {got.get('error')}")
        status, got = post(port, {"vertices": [0, 0, 0, 1, 0, 0], "simplices": [[0, 1]]}, "inflection")
        ok = status == 400 and "triangles" in got.get("error", "")
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} inflection without triangles -> HTTP {status} {got.get('error')}")
    finally:
        server.terminate()
        server.wait()

    print("All checks passed." if not failures else f"{failures} check(s) failed.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
