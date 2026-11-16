# Vendored frontend dependencies

Served locally so the app works offline (and in the desktop app). Unmodified copies of:

| Path | Source | License |
|---|---|---|
| `tailwind/tailwindcss-3.4.17.js` | Tailwind CSS's Play CDN build, https://cdn.tailwindcss.com/3.4.17 (where https://cdn.tailwindcss.com redirects). The app's classes are all in `css/styles.css`, so only Tailwind's base styles apply | MIT (`tailwind/LICENSE`) |
| `plotly/plotly-2.27.0.min.js` | https://cdn.plot.ly/plotly-2.27.0.min.js | MIT (in the file's header) |
| `fonts/` | JetBrains Mono (400, 700) and Space Grotesk (400, 500, 700) from Google Fonts, with the `@font-face` rules of its CSS in `fonts.css` (the same files as BouquetPHT's; the app uses the 400 and 700 weights) | SIL OFL 1.1 (`fonts/OFL-*.txt`) |
