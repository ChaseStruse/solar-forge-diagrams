# Changelog

Notable changes to Solar Forge Diagrams. Versions follow [Semantic Versioning](https://semver.org/); the Omarchy package adds a `-N` package release for packaging-only rebuilds.

## [Unreleased]

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
