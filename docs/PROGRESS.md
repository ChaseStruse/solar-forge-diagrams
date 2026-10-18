# Implementation progress

## Current alpha status

**M1–M5 alpha implementation is complete.** Implementation, native editing and final package checks passed. The user accepted measured memory and scheduled-input misses for the alpha; original targets remain unmet. M6 is optional/deferred. No source or binaries have been pushed or published. No desktop configuration or Docker context was changed.

## Current verification

- Frontend: lint, strict TypeScript, 20 tests / 130 assertions, production build, 182,245-byte gzip initial JS (358,400-byte budget).
- Rust: formatting, both atomic replacement tests, clippy with warnings denied, optimized native builds.
- Native: save/open/recovery/close guards, clipboard, grouping/history, resize/multi-drag/ports, repeated scene loads, context restoration, portal PNG/SVG exports, and visual checks in both views.
- Optimized native 1920×1080 DPR 1: standard board 170 ms load, 23 draws, 5 ms pan submission p95 / 49 ms scheduled update p95; stress 639 ms, 67 draws, 12 ms / 93 ms. Zero idle frames in 500 ms; real 30-second idle CPU 0.90% normalized.
- Resource sample: 603.11 MiB summed RSS / 350.15 MiB PSS. Memory and scheduled input exceed original targets and are explicitly accepted alpha limits. Configured display is 120 Hz; exact 60 Hz, cold-cache and physical fractional-DPI certification remain follow-ups.

## Omarchy distribution follow-up — 2026-10-16

The user requested Omarchy-specific delivery. Moved the canonical recipe to `packaging/omarchy/pkgbuilds/solar-forge-diagrams/` and added official-style `.omarchy/package.json` local/manual-update metadata. Added an Omarchy/x86_64 installer with package-identity and checksum checks, a bundle builder, and Omarchy launcher/upgrade/removal instructions. The installer uses a normal local pacman transaction because the installed `omarchy pkg add` implementation accepts repository names through `pacman -S`, not local paths. Omarchy's upstream packaging guide explicitly uses PKGBUILD plus metadata and `pacman -U` for local testing. There is no distinct Omarchy binary package format to convert to.

The existing validated 0.1.0-2 application package is reused unchanged inside the Omarchy bundle; no runtime code or package contents changed. The official-repository submission path is documented separately and has not been executed. A public source release and owner-selected license remain prerequisites. Bundle validation passes on installed Omarchy 4.0.4 x86_64: extraction, all checksums, package identity, `install.sh --check`, shell syntax, rejection of altered documentation/checksums, and rejection of invalid arguments. The application package hash matches the previously validated artifact. Delivered `artifacts/omarchy/solar-forge-diagrams-0.1.0-2-omarchy-x86_64.tar.gz`; raw result/checksum is in `benchmarks/results/2026-10-16-omarchy-bundle.json`. No system install or desktop changes were performed. Runtime code was unchanged, so the existing native acceptance applies.

## Historical checkpoints

The entries below retain the original measurements and open tasks at each checkpoint. They are historical; the current status above and final acceptance entry supersede their old pending-work lists.

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
| `63aa4b4` | M2–M4 editing/catalog/exports | Complete graph workflows, official offline AWS assets/templates, command search and portable exports |
| `4579060` | M5 build/distribution | Arch package, desktop/MIME integration, pinned Docker checks/artifact builders and dependency notices |
| `c073e7f` | Native workflow acceptance | Stable service identity, asynchronous persistence and expanded native lifecycle diagnostics |
| `75fadd4` | Alpha performance/limits | Reused Layers DOM, opaque renderer, WebKit cache policy, final measurements and accepted alpha exceptions |
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

Expanded native diagnostics now pass: group/ungroup undo restores the exact graph; copied graph fragments roundtrip; resize and multi-selection drag each complete as one gesture; named-port drag connects endpoints; ten repeated scene loads keep texture count stable; real WebGL context loss/restoration succeeds. Post-batching debug-shell sample at 1253×1376: 201 ms standard load, 23 draw calls, 5 ms pan submission p95, but 40 ms scheduled pan update p95 remains above the 33 ms target. Reference-size optimized measurement is next; performance acceptance remains open. Implementation commits: `63aa4b4` (editing/catalog/exports), `4579060` (packaging/containers), `c073e7f` (native workflow fixes and asynchronous persistence).

