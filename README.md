<div align="center">

<img src="favicon.svg" width="72" height="72" alt="Luxel logo">

# Luxel

**Small design tools that run in your browser.**
Palettes, image compression, screenshot polish and animated charts, all in one place.

[**Live demo →**](https://swif-7.github.io/Luxel-design-studio/)

[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)
[![Deploy](https://github.com/Swif-7/Luxel-design-studio/actions/workflows/pages.yml/badge.svg)](https://github.com/Swif-7/Luxel-design-studio/actions/workflows/pages.yml)
![Dependencies: 0](https://img.shields.io/badge/dependencies-0-black.svg)
![Languages](https://img.shields.io/badge/i18n-中文%20·%20EN%20·%20한국어%20·%20日本語%20·%20FR-black.svg)

English · [简体中文](README.zh-CN.md)

</div>

---

## Overview

Luxel (*lux* × *pixel*) is a set of design utilities for the small, repetitive jobs around design work: generating backgrounds, tidying a color system, compressing assets, dressing up screenshots and turning numbers into motion.

Every tool is a static page that runs in the browser. Images and data are processed on your device and never sent anywhere. There's no account, no backend and no tracking.

- **Zero dependencies.** Plain ES modules, WebGL and Canvas 2D. No framework, no bundler, no CDN.
- **Private by design.** Files never leave the browser; settings are saved in `localStorage`.
- **Five interface languages.** Simplified Chinese, English, Korean, Japanese and French, detected automatically and switchable on every page.
- **Light and dark themes**, a monochrome interface, and layouts that work down to phone width.

## Tools

| Tool | What it does | Exports |
|---|---|---|
| [**Rheo**](https://swif-7.github.io/Luxel-design-studio/rheo.html) | Real-time flow shader studio: seeded color ribbons, depth of field, surface textures, particles and an ASCII glyph layer | PNG up to 4K · 10 s WebM video · JSON parameters · standalone HTML |
| [**Rubric**](https://swif-7.github.io/Luxel-design-studio/rubric.html) | Builds a light and dark color and type system with sliders, checks contrast, and copies it as a Markdown UI spec for coding agents | Markdown spec (clipboard) |
| [**Recast**](https://swif-7.github.io/Luxel-design-studio/recast.html) | Batch image compression, format conversion and resizing in a Web Worker | WebP · JPEG · PNG · AVIF (where supported) · ZIP |
| [**Relief**](https://swif-7.github.io/Luxel-design-studio/relief.html) | Places a screenshot on a background, with cropping, browser or phone frames, 9 text layouts and on-canvas drag, resize and snapping | PNG · JPG · clipboard |
| [**Rise**](https://swif-7.github.io/Luxel-design-studio/rise.html) | Turns pasted data into animated charts: 18 chart types, 10 visual styles, up to 7 series | PNG · JPG · PNG sequence (with alpha) · MP4 or WebM · standalone HTML |
| **Roll** | Online video editing | *In development, not part of this release* |

<details>
<summary><b>Rheo</b>: details</summary>

- Four flow families (Tidal Spread, Confluence, Twin Vortex, Laminar Drift), 2–8 color stops, and a harmony-aware random palette in OKLCH.
- Controls for flow, width, softness, density, angle, speed, scale, X/Y offset, twist and fold layers.
- Background tint and diffusion, ribbon depth of field, surface textures (grain, pixel, halftone, dither) and particle layers.
- ASCII glyph matrix with binary, numeric, Latin, symbol, Chinese, Japanese or custom character sets.
- Deterministic seeds: the same seed and locks give the same parameters.
- Full-resolution offline rendering for PNG and video (WebCodecs VP9 or VP8 with a WebM muxer written for this project).
- A standalone HTML export that contains the renderer, parameters and license, with no external requests.

</details>

<details>
<summary><b>Rubric</b>: details</summary>

- Single or multiple accent colors (2–6), with contrasting and tonal suggestions.
- Main background, card and border colors, each with a default, a custom value or a suggestion derived from the background and primary color.
- Linked or independent light and dark themes; the dark theme is generated from the same parameters rather than inverted.
- Four type roles (body, strong, heading, mono), each with its own weight and size, and optional linked ratios.
- WCAG contrast checks for text and non-text elements, plus advisory notes on hue collisions, edge vibration and small-text weight.
- The copied spec includes CSS custom-property tokens, contrast ratios and implementation rules, written in the current interface language.

</details>

<details>
<summary><b>Recast</b>: details</summary>

- Drop in JPG, PNG or WebP files, one at a time or in batches.
- Choose the output format, quality and maximum edge (800–3840 px or original).
- Encoding runs in a Web Worker. If an output would be larger than its source, Recast says so.
- Before and after comparison, per-file size savings and a single ZIP download.

</details>

<details>
<summary><b>Relief</b>: details</summary>

- Four steps: Crop → Background → Composition → Export.
- Backgrounds: a Rheo flow generated on the spot (random colors or styles), a frame imported from Rheo, a solid color, or your own image with adjustable blur.
- Direct manipulation on the canvas: drag the title, subtitle or screenshot to move it, with Photoshop-style snapping to the center lines, edges and other elements. Click to get a size slider next to it; double-click text to edit it in place.
- Browser and hand-drawn phone frames (metal band, side buttons, Dynamic Island) with adjustable border thickness, plus shadow, radius and common aspect ratios.
- Nine layouts, including heading on top, text left, caption, bleed off the bottom, corner tag, bullet list, quote and magazine.

</details>

<details>
<summary><b>Rise</b>: details</summary>

- Seven steps: Data → Chart → Style → Motion → Background → Layout → Export.
- Pill-row data entry: paste CSV or tab-separated data, and thousands separators and decimal marks are detected. Any row can be set as the X-axis.
- Batch mode renders each series separately; merge mode puts all series in one chart and explains why some chart types aren't available.
- Spring-based motion with several easing curves and entrance styles.
- Moving Rheo backgrounds: drop in an HTML file exported from Rheo and the flow keeps moving behind the chart, in the preview and in video, PNG sequence and HTML exports.
- Transparent PNG sequences for video editors, and a standalone HTML embed that replays on click.

</details>

## Quick start

Use the hosted version at **<https://swif-7.github.io/Luxel-design-studio/>**, or run it locally.

Requires Node.js 18 or later. There's nothing to install.

```sh
git clone https://github.com/Swif-7/Luxel-design-studio.git
cd Luxel-design-studio
npm start
```

Open <http://localhost:4173>. The dev server listens on `127.0.0.1` only. To use another port:

```sh
PORT=4174 npm start
```

Because the site is static, any static file server works too. All asset paths are relative, so it can be served from a sub-path.

## Browser support

The latest two versions of Chrome, Edge, Safari and Firefox are supported.

| Feature | Requirement |
|---|---|
| Rheo rendering | WebGL with hardware acceleration |
| Video export | Rheo uses WebCodecs (Chromium-based browsers, recent Safari); Rise records MP4 or WebM with `MediaRecorder` |
| AVIF output (Recast) | A browser that can encode AVIF from a canvas |
| Copy to clipboard | A secure context (HTTPS or `localhost`) |

When a feature isn't supported, the tool says so instead of failing silently.

## Project structure

```
.
├── index.html            # Home: tool index with live thumbnails
├── rheo.html · rubric.html · recast.html · relief.html · rise.html
├── tokens.css            # Shared design tokens (color, type, radius), light and dark
├── *.css                 # One stylesheet per page
├── src/
│   ├── shader.js         # Rheo WebGL renderer and post-processing
│   ├── model.js          # Rheo parameters, seeding, validation and migration
│   ├── export.js         # Standalone HTML packaging
│   ├── spec.js           # Rubric: theme generation, contrast, Markdown spec (no DOM)
│   ├── recast-*.js       # Recast: formats, encoding worker, file inspection
│   ├── relief-*.js       # Relief: layout math and canvas rendering
│   ├── rise-*.js         # Rise: data parsing, chart model, drawing, compositing
│   ├── i18n.js           # Translation lookup, pattern matching, font fallbacks
│   ├── i18n-dom.js       # DOM auto-translation and the language switcher
│   └── lang/             # Dictionaries: Chinese source → [en, ko, ja, fr]
├── fonts/                # Self-hosted IBM Plex (SIL OFL 1.1)
├── tests/                # node:test suites and in-browser GPU and media checks
└── server.mjs            # Allowlist-based local dev server (Node built-ins only)
```

## Development

```sh
npm test
```

The suite uses Node's built-in test runner. It covers parameter models, spec generation, data parsing, chart math, encoding helpers, the render queue and **i18n coverage**: every Chinese UI string must have all four translations, and placeholders must match. Two in-browser checks are also included:

- `tests/render.html`: GPU rendering determinism and continuity for Rheo.
- `tests/media.html`: decoded size and duration of exported PNG and WebM files.

### Adding a translation

Interface text is written in Chinese in the source, and a Chinese string is its own dictionary key. Add an entry to the matching file in `src/lang/`:

```js
'复制规范': ['Copy spec', '스펙 복사', '仕様をコピー', 'Copier la spéc.'],
```

Brand and tool names, file formats and technical terms (HEX, CSV, token, WCAG, FPS, KB/MB) stay in English in every language. `npm test` fails if a string is missing.

## Deployment

The site deploys to GitHub Pages through [`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every push to `main`. The workflow runs the tests, then publishes only the runtime files. Tests, docs and the dev server aren't published.

## Open-source scope

The code in this repository is released under the **MIT License**. That covers everything published here: the five tools listed above, the shared design system and the i18n layer.

Luxel is still in active development. **Future tools and features, including Roll and modules not yet published, may not be open-sourced.** They may be released under different terms or kept proprietary. The MIT license covers the code in this repository as published and grants no rights to work that hasn't been published here.

## Contributing

Issues and pull requests are welcome.

- Run `npm test` before opening a PR.
- Keep the project dependency-free. Please discuss before adding a package or build step.
- New UI text needs translations in `src/lang/` for all four languages.
- Match the surrounding code style: plain ES modules, short functions, comments where the reasoning isn't obvious.

## Contact

Email **[Mindshell@126.com](mailto:Mindshell@126.com)**, or use **Contact us** on the home page, which copies the address to your clipboard.

## License

[MIT](LICENSE) © 2026 Swif-7 and Luxel contributors.

IBM Plex fonts are © IBM Corp. and licensed under the [SIL Open Font License 1.1](fonts/LICENSE.txt). They're distributed alongside the project and aren't covered by the MIT license.
