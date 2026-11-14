// ========== 3D Viewport ==========
// three.js scene in Bouquet2D's colors: Z up, grid floor with red X and green
// Y axes, orbit with the left/middle button, pan with Shift or the right
// button, numpad views and an axis triad.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { NavGizmo } from './gizmo.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

// As on Bouquet2D's canvas: dark curves, dark red loop and centers, amber current center
export const COLORS = {
    background: 0xf5f5f7,
    surface: 0xaab4c4,
    curve: 0x171717,
    loop: 0x7f1d1d,
    centers: 0x7f1d1d,
    current: 0xfbbf24,
    direction: 0xf59e0b,
    plane: 0xa855f7,
    inflection: 0x7c3aed,   // Bouquet2D's focal set
    simultaneity: 0x3b82f6, // Bouquet2D's symmetry set
};

// Numpad views, as directions from the target to the camera
export const VIEWS = {
    front: [0, -1, 0], back: [0, 1, 0],
    right: [1, 0, 0], left: [-1, 0, 0],
    top: [0, 0, 1], bottom: [0, 0, -1],
};

const FOV = 40;
const TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(FOV) / 2);

// Sizes of the loop tube, center dots, current marker and segment tubes, relative to the radius of the complex
const SIZES = { loop: 0.007, centers: 0.011, marker: 0.03, segments: 0.005 };

