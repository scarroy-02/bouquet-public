// ========== BouquetPHT ==========
// Wires the app together: toolbar, sidebars, 3D viewport, timeline and the
// floating vineyard, persistence diagram and direction sphere windows.
// Two transforms: PHT (heights in the directions of a loop on the sphere), the
// default, and radial (squared distance from centers along an observation loop).
import { Viewport, VIEWS } from './viewport.js';
import { Timeline } from './timeline.js';
import { parseComplexJSON, parseOBJ, parseOFF, parseCSVPoints, parseSSPL } from './io.js';
import { buildComplex, curveComplex } from './complex.js';
import { PRESETS, RESOLUTION } from './presets.js';
import { CircleCurve, splineCurve, sampleLoop } from './loop.js';
import { bouquet2dSpline, parabolicLift, curveInflectionSet, curveSimultaneitySet } from './curve-sets.js';
import { checkServer, computeVineyardAPI, computeInflectionAPI, computeSimultaneityAPI, implicitMeshAPI, subdivideAPI, SERVER_HINT } from './api.js';
import { SERIES, buildVineyard, persistent, renderVineyard, updateVineyardFrame, renderPD, clearPlot } from './plots.js';
import { initSections, makePanelDraggable, makePanelResizable } from './ui.js';
import { DirectionEditor } from './direction-editor.js';

const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString('en-US');
const PLAYBACK_FPS = 20;

// ========== State ==========
const state = {
    mode: 'pht',      // 'pht' or 'radial'
    complex: null,
    objectName: '',
    preset: null,     // key of the implicit preset shown (the Mesh slider remeshes it), else null
    resolution: RESOLUTION.default,
    implicit: null,   // name of the implicit surface shown (exact sets), or null
    file: null,       // { complex, name } as loaded, for a surface from a file (Subdivide refines it)
    presetToken: 0,   // the latest preset or file load; an earlier one still meshing is dropped
    csvCurve: null, // { name, points } when the complex is a space curve read from CSV
    smooth: null,   // { curve, raw, samples }: the smooth closed curve behind a curve complex
    lift: { on: false, lambda: 1 }, // a plane curve on the paraboloid z = λ(x² + y²)
    loop: {
        mode: 'circle',
        circle: { center: [0.5, 0.3, 0.2], radius: 1.5, normal: [0.2, -0.3, 1] },
        csv: null, // { name, points }
        closed: true,
    },
    loopCurve: null,
    loopClosed: true,
    samples: 64,
    centers: [],      // radial: centers along the observation loop
    directions: [],   // PHT: directions along the loop on the sphere
    vineyard: null,
    inflection: null, // { points, normals, ... } from the server, for the current complex
    simultaneity: null,     // { directions, first, second, ... } from the server, for the current complex
    frame: 0,
    playing: false,
    filters: { dims: [true, true, true, true], kinds: { ord: true, rel: true, ext: true }, minPersistence: 0 },
    computeId: 0,     // bumped whenever the input changes, so stale results are dropped
    activeCompute: null,
};

const viewport = new Viewport($('viewport'), { gizmoCanvas: $('gizmo'), badgeEl: $('viewBadge') });
const timeline = new Timeline($('timeline'), f => setFrame(f));
const editor = new DirectionEditor($('directionView'), {
    onChange: () => {
        updateDirectionStats();
        resample();
    },
    onStatus: (text, kind) => setStatus(text, kind),
});

// The frames of the vineyard: centers (radial) or directions (PHT)
const frames = () => (state.mode === 'pht' ? state.directions : state.centers);

// ========== Status Bar ==========
function setStatus(text, kind = '') {
    const el = $('status');
    el.textContent = text;
    el.title = text;
    el.className = kind;
}

function fillTable(table, rows) {
    table.replaceChildren(...rows.map(([key, value]) => {
        const tr = document.createElement('tr');
        for (const text of [key, value]) {
            const td = document.createElement('td');
            td.textContent = text;
            tr.append(td);
        }
        return tr;
    }));
}

// ========== Complex ==========
const KIND_LABEL = { surface: 'Surface', curve: 'Curve', complex: 'Simplicial complex' };

function setComplex(complex, name, { frame = true } = {}) {
    state.complex = complex;
    state.objectName = name;
    viewport.setComplex(complex);
    if (frame) viewport.frameAll(false);

    $('complexName').textContent = name;
    $('complexName').title = name;
    $('curveClosedRow').hidden = !state.csvCurve;
    $('h3Chip').hidden = complex.dimension < 3;

    const s = complex.stats;
    const rows = [
        ['Type', KIND_LABEL[complex.kind]],
        ['Dimension', complex.dimension],
        ['Vertices', fmt(s.vertices)],
        ['Edges', fmt(s.edges)],
        ['Triangles', fmt(s.triangles)],
    ];
    if (s.tetrahedra) rows.push(['Tetrahedra', fmt(s.tetrahedra)]);
    rows.push(['Euler char.', s.euler], ['Components', fmt(s.components)]);
    if (complex.orientable !== null) rows.push(['Orientable', complex.orientable ? 'Yes' : 'No']);
    if (s.triangles && !s.tetrahedra) {
        rows.push(['Boundary edges', fmt(s.boundaryEdges)], ['Non-manifold edges', fmt(s.nonManifoldEdges)]);
    }
    if (s.merged) rows.push(['Merged vertices', fmt(s.merged)]);
    fillTable($('statsTable'), rows);

    state.inflection = null;
    state.simultaneity = null;
    fillTable($('inflectionStats'), []);
    fillTable($('simultaneityStats'), []);
    showSingularSets();
    invalidateVineyard();
}

