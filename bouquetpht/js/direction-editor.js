// ========== Direction Loop Editor (PHT) ==========
// The unit sphere of directions with a closed loop on it, in its own viewport.
// Drag a handle to move it on the sphere, drag the loop to slide all of it,
// double-click the loop to add a handle; removeHoveredHandle() deletes one.
// Drawing (as Bouquet2D's custom loop): each click on the sphere adds a handle
// at the end, and the loop closes through the handles from 3 on.
// The loop, the sets, the markers and the arrow of the current direction keep
// their size on screen when zooming, so a small loop around a singularity stays readable.
// The sphere's axes are the world axes of the complex.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Viewport, COLORS as SCENE, clear, ghostMaterial } from './viewport.js';
import { buildComplex } from './complex.js';
import { SphereLoop } from './sphere-loop.js';

const PICK_PX = 10;
const CLICK_PX = 4;   // a press that moves less than this is a click
// On screen, in pixels: line widths, the radii of the direction dots, the handles and the current marker,
// and the arrow of the current direction
const PX = { loop: 2, segments: 1.5, dot: 2, handle: 5, marker: 4.5, arrow: { length: 40, shaft: 1.2, head: 4, tip: 10 } };
const MIN_DISTANCE = 1.02; // closest zoom: the camera stays just outside the sphere
const STEP = Math.PI / 90;  // longest piece of a drawn segment (2°)
const COLORS = { sphere: 0xd9dee7, graticule: 0x6b7280, handle: 0xef4444, hover: 0x4f8cff };
const UNIT_SPHERE = new THREE.SphereGeometry(1, 24, 16);
const HANDLE_MATERIAL = new THREE.MeshStandardMaterial({ color: COLORS.handle });
const HOVER_MATERIAL = new THREE.MeshStandardMaterial({ color: COLORS.hover, emissive: 0x0b2a66 });
const DOT_GEOMETRY = new THREE.SphereGeometry(1, 10, 8);
const DOT_MATERIAL = new THREE.MeshStandardMaterial({ color: SCENE.centers, transparent: true, opacity: 0.55 });

const normalize = v => {
    const l = Math.hypot(...v);
    return v.map(x => x / l);
};