Native export/clipboard/package acceptance: real Ctrl+C copied a valid selected diagram fragment into the Wayland clipboard; Ctrl+V added it and Ctrl+Z undid it. Real portal SVG and PNG exports succeeded; SVG contains three embedded official icons for the three-tier template, and the labeled native PNG has the actual 1253×1376 canvas dimensions. Launching with a document path loads it and adds a recent-document entry. Arch makepkg completes from a checksum-verified local archive; package is approximately 3 MB compressed / 10.13 MiB installed. Isolated pacman installation under `/tmp` succeeds with dependency duplication/scripts disabled; runtime uses installed host libraries. Desktop/MIME data is validated in that isolated root; GIO recognizes `.sforge.json` as the custom subtype. Generic `xdg-mime` uses libmagic on this host and reports JSON, so GIO/file-manager recognition is the relevant check. No system package/default app configuration was changed.

Resource acceptance remains open: isolated optimized 1920×1080 run on the configured 120 Hz display loads the standard board in 181 ms and submits pan frames at 6 ms p95 (23 draws), but scheduled update p95 is 55 ms; stress is 635 ms load / 14 ms pan submission / 97 ms scheduled update (67 draws). This does not pass the 33 ms scheduled-input target and is not the plan's 60 Hz baseline. A process-only DMA-BUF compatibility experiment did not improve the standard timing, so no workaround was shipped. Packaged standard-board measurement including real Layers DOM: 1.04 s process-to-opened-board (includes accessibility polling overhead), 1.53% normalized CPU over 30 s, 601.65 MiB summed RSS / 348.10 MiB PSS. Active render device is `/dev/dri/renderD129` on Intel i915. These misses are recorded, not reclassified as passing. Follow-up changes preserve Layers rows, use an opaque canvas and WebKit DocumentViewer cache policy; remeasurement is pending. See `docs/decisions/0003-native-memory.md`.

Current resource follow-up: Layers rows now survive selection/movement, keep keyboard focus, and render nested hierarchy. The WebKit context explicitly uses DocumentViewer caching (the official API recommends this for single-page applications), and the canvas is opaque. Native clippy/build pass with the pinned direct WebKit API binding already present in the dependency graph. These changes are undergoing final measurement; budgets remain unchanged. Fixed the Arch recipe to honor an externally provided Cargo target cache, ignored generated package trees in Biome, and strengthened the MIME subtype declaration.

After Layers/cache-policy tuning, a real native standard-board run measured 0.85 s process-to-opened-board (including accessibility polling), 0.90% normalized idle CPU over 30 s, 603.11 MiB summed RSS / 350.15 MiB PSS. Startup/idle improved in this sample; memory did not. Raw resource result is retained in `benchmarks/results/2026-10-16-resource-after-tuning.json`. The user has been asked whether memory/latency remain strict release blockers or are acceptable documented alpha limitations; until answered, the original thresholds remain in force and the plan is not marked complete.

## Alpha acceptance decision — 2026-10-16

The user explicitly accepted documented memory and scheduled-input limits for an alpha. The original engineering targets remain recorded; measurements above those targets are accepted alpha limitations, not passing performance results. Continue final package/artifact and upgrade/uninstall checks, then close the M1–M5 alpha implementation. M6 remains optional/deferred as specified by the plan. Full release certification (especially the exact 60 Hz baseline, cold-launch trials and physical high-DPI hardware) must not be implied by alpha acceptance.

Final source verification passes: 20 Bun tests / 130 assertions, lint, strict TypeScript, production build (182,245 bytes initial JS gzip), Rust fmt, both atomic-write tests, and clippy with warnings denied. Final alpha package rebuild and isolated upgrade/removal are next. Spatial-camera deviation is already recorded in `docs/decisions/0002-reference-editor.md`.

## Final alpha acceptance — 2026-10-16

M1 persistence/history, M2 manual editing, M3 offline AWS authoring, M4 exports/usability, and M5 packaging/documentation are complete for the accepted alpha scope. Optional automatic layout was evaluated and deferred to preserve predictable manual positions/history. M6 remains optional/deferred. The spatial-camera decision is recorded in ADR 0002.

Final package is `artifacts/arch/solar-forge-diagrams-0.1.0-2-x86_64.pkg.tar.zst`; normal native executable is `artifacts/native/solar-forge-diagrams` (8,103,136 bytes). Source archive and binaries were built from `75fadd4`; this final documentation checkpoint follows that source commit. Package is approximately 3 MiB compressed / 10.14 MiB installed including dependency notices. Source/package checksums and validation are recorded in `benchmarks/results/2026-10-16-alpha-package.json`.