// ========== Smooth Curves ==========
// A curve complex with a smooth closed curve behind it (a closed CSV curve, a Bouquet2D .sspl
// figure, as the curve presets are) has exact sets, computed on the page from the curve (curve-sets.js). A plane
// curve has degenerate sets of its own, so it can be lifted to the paraboloid z = λ(x² + y²).

// `raw`: the file's points, which make the complex (else `samples` points evenly in the parameter).
// A new curve starts unlifted, with λ such that the lift is about as high as the curve is wide.
function setSmooth(curve, { raw = null, samples = 0, keep = false } = {}) {
    state.smooth = curve && { curve, raw, samples };
    if (curve?.planar && !keep) {
        let r = 0;
        for (let k = 0; k < 256; k++) r = Math.max(r, Math.hypot(...curve.at((k / 256) * curve.period).p));
        state.lift = { on: false, lambda: Number((1 / r).toPrecision(2)) };
        $('liftCurve').checked = false;
        $('liftLambda').value = state.lift.lambda;
    }
    $('liftRow').hidden = $('lambdaRow').hidden = !curve?.planar;
}

// The closed spline through CSV points, as a plane curve if they are all in a plane z = const
function csvSpline(points) {
    const planar = points.every(p => p[2] === points[0][2]);
    return bouquet2dSpline(planar ? points.map(p => [p[0], p[1]]) : points);
}

// The complex of the smooth curve, on the paraboloid if it is a lifted plane curve
function smoothComplex() {
    const { curve, raw, samples } = state.smooth, { on, lambda } = state.lift;
    const pts = raw ?? Array.from({ length: samples }, (_, i) => curve.at((i / samples) * curve.period).p);
    return curveComplex(pts.map(p => (curve.planar && on ? [p[0], p[1], lambda * (p[0] ** 2 + p[1] ** 2)] : p.length === 2 ? [...p, 0] : p)), true);
}

// The curve whose sets are computed: the smooth curve, lifted if it is a plane curve; 'plane' for a
// plane curve that is not lifted; null for none
function setsCurve() {
    const sm = state.smooth;
    if (!sm) return null;
    if (!sm.curve.planar) return sm.curve;
    return state.lift.on ? parabolicLift(sm.curve, state.lift.lambda) : 'plane';
}

// Lift or flatten the plane curve, or change λ
function relift() {
    setComplex(smoothComplex(), state.objectName);
    updateEstimatorRows();
    setStatus(state.lift.on ? `Lifted to z = ${state.lift.lambda} (x² + y²)` : 'In the plane z = 0, as loaded');
}

async function loadPreset(key, { frame = true } = {}) {
    const preset = PRESETS[key];
    const token = ++state.presetToken;
    if (preset.file) {
        let text;
        try {
            const res = await fetch(preset.file);
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            text = await res.text();
        } catch (err) {
            if (token === state.presetToken) setStatus(`Could not load ${preset.file}: ${err.message}`, 'error');
            return;
        }
        if (token !== state.presetToken) return;
        $('curveClosed').checked = true; // the preset curves are closed
        await loadSurfaceFile(new File([text], preset.file.split('/').pop()));
        if (preset.lift) {
            state.lift = { on: true, lambda: preset.lift };
            $('liftCurve').checked = true;
            $('liftLambda').value = preset.lift;
            relift();
        }
        if (preset.method) {
            $('curvatureMethod').value = preset.method;
            updateEstimatorRows();
        }
        $('presetSelect').value = key;
        return;
    }
    let complex;
    setStatus(`Meshing ${preset.label} (F = 0)…`);
    try {
        const r = await implicitMeshAPI(preset.implicit, state.resolution);
        complex = buildComplex({ positions: r.vertices, simplices: r.simplices }, { weld: false });
    } catch (err) {
        if (token === state.presetToken) setStatus(err.message, 'error');
        return;
    }
    if (token !== state.presetToken) return;
    setSmooth(null);
    state.csvCurve = null;
    state.preset = key;
    state.file = null;
    $('subdivisionRow').hidden = $('schemeRow').hidden = true;
    state.implicit = preset.implicit;
    $('curvatureMethod').value = 'implicit';
    updateEstimatorRows();
    setComplex(complex, preset.label, { frame });
    $('presetSelect').value = key;
    $('resolutionRow').hidden = false;
    const s = complex.stats;
    $('resolutionVal').textContent = fmt(s.triangles);
    $('resolutionVal').title = 'triangles';
    setStatus(`Loaded preset: ${preset.label} (${fmt(s.triangles)} triangles), an implicit surface: its inflection and simultaneity sets are exact`);
}

