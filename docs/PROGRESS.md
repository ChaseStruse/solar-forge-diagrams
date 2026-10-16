# Implementation progress

## Current position

M0 functional native feasibility is demonstrated, including actual Save/Open/PNG dialogs. The final optimized portal-backend build and updated nested-fixture benchmark are being checked. M1–M6 are not implemented. Continue with M1 after this checkpoint; retain the outstanding acceptance checks below for M2/M5.

## Commit/task map

| Commit | Plan task | State |
| --- | --- | --- |
| `f489981` | Plan baseline | Approved native direction recorded |
| `41ee697` | M0 scaffold and first editor slice | Bun/strict TS/Vite/Three.js/Tauri, portable documents, benchmark fixtures, basic native file commands and initial UI |
| `50bfcb4` | M0 native validation and efficient labels | Bundled native assets, debug smoke runner, shared label atlases, readable labels, edge labels, native writer tests |

| Next implementation commit | M0 batched rendering and Wayland dialogs | Instanced text, one connector buffer, package-size checks, portal backend, nested fixtures, native snapped-drag check |

Hashes are added in the following documentation checkpoint to avoid self-referential commit hashes. Use the commit subject in git log if the final row still says “next”.

## Verified checks

- `bun run lint`, `bun run check`, `bun test`: pass (4 tests / 12 assertions).
- Production frontend build: pass; initial JS 525.92 kB raw / 134.75 kB gzip. Lazy diagnostics 1.25 kB raw / 0.73 kB gzip. The raw >500 kB Vite advisory remains visible.
- `cargo check --locked`, native `cargo build --locked`, Rust formatting, `cargo clippy -- -D warnings`: pass.
- `cargo test --locked`: 2 native atomic-writer tests pass (complete replacement and failed replacement preserving target).
- Actual native WebKitGTK window rendered both camera modes with bundled assets and no dev server. PNG captures were visually inspected.
- Explicit `--smoke-test` native command completed a document write/read roundtrip and exported labeled views under `/tmp/solar-forge-native-smoke/`.

## Preliminary native measurements (2026-10-15)

Debug native shell / production frontend, 1253×1376 window, DPR 1, WebKitGTK 2.52.6, GTK 3.24.52. CPU: Intel i9-11900H; 16 GB RAM; Intel UHD and NVIDIA RTX 3060 Mobile installed (active WebGL GPU not yet identified).

| Board | Load to scheduled frames | Render submission p95 | Camera change to frame p95 | GPU textures | Draw calls |
| --- | --- | --- | --- | --- | --- |
| 500 nodes / 750 edges | 237 ms | 22 ms | 25 ms | 9 | 2,501 |
| 2,000 nodes / 3,000 edges | 705 ms | 63 ms | 68 ms | 41 | 10,001 |

Idle: zero render frames over a 500 ms sample. `startupToScriptMs` was 210 ms from Web Performance timing, **not full process-start-to-editable latency**. These are single debug-shell runs, not the release acceptance benchmark or physical latency measurements. This pre-batching result missed the standard render-time budget; see the subsequent optimized run below.

A per-label-texture experiment regressed board loads to 8.5 s / 31 s. Shared atlases reduced these to 237 ms / 705 ms. Do not reintroduce independent full-size canvases per label.

## Next actions and remaining gates

1. Finalize the optimized portal build and current nested-fixture report; then start M1 commands/history, version migration policy, recovery/autosave, close protection, and durable document handles.
2. Remaining native acceptance: manual pan, clipboard, fractional scaling, multiple monitors, and interrupted-close behavior. A synthetic snapped drag passed in the real native WebView.
3. Measure process-start-to-ready, 30-second process-tree CPU/RSS, actual active GPU, and the 1920×1080 reference workload. Current timings use tiled windows.
4. Actual portal Save and PNG Export wrote temporary output files; Open returned the saved document and the app status was verified as `Diagram opened`. The portal chooser is floating at 875×600. No user desktop configuration was changed.

## Current limits

This is an M0 prototype: no history, autosave/recovery, multi-select, full connection editing, official AWS icons, SVG exporter, installable Arch package, or Docker build workflow yet. Save prompts for a destination every time. Basic palette/inspector work does not imply M2/M3 completion. Native close prompts still require explicit Tauri integration at M1.

## Local toolchain

Pinned Bun is in ignored `.tools/package/bin/bun`. Rust 1.99.1 is installed temporarily in `/tmp/solar-forge-cargo` and `/tmp/solar-forge-rustup`. For this session:

```sh
export PATH="$PWD/.tools/package/bin:/tmp/solar-forge-cargo/bin:$PATH"
export CARGO_HOME=/tmp/solar-forge-cargo
export RUSTUP_HOME=/tmp/solar-forge-rustup
bun run lint
bun run check
bun test
bun run build
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo build --manifest-path src-tauri/Cargo.toml --locked
src-tauri/target/debug/solar-forge-diagrams --smoke-test
```

Normal application usage does not require these temporary paths. A debug native binary is currently at `src-tauri/target/debug/solar-forge-diagrams`; it is not a release package.

## Optimized native follow-up

The pre-portal optimized shell (1046×918, DPR 1) recorded 139 ms standard load, 6 ms render submission p95, and 19 ms camera-update-to-frame p95. Stress results: 520 ms load / 20 ms submission p95 / 27 ms camera-update p95. Draw calls fell to 511 / 2,043; texture counts remained 9 / 41. Idle render count remained zero. This earlier benchmark had one group; the current fixture has three nested groups and must be measured separately.

The WebGL renderer string reported `Apple GPU` on Linux Intel/NVIDIA hardware; treat this as privacy-masked and do not claim an identified GPU. The earlier optimized native executable was 5,309,528 bytes; the portal backend adds native dependencies and requires a fresh size report. Initial JS is now 134,888 bytes gzip. `bun run check:size` enforces the compressed-JS budget; add `--native` when invoking its script to check the optimized executable.

Verified desktop outputs: `/tmp/solar-forge-dialog-smoke.sforge.json` and `/tmp/solar-forge-dialog-smoke.png`. Chooser buttons were activated with AT-SPI accessibility APIs after inspecting their actual names; the input-injection path was unreliable, so do not mistake its failed key presses for a failed file API.
