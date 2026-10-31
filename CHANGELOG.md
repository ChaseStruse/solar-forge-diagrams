# Changelog

Notable changes to Solar Forge Diagrams. Versions follow [Semantic Versioning](https://semver.org/); the Omarchy package adds a `-N` package release for packaging-only rebuilds.

## [Unreleased]

### Added

- **Pen input:** handles, connection hit areas and the tool rail grow while a pen is in use; a pen tap no longer nudges the component under it; a barrel button that sends a right or middle click pans, as those mouse buttons do; a pen's eraser end deletes the components and connections it passes over in one undoable step.
- **Keyboard camera:** hold WASD or the arrow keys to glide the view, with Shift for faster. Arrow keys still nudge a selection.
- **Sketch tool** (`B`): draw a box, diamond or oval to add a process, decision or terminal shape at that size, or draw a line between two components to connect them.
- **Tablet mode** from the top bar: full screen with pen-sized controls and fewer top-bar buttons. Under Hyprland the window first moves to the monitor the pen is mapped to (`input:tablet:output`) and returns to its previous monitor afterwards.
- **Tablet buttons** in the new **Settings** panel (gear in the top bar): choose Assign next to an action, then press a tablet button, the Kamvas pen's side button (mapped to the Pan tool by default) or an extra mouse button, and that control runs the action; pressing a tool's button again returns to Select. Actions cover the tools, undo/redo, delete, zoom, fit, journey and tablet mode, plus Components-menu navigation for wheels that send key combos. Mappings are saved locally.
- **Huion Kamvas wheels** in the desktop app, with no setup beyond a permission rule the package installs: turn to zoom; press to open the Components menu, turn to scroll it and press again to add the highlighted component. Sensitivity and direction are in Settings.
- **AWS architecture services** from the official July 2026 icon package: 203 more components (230 in all) across 21 AWS categories, from Aurora, Bedrock and Step Functions to Ground Station and Braket, each with its official icon and category colour and searchable by full name and common abbreviation. AWS icons now ship as separate files at fixed paths, loaded only when shown, and SVG export reuses them instead of bundling its own copies, so the initial script is about 15 kB (gzip) smaller than before and the build has half as many files.
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
