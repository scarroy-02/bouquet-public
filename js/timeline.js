// ========== Timeline ==========
// A ruler over the centers of the loop with a playhead on the current one.
// Click or drag to scrub.

const PAD = 12;   // px left/right of the first and last center
const RULER = 16; // height of the numbered strip
const PURPLE = '#a855f7';

export class Timeline {
    constructor(canvas, onScrub) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onScrub = onScrub;
        this.count = 0;
        this.frame = 0;
        this.computed = false;

        canvas.addEventListener('pointerdown', e => {
            canvas.setPointerCapture(e.pointerId);
            this.scrub(e);
        });
        canvas.addEventListener('pointermove', e => {
            if (canvas.hasPointerCapture(e.pointerId)) this.scrub(e);
        });
        new ResizeObserver(() => this.draw()).observe(canvas);
    }

    setCount(n) { this.count = n; this.draw(); }
    setFrame(f) { this.frame = f; this.draw(); }
    setComputed(on) { this.computed = on; this.draw(); }

    x(f) {
        const w = this.canvas.clientWidth;
        return PAD + (this.count > 1 ? f / (this.count - 1) : 0) * (w - 2 * PAD);
    }

    scrub(e) {
        if (this.count === 0) return;
        const r = this.canvas.getBoundingClientRect();
        const t = (e.clientX - r.left - PAD) / (r.width - 2 * PAD);
        this.onScrub(Math.round(Math.min(Math.max(t, 0), 1) * (this.count - 1)));
    }

    draw() {
        const c = this.canvas, g = this.ctx, dpr = window.devicePixelRatio || 1;
        const w = c.clientWidth, h = c.clientHeight;
        if (!w || !h) return;
        if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
            c.width = Math.round(w * dpr);
            c.height = Math.round(h * dpr);
        }
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        g.fillStyle = '#f5f5f7';
        g.fillRect(0, 0, w, RULER);
        if (this.count === 0) return;

        const n = this.count, px = (w - 2 * PAD) / Math.max(n - 1, 1);

        // A tick per center when there is room; numbered lines >= 44 px apart
        g.fillStyle = 'rgba(0, 0, 0, 0.15)';
        if (px >= 4) for (let f = 0; f < n; f++) g.fillRect(Math.round(this.x(f)), RULER - 3, 1, 3);
        const step = [1, 2, 5, 10, 20, 50, 100, 200, 500].find(s => s * px >= 44) || 1000;
        g.font = '9px "JetBrains Mono", monospace';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        for (let f = 0; f < n; f += step) {
            const x = Math.round(this.x(f));
            g.fillStyle = 'rgba(0, 0, 0, 0.08)';
            g.fillRect(x, RULER, 1, h - RULER);
            g.fillStyle = 'rgba(0, 0, 0, 0.45)';
            g.fillText(String(f), x + 0.5, RULER / 2);
        }

        // Range covered by the computed vineyard
        if (this.computed) {
            g.fillStyle = 'rgba(168, 85, 247, 0.35)';
            g.fillRect(this.x(0), h - 3, this.x(n - 1) - this.x(0) + 1, 3);
        }

        // Playhead
        const x = Math.round(this.x(this.frame));
        const label = String(this.frame);
        const tw = Math.max(g.measureText(label).width + 10, 18);
        g.fillStyle = PURPLE;
        g.fillRect(x - 1, RULER - 1, 2, h - RULER + 1);
        g.beginPath();
        g.roundRect(x - tw / 2, 1, tw, RULER - 2, 3);
        g.fill();
        g.fillStyle = '#ffffff';
        g.fillText(label, x, RULER / 2);
    }
}
