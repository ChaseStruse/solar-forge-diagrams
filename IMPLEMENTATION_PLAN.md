# Solar Forge Diagrams — agent implementation plan

Status: alpha complete for M1–M5; M6 deferred. See [project status](docs/STATUS.md) for current results and next steps, and the [development log](docs/DEVELOPMENT_LOG.md) for the task-to-commit history.

## 1. Product objective and priorities

Build a native, offline-first desktop diagram editor focused on flowcharts and AWS architecture. Give it Solar Forge styling and a 2.5D isometric presentation, with an architecture that can support optional 3D exploration later.

Priority order:

1. Responsive, dependable desktop editing on Omarchy / Arch Linux / Hyprland.
2. Correct documents, reliable recovery, and intuitive diagram interactions.
3. Small packages, low idle resource consumption, and efficient rendering.
4. AWS architecture tools and distinctive Solar Forge presentation.
5. Optional 3D exploration after the editor is stable.

The latest user decision is authoritative: **the application runs natively**. Docker Desktop is optional development/build infrastructure, not the application runtime. Do not require Docker, a local server, an account, or a network connection to launch the installed application. A browser edition is not a first-release deliverable.

## 2. Technology decisions

| Responsibility | Decision |
| --- | --- |
| Application language | TypeScript with strict checking |
| Package manager and unit tests | Bun; commit its lockfile |
| Frontend build | Vite |
| Rendering | Three.js, initially using WebGLRenderer |
| Menus, toolbars, inspector, text inputs | Semantic HTML, CSS, and TypeScript |
| Desktop shell | Tauri 2 with a small Rust integration layer |
| Document storage | Versioned application-owned JSON and native filesystem operations |
| UI state | Small typed stores; add Nanostores only if it simplifies actual code |
| Automatic layout | Implemented after alpha: deterministic nested layered packing; see docs/USER_GUIDE.md |
| Integration testing | Browser automation for portable UI logic plus real Tauri/Linux smoke tests |

Do not introduce React, Next.js, React Three Fiber, Electron, a server framework, an ORM, or a database without a demonstrated requirement and an explicit architecture decision. Bun is development tooling, not a required installed-app runtime. Use compatible, pinned toolchain versions and frozen lockfile installs.

Three.js is the only scene renderer. Do not maintain parallel PixiJS and Three.js implementations. Use its modules directly; avoid broad utility frameworks and speculative plugin systems.

## 3. Native deployment and Docker scope

### Native application

- Bundle the frontend with Tauri; production must not depend on a Vite dev server.
- Target Omarchy on Arch Linux first. Validate WebKitGTK/WebGL behavior on the real target machine early.
- Provide a desktop launcher, application icon, stable application/window identity, and diagram file association.
- Provide an Arch package recipe as the primary initial packaging route. Evaluate AppImage only after native packaging works.
- Respect XDG locations for settings, application data, recovery, and caches. Keep user-selected documents in their chosen locations.
- Test Wayland, fractional scaling, multiple monitors, clipboard, file dialogs, keyboard input, and reopening files from the file manager.
- Do not change the user's Hyprland configuration or bind global shortcuts automatically. Optional Omarchy integration must be documented and opt-in.

### Reproducible development and builds

- Provide a multi-stage Dockerfile and Compose tasks for dependency installation, checks, frontend builds, and Linux desktop build artifacts.
- Pin the Linux builder base and toolchains; cache Bun downloads and Cargo dependencies/build outputs.
- Use a glibc-based builder compatible with the intended Linux packaging route. Do not assume Alpine/musl is suitable for WebKitGTK/Tauri packaging.
- Keep compiler tools and caches out of release artifacts. Write exported artifacts with usable host ownership.
- Document Docker Desktop and native Docker Engine usage without changing the user's active Docker context automatically.
- Container checks do not substitute for native GUI/GPU testing. Record any checks requiring the host display explicitly.
- The user may also develop natively; Docker must not be a mandatory application dependency.

## 4. Architecture and ownership boundaries

Start with a single application repository and clear modules, not a large package workspace:

