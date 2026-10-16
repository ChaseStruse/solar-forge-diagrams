# Implementation progress

## Where to resume

**Continue M2–M5 native acceptance, performance and packaging.** M1 durable save/close/recovery workflows pass native checks. Manual editing, AWS catalog/templates, SVG export and usability features are implemented; their expanded native acceptance suite and performance correction are in progress. Packaging and Docker build files are present, with the first container checks passing. M2–M5 are not yet release-complete; M6 remains optional/deferred.

Use the current Rust 1.99.1 toolchain in `/tmp/solar-forge-cargo` and `/tmp/solar-forge-rustup`, plus ignored `.tools/package/bin/bun`. Do not use older executable measurements as current acceptance evidence. No user desktop configuration or Docker context was changed.

## Task-to-commit map

| Commit | Plan task | Delivered |
| --- | --- | --- |
| `f489981` | Plan baseline | Approved native desktop direction |
| `41ee697` | M0 scaffold / first vertical slice | Bun, strict TS, Vite, Three.js, Tauri; portable validated documents; initial fixtures, UI, native file commands |
| `50bfcb4` | M0 native verification / label efficiency | Bundled native assets, readable labels, shared atlases, native smoke runner, atomic writer tests |
| `57cc746` | M0 performance / Wayland integration | Instanced label draws, batched connector buffer, XDG portal dialogs with parent handles, nested fixtures, snapped-drag check, size-budget enforcement |
| `62b91fb` | M0 readability correction | Shallow camera angle, subtle depth, larger text and separated connection labels |
| `19925c0` | M1 persistence | Durable native handles/Save As, recovery, close protection; actual native interrupted-session recovery verified |
| `c336dee` | UI reference composition | Floating editor controls, Layers/properties, raised service tiles, spatial camera and projection tests |
| `ae63cff` | M1 history / usability | Bounded edit transactions, undo/redo controls, responsive control strip and fitted camera, batched tile details; frontend verified, native pending |
| Documentation checkpoint following `57cc746` | Handoff | Exact milestone mapping in the plan, final native measurements, remaining work and launch instructions |

The documentation checkpoint refers to prior implementation hashes to avoid self-referential commit IDs. All changes are local commits; nothing was pushed.

## Verified checks

- Frozen Bun install; `bun run verify` passes: Biome, strict TypeScript, 4 document tests / 12 assertions, production frontend build, compressed-JS size check.
- Native Cargo build (debug and optimized), Rust formatting, `cargo clippy --all-targets -- -D warnings`, and `cargo test --locked` pass. Both Rust tests exercise atomic file replacement and failed-replacement preservation.
- Actual native WebKitGTK rendering works with bundled assets and no development server.
- Both camera modes and PNG captures were visually inspected. Text is in the WebGL scene, including exports.
- Explicit native diagnostics verify a synthetic snapped drag ends as one completed gesture, zero idle render frames in a 500 ms sample, standard/stress fixtures, and a native writer/readback roundtrip.
- Actual desktop portal Save wrote a JSON document; Open reopened it and the app status was verified as `Diagram opened`; PNG Export wrote an image and status was `PNG exported`.
- Portal chooser floats at a usable 875×600. The earlier direct GTK chooser tiled too narrowly; setting its parent alone did not fix that, so the portal backend is deliberate.
- No desktop configuration was changed. Omarchy skill capture guidance was used for native visual checks.

## Latest preliminary optimized measurements

Source: `benchmarks/results/2026-10-15-release-nested-groups.json`, implementation `57cc746`. Optimized native shell with explicit diagnostics feature, production frontend, three nested group boundaries, total node counts including those boundaries. **Window: 900×918, DPR 1.** These are preliminary single-run measurements, not the plan's 1920×1080 release certification.

| Board | Load to scheduled frames | CPU render submission p95 | Camera update to frame p95 | GPU textures | Draw calls |
| --- | --- | --- | --- | --- | --- |
| 500 nodes / 750 edges | 151 ms | 4 ms | 19 ms | 9 | 511 |
| 2,000 nodes / 3,000 edges | 535 ms | 16 ms | 29 ms | 41 | 2,043 |