async function loadSurfaceFile(file) {
    try {
        const text = await file.text();
        const ext = file.name.split('.').pop().toLowerCase();
        let complex, csvCurve = null;
        setSmooth(null);
        if (ext === 'sspl') {
            const points = parseSSPL(text);
            setSmooth(bouquet2dSpline(points), { samples: 16 * points.length });
            complex = smoothComplex();
        } else if (ext === 'json') {
            complex = buildComplex(parseComplexJSON(text), { weld: false });
        } else if (ext === 'obj') {
            complex = buildComplex(parseOBJ(text));
        } else if (ext === 'off') {
            complex = buildComplex(parseOFF(text));
        } else {
            csvCurve = { name: file.name, points: parseCSVPoints(text) };
            if ($('curveClosed').checked && csvCurve.points.length >= 3) {
                setSmooth(csvSpline(csvCurve.points), { raw: csvCurve.points });
                complex = smoothComplex();
            } else {
                complex = curveComplex(csvCurve.points, $('curveClosed').checked);
            }
        }
        state.csvCurve = csvCurve;
        state.preset = null;
        state.implicit = null;
        state.file = complex.kind === 'surface' ? { complex, name: file.name } : null;
        ++state.presetToken;
        updateEstimatorRows();
        setComplex(complex, file.name);
        $('presetSelect').value = '';
        $('resolutionRow').hidden = true;
        $('subdivisionRow').hidden = $('schemeRow').hidden = !state.file;
        // The Coxeter scheme needs a closed mesh
        const open = complex.stats.boundaryEdges > 0;
        $('coxeterOption').disabled = open;
        if (open) $('subdivisionScheme').value = 'midpoint';
        $('subdivision').value = 0;
        $('subdivisionVal').textContent = fmt(complex.stats.triangles);
        const s = complex.stats;
        setStatus(`Loaded ${file.name}: ${fmt(s.vertices)} vertices, ${fmt(s.edges)} edges, ${fmt(s.triangles)} triangles`
            + (s.tetrahedra ? `, ${fmt(s.tetrahedra)} tetrahedra` : '')
            + (s.merged ? ` (merged ${fmt(s.merged)} duplicate vertices)` : ''));
    } catch (err) {
        setStatus(`Could not load ${file.name}: ${err.message}`, 'error');
    }
}

// ========== Observation Loop ==========
function rebuildLoop() {
    const { mode, circle, csv, closed } = state.loop;
    state.loopCurve = null;
    if (mode === 'circle') {
        state.loopCurve = new CircleCurve(circle.center, circle.radius, circle.normal);
        state.loopClosed = true;
    } else if (csv && closed && csv.points.length < 3) {
        setStatus('A closed loop needs at least 3 points', 'error');
    } else if (csv) {
        state.loopCurve = splineCurve(csv.points, closed);
        state.loopClosed = closed;
    }
    if (state.mode === 'radial') viewport.setLoop(state.loopCurve, state.loopClosed);
    resample();
}

// Centers and directions at the current number of samples
function resample() {
    state.centers = state.loopCurve ? sampleLoop(state.loopCurve, state.samples, state.loopClosed) : [];
    state.directions = editor.loop.sample(state.samples);
    viewport.setCenters(state.mode === 'radial' ? state.centers : []);
    editor.setDirections(state.directions);
    const n = frames().length;
    timeline.setCount(n);
    $('frameInput').max = Math.max(n - 1, 0);
    invalidateVineyard();
    setFrame(state.frame);
}

function setLoopMode(mode) {
    state.loop.mode = mode;
    $('loopMode').value = mode;
    $('circleProps').hidden = mode !== 'circle';
    $('csvProps').hidden = mode !== 'csv';
    rebuildLoop();
}

function fillCircleInputs() {
    for (const input of document.querySelectorAll('[data-circle]')) {
        const value = state.loop.circle[input.dataset.circle];
        input.value = input.dataset.i === undefined ? value : value[input.dataset.i];
    }
}

async function loadLoopFile(file) {
    try {
        const points = parseCSVPoints(await file.text());
        if (points.length < 2) throw new Error('need at least 2 points');
        state.loop.csv = { name: file.name, points };
        $('loopFileName').textContent = `${file.name} (${fmt(points.length)} pts)`;
        $('loopFileName').title = file.name;
        setMode('radial');
        setLoopMode('csv');
        viewport.frameAll();
        setStatus(`Loaded observation loop ${file.name}: ${fmt(points.length)} points`);
    } catch (err) {
        setStatus(`Could not load ${file.name}: ${err.message}`, 'error');
    }
}

// ========== Vineyard ==========
const PANELS = [
    { panel: 'vineyardPanel', toggle: 'showVineyardPlot', close: 'closeVineyardBtn', when: () => !!state.vineyard },
    { panel: 'persistencePanel', toggle: 'showPD', close: 'closePDBtn', when: () => !!state.vineyard },
    { panel: 'directionPanel', toggle: 'showDirectionPanel', close: 'closeDirectionBtn', when: () => state.mode === 'pht' },
];

// Windows are shown when they apply and their toggle is on.
function updatePanels() {
    for (const { panel, toggle, when } of PANELS) $(panel).classList.toggle('active', when() && $(toggle).checked);
}

function invalidateVineyard() {
    state.computeId++;
    state.vineyard = null;
    clearPlot($('vineyardPlot'));
    clearPlot($('pdPlot'));
    updatePanels();
    timeline.setComputed(false);
    fillTable($('vineyardStats'), [['Status', 'Not computed']]);
}

function setComputing(on) {
    for (const btn of document.querySelectorAll('.compute-btn')) {
        btn.classList.toggle('busy', on);
        btn.querySelector('span').textContent = on ? 'Computing…' : 'Compute Vineyard';
    }
}