```text
src/
  domain/          document types, validation, commands, history, migrations
  editor/          selection, tools, snapping, ports, interaction state machine
  renderer/        Three.js scene, cameras, picking, labels, resource ownership
  ui/              DOM components, dialogs, panels, shortcuts, theme
  catalog/         AWS service definitions and asset lookup
  persistence/     desktop adapter, autosave scheduling, recovery coordination
  export/          PNG rendering and document-driven SVG export
  platform/        typed boundary around native APIs
src-tauri/         narrow Rust commands, native configuration, packaging
assets/            curated local icons and fonts
tests/             fixtures and cross-module workflow tests
benchmarks/        deterministic boards, interaction scripts, reports
docs/              architecture decisions and operating instructions
```

- The domain model must not import Three.js, DOM, or Tauri APIs.
- The document is authoritative; scene objects are derived views, never the saved format.
- Route edits through typed commands. Each user gesture, including an entire drag, is one undoable transaction.
- Keep transient selection, hover, tool state, and camera animation separate from document content.
- Update affected nodes and incident connections; do not rebuild the entire scene for every change.
- Keep filesystem I/O behind a typed platform adapter. Do not send pointer updates through Rust IPC.
- Avoid per-frame object allocation, whole-document cloning, and repeated serialization.

## 5. Document model and persistence

Use a versioned `.sforge.json` document with stable IDs, nodes, edges, group relationships, styles, metadata, and optional saved view settings.

- Nodes include their kind, label, geometry, local position, optional elevation, parent group, and service metadata.
- Define coordinate axes and parent transforms once. Keep ordinary editing constrained to a plane; elevation is explicit.
- Edges reference node/port IDs and retain labels and routing controls independently of rendered meshes.
- Groups support nested account, region, VPC, availability-zone, and subnet boundaries. Prevent parent cycles and dangling references.
- Store catalog IDs rather than repeated icon contents. Define an asset strategy before allowing imported images; do not silently embed unlimited base64 data.
- Validate files at the boundary, enforce reasonable size limits, migrate supported older versions, and reject unsupported future versions without overwriting them.
- Use deterministic serialization suitable for diffs. Never serialize Three.js instances.
- Save through temporary files and atomic replacement where supported. Keep recovery snapshots and report failures visibly.
- Debounce autosave with a maximum wait; flush on safe lifecycle boundaries. An interrupted save must not destroy the last valid document.
- Bound history by memory usage and action count. Test redo invalidation, grouped actions, and deletion/restoration of connected objects.

## 6. Scene and interaction design

### First-release views

- Top-down orthographic editing for precision and dense diagrams.
- A shallow tilted orthographic view as the distinctive Solar Forge presentation: approximately 15 degrees from top-down, minimal diagonal skew, and subtle tile depth. Readability takes priority over dramatic isometric angles.
- Both views operate on the same graph. Switching views must not mutate document coordinates.
- Defer unrestricted orbit and arbitrary 3D placement until the core editor passes acceptance tests.

### Scene appearance

- Shallow raised service tiles with official AWS icons.
- Nested platforms for boundaries, restrained depth, charcoal surfaces, amber highlights, and copper accents.
- Readable labels with predictable scaling and deliberate overlap handling.
- Modest lighting; avoid real-time shadows, bloom, transparency stacks, and other expensive effects by default.
- An export theme with high contrast and a light background.
- Treat the proposed colors as initial tokens, not an existing brand specification.

### Required interactions

- Pan, zoom around the pointer, fit view, reset view, and grid snapping.
- Add, select, multi-select, move, resize, duplicate, delete, and group nodes.
- Drag on a defined plane using ray picking; no accidental depth movement.
- Connect named ports, reconnect endpoints, edit labels, and adjust routing.
- Begin with predictable orthogonal/polyline routing. Obstacle avoidance is a separate milestone, not an assumed Three.js feature.
- Clipboard, undo/redo, context menu, `/` component search, and `Ctrl+K` commands.
- Native DOM inputs for text editing, correct focus handling, keyboard navigation, and accessible inspector controls.
- Render labels in a way compatible with exports. If using DOM overlays, explicitly composite them or render equivalent labels during PNG export; a WebGL screenshot alone is insufficient.