// Unit sphere triangulated by subdividing an icosahedron (no poles).
function icosphere(subdiv) {
    const t = (1 + Math.sqrt(5)) / 2;
    const verts = [
        [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
        [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ].map(normalize);
    let faces = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4],
        [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8],
        [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    for (let s = 0; s < subdiv; s++) {
        const mid = new Map();
        const midpoint = (a, b) => {
            const key = a < b ? `${a},${b}` : `${b},${a}`;
            if (!mid.has(key)) {
                mid.set(key, verts.length);
                verts.push(normalize(verts[a].map((x, i) => x + verts[b][i])));
            }
            return mid.get(key);
        };
        faces = faces.flatMap(([a, b, c]) => {
            const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
            return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
        });
    }
    return { verts, faces };
}

export class DirectionEditor {
    // onChange(): the loop changed; onStatus(text, kind): messages for the status bar
    constructor(container, { onChange, onStatus }) {
        this.container = container;
        this.onChange = onChange;
        this.onStatus = onStatus;
        this.loop = SphereLoop.equator();
        this.hover = -1;
        this.drag = null;
        this.press = null;
        this.drawing = false;
        this.raycaster = new THREE.Raycaster();

        this.view = new Viewport(container, { arrow: false }); // its arrow would fill the view when zoomed in
        this.view.setGrid(false);
        this.view.controls.enablePan = false; // keep the sphere centered
        const { verts, faces } = icosphere(4);
        this.view.setComplex(buildComplex({ positions: verts.flat(), simplices: faces }));
        this.view.surfaceMaterial.color.set(COLORS.sphere);
        this.loopGroup = new THREE.Group();
        this.loopMaterials = [
            new LineMaterial({ color: SCENE.loop, linewidth: PX.loop }),
            new LineMaterial({ color: SCENE.loop, linewidth: PX.loop, transparent: true, opacity: 0.25, depthTest: false }),
        ];
        this.directions = [];
        this.dots = new THREE.Group();
        this.handleGroup = new THREE.Group();
        this.sets = { inflection: new THREE.Group(), simultaneity: new THREE.Group() };
        this.marker = currentMarker();
        this.view.scene.add(graticule(), axes(), this.sets.inflection, this.sets.simultaneity, this.loopGroup, this.dots, this.handleGroup, this.marker);
        this.view.frameAll(false, new THREE.Sphere(new THREE.Vector3(), 1.35)); // the sphere and the arrow
        this.home = this.view.camera.position.length();
        this.view.controls.minDistance = MIN_DISTANCE;
        this.view.beforeRender = () => this.fitToScreen();
        this.drawLoop();
        this.updateHandles();
        this.listen();
    }

    setDirections(directions) {
        this.directions = directions;
        this.dots.children[0]?.dispose();
        this.dots.clear();
        if (directions.length) this.dots.add(new THREE.InstancedMesh(DOT_GEOMETRY, DOT_MATERIAL, directions.length)); // placed by fitToScreen
        this.marker.visible = directions.length > 0;
        if (!directions.length) this.view.setDirection(null);
        this.view.requestRender();
    }

    setCurrent(index, v) {
        this.marker.position.copy(v).multiplyScalar(1.004);
        this.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
        this.view.setDirection(v); // the plane normal to v
    }

    // The inflection or simultaneity set (name): segments of unit directions, 6
    // numbers each, and their antipodes, just above the sphere.
    setSegments(name, directions) {
        const group = this.sets[name];
        clear(group);
        if (directions?.length) {
            const geometry = new LineSegmentsGeometry().setPositions(aboveSphere([...directions, ...directions.map(x => -x)], 1.002));
            group.add(new LineSegments2(geometry, new LineMaterial({ color: SCENE[name], linewidth: PX.segments })));
        }
        this.view.requestRender();
    }

    reset() {
        this.loop = SphereLoop.equator();
        this.update();
    }

    // Start drawing a new loop (the current one is cleared), or stop.
    setDrawing(on) {
        this.drawing = on;
        if (on) {
            this.loop = new SphereLoop([]);
            this.hover = -1;
            this.update();
        }
    }

    removeHoveredHandle() {
        const handles = this.loop.handles;
        if (this.hover < 0) return;
        if (handles.length === 3 && !this.drawing) return this.onStatus('A loop keeps at least 3 handles.', 'error');
        const next = handles.filter((_, i) => i !== this.hover);
        if (!this.loop.trySetHandles(next)) return this.onStatus('Removing it would make the loop pass through the center of the sphere.', 'error');
        this.hover = -1;
        this.update();
        this.onStatus(`Removed a handle (${next.length} left)`);
    }

    update() {
        this.drawLoop();
        this.updateHandles();
        this.onChange();
    }

    // The loop as a line of constant width on screen, with a faint copy on top for the far side
    drawLoop() {
        this.loopGroup.children[0]?.geometry.dispose();
        this.loopGroup.clear();
        const pts = this.loop.points;
        if (pts.length) {
            const geometry = new LineGeometry().setPositions([...pts, pts[0]].flatMap(p => [p.x, p.y, p.z].map(x => 1.003 * x)));
            const [solid, ghost] = this.loopMaterials.map(m => new Line2(geometry, m));
            ghost.renderOrder = 2;
            this.loopGroup.add(solid, ghost);
        }
        this.view.requestRender();
    }

    updateHandles() {
        this.handleGroup.clear();
        this.loop.handles.forEach((h, i) => {
            const active = i === this.hover || (this.drag?.kind === 'handle' && this.drag.index === i);
            const mesh = new THREE.Mesh(UNIT_SPHERE, active ? HOVER_MATERIAL : HANDLE_MATERIAL);
            mesh.position.copy(h);
            this.handleGroup.add(mesh);
        });
        this.view.requestRender();
    }

    // Before each frame: size the handles and the marker in pixels, and slow
    // the orbit down near the sphere so that a drag moves its surface about as
    // far as at the start.
    fitToScreen() {
        const cam = this.view.camera;
        const d = cam.position.length() - 1; // distance to the near side of the sphere
        const pixel = (2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / (this.container.clientHeight || 1);
        for (const h of this.handleGroup.children) h.scale.setScalar(PX.handle * pixel);
        this.marker.scale.setScalar(pixel);
        const dots = this.dots.children[0];
        if (dots) {
            const m = new THREE.Matrix4(), r = PX.dot * pixel;
            this.directions.forEach((v, i) => dots.setMatrixAt(i, m.makeScale(r, r, r).setPosition(v.x * 1.004, v.y * 1.004, v.z * 1.004)));
            dots.instanceMatrix.needsUpdate = true;
        }
        this.view.controls.rotateSpeed = Math.min(1, d / (this.home - 1));
    }

    // ---------- Picking (in screen space, front side of the sphere only) ----------
    // The point of the sphere under the pointer; off the sphere, the nearest
    // point of its outline, or null if strict.
    spherePoint(e, strict = false) {
        const r = this.container.getBoundingClientRect();
        this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2), this.view.camera);
        const { origin, direction } = this.raycaster.ray;
        const b = origin.dot(direction), disc = b * b - (origin.lengthSq() - 1);
        if (disc < 0 && strict) return null;
        const t = disc >= 0 ? -b - Math.sqrt(disc) : -b;
        return origin.clone().addScaledVector(direction, t).normalize();
    }

    screenDistance(p, e) {
        const r = this.container.getBoundingClientRect();
        const v = p.clone().project(this.view.camera);
        return Math.hypot(r.left + ((v.x + 1) / 2) * r.width - e.clientX, r.top + ((1 - v.y) / 2) * r.height - e.clientY);
    }

    facing(p) {
        const cam = this.view.camera;
        return p.dot(cam.position.clone().sub(p)) > 0;
    }

    pickHandle(e) {
        let best = -1, bestDistance = PICK_PX;
        this.loop.handles.forEach((h, i) => {
            const d = this.facing(h) ? this.screenDistance(h, e) : Infinity;
            if (d < bestDistance) { bestDistance = d; best = i; }
        });
        return best;
    }

    // The point of the loop under the pointer, or null.
    pickLoop(e) {
        let best = null, bestDistance = PICK_PX;
        for (const p of this.loop.points) {
            const d = this.facing(p) ? this.screenDistance(p, e) : Infinity;
            if (d < bestDistance) { bestDistance = d; best = p; }
        }
        return best;
    }

    updateHover(e) {
        const hover = this.pickHandle(e);
        this.container.style.cursor = hover >= 0 ? 'grab' : this.drawing ? 'crosshair' : this.pickLoop(e) ? 'grab' : '';
        if (hover !== this.hover) {
            this.hover = hover;
            this.updateHandles();
        }
    }

    // Drawing: a handle at the end of the loop, where the sphere was clicked
    addHandle(e) {
        const p = this.spherePoint(e, true);
        if (!p) return;
        const handles = [...this.loop.handles, p];
        if (!this.loop.trySetHandles(handles)) {
            return this.onStatus('Not there: the loop would pass through the center of the sphere. Place the points closer together.', 'error');
        }
        this.update();
        this.updateHover(e);
        this.onStatus(handles.length < 3 ? `Point ${handles.length} placed; the loop closes from 3 points on.`
            : `Point ${handles.length} placed. Keep clicking to add points, or press Esc to stop drawing.`);
    }

    // ---------- Interaction ----------
    listen() {
        const el = this.container;
        // Capture phase: a press on a handle or on the loop never reaches the orbit controls.
        // Any other press orbits; when drawing, a click there adds a handle.
        el.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            this.press = { x: e.clientX, y: e.clientY };
            const index = this.pickHandle(e);
            if (index >= 0) this.drag = { kind: 'handle', index };
            else if (!this.drawing && this.pickLoop(e)) this.drag = { kind: 'loop', from: this.spherePoint(e) };
            else return;
            e.stopPropagation();
            e.preventDefault();
            el.setPointerCapture(e.pointerId);
            el.style.cursor = 'grabbing';
            this.updateHandles();
        }, { capture: true });

        el.addEventListener('pointermove', e => {
            const drag = this.drag;
            if (!drag) return this.updateHover(e);
            if (drag.kind === 'handle') {
                const handles = this.loop.handles.slice();
                handles[drag.index] = this.spherePoint(e);
                if (!this.loop.trySetHandles(handles)) {
                    this.onStatus('Not there: the loop would pass through the center of the sphere. Keep a handle closer to its neighbours.', 'error');
                    return;
                }
            } else {
                // Slide the whole loop: rotate it about the center, taking the grabbed point along
                const to = this.spherePoint(e);
                const q = new THREE.Quaternion().setFromUnitVectors(drag.from, to);
                this.loop.trySetHandles(this.loop.handles.map(h => h.clone().applyQuaternion(q)));
                drag.from = to;
            }
            this.update();
        });

        el.addEventListener('pointerup', e => {
            const press = this.press;
            this.press = null;
            if (!this.drag) {
                if (this.drawing && e.button === 0 && press && Math.hypot(e.clientX - press.x, e.clientY - press.y) < CLICK_PX) this.addHandle(e);
                return;
            }
            this.drag = null;
            el.releasePointerCapture(e.pointerId);
            this.updateHover(e);
        });

        el.addEventListener('dblclick', e => {
            if (this.drawing) return; // each click already added a point
            const p = this.pickLoop(e);
            if (!p || this.pickHandle(e) >= 0) return;
            e.stopPropagation();
            const handles = this.loop.handles.slice();
            handles.splice(this.loop.segmentAt(p) + 1, 0, p.clone());
            if (this.loop.trySetHandles(handles)) {
                this.update();
                this.onStatus(`Added a handle (${handles.length} now)`);
            }
        }, { capture: true });
    }
}