export class Viewport {
    // gizmoCanvas (axis triad) and badgeEl (view name) are optional; arrow: false
    // leaves out the arrow of the PHT direction (setDirection then draws only the plane).
    constructor(container, { gizmoCanvas = null, badgeEl = null, arrow = true } = {}) {
        this.container = container;
        this.badgeEl = badgeEl;
        this.showArrow = arrow;
        this.sizes = SIZES;
        this.beforeRender = null; // optional hook, called before every frame
        this.unit = 1;          // radius of the complex; sizes the loop and markers
        this.center = new THREE.Vector3();
        this.aspect = 1;
        this.orthoHeight = 10;
        this.xray = false;
        this.showWire = false;
        this.loopCurve = null;
        this.loopClosed = true;
        this.centers = [];
        this.currentIndex = 0;

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        container.prepend(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(COLORS.background);
        const sky = new THREE.HemisphereLight(0xffffff, 0x8c8c8c, 1.3);
        sky.position.set(0, 0, 1);
        this.scene.add(sky);

        this.perspCam = new THREE.PerspectiveCamera(FOV, 1, 0.01, 1000);
        this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
        for (const cam of [this.perspCam, this.orthoCam]) {
            // Key light from the upper left of the view and a weak fill, moving with the camera
            const key = new THREE.DirectionalLight(0xffffff, 1.8);
            key.position.set(-1, 1.5, 1);
            const fill = new THREE.DirectionalLight(0xffffff, 0.5);
            fill.position.set(1.5, -0.5, 0.5);
            cam.add(key, key.target, fill, fill.target);
            this.scene.add(cam);
        }
        this.camera = this.perspCam;
        this.orthoCam.visible = false; // hides its light
        this.camera.position.set(9, -13, 7);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
        this.controls.screenSpacePanning = true;
        this.controls.addEventListener('change', () => this.requestRender());
        this.controls.addEventListener('start', () => this.stopAnimation());
        const canvas = this.renderer.domElement;
        canvas.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); }); // no autoscroll
        canvas.addEventListener('contextmenu', e => e.preventDefault());

        this.grid = makeGrid();
        this.scene.add(this.grid);

        this.groups = {};
        for (const name of ['surface', 'loop', 'centers', 'marker', 'inflection', 'simultaneity']) {
            this.groups[name] = new THREE.Group();
            this.scene.add(this.groups[name]);
        }

        this.gizmo = gizmoCanvas && new NavGizmo(gizmoCanvas, {
            onSnap: dir => this.viewDirection(dir),
            onOrbit: (dx, dy) => this.orbitBy(dx, dy),
            onRedraw: () => this.requestRender(),
        });

        new ResizeObserver(() => this.resize()).observe(container);
        this.resize();
    }

    // ---------- Rendering ----------
    requestRender() {
        if (this.pending) return;
        this.pending = true;
        requestAnimationFrame(() => {
            this.pending = false;
            this.render();
        });
    }

    render() {
        this.beforeRender?.();
        this.updateGrid();
        this.renderer.render(this.scene, this.camera);
        this.gizmo?.draw(this.camera);
        this.updateViewName();
    }

    resize() {
        const w = this.container.clientWidth, h = this.container.clientHeight;
        if (!w || !h) return;
        this.aspect = w / h;
        this.renderer.setSize(w, h);
        this.updateProjection();
        this.render();
    }

    updateProjection() {
        this.perspCam.aspect = this.aspect;
        this.perspCam.updateProjectionMatrix();
        const h = this.orthoHeight / 2;
        Object.assign(this.orthoCam, { left: -h * this.aspect, right: h * this.aspect, top: h, bottom: -h });
        this.orthoCam.updateProjectionMatrix();
    }

    // Grid spacing follows the zoom by powers of 10; minor lines fade out
    // before they become the major lines of the next level.
    updateGrid() {
        const target = this.controls.target;
        const dist = this.camera.isOrthographicCamera
            ? this.orthoHeight / this.orthoCam.zoom / (2 * TAN_HALF_FOV)
            : this.camera.position.distanceTo(target);
        const level = Math.log10(Math.max(dist, 1e-9));
        const u = this.grid.material.uniforms;
        u.uSpacing.value = 10 ** (Math.floor(level) - 1);
        u.uBlend.value = level - Math.floor(level);
        u.uFade.value = 6 * dist;
        u.uCenter.value.set(target.x, target.y);
        this.grid.position.set(target.x, target.y, 0);
        this.grid.scale.set(6 * dist, 6 * dist, 1);
    }

    // Badge text: the axis view, if any, and the projection, e.g. "Top · Ortho".
    updateViewName() {
        if (!this.badgeEl) return;
        const dir = this.camera.position.clone().sub(this.controls.target).normalize();
        const axis = new THREE.Vector3();
        let name = '';
        for (const [key, v] of Object.entries(VIEWS)) {
            if (dir.dot(axis.fromArray(v)) > 0.9999) name = `${key} · `;
        }
        const text = `${name}${this.camera.isOrthographicCamera ? 'Ortho' : 'Persp'}`;
        if (this.badgeEl.textContent !== text) this.badgeEl.textContent = text;
    }

    // ---------- Objects ----------
    setComplex(cx) {
        clear(this.groups.surface);
        this.surfaceMaterial = null;
        this.wire = null;
        const positions = new Float32Array(cx.positions);
        this.bounds = new THREE.Box3().setFromArray(positions);
        const sphere = this.bounds.getBoundingSphere(new THREE.Sphere());
        this.center.copy(sphere.center);
        this.unit = Math.max(sphere.radius, 1e-9);

        if (cx.triangles.length) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setIndex(new THREE.BufferAttribute(cx.triangles, 1));
            geometry.computeVertexNormals();
            this.surfaceMaterial = new THREE.MeshStandardMaterial({
                color: COLORS.surface,
                roughness: 0.8,
                side: THREE.DoubleSide,
                // smooth vertex normals need consistently oriented triangles
                flatShading: !cx.orientable,
                // keeps the wireframe overlay in front of the faces
                polygonOffset: true,
                polygonOffsetFactor: 1,
                polygonOffsetUnits: 1,
            });
            this.groups.surface.add(new THREE.Mesh(geometry, this.surfaceMaterial));

            const wireGeometry = new THREE.BufferGeometry();
            wireGeometry.setAttribute('position', geometry.getAttribute('position'));
            wireGeometry.setIndex(new THREE.BufferAttribute(cx.allEdges, 1));
            this.wire = new THREE.LineSegments(wireGeometry,
                new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 }));
            this.wire.visible = this.showWire;
            this.groups.surface.add(this.wire);
        }
        if (cx.freeEdges.length) {
            this.groups.surface.add(edgeTubes(positions, cx.freeEdges, this.unit * 0.008, COLORS.curve));
        }
        if (cx.isolated.length) {
            const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(this.unit * 0.018, 12, 8),
                new THREE.MeshStandardMaterial({ color: COLORS.curve }), cx.isolated.length);
            const m = new THREE.Matrix4();
            cx.isolated.forEach((v, k) => dots.setMatrixAt(k, m.makeTranslation(positions[3 * v], positions[3 * v + 1], positions[3 * v + 2])));
            this.groups.surface.add(dots);
        }
        this.applyXRay();
        this.updateLoopMeshes();
    }

    setLoop(curve, closed) {
        this.loopCurve = curve;
        this.loopClosed = closed;
        this.updateLoopMeshes();
    }

    // Segments (x, y, z of both ends per segment) of the inflection or
    // simultaneity set (name), as thin tubes; null clears them.
    setSegments(name, points) {
        const group = this.groups[name];
        clear(group);
        if (points?.length) group.add(polylineTubes(points, this.unit * this.sizes.segments, COLORS[name]));
        this.requestRender();
    }

    setCenters(centers) {
        this.centers = centers;
        this.updateCenterMeshes();
    }

    setCurrent(index) {
        this.currentIndex = index;
        const c = this.centers[index];
        this.groups.marker.visible = !!c && this.loopVisible !== false;
        if (c) this.groups.marker.position.copy(c);
        this.requestRender();
    }

    updateLoopMeshes() {
        clear(this.groups.loop);
        if (this.loopCurve) {
            const geometry = new THREE.TubeGeometry(this.loopCurve, 512, this.unit * this.sizes.loop, 12, this.loopClosed);
            const solid = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: COLORS.loop, roughness: 0.5 }));
            // Faint copy drawn on top, so the parts behind the surface stay visible
            const ghost = new THREE.Mesh(geometry, ghostMaterial(COLORS.loop, 0.25));
            ghost.renderOrder = 2;
            this.groups.loop.add(solid, ghost);
        }
        this.updateCenterMeshes();
    }

    updateCenterMeshes() {
        clear(this.groups.centers);
        clear(this.groups.marker);
        if (this.centers.length) {
            const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(this.unit * this.sizes.centers, 10, 8),
                new THREE.MeshStandardMaterial({ color: COLORS.centers, transparent: true, opacity: 0.55 }), this.centers.length);
            const m = new THREE.Matrix4();
            this.centers.forEach((c, i) => dots.setMatrixAt(i, m.makeTranslation(c.x, c.y, c.z)));
            this.groups.centers.add(dots);

            const geometry = new THREE.SphereGeometry(this.unit * this.sizes.marker, 24, 16);
            const marker = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: COLORS.current, emissive: 0x5a3d00 }));
            const ghost = new THREE.Mesh(geometry, ghostMaterial(COLORS.current, 0.45));
            ghost.renderOrder = 3;
            this.groups.marker.add(marker, ghost);
        }
        this.setCurrent(this.currentIndex);
    }

    // ---------- Display options ----------
    setVisible(name, visible) {
        this.groups[name].visible = visible;
        if (name === 'loop') {
            this.loopVisible = visible;
            this.groups.marker.visible = visible && this.centers.length > 0;
        }
        this.requestRender();
    }

    setXRay(on) {
        this.xray = on;
        this.applyXRay();
    }

    applyXRay() {
        const m = this.surfaceMaterial;
        if (m) {
            m.transparent = this.xray;
            m.opacity = this.xray ? 0.3 : 1;
            m.depthWrite = !this.xray;
            m.needsUpdate = true;
        }
        this.requestRender();
    }

    setWireframe(on) {
        this.showWire = on;
        if (this.wire) this.wire.visible = on;
        this.requestRender();
    }

    setGrid(on) {
        this.grid.visible = on;
        this.requestRender();
    }

    // PHT: the direction v as an arrow from the center of the complex, with the
    // plane through the center normal to v (a level set of the height). null hides them.
    setDirection(v) {
        if (!this.direction) {
            const material = new THREE.MeshStandardMaterial({ color: COLORS.direction });
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1.09, 12), material);
            shaft.position.y = 0.545;
            const head = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.06, 20), material);
            head.position.y = 1.12;
            this.arrow = new THREE.Group();
            this.arrow.add(shaft, head);
            this.arrow.visible = this.showArrow;
            this.levelPlane = new THREE.Mesh(new THREE.CircleGeometry(1.15, 96), new THREE.MeshBasicMaterial({
                color: COLORS.plane, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false,
            }));
            this.levelPlane.visible = this.planeVisible !== false;
            this.direction = new THREE.Group();
            this.direction.add(this.arrow, this.levelPlane);
            this.scene.add(this.direction);
        }
        this.direction.visible = !!v;
        if (v) {
            this.direction.position.copy(this.center);
            this.direction.scale.setScalar(this.unit);
            this.arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
            this.levelPlane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v);
        }
        this.requestRender();
    }

    setPlaneVisible(visible) {
        this.planeVisible = visible;
        if (this.levelPlane) this.levelPlane.visible = visible;
        this.requestRender();
    }

    // ---------- Camera ----------
    // Fit the complex and the loop in view, or the given bounding sphere.
    frameAll(animate = true, sphere = null) {
        if (!sphere) {
            const box = this.bounds ? this.bounds.clone() : new THREE.Box3();
            if (this.loopCurve) for (const p of this.loopCurve.getPoints(64)) box.expandByPoint(p);
            if (box.isEmpty()) return;
            sphere = box.getBoundingSphere(new THREE.Sphere());
        }
        const r = Math.max(sphere.radius, 1e-9);

        this.perspCam.near = r * 0.002;
        this.perspCam.far = r * 500;
        this.orthoCam.near = -r * 500;
        this.orthoCam.far = r * 500;
        this.controls.minDistance = r * 0.01;
        this.controls.maxDistance = r * 100;

        const vfov = THREE.MathUtils.degToRad(FOV);
        const hfov = 2 * Math.atan(TAN_HALF_FOV * this.aspect);
        const dist = (1.05 * r) / Math.sin(Math.min(vfov, hfov) / 2);
        this.orthoHeight = (2.2 * r) / Math.min(this.aspect, 1);
        this.orthoCam.zoom = 1;
        this.updateProjection();

        const dir = this.camera.position.clone().sub(this.controls.target).normalize();
        this.moveCamera(sphere.center, sphere.center.clone().addScaledVector(dir, dist), animate);
    }

    // Look at the target from `dir` (numpad views, axis triad clicks).
    viewDirection(dir) {
        const d = new THREE.Vector3(...dir).normalize();
        // Looking straight down or up: keep +Y up on screen
        if (Math.abs(d.z) > 0.9999) d.set(0, -1e-4, Math.sign(d.z)).normalize();
        const target = this.controls.target.clone();
        const dist = this.camera.position.distanceTo(target);
        this.moveCamera(target, target.clone().addScaledVector(d, dist), true);
    }

    viewOpposite() {
        this.viewDirection(this.controls.target.clone().sub(this.camera.position).toArray());
    }

    // Orbit like the viewport's own drag (used by the axis triad).
    orbitBy(dx, dy) {
        this.stopAnimation();
        const target = this.controls.target;
        const offset = this.camera.position.clone().sub(target);
        const r = offset.length();
        const theta = Math.atan2(offset.y, offset.x) - dx * 0.012;
        const phi = THREE.MathUtils.clamp(Math.acos(THREE.MathUtils.clamp(offset.z / r, -1, 1)) - dy * 0.012, 1e-4, Math.PI - 1e-4);
        this.camera.position
            .set(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi))
            .multiplyScalar(r)
            .add(target);
        this.controls.update();
        this.requestRender();
    }

    toggleOrtho() {
        const target = this.controls.target;
        if (this.camera === this.perspCam) {
            this.orthoHeight = 2 * this.perspCam.position.distanceTo(target) * TAN_HALF_FOV;
            this.orthoCam.zoom = 1;
            this.orthoCam.position.copy(this.perspCam.position);
            this.setCamera(this.orthoCam);
        } else {
            const height = this.orthoHeight / this.orthoCam.zoom;
            const dir = this.orthoCam.position.clone().sub(target).normalize();
            this.perspCam.position.copy(target).addScaledVector(dir, height / (2 * TAN_HALF_FOV));
            this.setCamera(this.perspCam);
        }
    }

    // A running view animation carries on with the new camera.
    setCamera(cam) {
        this.camera = cam;
        this.perspCam.visible = cam === this.perspCam; // only the active camera's light
        this.orthoCam.visible = cam === this.orthoCam;
        this.controls.object = cam;
        this.updateProjection();
        this.controls.update();
        this.requestRender();
    }

    // Move the camera (and orbit target), turning around the target smoothly.
    moveCamera(target, position, animate) {
        this.stopAnimation();
        if (!animate) {
            this.controls.target.copy(target);
            this.camera.position.copy(position);
            this.controls.update();
            this.requestRender();
            return;
        }
        const fromTarget = this.controls.target.clone();
        const fromOffset = this.camera.position.clone().sub(fromTarget);
        const toOffset = position.clone().sub(target);
        const fromLength = fromOffset.length(), toLength = toOffset.length();
        const fromDir = fromOffset.normalize();
        const turn = new THREE.Quaternion().setFromUnitVectors(fromDir, toOffset.normalize());
        const q = new THREE.Quaternion();
        const t0 = performance.now();
        const step = now => {
            const k = Math.min((now - t0) / 250, 1), e = 1 - (1 - k) ** 3;
            q.identity().slerp(turn, e);
            this.controls.target.lerpVectors(fromTarget, target, e);
            this.camera.position.copy(fromDir).applyQuaternion(q)
                .multiplyScalar(THREE.MathUtils.lerp(fromLength, toLength, e))
                .add(this.controls.target);
            this.controls.update();
            this.render();
            this.anim = k < 1 ? requestAnimationFrame(step) : null;
        };
        this.anim = requestAnimationFrame(step);
    }

    stopAnimation() {
        if (this.anim) cancelAnimationFrame(this.anim);
        this.anim = null;
    }
}

