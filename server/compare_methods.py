#!/usr/bin/env python3
"""Compare the methods for the inflection and simultaneity sets against the exact sets of the implicit presets.

For each implicit surface, mesh level and noise level, every method computes both sets on the preset's mesh
(with its vertices moved by Gaussian noise of standard deviation noise * h per coordinate, h the average edge
length). The reference is the exact sets of the surface (method "Exact (from F)"), at mesh level 6 so that the
curves are densely sampled. Measured:

  curves on the surface  distance between the method's curves and the exact ones, both ways (median and 95th
                         percentile, in h); the share of the exact curves within 1 h of the method's
                         (complete) and of the method's within 1 h of the exact ones (true). The curves are
                         densified first (points h / 10 apart, 0.25 degrees on the sphere), so that these
                         are distances between curves, not between their sample points
  curves on the sphere   the same for the directions (in degrees, tolerance 2 degrees), +-v counted alike
  pieces                 number of separate curves: segments joined where they share an end, on the surface
                         (by the pair (p, q) for the simultaneity set)
  cusps                  cusps of the inflection set on the sphere: points where the curve reverses (the two
                         arms 1 degree back and forward make less than 90 degrees). For each exact cusp, the
                         distance to the nearest cusp of the method; missed exact cusps and extra cusps (none
                         within 3 degrees)
  ends                   the free ends of the simultaneity curves (by the pair (p, q)), compared on the sphere
                         the same way with the ends of the exact curves (generically, these are where the
                         pair's two points meet, at cusps of the inflection set)

The default surfaces are generic. The chair and the tanglecube are symmetric, and the chair is a Kummer-type
surface with planes tangent along whole curves (whose points all share one normal), so their sets are
degenerate. The double torus is a thin tube with small parabolic loops: even its exact sets at levels 4
and 5 differ from the level-6 reference (more pieces, and only 84 to 100% within tolerance), so it shows
where all the methods struggle rather than ranking them.

Usage (starts its own server; needs numpy and scipy):
  python3 compare_methods.py [--surfaces three-blobs double-torus] [--levels 4 5] [--noise 0 0.05]
"""
import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import numpy as np
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
METHODS = [
    ("jet, degree 2", {"method": "jet", "degree": 2}),
    ("jet, degree 3", {"method": "jet", "degree": 3}),
    ("jet, degree 4", {"method": "jet", "degree": 4}),
    ("jet blend, degree 2", {"method": "jets", "degree": 2, "support": 3}),
    ("jet blend, degree 3", {"method": "jets", "degree": 3, "support": 3}),
    ("jet blend, degree 4", {"method": "jets", "degree": 4, "support": 3}),
]
ARM, REVERSAL, CUSP_TOL, SPHERE_TOL = 1.0, 90.0, 3.0, 2.0  # degrees