async function compute() {
    if (!state.complex) return setStatus('Load a complex first (Import, or a preset).', 'error');
    const list = frames(), pht = state.mode === 'pht';
    if (!list.length) return setStatus(pht ? 'Place at least 3 points of the direction loop first.' : 'Set up an observation loop first.', 'error');

    const id = ++state.computeId;
    state.activeCompute = id;
    setComputing(true);
    setStatus(`Computing ${pht ? 'PHT' : 'radial'} vineyard: ${list.length} ${pht ? 'directions' : 'centers'} on ${fmt(state.complex.stats.vertices)} vertices…`);
    const t0 = performance.now();
    try {
        const raw = await computeVineyardAPI(state.complex, pht ? { directions: list } : { centers: list });
        if (id !== state.computeId) {
            setStatus('The input changed during the computation; press Compute Vineyard again.');
            return;
        }
        state.vineyard = buildVineyard(raw, list);
        showVineyard((performance.now() - t0) / 1000);
    } catch (err) {
        if (id === state.computeId) setStatus(err.message, 'error');
    } finally {
        if (state.activeCompute === id) {
            state.activeCompute = null;
            setComputing(false);
        }
    }
}

// The method of the Inflection & Simultaneity section: the request options,
// and labels for the stats and the status bar
function methodSettings() {
    const select = $('curvatureMethod'), method = select.value;
    const rings = Number($('rings').value), degree = Number($('degree').value);
    const support = Number($('support').value);
    const fitted = method === 'jets';
    return {
        method, rings, degree, support, fitted,
        exact: method === 'implicit' || fitted,
        label: method === 'implicit' ? 'Exact (from F)'
            : method === 'jets' ? `Jet blend, ${support} edges` : select.selectedOptions[0].text,
        suffix: method === 'implicit' ? ' (exact)' : method === 'jets' ? ' (exact on the jet blend)' : '',
        options: method === 'implicit' ? { method: 'jet', implicit: state.implicit } : { method, rings, degree, support },
    };
}

// The jet settings in the stats
function jetRows(m) {
    if (m.method !== 'jet' && !m.fitted) return [];
    return [['Jets', `degree ${m.degree}, ${m.rings} rings`]];
}

// A curve: its sets are computed here, exactly, from the smooth curve behind it (curve-sets.js);
// false for a complex with triangles, which goes to the server
function computeCurveSet(kind) {
    if (!state.complex || state.complex.triangles.length) return false;
    const curve = setsCurve();
    if (!curve) {
        setStatus('Exact sets need a closed smooth curve: a curve preset, a closed CSV curve or a Bouquet2D .sspl figure.', 'error');
        return true;
    }
    if (curve === 'plane') {
        setStatus('A plane curve has degenerate sets: lift it to the paraboloid first (Lift, in the Complex section).', 'error');
        return true;
    }
    const t0 = performance.now();
    const result = kind === 'inflection' ? curveInflectionSet(curve) : curveSimultaneitySet(curve);
    state[kind] = result;
    const seconds = ((performance.now() - t0) / 1000).toFixed(2);
    const rows = [['Curve', 'exact, on the spline through its points'],
        ['Segments', fmt(result.segments)]];
    if (kind === 'simultaneity') {
        rows.push(['Curves', fmt(result.curves)], [curve.lambda ? 'Ends (vertices)' : 'Ends (torsion zeros)', fmt(result.ends)]);
        if (result.unclosed) rows.push(['Ends left open (two in a cell)', fmt(result.unclosed)]);
    }
    fillTable($(`${kind}Stats`), rows);
    showSingularSets();
    setStatus(kind === 'inflection'
        ? `Inflection set (exact): ± the binormals of the curve, ${fmt(result.segments)} segments (${seconds} s)`
        : `Simultaneity set (exact): the normals of the planes tangent to the curve at two points, ${fmt(result.segments)} segments in `
            + `${fmt(result.curves)} curves (${seconds} s)`);
    return true;
}

async function computeInflection() {
    if (computeCurveSet('inflection')) return;
    const complex = state.complex;
    if (!complex?.triangles.length) return setStatus('The inflection set needs a surface: a complex with triangles.', 'error');
    const m = methodSettings();
    setStatus(`Computing the inflection set (${m.label})…`);
    const t0 = performance.now();
    try {
        const result = await computeInflectionAPI(complex, m.options);
        if (complex !== state.complex) return;
        state.inflection = result;
        const rows = [['Curvature', m.label]];
        rows.push(...jetRows(m));
        rows.push(
            ['Segments', fmt(result.segments)],
            ['Vertices with K < 0', `${fmt(result.negative)} of ${fmt(result.vertices)}`],
        );
        if (result.skipped) rows.push(['Skipped vertices', fmt(result.skipped)]);
        if (m.exact) rows.push(['Curves (traced exactly)', fmt(result.curves)], ['Crossings with no exact point', fmt(result.dropped)]);
        if (result.unprojected) rows.push(['Vertices not moved onto F = 0', fmt(result.unprojected)]);
        fillTable($('inflectionStats'), rows);
        showSingularSets();
        setStatus(result.segments
            ? `Inflection set${m.suffix}: ${fmt(result.segments)} segments of the parabolic curve (${((performance.now() - t0) / 1000).toFixed(2)} s)`
            : 'No parabolic curve: K does not change sign on this surface, so every height function is Morse.');
    } catch (err) {
        setStatus(err.message, 'error');
    }
}