// ========== Helpers ==========
export const ghostMaterial = (color, opacity) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });

export function clear(group) {
    group.traverse(o => {
        if (o.isInstancedMesh) o.dispose();
        o.geometry?.dispose();
        o.material?.dispose();
    });
    group.clear();
}

// Edges in no triangle (space curves) as tubes: an instanced cylinder per edge
// and a sphere at each vertex for round joints.
function edgeTubes(positions, edges, radius, color) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const m = edges.length / 2;
    const tubes = new THREE.InstancedMesh(new THREE.CylinderGeometry(radius, radius, 1, 10, 1, true), material, m);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), mid = new THREE.Vector3(), dir = new THREE.Vector3();
    const q = new THREE.Quaternion(), scale = new THREE.Vector3(), matrix = new THREE.Matrix4();
    const yAxis = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < m; k++) {
        a.fromArray(positions, 3 * edges[2 * k]);
        b.fromArray(positions, 3 * edges[2 * k + 1]);
        dir.subVectors(b, a);
        const length = dir.length();
        if (length > 0) q.setFromUnitVectors(yAxis, dir.divideScalar(length));
        // a zero-length edge (e.g. a whole curve with the same normal) leaves only its joint
        tubes.setMatrixAt(k, matrix.compose(mid.addVectors(a, b).multiplyScalar(0.5), q, length > 0 ? scale.set(1, length, 1) : scale.set(0, 0, 0)));
    }
    const vertices = [...new Set(edges)];
    const joints = new THREE.InstancedMesh(new THREE.SphereGeometry(radius, 10, 8), material, vertices.length);
    vertices.forEach((v, k) => joints.setMatrixAt(k, matrix.makeTranslation(positions[3 * v], positions[3 * v + 1], positions[3 * v + 2])));
    const group = new THREE.Group();
    group.add(tubes, joints);
    return group;
}