// The current direction: a dot on the sphere with an arrow along the direction,
// in pixels (fitToScreen scales the group to the zoom). The arrow is along +Y.
function currentMarker() {
    const group = new THREE.Group();
    const dot = new THREE.Mesh(UNIT_SPHERE, new THREE.MeshStandardMaterial({ color: SCENE.current, emissive: 0x5a3d00 }));
    const ghost = new THREE.Mesh(UNIT_SPHERE, ghostMaterial(SCENE.current, 0.45)); // seen through the sphere
    ghost.renderOrder = 3;
    dot.scale.setScalar(PX.marker);
    ghost.scale.setScalar(PX.marker);
    const { length, shaft, head, tip } = PX.arrow;
    const material = new THREE.MeshStandardMaterial({ color: SCENE.direction });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(shaft, shaft, length - tip, 12), material);
    stem.position.y = (length - tip) / 2;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(head, tip, 20), material);
    cone.position.y = length - tip / 2;
    group.add(dot, ghost, stem, cone);
    group.visible = false;
    return group;
}

// Segments of unit directions (6 numbers each) as segments at radius r, the
// long ones split along their great circle: a straight segment between two
// points just above the sphere sinks below it in the middle if it is long.
function aboveSphere(segments, r) {
    const out = [], a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < segments.length; i += 6) {
        a.fromArray(segments, i);
        b.fromArray(segments, i + 3);
        const n = Math.ceil(a.angleTo(b) / STEP) || 1;
        for (let k = 0; k < n; k++) {
            out.push(...p.lerpVectors(a, b, k / n).setLength(r).toArray(), ...p.lerpVectors(a, b, (k + 1) / n).setLength(r).toArray());
        }
    }
    return out;
}

