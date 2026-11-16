// ========== Loop of Directions on the Unit Sphere ==========
// A closed loop on S² through control points ("handles"): the closed
// centripetal Catmull-Rom spline through the handles, projected radially onto
// the sphere. It is closed by construction and always passes through the handles.
// With fewer than 3 handles (a loop being drawn) it has no points yet.
import * as THREE from 'three';

const PER_SEGMENT = 48;  // dense samples between consecutive handles
const MIN_CHORD = 0.2;   // the spline must stay this far from the center to be projected

export class SphereLoop {
    constructor(handles) {
        this.handles = handles.map(h => h.clone().normalize());
        this.points = projectedSpline(this.handles);
    }

    // n handles evenly spaced on the equator (z = 0), starting at +X.
    static equator(n = 8) {
        return new SphereLoop(Array.from({ length: n }, (_, k) => {
            const a = (2 * Math.PI * k) / n;
            return new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
        }));
    }

    // Replace the handles, unless the spline through them would pass too close
    // to the center to be projected (e.g. two neighbours almost opposite).
    trySetHandles(handles) {
        const points = projectedSpline(handles);
        if (!points) return false;
        this.handles = handles;
        this.points = points;
        return true;
    }

    // Length in radians (the equator has length 2π).
    length() {
        let total = 0;
        for (let i = 0; i < this.points.length; i++) total += angle(this.points[i], this.points[(i + 1) % this.points.length]);
        return total;
    }

    // n directions spaced evenly by arc length, starting at the first handle.
    sample(n) {
        const pts = this.points, m = pts.length;
        if (!m) return [];
        const cum = [0];
        for (let i = 0; i < m; i++) cum.push(cum[i] + angle(pts[i], pts[(i + 1) % m]));
        const out = [];
        let j = 0;
        for (let k = 0; k < n; k++) {
            const s = (cum[m] * k) / n;
            while (cum[j + 1] < s) j++;
            const seg = cum[j + 1] - cum[j];
            out.push(slerp(pts[j], pts[(j + 1) % m], seg > 0 ? (s - cum[j]) / seg : 0));
        }
        return out;
    }

    // Index of the handle after which a point of the loop lies (for inserting a handle there).
    segmentAt(point) {
        let best = 0, bestDot = -Infinity;
        this.points.forEach((p, i) => {
            const d = p.dot(point);
            if (d > bestDot) { bestDot = d; best = i; }
        });
        return Math.floor(best / PER_SEGMENT);
    }
}

function projectedSpline(handles) {
    if (handles.length < 3) return [];
    const spline = new THREE.CatmullRomCurve3(handles, true, 'centripetal');
    const n = handles.length * PER_SEGMENT;
    const points = [];
    for (let i = 0; i < n; i++) {
        const p = spline.getPoint(i / n); // point i * PER_SEGMENT is handle i
        if (p.length() < MIN_CHORD) return null;
        points.push(p.normalize());
    }
    return points;
}

const angle = (a, b) => 2 * Math.asin(Math.min(1, a.distanceTo(b) / 2));

function slerp(a, b, t) {
    const q = new THREE.Quaternion().setFromUnitVectors(a, b);
    return a.clone().applyQuaternion(new THREE.Quaternion().slerp(q, t));
}
