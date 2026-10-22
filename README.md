# Solar Forge Diagrams

Native, offline architecture diagramming for Linux. Draw AWS, Kubernetes, container and flowchart diagrams on an isometric Three.js canvas, import existing infrastructure, check which traffic can actually flow, and export images, video or diagram source. No account, server or internet connection required.

> **Alpha.** x86_64 [Omarchy](https://omarchy.org) is the supported platform. See [project status](docs/STATUS.md) for known limits.

## Install on Omarchy

Download the latest bundle, **[solar-forge-diagrams-omarchy-x86_64.tar.gz](https://github.com/ChaseStruse/solar-forge-diagrams/releases/latest/download/solar-forge-diagrams-omarchy-x86_64.tar.gz)**. Older versions and checksums are on the [releases page](https://github.com/ChaseStruse/solar-forge-diagrams/releases). Then run:

```sh
tar -xzf solar-forge-diagrams-omarchy-x86_64.tar.gz
cd solar-forge-diagrams-*-omarchy-x86_64
./install.sh --check
./install.sh
```

The installer checks the bundle's checksums and package identity, then installs it with the normal `pacman` transaction. Launch **Solar Forge Diagrams** with `Super+Space`. Upgrade by running a newer bundle's installer; remove with `omarchy pkg drop solar-forge-diagrams`. Details are in [packaging/omarchy/README.md](packaging/omarchy/README.md).

## Features

- **Editing:** Plan and 2.5D views, multi-select, grouping, resize, connections, clipboard, undo/redo, text and sticky notes, themes.
- **Catalog:** official AWS and Kubernetes icons, container/DevOps/networking pictograms, flowchart shapes, and an example browser.
- **Import:** Terraform (`.tf` or `terraform show -json`), CloudFormation YAML/JSON and Docker Compose, parsed locally. No Terraform, Docker or network access is needed.
- **Network checks:** security groups, network ACLs and route tables feed a reachability matrix with explained Allowed / Denied / Unknown decisions.
- **Journeys:** animated traffic walkthroughs with saved scenarios, captions and branch choices.
- **Projects:** linked detail diagrams, atomic saves and crash recovery.
- **Export:** PNG, SVG, GIF, WebM/MP4, Mermaid, PlantUML and draw.io.

Try the files in [examples/infrastructure](examples/infrastructure) with **File menu → Import infrastructure…**.

## Documentation

- [User guide](docs/USER_GUIDE.md): everything the app can do
- [Documents and recovery](docs/DOCUMENTS.md): file format and recovery behavior
- [Building and packaging](docs/BUILDING.md) and [releasing](docs/RELEASING.md)
- [Project status](docs/STATUS.md), [changelog](CHANGELOG.md) and [development log](docs/DEVELOPMENT_LOG.md)
- [Implementation plan](IMPLEMENTATION_PLAN.md) and [design decisions](docs/decisions)

## Development

Install Bun 1.3.11 and a stable Rust toolchain, plus the Tauri Linux prerequisites (WebKitGTK 4.1 and GTK 3 development libraries).

```sh
bun install --frozen-lockfile
bun run verify      # lint, type check, tests, build, size budget
bun run desktop     # native development window
```

`bun run dev` previews UI work in a browser, where Save downloads a copy and Open uses the browser file picker, but only `bun run desktop` validates the native Tauri and GPU behavior. The installed app bundles its assets and needs no server, Bun or Docker at runtime.

### Native smoke check

```sh
bun run build
cargo build --manifest-path src-tauri/Cargo.toml --locked
src-tauri/target/debug/solar-forge-diagrams --smoke-test
```

The smoke check runs in debug builds, or in release builds compiled with `--features diagnostics`. It opens a real window, captures both camera views, checks idle rendering, loads the benchmark boards and round-trips a document through the native writer. Results go to `/tmp/solar-forge-native-smoke/`. It does not measure physical input latency, native dialogs, release startup or GPU time.

The Linux file chooser uses XDG desktop portals, so a portal file-chooser backend must be available. The app does not change desktop configuration.

## License

Solar Forge Diagrams is released under the [MIT License](LICENSE). Bundled AWS Architecture Icons and Kubernetes icons are covered by their own terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
