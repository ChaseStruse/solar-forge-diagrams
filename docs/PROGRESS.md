# Implementation progress

## Current position

M0 native feasibility is demonstrated; performance and manual desktop checks are still in progress. M1–M6 are not complete. Continue with draw-call reduction and the native checks below before expanding the editor toolset.

## Commit/task map

| Commit | Plan task | State |
| --- | --- | --- |
| `f489981` | Plan baseline | Approved native direction recorded |
| `41ee697` | M0 scaffold and first editor slice | Bun/strict TS/Vite/Three.js/Tauri, portable documents, benchmark fixtures, basic native file commands and initial UI |
| Next implementation commit | M0 native validation and efficient labels | Bundled native assets, debug smoke runner, shared label atlases, readable labels, edge labels, native writer tests |

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

Idle: zero render frames over a 500 ms sample. `startupToScriptMs` was 210 ms from Web Performance timing, **not full process-start-to-editable latency**. These are single debug-shell runs, not the release acceptance benchmark or physical latency measurements. Standard render-time budget is currently missed; reduce draw calls next.

A per-label-texture experiment regressed board loads to 8.5 s / 31 s. Shared atlases reduced these to 237 ms / 705 ms. Do not reintroduce independent full-size canvases per label.

## Next actions and remaining gates

1. Batch connectors and label draws; repeat the native benchmark and inspect PNGs.
2. Verify native Open/Save/Export dialogs, drag and pan interactions, close behavior, clipboard, fractional scaling, and multiple monitors. Automated writer checks are not dialog validation.
3. Capture release-mode startup, process-tree CPU/RSS, active GPU, and 1920×1080 reference results. Current measurements use the actual tiled window.
4. Once M0 gates are satisfied, implement M1 commands/history, version migration policy, recovery/autosave and durable document handles.

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
