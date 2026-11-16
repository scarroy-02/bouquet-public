# Vendored frontend dependencies

Served locally so the app works offline (and in the desktop app). Unmodified copies of:

| Path | Source | License |
|---|---|---|
| `three/` | three.js 0.170.0 (npm `three@0.170.0`): `build/three.module.js`, and the addons the app imports (`examples/jsm/controls/OrbitControls.js`, `examples/jsm/lines/*`) | MIT (`three/LICENSE`) |
| `plotly/plotly-2.27.0.min.js` | https://cdn.plot.ly/plotly-2.27.0.min.js | MIT (in the file's header) |
| `fonts/` | JetBrains Mono (400, 700) and Space Grotesk (400, 500, 700) from Google Fonts, with the `@font-face` rules of its CSS in `fonts.css` | SIL OFL 1.1 (`fonts/OFL-*.txt`) |

To add a three.js addon, copy it from the same npm version into `three/examples/jsm/`.
