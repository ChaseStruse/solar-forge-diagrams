# Changelog

Notable changes to Solar Forge Diagrams. Versions follow [Semantic Versioning](https://semver.org/); the Omarchy package adds a `-N` package release for packaging-only rebuilds.

## [Unreleased]

### Added

- **Cognito, WAF and Shield** components with official AWS icons, also recognised by Terraform and CloudFormation import.
- **Comic Noir** (inked black-and-white chrome, colour components) and **Deep Space** themes.
- **Board font** choice: Standard, Courier New or Terminal (bundled VT323, loaded on demand).
- **Features tour** from the top bar.
- **Bulk architecture details:** edit details for every selected object at once, or apply a boundary's details to everything inside it.
- Component **Text size** and **Wrap caption** controls.
- **Browser file operations:** in a browser build, Save and Save as download a `.sforge.json` copy, Open uses the browser file picker, PNG and SVG exports download, and crash recovery keeps a snapshot in local storage. The native app is unchanged.

### Changed

- Connections between two components in both directions are drawn as two parallel one-way lanes.
- Component captions stay on one line by default, shrinking to fit.
- Data-flow animation runs at half its previous speed.

### Fixed

- Large boards no longer fade to black: fog now thins as the camera backs away to fit a big diagram, so tiles, boundaries and notes keep their colours.
- Zooming in on a large board in the 2.5D view is no longer capped at 4× the fitted view; the zoom-in limit grows with the board.
- Blurry board text: rendering now matches the display pixel ratio, and captions, labels, text and notes are redrawn at their on-screen size when zooming pauses.
- Captions, icons and labels stay sharp while panning and zooming: they are drawn after the in-motion antialiasing pass instead of being smoothed by it.
- Idle boards with data flow on no longer saturate integrated GPUs: animated frames use the cheap antialiasing pass, and full multisampling is kept for a board at rest (about 3× the idle frame rate on Intel UHD graphics).
- Shorter stall when zooming stops: caption atlas pages upload about 4× faster.

## [0.2.0] — 2026-10-20

First public release.

### Added

- **MIT license** for the application source.
- **Infrastructure import:** Terraform (`.tf` and `terraform show -json`), CloudFormation YAML/JSON and Docker Compose, parsed offline in a background worker with automatic layout.
- **Network reachability:** security groups, network ACLs, route tables and a reachability matrix with Allowed / Denied / Unknown decisions and decision traces.
- **Traffic journeys:** per-connection traffic rules, saved traffic scenarios, walkthrough captions, fork choices and active routes.
- **Linked detail diagrams:** multi-board projects with shared undo history, saving and recovery.
- **Exports:** WebM/MP4 journey video, Mermaid, PlantUML and multi-page draw.io.
- **Catalog:** Kubernetes resources with official icons; container, DevOps and networking pictograms; an example browser with AWS, Kubernetes and flowchart examples.
- Text annotations, sticky notes, themes and copy-image to clipboard.
- Release builds run entirely in Docker (`scripts/docker-release.sh`) and produce a fixed-name download bundle.

### Changed

- Faster rendering, routing and import: roughly halved board load and pan latency, and large Terraform imports in under a second (see `benchmarks/results/2026-10-17-performance-pass.json`).

## [0.1.0] — 2026-10-16

First alpha, distributed only as local builds (packages 0.1.0-1 through 0.1.0-6).

- Native Tauri desktop app with an isometric Three.js canvas, Plan and 2.5D views.
- Durable `.sforge.json` documents with atomic saves, crash recovery and unsaved-change protection.
- Editing: multi-select, rectangle selection, resize, grouping, connections, clipboard and undo/redo.
- Offline AWS catalog with official icons, VPC and architecture templates, and flowcharts.
- PNG, SVG and animated GIF export.
- Omarchy package with launcher, icon and file association, and a verified install bundle.

[Unreleased]: https://github.com/ChaseStruse/solar-forge-diagrams/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ChaseStruse/solar-forge-diagrams/releases/tag/v0.2.0
[0.1.0]: https://github.com/ChaseStruse/solar-forge-diagrams/blob/main/CHANGELOG.md#010--2026-10-16
