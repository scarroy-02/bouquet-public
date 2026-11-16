// ========== Vineyard & Persistence Diagram (Plotly) ==========
// Same encoding as Bouquet2D, with H₂ and H₃ added: one color per (kind,
// dimension), marker shape by kind (circle Ordinary, square Relative, diamond
// Extended).

export const SERIES = [
    { key: 'ord0', kind: 'ord', dim: 0, name: 'Ord H₀', color: '#ef4444' },
    { key: 'rel0', kind: 'rel', dim: 0, name: 'Rel H₀', color: '#f97316' },
    { key: 'ext0', kind: 'ext', dim: 0, name: 'Ext H₀', color: '#eab308' },
    { key: 'ord1', kind: 'ord', dim: 1, name: 'Ord H₁', color: '#3b82f6' },
    { key: 'rel1', kind: 'rel', dim: 1, name: 'Rel H₁', color: '#06b6d4' },
    { key: 'ext1', kind: 'ext', dim: 1, name: 'Ext H₁', color: '#a855f7' },
    { key: 'ord2', kind: 'ord', dim: 2, name: 'Ord H₂', color: '#22c55e' },
    { key: 'rel2', kind: 'rel', dim: 2, name: 'Rel H₂', color: '#84cc16' },
    { key: 'ext2', kind: 'ext', dim: 2, name: 'Ext H₂', color: '#ec4899' },
    { key: 'ord3', kind: 'ord', dim: 3, name: 'Ord H₃', color: '#a3a3a3' },
    { key: 'rel3', kind: 'rel', dim: 3, name: 'Rel H₃', color: '#e5e5e5' },
    { key: 'ext3', kind: 'ext', dim: 3, name: 'Ext H₃', color: '#ffffff' },
];
const SYMBOL = { ord: 'circle', rel: 'square', ext: 'diamond' };
const CURRENT_COLOR = '#fbbf24';
const CURRENT_TRACE = SERIES.length + 1; // after the diagonal plane and the series

const FONT = { family: '"JetBrains Mono", monospace', size: 9, color: '#666666' };
const AXIS = { color: '#888888', gridcolor: '#e5e5e5', zerolinecolor: '#cccccc', linecolor: '#cccccc' };
const CONFIG = { displayModeBar: false, responsive: true };

let nextId = 0;

// Group the server's pairs by series (vineyard traces) and by center (the
// diagram of each frame).
export function buildVineyard(raw, centers) {
    const series = {};
    const byFrame = centers.map(() => []);
    for (const s of SERIES) {
        series[s.key] = (raw[s.key] || []).map(e => ({
            s,
            birth: e.birth,
            death: e.death,
            frame: e.centerIdx,
            persistence: Math.abs(e.death - e.birth),
        }));
        for (const p of series[s.key]) byFrame[p.frame].push(p);
    }
    // Radial values are >= 0 and keep 0 in view; heights can be negative.
    const lo = Math.min(0, raw.minValue), hi = raw.maxValue;
    return { id: ++nextId, frames: centers.length, centers, series, byFrame, lo, hi, minValue: raw.minValue, maxValue: raw.maxValue };
}

// Plot range [lo, hi] of the function values, with a margin.
function valueRange(vy) {
    const pad = 0.05 * (vy.hi - vy.lo || 1);
    return [vy.lo < 0 ? vy.lo - pad : vy.lo, vy.hi + pad];
}

const shown = (s, filters) => filters.dims[s.dim] && filters.kinds[s.kind];

// Pairs at least as persistent as the threshold (a fraction of the largest value).
export const persistent = (pts, vy, filters) => {
    const min = filters.minPersistence * (vy.hi - vy.lo);
    return min > 0 ? pts.filter(p => p.persistence >= min) : pts;
};

function currentPoints(vy, frame, filters) {
    const pts = persistent(vy.byFrame[frame], vy, filters).filter(p => shown(p.s, filters));
    return { x: pts.map(p => p.birth), y: pts.map(p => p.death), z: pts.map(() => frame) };
}