def post(port, path, body):
    req = urllib.request.Request(f"http://127.0.0.1:{port}/{path}", json.dumps(body).encode(), {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"error": json.loads(e.read()).get("error")}


def chains(P):
    """Segments (consecutive pairs of rows of P) joined into polylines where ends coincide exactly. Returns
    the distinct rows, the polylines (as lists of their indices) and the rows at free ends."""
    keys, index = {}, []
    for p in map(tuple, P):
        index.append(keys.setdefault(p, len(keys)))
    pts = np.array(list(keys))
    edges = [(index[i], index[i + 1]) for i in range(0, len(index), 2) if index[i] != index[i + 1]]
    incident = [[] for _ in range(len(pts))]
    for e, (a, b) in enumerate(edges):
        incident[a].append(e)
        incident[b].append(e)
    used, out = [False] * len(edges), []

    def walk(v, e):
        chain = [v]
        while e is not None and not used[e]:
            used[e] = True
            a, b = edges[e]
            v = b if a == v else a
            chain.append(v)
            e = next((f for f in incident[v] if not used[f]), None) if len(incident[v]) == 2 else None
        return chain

    for v in range(len(pts)):
        if len(incident[v]) != 2:
            for e in incident[v]:
                if not used[e]:
                    out.append(walk(v, e))
    for e in range(len(edges)):
        if not used[e]:
            out.append(walk(edges[e][0], e))
    ends = [v for v in range(len(pts)) if len(incident[v]) == 1]
    return pts, out, pts[ends] if ends else np.zeros((0, 3))


def angle(a, b):
    return np.degrees(np.arccos(np.clip(np.sum(a * b, axis=-1), -1, 1)))


def cusps(directions, keys):
    """Cusps of curves on the sphere (unit vectors, 2 per segment): points where the curve reverses. The
    segments are joined by `keys` (rows starting with the directions, e.g. with the points on the surface)."""
    pts, polylines, _ = chains(keys)
    found = []
    for chain in polylines:
        C = pts[chain][:, :3]
        if len(C) < 3:
            continue
        s = np.concatenate([[0], np.cumsum(angle(C[1:], C[:-1]))])
        best = None
        for i in range(len(C)):
            j = np.searchsorted(s, s[i] - ARM, side="right") - 1
            k = np.searchsorted(s, s[i] + ARM, side="left")
            if j < 0 or k >= len(C):
                if best: found.append(best[1]); best = None
                continue
            a, b = C[j] - C[i], C[k] - C[i]
            a -= (a @ C[i]) * C[i]
            b -= (b @ C[i]) * C[i]
            if np.linalg.norm(a) == 0 or np.linalg.norm(b) == 0:
                continue
            t = np.degrees(np.arccos(np.clip(a @ b / np.linalg.norm(a) / np.linalg.norm(b), -1, 1)))
            if t < REVERSAL:
                if best is None or t < best[0]:
                    best = (t, C[i])
            elif best:
                found.append(best[1])
                best = None
        if best:
            found.append(best[1])
    return np.array(found).reshape(-1, 3)


def densify(P, step, sphere=False):
    """Points along the segments (2 rows of P per segment), at most `step` apart; on the sphere (unit
    vectors) the points are pushed back onto it."""
    if len(P) == 0:
        return P
    a, b = P[0::2], P[1::2]
    n = np.maximum(1, np.ceil(np.linalg.norm(b - a, axis=1) / step).astype(int))
    t = np.concatenate([np.arange(k + 1) / k for k in n])
    i = np.repeat(np.arange(len(a)), n + 1)
    Q = a[i] + t[:, None] * (b[i] - a[i])
    return Q / np.linalg.norm(Q, axis=1, keepdims=True) if sphere else Q


def both_ways(A, B, tol):
    """Distances from A to B and B to A: median and 95th percentile of all, share of B within tol of A
    (complete), share of A within tol of B (true)."""
    if len(A) == 0 or len(B) == 0:
        return np.nan, np.nan, 0.0, 0.0
    ab, ba = cKDTree(B).query(A)[0], cKDTree(A).query(B)[0]
    d = np.concatenate([ab, ba])
    return np.median(d), np.quantile(d, 0.95), np.mean(ba <= tol), np.mean(ab <= tol)


def sphere_stats(A, B):
    """both_ways on the sphere, in degrees, with +-v alike (both sets symmetrized); chord to angle."""
    A, B = densify(A, np.radians(0.25), True), densify(B, np.radians(0.25), True)
    A, B = np.vstack([A, -A]), np.vstack([B, -B])
    tol = 2 * np.sin(np.radians(SPHERE_TOL) / 2)
    med, p95, comp, true = both_ways(A, B, tol)
    deg = lambda c: np.degrees(2 * np.arcsin(min(c / 2, 1))) if np.isfinite(c) else np.nan
    return deg(med), deg(p95), comp, true


def match(ref, found):
    """For points on the sphere (+-v alike): median distance from each reference point to the nearest found
    one, and the numbers of missed reference points and extra found points (none within CUSP_TOL)."""
    if len(ref) == 0:
        return np.nan, 0, len(found)
    if len(found) == 0:
        return np.nan, len(ref), 0
    F = np.vstack([found, -found])
    d_ref = angle(ref[:, None], F[None]).min(1)
    R = np.vstack([ref, -ref])
    d_found = angle(found[:, None], R[None]).min(1)
    return np.median(d_ref), int(np.sum(d_ref > CUSP_TOL)), int(np.sum(d_found > CUSP_TOL))


def run(port, surface, levels, noises, rng):
    ref_mesh = post(port, "implicit", {"surface": surface, "level": 6})
    ref_i = post(port, "inflection", {**ref_mesh, "implicit": surface})
    ref_s = post(port, "simultaneity", {**ref_mesh, "implicit": surface})
    RI_p, RI_v = np.reshape(ref_i["points"], (-1, 3)), np.reshape(ref_i["normals"], (-1, 3))
    RS_p = np.vstack([np.reshape(ref_s["first"], (-1, 3)), np.reshape(ref_s["second"], (-1, 3))])
    RS_v = np.reshape(ref_s["directions"], (-1, 3))
    RS_k = np.hstack([RS_v, np.reshape(ref_s["first"], (-1, 3)), np.reshape(ref_s["second"], (-1, 3))])
    ref_cusps, ref_ends = cusps(RI_v, np.hstack([RI_v, RI_p])), chains(RS_k)[2][:, :3]
    print(f"\n=== {surface}: exact (level 6) inflection {ref_i['curves']} curves with {len(ref_cusps)} cusps; "
          f"simultaneity {ref_s['curves']} curves with {len(ref_ends)} free ends")
    for level in levels:
        mesh = post(port, "implicit", {"surface": surface, "level": level})
        V, T = np.reshape(mesh["vertices"], (-1, 3)), np.array(mesh["simplices"])
        h = np.linalg.norm(V[T[:, 0]] - V[T[:, 1]], axis=1).mean()
        for noise in noises:
            Vn = V + noise * h * rng.normal(size=V.shape)
            body = {"vertices": Vn.ravel().tolist(), "simplices": mesh["simplices"]}
            print(f"\n{surface}, level {level} ({len(T)} triangles, h = {h:.3f}), noise {noise} h")
            print(f"  {'':22s}|{'inflection on the surface':^28s}|{'inflection on the sphere':^28s}|{'cusps':^16s}|"
                  f"{'simultaneity on the sphere':^28s}|{'ends':^16s}|")
            print(f"  {'method':22s}|{'med/95% h':>11s}{'compl':>6s}{'true':>6s}{'pcs':>5s}|"
                  f"{'med/95% deg':>12s}{'compl':>6s}{'true':>6s}{'':>4s}|{'err':>6s}{'miss':>5s}{'extra':>5s}|"
                  f"{'med/95% deg':>12s}{'compl':>6s}{'true':>6s}{'pcs':>4s}|{'err':>6s}{'miss':>5s}{'extra':>5s}|{'time':>6s}")
            for name, opt in [("exact (from F)", {"implicit": surface})] + METHODS:
                t = time.time()
                b = {**mesh, **opt} if "implicit" in opt else {**body, **opt}
                ri, rs = post(port, "inflection", b), post(port, "simultaneity", b)
                dt = time.time() - t
                if "error" in ri or "error" in rs:
                    print(f"  {name:22s}| error: {ri.get('error') or rs.get('error')}")
                    continue
                Ip, Iv = np.reshape(ri["points"], (-1, 3)), np.reshape(ri["normals"], (-1, 3))
                Sv = np.reshape(rs["directions"], (-1, 3))
                Sk = np.hstack([Sv, np.reshape(rs["first"], (-1, 3)), np.reshape(rs["second"], (-1, 3))])
                im, i95, ic, it = both_ways(densify(Ip, h / 10), densify(RI_p, h / 10), h)
                vm, v95, vc, vt = sphere_stats(Iv, RI_v)
                cm, cmiss, cextra = match(ref_cusps, cusps(Iv, np.hstack([Iv, Ip])))
                sm, s95, sc, st = sphere_stats(Sv, RS_v)
                em, emiss, eextra = match(ref_ends, chains(Sk)[2][:, :3])
                print(f"  {name:22s}|{im:5.2f}/{i95:5.2f}{ic:6.0%}{it:6.0%}{len(chains(Ip)[1]):5d}|"
                      f"{vm:5.2f}/{v95:6.2f}{vc:6.0%}{vt:6.0%}{'':>4s}|{cm:6.2f}{cmiss:5d}{cextra:5d}|"
                      f"{sm:5.2f}/{s95:6.2f}{sc:6.0%}{st:6.0%}{len(chains(Sk)[1]):4d}|{em:6.2f}{emiss:5d}{eextra:5d}|{dt:5.1f}s")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--surfaces", nargs="+", default=["three-blobs", "double-torus"])
    ap.add_argument("--levels", type=int, nargs="+", default=[4, 5])
    ap.add_argument("--noise", type=float, nargs="+", default=[0, 0.05], help="vertex noise, in average edge lengths")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = subprocess.Popen([os.path.join(HERE, "server")], env={**os.environ, "PORT": str(port)}, stdout=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/health")
                break
            except OSError:
                time.sleep(0.05)
        rng = np.random.default_rng(args.seed)
        for surface in args.surfaces:
            run(port, surface, args.levels, args.noise, rng)
    finally:
        server.terminate()
        server.wait()


if __name__ == "__main__":
    sys.exit(main())