async function computeSimultaneity() {
    if (computeCurveSet('simultaneity')) return;
    const complex = state.complex;
    if (!complex?.triangles.length) return setStatus('The simultaneity set needs a surface: a complex with triangles.', 'error');
    const m = methodSettings();
    setStatus(`Computing the simultaneity set${m.suffix}…`);
    const t0 = performance.now();
    try {
        const result = await computeSimultaneityAPI(complex, m.options);
        if (complex !== state.complex) return;
        state.simultaneity = result;
        const rows = [['Normals', m.exact ? m.label : 'Jet fitting'], ...jetRows(m)];
        rows.push(['Simultaneity segments', fmt(result.segments)], ['Fold crossings dropped', fmt(result.folds)]);
        if (m.exact) rows.push(['Curves (traced exactly)', fmt(result.curves)], ['Crossings with no exact pair', fmt(result.dropped)]);
        if (result.unprojected) rows.push(['Vertices not moved onto F = 0', fmt(result.unprojected)]);
        fillTable($('simultaneityStats'), rows);
        showSingularSets();
        setStatus(result.segments
            ? `Simultaneity set${m.suffix}: ${fmt(result.segments)} segments (${((performance.now() - t0) / 1000).toFixed(2)} s)`
            : 'No simultaneity set: no two critical points of a height ever have the same value.');
    } catch (err) {
        setStatus(err.message, 'error');
    }
}

// In PHT mode: both sets on the sphere, and for a surface (if Sets on surface is on) the
// parabolic curve and the contact curves of the simultaneity set on it. A curve's sets are only
// drawn on the sphere.
function showSingularSets() {
    const pht = state.mode === 'pht', surface = state.complex?.triangles.length > 0;
    $('surfaceSetsRow').hidden = !pht || !surface;
    const b = pht && $('showInflection').checked ? state.inflection : null;
    const m = pht && $('showSimultaneity').checked ? state.simultaneity : null;
    const onSurface = surface && $('showSurfaceSets').checked;
    viewport.setSegments('inflection', onSurface ? b?.points : null);
    editor.setSegments('inflection', b?.normals);
    viewport.setSegments('simultaneity', onSurface && m ? [...m.first, ...m.second] : null);
    editor.setSegments('simultaneity', m?.directions);
}

function showVineyard(seconds) {
    const vy = state.vineyard;
    // Show the windows before plotting, so Plotly measures their real size
    updatePanels();
    renderVineyard($('vineyardPlot'), vy, state.frame, state.filters);
    renderPD($('pdPlot'), vy, state.frame, state.filters);
    $('pdInfo').textContent = `${frameName()} ${state.frame}`;
    timeline.setComputed(true);

    vy.seconds = seconds;
    updateVineyardStats();
    const total = SERIES.reduce((n, s) => n + vy.series[s.key].length, 0);
    setStatus(`${state.mode === 'pht' ? 'PHT' : 'Radial'} vineyard: ${fmt(total)} pts over ${fmt(vy.frames)} ${state.mode === 'pht' ? 'directions' : 'centers'} (${seconds.toFixed(2)} s)`);
}

function updateVineyardStats() {
    const vy = state.vineyard;
    const dims = state.complex.dimension;
    const perDim = Array.from({ length: dims + 1 }, (_, d) => SERIES.filter(s => s.dim === d)
        .reduce((n, s) => n + vy.series[s.key].length, 0));
    const total = perDim.reduce((a, b) => a + b, 0);
    const shown = SERIES.reduce((n, s) => n + persistent(vy.series[s.key], vy, state.filters).length, 0);
    const rows = [
        [state.mode === 'pht' ? 'Directions' : 'Centers', fmt(vy.frames)],
        ['Points', fmt(total)],
        [perDim.map((_, d) => `H${'₀₁₂₃'[d]}`).join(' / '), perDim.map(fmt).join(' / ')],
    ];
    if (shown < total) rows.push(['Below min pers.', fmt(total - shown)]);
    rows.push(['Values', `${vy.minValue.toPrecision(3)} … ${vy.maxValue.toPrecision(3)}`], ['Time', `${vy.seconds.toFixed(2)} s`]);
    fillTable($('vineyardStats'), rows);
}

function refreshPlots() {
    if (!state.vineyard) return;
    renderVineyard($('vineyardPlot'), state.vineyard, state.frame, state.filters);
    renderPD($('pdPlot'), state.vineyard, state.frame, state.filters);
    updateVineyardStats();
}

// ========== Frames & Playback ==========
const frameName = () => (state.mode === 'pht' ? 'Direction' : 'Center');
const coords = p => `(${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)})`;

function setFrame(f) {
    const list = frames(), n = list.length;
    state.frame = n ? Math.min(Math.max(Math.round(f), 0), n - 1) : 0;
    timeline.setFrame(state.frame);
    $('frameInput').value = state.frame;
    $('frameInfo').textContent = n ? `/ ${n - 1}` : '';
    const p = list[state.frame];
    if (state.mode === 'pht') {
        viewport.setDirection(p ?? null);
        if (p) editor.setCurrent(state.frame, p);
        $('centerInfo').textContent = p ? `v = ${coords(p)}` : '';
    } else {
        viewport.setCurrent(state.frame);
        $('centerInfo').textContent = p ? `c = ${coords(p)}` : '';
    }

    const vy = state.vineyard;
    if (vy) {
        updateVineyardFrame($('vineyardPlot'), vy, state.frame, state.filters);
        renderPD($('pdPlot'), vy, state.frame, state.filters);
        $('pdInfo').textContent = `${frameName()} ${state.frame}`;
    }
}