// Diagrams stacked along the loop: x = birth, y = death, z = time (center index).
export function renderVineyard(div, vy, frame, filters) {
    const [lo, hi] = valueRange(vy);
    const last = Math.max(vy.frames - 1, 1);

    const diagonal = {
        type: 'mesh3d',
        x: [lo, hi, hi, lo],
        y: [lo, hi, hi, lo],
        z: [0, 0, last, last],
        i: [0, 0], j: [1, 2], k: [2, 3],
        color: '#9a9a9a',
        opacity: 0.12,
        hoverinfo: 'skip',
        showscale: false,
        name: 'Diagonal',
    };

    const traces = SERIES.map(s => {
        const pts = persistent(vy.series[s.key], vy, filters);
        return {
            type: 'scatter3d',
            mode: 'markers',
            name: s.name,
            x: pts.map(p => p.birth),
            y: pts.map(p => p.death),
            z: pts.map(p => p.frame),
            visible: shown(s, filters),
            marker: { size: s.kind === 'ord' ? 3 : 2.4, color: s.color, opacity: 0.75, symbol: SYMBOL[s.kind] },
            hovertemplate: `${s.name}<br>birth %{x:.4g}<br>death %{y:.4g}<br>time %{z}<extra></extra>`,
        };
    });

    const current = {
        type: 'scatter3d',
        mode: 'markers',
        name: 'Current',
        ...currentPoints(vy, frame, filters),
        marker: { size: 5, color: CURRENT_COLOR, opacity: 1, line: { color: '#78350f', width: 1 } },
        hoverinfo: 'skip',
    };

    const axis = (title, range) => ({ ...AXIS, title: { text: title }, range, showspikes: false });
    const layout = {
        uirevision: vy.id, // keep the user's camera until the next computation
        scene: {
            xaxis: axis('Birth', [lo, hi]),
            yaxis: axis('Death', [lo, hi]),
            zaxis: axis('Time', [0, last]),
            aspectmode: 'cube',
            bgcolor: 'rgba(0,0,0,0)',
            camera: { eye: { x: 1.8, y: 1.8, z: 1.1 } },
        },
        paper_bgcolor: 'rgba(0,0,0,0)',
        font: FONT,
        margin: { l: 0, r: 0, t: 0, b: 0 },
        showlegend: false,
    };

    Plotly.react(div, [diagonal, ...traces, current], layout, CONFIG);
}

// Move the highlighted slice of the vineyard to another frame.
export function updateVineyardFrame(div, vy, frame, filters) {
    const p = currentPoints(vy, frame, filters);
    Plotly.restyle(div, { x: [p.x], y: [p.y], z: [p.z] }, [CURRENT_TRACE]);
}

// Extended persistence diagram of one center.
export function renderPD(div, vy, frame, filters) {
    const [lo, hi] = valueRange(vy);
    const pts = persistent(vy.byFrame[frame], vy, filters);

    const diagonal = {
        type: 'scatter',
        mode: 'lines',
        x: [lo, hi],
        y: [lo, hi],
        line: { color: '#999999', dash: 'dash', width: 1 },
        hoverinfo: 'skip',
    };

    const traces = SERIES.map(s => {
        const mine = pts.filter(p => p.s === s);
        return {
            type: 'scatter',
            mode: 'markers',
            name: s.name,
            x: mine.map(p => p.birth),
            y: mine.map(p => p.death),
            visible: shown(s, filters),
            marker: { size: 9, color: s.color, symbol: SYMBOL[s.kind], line: { color: 'rgba(255,255,255,0.8)', width: 1 } },
            hovertemplate: `${s.name}<br>birth %{x:.4g}<br>death %{y:.4g}<extra></extra>`,
        };
    });

    const axis = title => ({
        ...AXIS,
        title: { text: title },
        range: [lo - 0.02 * (hi - lo), hi],
        zeroline: true,
    });
    const layout = {
        uirevision: vy.id, // keep zoom while scrubbing
        xaxis: axis('Birth'),
        yaxis: { ...axis('Death'), scaleanchor: 'x', scaleratio: 1 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: '#fafafa',
        font: FONT,
        margin: { l: 46, r: 14, t: 12, b: 36 },
        showlegend: false,
    };

    Plotly.react(div, [diagonal, ...traces], layout, CONFIG);
}

export function clearPlot(div) {
    Plotly.purge(div);
}