// Segments (6 numbers each) joined into polylines where they share an end,
// each drawn as one tube with a ring of vertices at every point, so there is
// no gap at the bends (the simultaneity set can have 100,000 segments, too
// many for a cylinder and a sphere each). Spheres cap the ends and junctions.
function polylineTubes(points, radius, color) {
    const RADIAL = 8;
    // Weld equal ends
    const index = new Map(), pos = [], edges = [];
    const vertex = i => {
        const key = `${points[i]},${points[i + 1]},${points[i + 2]}`;
        let v = index.get(key);
        if (v === undefined) {
            v = pos.length;
            index.set(key, v);
            pos.push(new THREE.Vector3(points[i], points[i + 1], points[i + 2]));
        }
        return v;
    };
    for (let i = 0; i < points.length; i += 6) {
        const a = vertex(i), b = vertex(i + 3);
        if (a !== b) edges.push(a, b);
    }
    const m = edges.length / 2;
    const incident = pos.map(() => []);
    for (let e = 0; e < m; e++) incident[edges[2 * e]].push(e), incident[edges[2 * e + 1]].push(e);

    // Chains: from every end or junction (not 2 segments), then the closed loops left
    const used = new Uint8Array(m), chains = [];
    const walk = (v, e) => {
        const chain = [v];
        while (e !== undefined && !used[e]) {
            used[e] = 1;
            v = edges[2 * e] === v ? edges[2 * e + 1] : edges[2 * e];
            chain.push(v);
            e = incident[v].length === 2 ? incident[v].find(f => !used[f]) : undefined;
        }
        return chain;
    };
    for (let v = 0; v < pos.length; v++) {
        if (incident[v].length !== 2) for (const e of incident[v]) if (!used[e]) chains.push(walk(v, e));
    }
    for (let e = 0; e < m; e++) if (!used[e]) chains.push(walk(edges[2 * e], e));

    // A ring around every point, square to the mean of the two segment
    // directions and widened along the bend so the tube keeps its thickness
    const vertices = [], normals = [], indices = [];
    const dIn = new THREE.Vector3(), dOut = new THREE.Vector3(), t = new THREE.Vector3(), n = new THREE.Vector3();
    const b = new THREE.Vector3(), bend = new THREE.Vector3(), o = new THREE.Vector3(), q = new THREE.Vector3();
    for (const chain of chains) {
        const pts = chain.map(k => pos[k]), L = pts.length;
        const closed = L > 2 && chain[0] === chain[L - 1];
        const base = vertices.length / 3;
        for (let j = 0; j < L; j++) {
            const prev = j > 0 ? pts[j - 1] : closed ? pts[L - 2] : null;
            const next = j < L - 1 ? pts[j + 1] : closed ? pts[1] : null;
            if (next) dOut.subVectors(next, pts[j]).normalize();
            if (prev) dIn.subVectors(pts[j], prev).normalize();
            if (!next) dOut.copy(dIn);
            if (!prev) dIn.copy(dOut);
            t.addVectors(dIn, dOut);
            if (t.lengthSq() < 1e-12) t.copy(dOut);
            t.normalize();
            // Frame carried along the chain without twisting
            if (j > 0) n.addScaledVector(t, -n.dot(t));
            if (j === 0 || n.lengthSq() < 1e-12) n.set(Math.abs(t.x) < 0.9 ? 1 : 0, Math.abs(t.x) < 0.9 ? 0 : 1, 0).cross(t);
            n.normalize();
            b.crossVectors(t, n);
            bend.subVectors(dOut, dIn);
            const stretch = 1 / Math.max(t.dot(dOut), 0.5) - 1;
            if (bend.lengthSq() > 1e-12) bend.normalize();
            for (let r = 0; r < RADIAL; r++) {
                const phi = (2 * Math.PI * r) / RADIAL;
                o.copy(n).multiplyScalar(Math.cos(phi)).addScaledVector(b, Math.sin(phi));
                q.copy(pts[j]).addScaledVector(o, radius).addScaledVector(bend, radius * stretch * o.dot(bend));
                vertices.push(q.x, q.y, q.z);
                normals.push(o.x, o.y, o.z);
            }
            if (j === L - 1) break;
            for (let r = 0; r < RADIAL; r++) {
                const a = base + j * RADIAL + r, a2 = base + j * RADIAL + ((r + 1) % RADIAL);
                indices.push(a, a2, a + RADIAL, a2, a2 + RADIAL, a + RADIAL);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, material));

    const caps = pos.filter((_, v) => incident[v].length !== 2);
    if (caps.length) {
        const spheres = new THREE.InstancedMesh(new THREE.SphereGeometry(radius, 10, 8), material, caps.length);
        const matrix = new THREE.Matrix4();
        caps.forEach((p, k) => spheres.setMatrixAt(k, matrix.makeTranslation(p.x, p.y, p.z)));
        group.add(spheres);
    }
    return group;
}

// Floor grid in the XY plane: 1-px lines in powers of 10, a red X axis and a
// green Y axis, fading out with distance.
function makeGrid() {
    const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
            uSpacing: { value: 1 },
            uBlend: { value: 0 },
            uFade: { value: 100 },
            uCenter: { value: new THREE.Vector2() },
        },
        vertexShader: /* glsl */ `
            varying vec2 vXY;
            void main() {
                vec4 world = modelMatrix * vec4(position, 1.0);
                vXY = world.xy;
                gl_Position = projectionMatrix * viewMatrix * world;
            }`,
        fragmentShader: /* glsl */ `
            uniform float uSpacing, uBlend, uFade;
            uniform vec2 uCenter;
            varying vec2 vXY;
            float lines(float spacing) {
                vec2 c = vXY / spacing;
                vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
                return 1.0 - min(min(g.x, g.y), 1.0);
            }
            void main() {
                float alpha = max(lines(uSpacing) * (1.0 - uBlend) * 0.12, lines(uSpacing * 10.0) * 0.24);
                vec3 color = vec3(0.4);
                vec2 w = fwidth(vXY) * 1.5;
                float xAxis = 1.0 - smoothstep(0.0, w.y, abs(vXY.y));
                float yAxis = 1.0 - smoothstep(0.0, w.x, abs(vXY.x));
                color = mix(color, vec3(0.937, 0.267, 0.267), xAxis);
                color = mix(color, vec3(0.133, 0.773, 0.369), yAxis * (1.0 - xAxis));
                alpha = max(alpha, max(xAxis, yAxis) * 0.7);
                alpha *= 1.0 - smoothstep(0.3 * uFade, uFade, length(vXY - uCenter));
                if (alpha < 0.002) discard;
                gl_FragColor = vec4(color, alpha);
            }`,
    });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    grid.renderOrder = -1;
    grid.frustumCulled = false;
    return grid;
}
