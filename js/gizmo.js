// ========== Axis Triad ==========
// The world axes as seen from the camera, in the viewport corner. Click an axis
// letter (or a hollow dot, for the negative direction) to look along it; drag
// to orbit.
import * as THREE from 'three';

const SIZE = 76; // CSS px
const ARM = 24;  // axis length, px
const AXES = [
    { dir: [1, 0, 0], label: 'X', rgb: '239, 68, 68' },
    { dir: [0, 1, 0], label: 'Y', rgb: '34, 197, 94' },
    { dir: [0, 0, 1], label: 'Z', rgb: '79, 140, 255' },
    { dir: [-1, 0, 0], label: '−X', rgb: '239, 68, 68', neg: true },
    { dir: [0, -1, 0], label: '−Y', rgb: '34, 197, 94', neg: true },
    { dir: [0, 0, -1], label: '−Z', rgb: '79, 140, 255', neg: true },
];

export class NavGizmo {
    constructor(canvas, { onSnap, onOrbit, onRedraw }) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.targets = [];
        this.hover = null;

        let last = null, dragging = false;
        canvas.addEventListener('pointerdown', e => {
            canvas.setPointerCapture(e.pointerId);
            last = { x: e.clientX, y: e.clientY };
            dragging = false;
        });
        canvas.addEventListener('pointermove', e => {
            if (last) {
                const dx = e.clientX - last.x, dy = e.clientY - last.y;
                if (!dragging && Math.hypot(dx, dy) < 3) return;
                dragging = true;
                last = { x: e.clientX, y: e.clientY };
                onOrbit(dx, dy);
                return;
            }
            const hit = this.hit(e);
            if (hit !== this.hover) { this.hover = hit; onRedraw(); }
        });
        canvas.addEventListener('pointerup', e => {
            if (last && !dragging) {
                const hit = this.hit(e);
                if (hit) onSnap(hit.dir);
            }
            last = null;
        });
        canvas.addEventListener('pointerleave', () => { this.hover = null; onRedraw(); });
    }

    hit(e) {
        const r = this.canvas.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        // Front-most target first
        for (let i = this.targets.length - 1; i >= 0; i--) {
            const t = this.targets[i];
            if (Math.hypot(x - t.x, y - t.y) <= 8) return t.axis;
        }
        return null;
    }

    draw(camera) {
        const g = this.ctx, dpr = window.devicePixelRatio || 1, c = SIZE / 2;
        if (this.canvas.width !== SIZE * dpr) this.canvas.width = this.canvas.height = SIZE * dpr;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, SIZE, SIZE);

        // Axes in view space, drawn back to front; axes pointing away are fainter
        const toView = camera.quaternion.clone().invert();
        const v = new THREE.Vector3();
        this.targets = AXES.map(axis => {
            v.fromArray(axis.dir).applyQuaternion(toView);
            const reach = axis.neg ? ARM * 0.8 : ARM + 7;
            return { axis, x: c + v.x * reach, y: c - v.y * reach, lx: c + v.x * ARM, ly: c - v.y * ARM, z: v.z };
        }).sort((a, b) => a.z - b.z);

        g.font = '700 10px "JetBrains Mono", monospace';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineCap = 'round';
        for (const t of this.targets) {
            const { axis } = t, alpha = 0.45 + 0.55 * (t.z + 1) / 2;
            if (this.hover === axis) {
                g.fillStyle = `rgba(${axis.rgb}, 0.15)`;
                g.beginPath();
                g.arc(t.x, t.y, 8, 0, 2 * Math.PI);
                g.fill();
            }
            if (axis.neg) {
                g.strokeStyle = `rgba(${axis.rgb}, ${alpha})`;
                g.lineWidth = 1.2;
                g.beginPath();
                g.arc(t.x, t.y, 2.5, 0, 2 * Math.PI);
                g.stroke();
                if (this.hover === axis) {
                    g.fillStyle = `rgb(${axis.rgb})`;
                    g.fillText(axis.label, t.x, t.y - 10);
                }
            } else {
                g.strokeStyle = `rgba(${axis.rgb}, ${alpha})`;
                g.lineWidth = 2;
                g.beginPath();
                g.moveTo(c, c);
                g.lineTo(t.lx, t.ly);
                g.stroke();
                g.fillStyle = `rgba(${axis.rgb}, ${alpha})`;
                g.fillText(axis.label, t.x, t.y);
            }
        }
        g.fillStyle = '#1a1a1a';
        g.beginPath();
        g.arc(c, c, 1.6, 0, 2 * Math.PI);
        g.fill();
    }
}