## 7. Performance contract

Speed is a core requirement. “Lightning fast” must be demonstrated with measurements, not assertions. These are initial engineering budgets, not claims about the unbuilt product. Record hardware and tune only with evidence; never quietly weaken a target to pass a milestone.

Baseline: release build on the user's Omarchy hardware at 1920×1080, 60 Hz, with animations disabled. Record CPU, GPU, RAM, driver, WebKitGTK version, scale factor, and build hash. Also test the actual high-DPI setup separately.

| Metric | Initial target |
| --- | --- |
| Standard benchmark | 500 nodes, 750 edges, nested groups and visible labels |
| Stress benchmark | 2,000 nodes, 3,000 edges; report results and degraded behavior |
| Pan/drag frame time on standard board | p95 ≤ 16.7 ms |
| Input event to next rendered update | p95 ≤ 33 ms; distinguish this from physical input-to-photon latency |
| Warm launch to editable board | ≤ 1 second |
| Cold launch to editable board | ≤ 2 seconds, excluding OS login and installer work |
| Open standard benchmark document | ≤ 500 ms after file selection |
| Idle | No continuous render loop; target < 1% normalized CPU over 30 seconds |
| Frontend initial JS | ≤ 350 KiB gzip; lazy-load optional features and catalog assets |
| App-owned installed assets/binary | Target ≤ 30 MiB excluding system WebKitGTK/GTK; report all dependencies separately |
| Standard-board process-tree memory | Target ≤ 250 MiB RSS; document shared-memory accounting and GPU memory separately |

Implementation rules:

- Render on invalidation; coalesce changes into one requestAnimationFrame. Animate only while something is moving.
- Reuse geometry/materials, dispose owned GPU resources, and use instancing where measurements justify it.
- Keep hover/selection effects local. Use spatial indexing or candidate filtering when picking becomes expensive.
- Cap device pixel ratio through a quality setting; keep text legible. Do not assume unlimited GPU fill rate.
- Lazy-load service assets, exporters, layout engines, and optional 3D features.
- Move expensive layout/validation work to workers when profiling identifies main-thread stalls. Avoid excessive worker message copying.
- Route affected connections during dragging; postpone expensive global layout until explicitly requested.
- Monitor frame time, long tasks, startup, memory, bundle size, and GPU resource counts. Measure before optimizing.
- Include repeated open/close/edit cycles to detect leaks. Test GPU context loss and graceful recovery.
- Report a >10% regression on stable benchmark infrastructure and investigate before merging; use repeated runs to distinguish noise.
- Do not claim zero latency, universal hardware performance, or 3D acceleration based solely on browser tests.

## 8. Small packages and TypeScript practices

