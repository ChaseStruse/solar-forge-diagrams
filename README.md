# Solar Forge Diagrams

Native, offline-first architecture diagramming with a Three.js isometric canvas and a small Tauri shell. Implementation follows [the plan](IMPLEMENTATION_PLAN.md); see [progress and commit mapping](docs/PROGRESS.md).

## Install on Omarchy

Download/extract the [Omarchy install bundle](artifacts/omarchy/solar-forge-diagrams-0.1.0-4-omarchy-x86_64.tar.gz), then run `./install.sh --check` and `./install.sh` in its directory. Launch **Solar Forge Diagrams** with `Super+Space`. The x86_64 bundle uses Omarchy's native package manager and includes desktop/file integration. See [installation and removal](packaging/omarchy/README.md).

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

M1–M5 are complete for the alpha: durable documents/recovery, manual editing and grouping, flowcharts, offline AWS catalog/templates, PNG/SVG exports, usability tools, Omarchy packaging and pinned Docker builds. Read the [user guide](docs/USER_GUIDE.md), [progress](docs/PROGRESS.md), and [build/package instructions](docs/BUILDING.md).

Accepted alpha limits: the native 500-node board measured approximately **603 MiB summed RSS / 350 MiB PSS** and **49 ms scheduled pan-update p95**. The original 250 MiB / 33 ms targets remain unmet. Exact 60 Hz, physical high-DPI and cold-cache release certification remain follow-ups. Optional M6 3D exploration is deferred.

The Linux file chooser uses XDG desktop portals. Omarchy must have its normal portal service and file-chooser backend available; the app does not edit desktop configuration.

```sh
bun run verify
cargo build --manifest-path src-tauri/Cargo.toml --release --locked
./src-tauri/target/release/solar-forge-diagrams
```

The installed native executable needs neither Bun nor Docker at runtime. To benchmark the optimized shell explicitly, compile with `--features diagnostics` and run it with `--smoke-test`.