Final source frontend verification, Rust tests, clippy and fmt pass. The checksum-verified Arch rebuild and pinned Docker native artifact export both pass. Isolated pacman upgrade 0.1.0-1 → 0.1.0-2, removal and reinstall preserve identical document and recovery hashes. Desktop validation and isolated MIME database generation pass. These checks use host runtime libraries with dependency duplication and package hooks disabled in `/tmp`; they do not claim a fresh-OS installation. The normal packaged executable launches with bundled assets, reopens existing version-1 documents and accepts second-instance file-manager arguments. No schema migration is needed because the format remains version 1; unsupported future versions are rejected by tested parsing.

Remaining work is production certification and optional exploration, not unfinished alpha implementation: original 250 MiB RSS / 33 ms scheduled-input targets are missed; exact 60 Hz, true cold-cache launch trials and physical fractional-DPI testing remain. See the raw reports and user guide. All delivery is local; no push, publication, system installation, global MIME defaults, compositor configuration or Docker context changes were made.

## Omarchy launcher installation — 2026-10-16

The user could not find Solar Forge in the launcher. Diagnosis: the package had only been built/tested in isolation; no host package, executable or desktop entry existed. Installed the validated local 0.1.0-2 package through authenticated pacman with normal dependency checks and system hooks. MIME, icon and desktop caches updated successfully. `pacman -Q` confirms installation; `desktop-file-validate` passes; GIO resolves `com.solarforge.diagrams.desktop` as a visible **Solar Forge Diagrams** entry with the correct executable. No keybindings were changed. This installation supersedes the earlier packaging checkpoint's statement that no host installation had been performed.

## Rectangle-selection correction — verified; host upgrade awaiting authentication

User reported that dragging to select moved the native window. Rectangle selection was missing; canvas presses also did not prevent native drag defaults. Implemented a visible screen-space rectangle in both views, reverse dragging, Shift-add, pointer capture/release/cancel handling, and explicit canvas pointer/mouse/native-drag prevention. Empty interiors of unselected boundaries can start selection; boundaries are selected by a rectangle only when fully enclosed, so selecting child services does not accidentally select their parent. Selection does not modify the document/history. Added projected nested-node tests and native gesture regressions. Set Bun's test root to `tests` so extracted package sources under ignored artifacts cannot duplicate stale tests. Browser trusted-pointer checks pass, along with 22 tests / 138 assertions. Native private-bus diagnostics now pass rectangle selection, snapped/multi-node drag, resize, port connection, history/clipboard roundtrips, context restoration and stable textures/zero idle frames. The native run caught and corrected a stale-parent lookup during graph replacement; existing real-editor grouping/undo checks pass again. Compositor-driven native mouse dragging now also passes: the rectangle is visible, both service tiles select on release, and the native window position/size stay fixed (captures inspected). Package 0.1.0-3 is next. The open user editor is preserved.

Rectangle-selection delivery: source committed as `eab4757`. Normal non-diagnostic Omarchy 0.1.0-3 package builds successfully from the checksum-verified source archive. Its build passes frontend verification (22 tests / 138 assertions, 183,135-byte initial JS gzip) and both native atomic-write tests. The updated Omarchy install bundle extracts and passes all checksums, package identity and `install.sh --check`. Bundle: `artifacts/omarchy/solar-forge-diagrams-0.1.0-3-omarchy-x86_64.tar.gz`. Package checksums and delivery status are recorded in `benchmarks/results/2026-10-16-marquee-package.json`.

Host upgrade was started with authenticated pacman and is waiting on the operating system's authentication prompt. At the last check the installed package remains 0.1.0-2; do not claim the fix is loaded in the running editor. After authentication completes, save and reopen the application to load 0.1.0-3. The current user session was deliberately left open throughout testing. Original alpha performance exceptions remain unchanged.

## Networking and journey update (2026-10-17)

- Fitting text and notes in both dimensions, proportional resize sizing, tile-width captions, and common 160 × 100 component defaults.
- Ten offline container, DevOps, and networking pictograms, plus two-zone VPC and networking journey templates.
- Persisted traffic parameters and editable per-connection rules with IPv4/CIDR validation, undo/redo, and visible denial feedback.
- Offline GIF89a journey recording, browser download/native atomic save, bounded frame count and dimensions, and cancellation.
- Validation: 39 Bun tests, lint, TypeScript, production build, bundle budget, and headless Chromium checks of templates and denial feedback. GIF decoding checked independently using FFmpeg. Native Rust compilation/save-dialog validation requires a machine with the Rust/Tauri toolchain.

