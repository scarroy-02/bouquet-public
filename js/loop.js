// ========== Observation Loop ==========
import * as THREE from 'three';

// Circle in the plane through `center` orthogonal to `normal`. It starts on the
// coordinate axis least aligned with the normal (+X for a horizontal circle) and
// turns counterclockwise seen from the normal's tip. t is proportional to arc length.
export class CircleCurve extends THREE.Curve {
    constructor(center, radius, normal) {
        super();
        this.center = new THREE.Vector3(...center);
        this.radius = radius;
        const n = new THREE.Vector3(...normal).normalize();
        const a = Math.abs(n.x), b = Math.abs(n.y), c = Math.abs(n.z);
        const axis = a <= b && a <= c ? new THREE.Vector3(1, 0, 0)
            : b <= c ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
        this.u = axis.addScaledVector(n, -axis.dot(n)).normalize();
        this.v = new THREE.Vector3().crossVectors(n, this.u);
    }

    getPoint(t, target = new THREE.Vector3()) {
        const angle = 2 * Math.PI * t;
        return target.copy(this.center)
            .addScaledVector(this.u, this.radius * Math.cos(angle))
            .addScaledVector(this.v, this.radius * Math.sin(angle));
    }

    getPointAt(u, target) {
        return this.getPoint(u, target);
    }
}

// Smooth loop through the given points (centripetal Catmull-Rom spline).
export function splineCurve(points, closed) {
    const pts = points.map(p => new THREE.Vector3(...p));
    // A closed loop listed with its first point repeated at the end
    if (closed && pts.length > 3 && pts[0].equals(pts.at(-1))) pts.pop();
    const curve = new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
    curve.arcLengthDivisions = Math.max(200, 10 * pts.length);
    return curve;
}

// n centers spaced uniformly by arc length; an open arc includes both ends.
export function sampleLoop(curve, n, closed) {
    const centers = [];
    for (let i = 0; i < n; i++) centers.push(curve.getPointAt(closed ? i / n : i / (n - 1)));
    return centers;
}
