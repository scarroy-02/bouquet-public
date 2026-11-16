# Bouquet

Two desktop apps that follow how the topology of a shape changes along a family of functions on it, with the
geometry that controls those changes:

- **[Bouquet2D](bouquet2d)**, for plane curves: the symmetry set and the focal set of a curve, and the vineyard of
  the squared distance from a center moving along a loop.
- **[BouquetPHT](bouquetpht)**, for shapes in R³ (surfaces, space curves, simplicial complexes): the vineyard of
  the persistent homology transform, the height in a direction moving along a loop on the sphere, with the
  inflection and simultaneity sets of a surface, where the vineyard can change.

## Download

Get them from [Releases](https://github.com/scarroy-02/bouquet-public/releases): Bouquet2D's are tagged
`bouquet2d-v…`, BouquetPHT's `bouquetpht-v…` (and `v0.1.0`, its first).

| System | File |
|---|---|
| Windows | `.exe`, portable: nothing to install |
| macOS | `.dmg`: `arm64` for Apple silicon, `x64` for Intel |
| Linux | `.AppImage` |

Everything runs on your computer, and the apps work offline: each starts its own computation server on a local
port and stops it when you quit.

**First launch.** The apps aren't signed with an Apple or Microsoft certificate, so your system asks once:
- macOS: open the app, then *System Settings → Privacy & Security → Open Anyway* (or run
  `xattr -dr com.apple.quarantine /Applications/Bouquet2D.app`, or `BouquetPHT.app`);
- Windows: *Windows protected your PC → More info → Run anyway*;
- Linux: make the file executable (`chmod +x Bouquet2D-*.AppImage`), then run it.

Each app's README explains how to use it and how to build it from source.

## Repository

| Folder | |
|---|---|
| [`bouquet2d/`](bouquet2d) | Bouquet2D: the app (`index.html`, `js/`, `css/`, `assets/`), its computation server (`server/`), the libraries it bundles (`vendor/`) and the desktop app around them (`desktop/`) |
| [`bouquetpht/`](bouquetpht) | BouquetPHT, laid out the same way |
| [`.github/workflows/`](.github/workflows) | One workflow per app, which builds it for Linux, Windows and macOS, and releases it when a tag `bouquet2d-vX.Y.Z` or `bouquetpht-vX.Y.Z` is pushed |

## License

Copyright © 2026 Rohit Roy. Bouquet2D and BouquetPHT are free software: you can redistribute them and/or modify
them under the terms of the GNU General Public License, version 3 or (at your option) any later version, see
[LICENSE](LICENSE). The libraries they bundle keep their own licenses: the frontends' are listed in
[`bouquet2d/vendor/README.md`](bouquet2d/vendor/README.md) and
[`bouquetpht/vendor/README.md`](bouquetpht/vendor/README.md). Bouquet2D's server is built on GUDHI, Boost,
cpp-httplib and nlohmann/json, and BouquetPHT's also on CGAL (under the GPL and LGPL) and Eigen. Bouquet2D's icon
is the bouquet emoji of Google's [Noto Emoji](https://github.com/googlefonts/noto-emoji), under the Apache License
2.0 (see [`bouquet2d/desktop/build/icon-LICENSE.txt`](bouquet2d/desktop/build/icon-LICENSE.txt)).