let lastTick = 0;
function tick(now) {
    if (!state.playing) return;
    if (now - lastTick >= 1000 / PLAYBACK_FPS) {
        lastTick = now;
        setFrame((state.frame + 1) % frames().length);
    }
    requestAnimationFrame(tick);
}

function togglePlay(play = !state.playing) {
    play = play && frames().length > 0;
    const start = play && !state.playing;
    state.playing = play;
    $('playBtn').textContent = play ? '⏸' : '▶';
    $('playBtn').classList.toggle('active', play);
    if (start) requestAnimationFrame(tick);
}

// ========== Transform: radial or PHT ==========
function setMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    const pht = mode === 'pht';
    for (const b of document.querySelectorAll('[data-action="mode"]')) b.classList.toggle('active', b.dataset.mode === mode);
    $('loopSection').hidden = pht;
    $('directionSection').hidden = !pht;
    $('directionToggleRow').hidden = !pht;
    $('planeRow').hidden = !pht;
    $('inflectionSection').hidden = !pht;
    $('inflectionRow').hidden = !pht;
    $('simultaneityRow').hidden = !pht;
    showSingularSets();
    $('frameLabel').textContent = frameName();
    if (pht) {
        viewport.setLoop(null, true);
    } else {
        viewport.setDirection(null);
        viewport.setLoop(state.loopCurve, state.loopClosed);
    }
    updatePanels();
    if (pht) syncCamera(viewport, editor.view);
    resample();
    setStatus(pht ? 'PHT: shape the loop of directions on the sphere, then compute the vineyard.'
        : 'Radial: centers along the observation loop.');
}

// The sphere window and the main view look at the world from the same
// direction, so a direction on the sphere points the same way as in the scene.
let syncing = false;
function syncCamera(from, to) {
    if (syncing || state.mode !== 'pht') return;
    syncing = true;
    const dir = from.camera.position.clone().sub(from.controls.target).normalize();
    const dist = to.camera.position.distanceTo(to.controls.target);
    to.camera.position.copy(to.controls.target).addScaledVector(dir, dist);
    to.controls.update();
    to.requestRender();
    syncing = false;
}
viewport.controls.addEventListener('change', () => syncCamera(viewport, editor.view));
editor.view.controls.addEventListener('change', () => syncCamera(editor.view, viewport));
editor.view.controls.addEventListener('start', () => viewport.stopAnimation());

function updateDirectionStats() {
    const n = editor.loop.handles.length;
    fillTable($('directionStats'), [
        ['Handles', n < 3 ? `${n} (a loop needs 3)` : n],
        ['Length', n < 3 ? '—' : `${(editor.loop.length() * 180 / Math.PI).toFixed(1)}°`],
    ]);
}

// Draw Loop: a new loop on the sphere, clicked point by point, as in Bouquet2D
function setDrawing(on) {
    editor.setDrawing(on);
    $('drawLoopBtn').classList.toggle('active', on);
    $('drawLoopBtn').textContent = on ? 'Stop Drawing' : 'Draw Loop';
}

function toggleDrawing() {
    const on = !editor.drawing;
    setDrawing(on);
    if (on) ACTIONS['show-sphere']();
    const n = editor.loop.handles.length;
    if (on) setStatus('Drawing a new loop: click on the sphere to place its points (scroll to zoom in); it closes through them from 3 points on. Esc stops.');
    else if (n < 3) setStatus(`Stopped drawing with ${n} point${n === 1 ? '' : 's'}: a loop needs at least 3 (Draw Loop starts again).`, 'error');
    else setStatus(`Loop drawn through ${n} points.`);
}

// ========== View ==========
function toggleOrtho() {
    viewport.toggleOrtho();
    $('orthoBtn').classList.toggle('active', viewport.camera.isOrthographicCamera);
}

function toggleXRay() {
    $('showXray').checked = !$('showXray').checked;
    viewport.setXRay($('showXray').checked);
}

// ========== Actions (buttons) ==========
const ACTIONS = {
    'open-surface': () => $('surfaceFile').click(),
    'open-loop': () => $('loopFile').click(),
    'compute': compute,
    'frame-all': () => viewport.frameAll(),
    'toggle-ortho': toggleOrtho,
    'play': () => togglePlay(),
    'frame-prev': () => setFrame(state.frame - 1),
    'frame-next': () => setFrame(state.frame + 1),
    'mode': el => setMode(el.dataset.mode),
    'reset-directions': () => {
        setDrawing(false);
        editor.reset();
    },
    'draw-directions': toggleDrawing,
    'compute-inflection': computeInflection,
    'compute-simultaneity': computeSimultaneity,
    'show-sphere': () => {
        $('showDirectionPanel').checked = true;
        updatePanels();
        syncCamera(viewport, editor.view);
    },
};

document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (el) ACTIONS[el.dataset.action](el);
});

// Buttons don't take focus on click, so Space keeps meaning play/pause.
document.addEventListener('mousedown', e => {
    if (e.target.closest('button')) e.preventDefault();
});