- Zero rendered frames during the 500 ms idle sample; 30-second CPU measurements remain open.
- `navigationToScriptMs`: 149 ms. This excludes process startup and is not a cold/warm launch measurement.
- Initial JS: **134,888 bytes gzip**; optimized executable with bundled assets and portal backend: **7,203,600 bytes**. Both pass initial size budgets. Native executable size excludes system GTK/WebKitGTK and portal services.
- Vite reports its raw >500 kB entry-chunk advisory (524.11 kB raw). The compressed startup budget passes; the advisory is not hidden.
- WebKitGTK 2.52.6, GTK 3.24.52; host inventory: Intel i9-11900H, 16 GB RAM, Intel UHD + NVIDIA RTX 3060 Mobile. WebGL reported `Apple GPU`/`Apple Inc.`; these appear privacy-masked. Active physical GPU/driver identity is unverified.
- Camera-update timing is scheduled JS-to-frame timing, not physical input latency or GPU completion time.

The older single-group result is retained separately. Do not compare runs as controlled experiments across different window sizes and fixture revisions. A per-label-texture experiment caused 8.5 s / 31 s loads; shared atlases and instanced batches removed that regression. Do not restore independent full-size label canvases or one draw per edge.

## Remaining acceptance and limits

- M1: native acceptance of implemented commands/history; autosave, recovery UI, durable file handles, migration policy and native unsaved-close protection. Current close behavior must not be described as data-loss-safe.
- M2: multi-select, resize, grouping tools, connection creation/reconnection/routing controls, clipboard, full shortcuts and context menus. Existing ordinary edits still reload portions of the scene; refine this when routing them through commands.
- M3: official AWS artwork, complete catalog, architecture metadata, templates, and production UI polish. Current tiles use text identifiers and five prototype services.
- M4: document-driven SVG, recent documents, quality controls and finished export behavior. Optional automatic layout remains unevaluated.
- M5: Arch packaging, file associations, Docker build/check workflow, clean install/upgrade verification. Current binaries are runnable build artifacts, not installable release packages.
- Outstanding native checks: manual pan, clipboard, fractional scaling, multiple monitors, real interruption/recovery workflows, repeated open/edit cycles, context-loss behavior, process-start-to-ready, 30-second process-tree CPU/RSS, and 1920×1080 reference measurements. PNG snapshots and a short idle frame count do not certify those checks.
- M6 free orbit/arbitrary 3D placement remains deferred.

## Run or continue locally

Runnable optimized binary (no Bun/Docker required to launch):

```sh
./src-tauri/target/release/solar-forge-diagrams
```

This session installed isolated tools because Bun and Rust were absent. Bun is in ignored `.tools/package/bin/bun`; Rust 1.99.1 is in temporary `/tmp/solar-forge-cargo` and `/tmp/solar-forge-rustup`. These are not application runtime requirements and the /tmp toolchain may disappear after reboot.

```sh
export PATH="$PWD/.tools/package/bin:/tmp/solar-forge-cargo/bin:$PATH"
export CARGO_HOME=/tmp/solar-forge-cargo
export RUSTUP_HOME=/tmp/solar-forge-rustup
bun run verify
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo build --manifest-path src-tauri/Cargo.toml --release --features diagnostics --locked
bun scripts/check-budgets.ts --native
./src-tauri/target/release/solar-forge-diagrams --smoke-test
```

Diagnostics run only in debug or explicitly diagnostic-enabled builds with `--smoke-test`, write under `/tmp/solar-forge-native-smoke/`, and exit on success. Standard builds omit the diagnostics feature. Normal launches do not benchmark or write smoke-test files.

Native dialog test outputs are `/tmp/solar-forge-dialog-smoke.sforge.json` and `/tmp/solar-forge-dialog-smoke.png`. AT-SPI accessibility actions completed the chooser tests; injected key sequences proved unreliable. Portal chooser controls are named `Save` for writing and `Select` for opening.

## Readability correction after M0

User feedback: the default angle was exaggerated and the diagram unreadable. The default camera now tilts approximately 15 degrees from top-down with minimal diagonal skew. Tile/platform thickness and group elevation are reduced; labels are slightly larger with lighter outlines. Connection labels receive a consistent screen-space upward offset and dark backing so they do not overlap service names.

Validated with `bun run verify`, native build, and the native smoke runner; both view captures were inspected. Snapped dragging and idle invalidation still pass. The final debug-shell run at 900×918 measured 123 ms standard-board load, 5 ms render submission p95, 17 ms scheduled camera-update p95; 10 atlas textures and 512 draw calls. These are preliminary debug measurements; earlier release results remain historical. Compressed JS is 135,030 bytes. The optimized native binary is rebuilt for this correction. Existing running windows require reopening to load bundled asset changes; they are not forcibly closed.