function graticule() {
    const pts = [];
    const at = (lat, lon) => [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)].map(x => x * 1.002);
    const N = 96, deg = Math.PI / 180;
    for (const lat of [-60, -30, 0, 30, 60]) {
        for (let k = 0; k < N; k++) pts.push(...at(lat * deg, (2 * Math.PI * k) / N), ...at(lat * deg, (2 * Math.PI * (k + 1)) / N));
    }
    for (let lon = 0; lon < 360; lon += 30) {
        for (let k = 0; k < N / 2; k++) pts.push(...at(-Math.PI / 2 + (2 * Math.PI * k) / N, lon * deg), ...at(-Math.PI / 2 + (2 * Math.PI * (k + 1)) / N, lon * deg));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: COLORS.graticule, transparent: true, opacity: 0.35 }));
}

// The world axes through the sphere: X red, Y green, Z blue, as in the main viewport.
function axes() {
    const group = new THREE.Group();
    [[1, 0, 0, 0xef4444], [0, 1, 0, 0x22c55e], [0, 0, 1, 0x4f8cff]].forEach(([x, y, z, color]) => {
        const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.4 * x, -1.4 * y, -1.4 * z), new THREE.Vector3(1.4 * x, 1.4 * y, 1.4 * z)]);
        group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color })));
    });
    return group;
}