// Keyboard shortcuts (numpad or the digit row for views)
document.addEventListener('keydown', e => {
    if (e.target.closest?.('input, select, textarea')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyO') ACTIONS['open-surface']();
    else if (ctrl && e.code === 'Enter') compute();
    else if (ctrl) return;
    else if (e.altKey && e.code === 'KeyZ') toggleXRay();
    else if (e.altKey) return;
    else {
        switch (e.code) {
            case 'Numpad1': case 'Digit1': viewport.viewDirection(VIEWS.front); break;
            case 'Numpad3': case 'Digit3': viewport.viewDirection(VIEWS.right); break;
            case 'Numpad7': case 'Digit7': viewport.viewDirection(VIEWS.top); break;
            case 'Numpad9': case 'Digit9': viewport.viewOpposite(); break;
            case 'Numpad5': case 'Digit5': toggleOrtho(); break;
            case 'Home': case 'NumpadDecimal': viewport.frameAll(); break;
            case 'Space': togglePlay(); break;
            case 'ArrowLeft': setFrame(e.shiftKey ? 0 : state.frame - 1); break;
            case 'ArrowRight': setFrame(e.shiftKey ? frames().length - 1 : state.frame + 1); break;
            case 'Delete': case 'Backspace': if (state.mode === 'pht') editor.removeHoveredHandle(); break;
            case 'Escape': if (!editor.drawing) return; toggleDrawing(); break;
            default: return;
        }
    }
    e.preventDefault();
});

// ========== Inputs ==========
$('surfaceFile').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) loadSurfaceFile(file);
});

$('loopFile').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) loadLoopFile(file);
});

$('presetSelect').addEventListener('change', e => {
    if (e.target.value) loadPreset(e.target.value);
});

$('curveClosed').addEventListener('change', e => {
    if (!state.csvCurve) return;
    const { points, name } = state.csvCurve;
    if (e.target.checked && points.length >= 3) setSmooth(csvSpline(points), { raw: points, keep: true });
    else setSmooth(null);
    updateEstimatorRows();
    setComplex(state.smooth ? smoothComplex() : curveComplex(points, e.target.checked), name, { frame: false });
});

$('liftCurve').addEventListener('change', e => {
    state.lift.on = e.target.checked;
    relift();
});

$('liftLambda').addEventListener('change', e => {
    const lambda = Number(e.target.value);
    e.target.classList.toggle('invalid', !(lambda > 0));
    if (!(lambda > 0)) return;
    state.lift.lambda = lambda;
    if (state.lift.on) relift();
});

$('loopMode').addEventListener('change', e => setLoopMode(e.target.value));

for (const input of document.querySelectorAll('[data-circle]')) {
    input.addEventListener('input', () => {
        const { circle } = state.loop;
        const key = input.dataset.circle;
        const value = parseFloat(input.value);
        const next = key === 'radius' ? value : circle[key].map((x, i) => (i === Number(input.dataset.i) ? value : x));
        const valid = Number.isFinite(value) && (key === 'radius' ? value > 0 : key !== 'normal' || Math.hypot(...next) > 0);
        input.classList.toggle('invalid', !valid);
        if (!valid) return;
        circle[key] = next;
        rebuildLoop();
    });
}

$('loopOpen').addEventListener('change', e => {
    state.loop.closed = !e.target.checked;
    rebuildLoop();
});

// Remeshed on release only: each level takes a server call
$('resolution').addEventListener('change', e => {
    state.resolution = Number(e.target.value);
    if (state.preset) loadPreset(state.preset, { frame: false });
});

$('samples').addEventListener('input', e => {
    state.samples = Number(e.target.value);
    $('samplesVal').textContent = state.samples;
    resample();
});

$('frameInput').addEventListener('change', e => setFrame(Number(e.target.value)));

// Log scale: 0 is off, then steps of 10^0.1 from 10^-4.9 to 10^-1 of the largest function value
$('minPersistence').addEventListener('input', e => {
    const step = Number(e.target.value);
    state.filters.minPersistence = step ? 10 ** (step / 10 - 5) : 0;
    $('minPersistenceVal').textContent = step ? `${Number((state.filters.minPersistence * 100).toPrecision(2))} %` : 'Off';
    refreshPlots();
});

for (const chip of document.querySelectorAll('#dimChips .chip')) {
    chip.addEventListener('click', () => {
        const d = Number(chip.dataset.dim);
        state.filters.dims[d] = !state.filters.dims[d];
        chip.classList.toggle('active', state.filters.dims[d]);
        refreshPlots();
    });
}

for (const chip of document.querySelectorAll('#kindChips .chip')) {
    chip.addEventListener('click', () => {
        const k = chip.dataset.kind;
        state.filters.kinds[k] = !state.filters.kinds[k];
        chip.classList.toggle('active', state.filters.kinds[k]);
        refreshPlots();
    });
}