Resume remains M1. This readability correction does not change the document format or complete later milestones.

## Reference-style redesign in progress

The live Sketchlab page was finally rendered and visually inspected at 1440×1000 (two raised tiles, captions below, floating rail, right Layers panel, luminous connector). The earlier sidebar dashboard and colored platforms were a poor match. The redesign uses that composition with original Solar Forge UI/code: full canvas, compact floating controls, Layers/selection properties, an on-demand AWS palette, dark raised tiles, subtle boundaries, warm glowing arrows, a static sky backdrop, and readable captions beneath nodes. Default startup is a two-service AWS starter; the serverless example is in the file menu.

A centered perspective camera replaces the previous rolled/near-flat orthographic spatial view; Plan remains orthographic. Projection tests enforce level rows and fit margins. Native snapped dragging and zero-idle-frame checks pass. Native whole-window capture was inspected at 1440×1000; no upstream source or assets were copied. Runtime JS dependencies remain unchanged. Generic service glyphs remain placeholders for official artwork in M3.

The first redesigned native benchmark at 900×918 passed the standard submission budget (10 ms p95) but used about 2,000 draw calls for tile outlines/insets/shadows. Batch those shared surfaces before completing this correction; stress performance is not yet acceptable. Narrow-window Layers behavior is also being checked. M1 remains the next full milestone.

## 2026-10-16 — history and usability continuation

User feedback makes UI usability a core acceptance requirement throughout implementation. Consolidated zoom/history/view controls into a responsive bottom strip so controls cannot collide at the tested desktop and tiled widths. Layers scroll independently of properties; the service picker has an empty-search message and bounded height. Replaced the misleading “Stored locally” marker with explicit unchanged/unsaved state. Fitted boards refit on resize; manually panned/zoomed cameras retain their view. A narrow-window screenshot caught and corrected offscreen tiles after resizing.

M1 first slice: domain-owned move/rename/insert/delete commands, up to 100 retained actions and an 8 MB serialized-payload estimate (not measured heap usage). Cascading deletion restores children, incident edges, and original ordering. Each drag records once on completion. Undoing moves updates the affected tile/connections without rebuilding the scene; renames and structural edits still reload scene content. Redo invalidates after a new edit; saved revision tokens prevent a completed asynchronous save from clearing later edits. Input fields retain native text undo. Added toolbar buttons and Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y.

Completed the pre-existing uncommitted renderer batching work: service insets and shadows use instancing; outlines share a buffer. These decorations require three draws across the board instead of per-tile draws. Extended diagnostics include pan timings. Native performance acceptance of this change remains open.

Validation:

- `PATH="$PWD/.tools/package/bin:$PATH" bun run verify`: lint, strict TS, 11 tests / 68 assertions, production build and compressed-JS budget pass. Initial JS is approximately 148 kB gzip, below the 350 KiB budget; Vite's raw chunk advisory remains.
- Headless Chromium through local ChromeDriver: add → rename → delete → undo → redo, return to unchanged state, snapped drag recorded once and undone, zero frames in a 500 ms idle sample. Screenshots inspected at 1440, 900, and 513 px widths, plus Plan PNG through the actual exporter. Browser checks used development assets; they do not certify native WebKitGTK.
- Batched draw counts: 521 on 500 nodes / 750 edges; 2,065 on 2,000 / 3,000. Software-rendered headless load samples were approximately 373 ms / 1,035 ms; these are not comparable to prior native hardware runs and do not establish performance-budget acceptance. Raw temporary report: `/tmp/solar-browser-render-results.json`.
- Native rebuild/smoke check not run: the temporary Cargo/Rust toolchain from the previous session no longer exists. No Rust source or native permissions changed. Do not treat the existing executable as containing this continuation.

Next: provision a native build toolchain, run native history/renderer acceptance, then implement durable file handles and unsaved-close protection, followed by recovery. UI polish, official AWS artwork, connection editing and complete M2 workflows remain open; this continuation does not establish a finished usable-editor milestone.

## M1 persistence continuation — in validation