- Prefer platform APIs and a small well-tested function over a broad dependency for trivial work.
- Every new runtime dependency needs a stated purpose, license review, maintenance check, bundle impact, and considered alternative in the change description.
- Use named/module imports, tree shaking, code splitting, deduplicated assets, and compressed release output. Inspect actual output rather than assuming tree shaking worked.
- No remote fonts, CDNs, runtime downloads, or telemetry in the first release.
- Enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noEmit` for type checking where appropriate.
- Use `unknown` plus validation at file, IPC, and external-data boundaries. Avoid `any`, unchecked casts, and non-null assertions.
- Prefer discriminated unions for tools, commands, and node variants; use exhaustive handling.
- Use `import type`, explicit module-boundary types, small cohesive functions, and clear resource ownership.
- Avoid enums or abstractions where simple literal unions/functions suffice. Do not create generic frameworks for hypothetical needs.
- Handle async failures, cancellation, stale worker results, and event-listener cleanup deliberately.
- Enforce formatting and linting with one small, consistent toolchain. Choose tools based on required rules, not overlapping defaults.
- Rust commands must have narrow permissions and typed inputs; avoid broad shell execution and unnecessary filesystem access.

## 9. AWS catalog and scope

- Bundle a curated initial catalog: EC2, Lambda, ECS/EKS, S3, RDS, DynamoDB, API Gateway, CloudFront, Route 53, SQS, SNS, EventBridge, and load balancers.
- Use official AWS icon assets, retain required notices, record source/version, and verify applicable usage terms before distribution.
- Search by service name, abbreviation, category, and aliases.
- Support optional region, environment, resource name, tags, and notes; no AWS credentials are required.
- Add templates for a serverless API, three-tier application, event pipeline, and container service.
- Validate document structure without pretending to validate deployment correctness.
- Defer live AWS discovery, deployment, collaboration, accounts, AI generation, and cloud synchronization. Offline infrastructure import was subsequently authorized and implemented; see docs/decisions/0004-infrastructure-import.md.

## 10. Milestones and exit criteria

Work sequentially through decision gates. Each milestone must leave a runnable application and a short validation report.

### Execution checkpoints (2026-10-15)

| Milestone | Implementation commits | Handoff state |
| --- | --- | --- |
| M0 | `41ee697`, `50bfcb4`, `57cc746`; readability correction `62b91fb` | Native functional gate passed: bundled WebGL scene, camera modes, snapped drag, native Save/Open/PNG, fixtures and initial measurements. Broader release performance/scaling acceptance remains tracked in progress notes. |
| M1 | Schema/validation foundation in `41ee697`; full milestone pending | **Resume here:** typed commands/history first, then autosave/recovery, durable file handles, close protection, and migration policy. |
| M2–M5 | No completion commits yet | Planned; initial palette/inspector/export prototypes do not establish milestone completion. |
| M6 | None | Optional and deferred until M5. |

Read [docs/STATUS.md](docs/STATUS.md) and [docs/DEVELOPMENT_LOG.md](docs/DEVELOPMENT_LOG.md) for exact validation, measured limits, local tooling, and next steps. Each subsequent implementation change must add a dated entry to the development log and keep the status page current.

### M0 — Native feasibility and measurements

- Scaffold Bun, strict TypeScript, Vite, Three.js, and Tauri with minimal dependencies.
- Run a native window on Omarchy with sample service tiles, nested platforms, connectors, and readable labels.
- Implement top-down/isometric switching, plane-constrained dragging, native open/save smoke tests, and a labeled PNG prototype.
- Establish deterministic standard/stress benchmark fixtures and initial performance/size reports.
- Exit: real native WebGL operation verified; major compatibility problems documented and resolved before expanding scope. Do not silently substitute Electron or a browser application if Tauri fails.

### M1 — Domain and durable documents

- Implement schema validation, command/history model, graph invariants, migration fixtures, native persistence, autosave, and recovery.
- Exit: save/reopen round trips; interrupted writes retain valid data; malformed documents fail safely; undo/redo restores graph relationships.

### M2 — Usable editor

- Implement the required selection, movement, resize, grouping, snapping, connection, text, clipboard, and shortcut workflows.
- Exit: create a complete flowchart from an empty board, revise it, save, close, and reopen without lost content or broken connections. Meet standard-board interaction budgets.

### M3 — AWS and Solar Forge

- Add the catalog, nested architecture boundaries, metadata inspector, templates, theme tokens, and keyboard-accessible command/component palettes.
- Exit: construct and move a nested AWS architecture while preserving ports, edges, and parent coordinates. All assets work offline.

### M4 — Exports and usability

- Finish labeled PNG export and clean top-down SVG export from the document model. Do not promise SVG parity with shaded 3D output.
- Add recent documents, unsaved-change prompts, recovery UI, quality settings, and useful errors.
- Evaluate optional automatic layout in a worker; preserve user positions unless explicitly invoked and make it undoable.
- Exit: exported icons/fonts/labels are correct; files remain portable; keyboard workflows and scaling pass native checks.

### M5 — Packaging and release

- Deliver Arch packaging, launcher/file associations, Docker build/check workflow, and install/development/recovery documentation.
- Verify clean native install, offline launch, upgrades with document migration, and uninstall behavior that preserves user documents.
- Publish the measured performance and package-size report alongside known limitations.
- Exit: all release checks pass on Omarchy; no Docker runtime or browser server is needed to use the app.

### M6 — Optional 3D exploration

- Only after M5: investigate orbit controls, explicit elevation/layers, camera bookmarks, and presentation animation.
- Require evidence that 3D improves comprehension. Preserve top-down editing and existing documents.
- Arbitrary 3D connector routing, occlusion, and placement are new interaction work, not a camera-toggle-only feature.

## 11. Agent execution and frequent commits

- Read this plan and applicable repository instructions before making changes. Inspect the working tree and preserve unrelated user work.
- Implement the smallest useful vertical slice; avoid large speculative rewrites.
- **Commit frequently:** make a focused commit after each coherent, validated change, usually several per milestone. Do not wait until an entire milestone or long session is complete.
- Example sequence: scaffold → document model → command history → native save adapter → recovery tests. Each is independently reviewable.
- Run relevant checks before committing. Keep normal commits buildable; clearly identify an exceptional unfinished checkpoint if one is necessary.
- Use descriptive conventional messages such as `feat(editor): add plane-constrained dragging` or `perf(renderer): update only incident edges`.
- Stage specific files, inspect the staged diff, and never commit secrets, unrelated changes, generated build output, or dependency caches.
- Do not amend others' commits, reset unrelated work, force push, or push/publish without authorization. Local frequent commits are expected.
- Keep `docs/STATUS.md` concise and current, and append dated entries to `docs/DEVELOPMENT_LOG.md` with completed milestone items, validation commands/results, benchmark changes, next action, and blockers. Do not mark unverified work complete.
- Record consequential deviations in `docs/decisions/` with motivation, alternatives, and performance implications.
- Do not spawn parallel agents unless separately authorized by the user or applicable instructions. If parallel work is authorized, assign clear ownership and coordinate changes to shared model files.

## 12. Validation and definition of done

Required checks, scaled to the affected code:

- Strict TypeScript checking, formatting/lint checks, relevant Bun unit tests, production frontend build.
- Rust formatting, linting, tests where meaningful, and native build for native changes.
- Meaningful domain tests: graph invariants, history transactions, migrations, serialization, and failed-save recovery.
- Workflow tests: create/connect/group/edit/undo/save/reopen/export. Browser tests cover portable behavior; actual Tauri runs cover native APIs and WebKitGTK.
- Visual checks at both camera angles and multiple scale factors, including selection, connection labels, clipping, and exports.
- Performance/size checks when touching rendering, assets, dependencies, serialization, or startup.
- Docker build/check verification when changing the toolchain or packaging.

A feature is done only when it works in the native app, preserves documents/history, has relevant validation, fits the performance budget or has an explicitly recorded unresolved exception, updates necessary documentation, and is committed. A benchmark target missed at release remains an open issue; do not label the product performance-complete.

## 13. Reference material

- [Three.js documentation](https://threejs.org/docs/)
- [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri webview versions](https://v2.tauri.app/reference/webview-versions/)
- [Tauri Arch packaging](https://v2.tauri.app/distribute/aur/)
- [AWS architecture icons](https://aws.amazon.com/architecture/icons/)
- [Sketchlab reference repository](https://github.com/webdevcody/sketchlab.app)
- [Docker Desktop Linux environment](https://docs.docker.com/desktop/setup/install/linux/)

Use Sketchlab for interaction inspiration. Verify licensing before copying any source or assets. Its implementation is not a required dependency.

## Alpha acceptance update — 2026-10-16

The user approved treating the measured native memory and scheduled-input latency misses as documented limitations for the first alpha. Preserve the original section 7 targets and raw measurements; do not report the misses as passes or as production performance certification. M1–M5 can close for the alpha once implementation and remaining package/workflow checks pass. M6 remains optional and deferred. Exact 60 Hz/cold-start/high-DPI hardware release certification remains a follow-up rather than a claim about this alpha.