## Networking review follow-up (2026-10-17)

- Confirmed both templates in Chromium; widened the VPC to reserve a left margin for the internet gateway, route table, and security group outside the AZ footprints. Geometry regression checks cover containment and AZ separation.
- Wrapped service captions in the canvas atlas and SVG export; assigned individual component colours to both catalog tiles and SVG artwork. Deny/Unrestricted disable ignored traffic fields.
- Replaced RGB332 with an image-adaptive median-cut palette and optional Floyd–Steinberg dithering; reused the palette/cache during worker encoding to keep colours stable and playback responsive.
- Added remembered 2–120 second recording settings, binary native IPC, and a 12-bit LZW EOF limit with independent decoder regression tests for a dictionary that fills at the final pixel.
- Validation: 48 tests, lint, TypeScript, production build, bundle budget; browser checks for templates, rules, longer recordings and cancellation; FFmpeg decoding of exported GIFs. Native Rust compilation and save-dialog checks remain unavailable without the Rust/Tauri toolchain.

## Infrastructure import and resource reachability (2026-10-17)

- `8cbe0d7`: deterministic layered layout, nested containment and spacing, editor command, and undo/redo.
- `a23ced0`: offline Terraform HCL/show JSON, CloudFormation YAML/JSON, and Compose import; previews, warnings, file selection, sample infrastructure, validated network policy schema, and evaluator foundation.
- `0f886cd`: resource policy/attachment editor, paged reachability matrix, decision details, virtual gateway journey paths, dependency-edge separation, and reference-safe copying/deletion.
- Follow-up hardening: plan-reference recovery, conditional/partial data remains Unknown, missing ACL references cannot broaden access, static dependency rendering, and GIF export of matrix-selected journeys. Updated scope, dependency review and redistributable YAML notice.
- Verification: 70 tests plus lint, strict TypeScript, production build and bundle budget. Browser smoke checks exercise import, resource attachments, PostgreSQL allow/SSH deny, matrix tracing, policy edits and undo, Compose isolation, CloudFormation file selection and checked-path GIF export. Native compilation/dialog validation remains unavailable without Rust/Tauri tooling.

### 2026-10-17 — Saved scenarios, recorded walkthroughs, detail boards and interchange

Added per-board named traffic profiles with optional source/destination resources, reusable example profiles and a scenario picker in the reachability matrix. Resource walkthrough captions appear live and are composited into GIF/video frames. Scenarios, captions and detail links are validated and serialized in version-1 project documents.

Linked detail boards live in a flat embedded project library. Resources can create/open/reuse links; canvas double-click, Layers links, Back and project navigation open them. One history records edits across boards, while Save/Save As and recovery serialize the entire project. Infrastructure imports now replace the current board as an undoable graph transaction, preserving other detail boards.

Added offline MediaRecorder WebM/MP4 recording with runtime codec detection, configurable 2–120 second duration, up to 1280 × 720 / 30 fps, captions, cancellation and a 100 MB cap. Native video payloads use binary IPC. Added deterministic Mermaid and PlantUML exports for the active board and uncompressed multi-page draw.io project export with internal detail-page links. These architecture exports do not carry resource-policy simulation or saved scenarios; native JSON remains the complete project format.

Validation: `bun run verify` passes (79 tests, TypeScript, Biome, production build and bundle budget; initial JS 223,706 bytes gzip / 358,400). Local headless Chromium exercised profile save/apply, detail creation/navigation, cross-board undo/redo, project serialization, import-in-detail and undo, live captions, MP4/WebM recording and Esc cancellation. `ffprobe` independently identified VP9 WebM and H.264 MP4 output. The actual Mermaid 11.15 parser/renderer accepted all seven built-in templates. DOMParser accepted draw.io XML and all generated detail links resolved to exported page IDs. Live captions were visually inspected. Unit tests cover malformed project data, stable text exports/escaping, recording cleanup/duration and raw native video transfer. Native Rust compilation/dialogs and PlantUML rendering were not exercised in this environment; no Rust or Java runtime is installed. Existing installer bundles were not rebuilt.