Implemented native session file handles and Save As, serialized/debounced recovery writes (750 ms / maximum five seconds), startup recovery choice, save/discard/cancel replacement and native-close dialogs, XDG application-data storage, and a process-held recovery lock. New/open/save errors preserve the current document; recovery opens unsaved with no original-file overwrite handle. Atomic writes use unique temporary names. Added recovery ordering, failure/retry, and debounce/max-wait tests. Document format/migration and recovery guarantees are documented in `docs/DOCUMENTS.md`.

Validation so far: 14 Bun tests / 74 assertions; frontend verification passes (152,659 bytes gzip). Native Rust toolchain restored under `/tmp`; locked dependency fetch and initial atomic-write tests pass. Native rebuild, close/recovery workflow and persistence acceptance are in progress. M1 is not marked complete until those pass.

M1 native validation (2026-10-16): Cargo fmt/clippy/build pass. Real WebKitGTK smoke passes snapped drag, native roundtrip, both view captures, and zero idle frames. Native AT-SPI exercised close → Cancel, Save through the actual portal into `/tmp/solar-forge-native-m1.sforge.json`, edit → Save again without a chooser (durable handle), and recovery after SIGKILL of only the isolated test process. The saved file retained two nodes while the recovery snapshot retained three; restart displayed the recovery dialog and restored three nodes. Testing used `XDG_DATA_HOME=/tmp/solar-forge-native-data`, preserving personal app data. M1 functional gate is passed for these workflows; corrupt-disk/power-loss simulation beyond atomic replacement tests and broader hardware acceptance remain release checks.

## M2–M4 implementation checkpoint — native acceptance in progress

Implemented manual multi-selection (Shift-click / Ctrl+A), grouped snapped movement and nudge keys, drag and numeric resize, nested group/ungroup and parent changes with world-coordinate preservation, duplicate/delete, native clipboard event handling, right-click actions, connection creation by clicks or dragging a named port, endpoint/port reconnection, labels, orthogonal route/bend controls, and diagram renaming. Added ordinary flowchart process/decision/terminal shapes and New from an empty board. Insertion finds free slots instead of stacking components. Graph transactions retain affected records and preserve prior command references through undo/redo.

Curated catalog now contains 14 AWS services with stable IDs, search aliases/categories, original official July 2026 artwork, five boundary kinds, architecture metadata, and five templates (including the four planned AWS examples). Source hashes/usage provenance are in `assets/aws/`. Added Ctrl+K command search, document-driven self-contained light SVG export, native SVG writer, recent files, quality settings, and file-manager open queuing through the pinned official single-instance plugin. AWS artwork remains unchanged and offline. Optional automatic layout remains deferred: manual editing is the priority and an unvalidated global layout would violate position/history guarantees.

Validation: 20 Bun tests / 130 assertions, strict TS, lint, production build and initial bundle budget pass (approximately 182 kB gzip). Browser workflow passes New → insert flowchart shapes → Shift-select → group/ungroup → undo/redo → resize → duplicate, plus actual canvas connection and drag tests. Plan/2.5D PNG and wide/narrow screenshots have been inspected. Extended native diagnostics now cover graph/clipboard roundtrips, resize, multi-drag, named ports, repeated texture lifecycle and context-loss recovery; native rerun is pending. The first optimized run before tile-body batching missed scheduled-input timing targets, so performance is not accepted yet.

Performance correction in progress: batched tile bodies into at most five draws, retaining invisible picking geometry; shared fallback icon atlas regions. Browser draw counts fell from 530 to 23 on the standard board and from 2,102 to 67 on stress. Headless timings under concurrent builds are not certification. M2 is still open until native workflow and standard-board acceptance pass.

M5 scaffolding: Arch package recipe, desktop/MIME/icon assets, pinned-digest glibc Docker builders, Compose artifact tasks, source archive and dependency-notice collection. The first Docker check image builds successfully and passes frontend + Rust tests. Clean native package/install/uninstall and container artifact export checks remain in progress. No source or binaries have been published.

Packaging/container update: pinned Docker native artifact export succeeds (7,968,176-byte container-built executable), Compose config validates, and artifact ownership matches the invoking user. The dependency-license collector succeeds for all 307 normal-target Rust packages plus Three.js, including upstream/canonical texts missing from four crate archives. SVG exports for all five templates validate as self-contained XML; rendered three-tier and flowchart output has been visually inspected, including icon/label presence and escaping.