// Display toggles
$('showComplex').addEventListener('change', e => viewport.setVisible('surface', e.target.checked));
$('showLoop').addEventListener('change', e => viewport.setVisible('loop', e.target.checked));
$('showCenters').addEventListener('change', e => viewport.setVisible('centers', e.target.checked));
$('showWire').addEventListener('change', e => viewport.setWireframe(e.target.checked));
$('showGrid').addEventListener('change', e => viewport.setGrid(e.target.checked));
$('showXray').addEventListener('change', e => viewport.setXRay(e.target.checked));
$('showInflection').addEventListener('change', showSingularSets);
$('showSimultaneity').addEventListener('change', showSingularSets);
$('showSurfaceSets').addEventListener('change', showSingularSets);
// The settings of the chosen method; "Exact (from F)" is offered (and chosen
// by default) only for the implicit presets
function updateEstimatorRows() {
    const select = $('curvatureMethod');
    $('implicitOption').hidden = $('implicitOption').disabled = !state.implicit;
    if (!state.implicit && select.value === 'implicit') select.value = 'jet';
    const method = select.value, jets = method === 'jet' || method === 'jets';
    $('ringsRow').hidden = !jets;
    $('degreeRow').hidden = !jets;
    $('supportRow').hidden = method !== 'jets';
    // A smooth curve has exact sets, whatever the method
    const curve = state.smooth;
    if (curve) for (const id of ['methodRow', 'ringsRow', 'degreeRow', 'supportRow']) $(id).hidden = true;
    else $('methodRow').hidden = false;
}
$('curvatureMethod').addEventListener('change', updateEstimatorRows);
$('support').addEventListener('input', e => { $('supportVal').textContent = e.target.value; });
$('degree').addEventListener('input', e => { $('degreeVal').textContent = e.target.value; });

// Subdivide a loaded surface onto its jet blend, with the current jet settings.
// The Coxeter scheme traces a new mesh of that surface, the midpoint scheme
// splits the loaded triangles.
// The isotropic scheme remeshes the loaded mesh itself, with no fitted surface.
async function subdivide() {
    const file = state.file, steps = Number($('subdivision').value), scheme = $('subdivisionScheme').value;
    if (!file) return;
    let complex = file.complex, unprojected = 0, inputEuler = complex.stats.euler;
    const what = { coxeter: 'remeshed (Coxeter)', midpoint: 'subdivided', isotropic: 'remeshed (isotropic)' }[scheme];
    if (steps) {
        const m = methodSettings();
        const settings = { rings: m.rings, degree: m.degree, support: m.support };
        const onto = scheme === 'isotropic' ? 'on itself, keeping its sharp edges' : 'onto the jet blend';
        setStatus(`${scheme === 'midpoint' ? 'Subdividing' : 'Remeshing'} ${file.name}, ${steps} step${steps > 1 ? 's' : ''}, ${onto}…`);
        try {
            const r = await subdivideAPI(file.complex, steps, scheme, settings);
            complex = buildComplex({ positions: r.vertices, simplices: r.simplices }, { weld: false });
            unprojected = r.unprojected;
            inputEuler = r.input_euler;
        } catch (err) {
            return setStatus(err.message, 'error');
        }
        if (file !== state.file || steps !== Number($('subdivision').value) || scheme !== $('subdivisionScheme').value) return; // superseded
    }
    setComplex(complex, file.name, { frame: false });
    $('subdivisionVal').textContent = fmt(complex.stats.triangles);
    // The Coxeter mesh follows F = 0 itself, so it shows where the fit has extra handles or pieces.
    // The server's count is of the mesh as it read it (duplicate vertices kept apart, unlike here).
    const s = complex.stats;
    const topology = s.euler !== inputEuler
        ? `; the fitted surface's topology differs from the loaded mesh's (Euler characteristic ${s.euler}, loaded ${inputEuler})` : '';
    setStatus(steps ? `${file.name}: ${what}, ${steps} step${steps > 1 ? 's' : ''}, ${fmt(s.triangles)} triangles`
        + (unprojected ? ` (${fmt(unprojected)} vertices could not be moved onto the fitted surface)` : '') + topology
        : `${file.name}: as loaded, ${fmt(s.triangles)} triangles`, topology ? 'error' : '');
}
$('subdivision').addEventListener('change', subdivide);
$('subdivisionScheme').addEventListener('change', () => { if (Number($('subdivision').value)) subdivide(); });
$('rings').addEventListener('input', e => { $('ringsVal').textContent = e.target.value; });
$('showPlane').addEventListener('change', e => {
    viewport.setPlaneVisible(e.target.checked);
    editor.view.setPlaneVisible(e.target.checked);
});

// Plot windows
for (const { panel, toggle, close } of PANELS) {
    makePanelDraggable($(panel));
    makePanelResizable($(panel));
    $(toggle).addEventListener('change', () => {
        updatePanels();
        syncCamera(viewport, editor.view);
    });
    $(close).addEventListener('click', () => {
        $(toggle).checked = false;
        updatePanels();
    });
}

for (const id of ['vineyardPlot', 'pdPlot']) {
    const el = $(id);
    new ResizeObserver(() => { if (el.data) Plotly.Plots.resize(el); }).observe(el);
}

// ========== Init ==========
initSections();
updateDirectionStats();
fillCircleInputs();
loadPreset('ellipsoid');
setLoopMode('circle');
viewport.frameAll(false);
updatePanels();
syncCamera(viewport, editor.view);
checkServer().then(ok => {
    if (ok) setStatus('Ready. Press Compute Vineyard (Ctrl Enter) to compute the vineyard along the loop.');
    else setStatus(`The persistence server is not reachable. ${SERVER_HINT}.`, 'error');
});
