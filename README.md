# Solar Forge Diagrams

Native, offline-first architecture diagramming with a Three.js isometric canvas and a small Tauri shell. Implementation follows [the plan](IMPLEMENTATION_PLAN.md); see [progress and commit mapping](docs/PROGRESS.md).

## Development

Install Bun 1.3.11 and a stable Rust toolchain, plus the Tauri Linux prerequisites (WebKitGTK 4.1 and GTK 3 development libraries).

```sh
bun install --frozen-lockfile
bun run check
bun test
bun run build
bun run desktop
```

`bun run dev` previews portable UI work in a browser. Native validation requires `bun run desktop`; browser checks cannot certify Tauri or GPU compatibility. Production uses bundled assets and needs no server or Docker runtime.

## Native smoke check

Build the frontend first, then compile the bundled-asset native application:

```sh
bun run build
cargo build --manifest-path src-tauri/Cargo.toml --locked
src-tauri/target/debug/solar-forge-diagrams --smoke-test
```

The opt-in smoke check (debug builds, or release builds compiled with `--features diagnostics`) opens a real native window, captures both camera views, checks idle render invalidation, loads the benchmark boards, and roundtrips a document through the native atomic writer. Results and PNGs go to `/tmp/solar-forge-native-smoke/`; the app exits on success. It does not certify physical input latency, native dialog interactions, release startup, or GPU execution time. Normal launches do not run diagnostics.

## Current checkpoint

M0 native feasibility and the M1 durable-document workflows are implemented. The editor supports undo/redo, Save/Save As with native session handles, debounced recovery snapshots, restart recovery, and save/discard/cancel close protection. M2 editing workflows are in progress; see `docs/PROGRESS.md` for current validation and remaining milestones. Document and recovery behavior is described in [docs/DOCUMENTS.md](docs/DOCUMENTS.md).

The Linux file chooser uses XDG desktop portals. Omarchy must have its normal portal service and file-chooser backend available; the app does not edit desktop configuration.

```sh
bun run verify
cargo build --manifest-path src-tauri/Cargo.toml --release --locked
./src-tauri/target/release/solar-forge-diagrams
```

The installed native executable needs neither Bun nor Docker at runtime. To benchmark the optimized shell explicitly, compile with `--features diagnostics` and run it with `--smoke-test`.
