#!/usr/bin/env python3
"""
Check the C++ server against GUDHI's Python extended persistence.

Starts ./server on a free port, sends a few closed plane curves (one curve, several curves told apart
by curveId) with random centers, for the squared and the plain distance, and compares each diagram
with SimplexTree.extend_filtration() + extended_persistence() on the lower-star filtration of the
same distance.

Usage: make && python3 test_server.py      (needs numpy and gudhi)
"""

import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request

import gudhi as gd
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
KINDS = ["ord", "rel", "ext", "ext"]  # GUDHI subdiagrams: Ord, Rel, Ext+, Ext-
BUCKETS = [f"{k}{d}" for k in ("ord", "rel", "ext") for d in (0, 1)]


def curve(n, radius, center=(0.0, 0.0), phase=0.0):
    t = np.arange(n) * 2 * np.pi / n + phase
    return np.stack([center[0] + radius(t) * np.cos(t), center[1] + radius(t) * np.sin(t)], -1)


def cases():
    ellipse = curve(120, lambda t: 1 / np.sqrt((np.cos(t) / 2) ** 2 + np.sin(t) ** 2))
    flower = curve(300, lambda t: 1 + 0.3 * np.cos(5 * t) + 0.1 * np.sin(3 * t))
    small = curve(40, lambda t: 0.5 + 0 * t, center=(3.0, 1.0))
    return [
        ("ellipse", [ellipse]),
        ("five-petal curve", [flower]),
        ("two curves", [flower, small]),
        ("three curves", [ellipse, small, curve(60, lambda t: 0.4 + 0.1 * np.cos(3 * t), (-3.0, -1.0))]),
    ]


def reference(curves, f):
    """Extended persistence of the vertex values f on the closed curves, with GUDHI's Python interface."""
    st = gd.SimplexTree()
    start = 0
    for c in curves:
        for j in range(len(c)):
            a, b = start + j, start + (j + 1) % len(c)
            st.insert([a], f[a])
            st.insert([a, b], max(f[a], f[b]))
        start += len(c)
    st.extend_filtration()
    out = {b: [] for b in BUCKETS}
    for kind, dgm in zip(KINDS, st.extended_persistence()):
        for dim, (b, d) in dgm:
            out[f"{kind}{dim}"].append((b, d))
    return out


def post(port, payload, path):
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
        for name, curves in cases():
            V = np.vstack(curves)
            points = [{"x": x, "y": y, "curveId": i} for i, c in enumerate(curves) for x, y in c.tolist()]
            centers = rng.uniform(V.min(0) - 0.5, V.max(0) + 0.5, size=(16, 2))
            centers[0] = V.mean(0)
            for squared in (True, False):
                values = [((V - c) ** 2).sum(1) if squared else np.sqrt(((V - c) ** 2).sum(1)) for c in centers]
                payload = {"points": points, "centers": [{"x": x, "y": y} for x, y in centers.tolist()],
                           "use_squared_distance": squared}
                t0 = time.time()
                status, got = post(port, payload, "vineyard")
                elapsed = time.time() - t0
                label = f"{name} ({'squared' if squared else 'plain'} distance)"
                if status != 200:
                    print(f"FAIL {label}: HTTP {status} {got}")
                    failures += 1
                    continue
                bad = int(not np.isclose(got["infinityY"], 1.15 * max(map(max, values))))
                if bad:
                    print(f"  {label}: infinityY {got['infinityY']}")
                for ci, f in enumerate(values):
                    ref = reference(curves, f)
                    for b in BUCKETS:
                        mine = [(e["birth"], e["death"]) for e in got[b] if e["centerIdx"] == ci]
                        if not same(mine, ref[b]):
                            bad += 1
                            print(f"  {label}, #{ci}, {b}: server {sorted(mine)} != gudhi {sorted(ref[b])}")
                # The single-center endpoint, for the first center
                status, one = post(port, {**payload, "center": payload["centers"][0]}, "persistence")
                ref = reference(curves, values[0])
                if status != 200 or any(not same([tuple(p) for p in one[b]], ref[b]) for b in BUCKETS) \
                        or not np.isclose(one["r_min"], values[0].min()) or not np.isclose(one["r_max"], values[0].max()):
                    bad += 1
                    print(f"  {label}: /persistence differs from gudhi (HTTP {status})")
                failures += bad > 0
                pairs = sum(len(got[b]) for b in BUCKETS)
                print(f"{'FAIL' if bad else 'ok  '} {label:<38} {len(V):>4} points  {elapsed * 1000:4.0f} ms  {pairs} pairs")

        status, got = post(port, {"points": [{"x": 0, "y": 0}, {"x": 1, "y": 0}], "centers": [{"x": 0, "y": 0}]},
                           "vineyard")
        ok = status == 400 and "at least 3" in got.get("error", "")
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} two points -> HTTP {status} {got.get('error')}")
    finally:
        server.terminate()
        server.wait()
    print("All checks passed." if not failures else f"{failures} check(s) failed.")
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
