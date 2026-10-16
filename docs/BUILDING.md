# Build and package

The installed app is native and offline. Bun, Rust, Docker and development servers are build tools, not runtime requirements. The packaging target is x86_64 Omarchy (validated on 4.0.4), using its native pacman package format. AppImage and optional M6 3D exploration remain deferred by the plan.

## Native development

Use Bun 1.3.11 and Rust 1.99.1. Install Arch packages `webkit2gtk-4.1 gtk3 rust pkgconf` and your desktop's normal XDG portal/file chooser backend. Do not modify compositor configuration. Run `bun install --frozen-lockfile`, `bun run verify`, and `cargo test --manifest-path src-tauri/Cargo.toml --locked`, then build with `cargo build --manifest-path src-tauri/Cargo.toml --release --locked`. Run `src-tauri/target/release/solar-forge-diagrams`. `bun run desktop` starts a development window; installed builds embed the frontend.

Opt-in native diagnostics: build with `--features diagnostics`, then run `--smoke-test`. For isolated testing set `XDG_DATA_HOME=/tmp/solar-forge-test-data`. Never report browser or container tests as native GUI/GPU certification.

## Omarchy install bundle

The deliverable is `artifacts/omarchy/solar-forge-diagrams-0.1.0-2-omarchy-x86_64.tar.gz`. Extract it and run `./install.sh --check`, then `./install.sh` in a terminal. The installer verifies Omarchy, x86_64, checksums and package identity, then uses the normal `sudo pacman -U` transaction for the included local package. It does not bypass dependency checks or confirmation. No build tools are required to install it. Dependencies may be downloaded on first installation; running the app is offline.

Launch **Solar Forge Diagrams** using `Super+Space`. The package installs the native executable, desktop entry, icon and MIME definition for `.sforge.json`. Desktop database updates use normal package hooks. File-manager arguments reach the running app with unsaved-change protection. Choose Open With to associate documents; no global default or compositor configuration is forced.

Upgrade by running the next bundle's installer. Remove through Omarchy's package removal menu or `omarchy pkg drop solar-forge-diagrams`. Documents and XDG application data/recovery remain intact.

## Build the Omarchy package

The recipe lives at `packaging/omarchy/pkgbuilds/solar-forge-diagrams/`, including Omarchy's `.omarchy/package.json` metadata. The recipe remains a PKGBUILD because that is the format required by the [Omarchy Package Repository](https://github.com/omacom/omarchy-pkgs#contribute-a-package).

After a reviewed commit, run `scripts/source-archive.sh`. Copy `artifacts/solar-forge-diagrams-0.1.0.tar.gz` beside the recipe. Replace `SKIP` with the printed SHA-256 (or run `updpkgsums`). Run `makepkg --cleanbuild` from that directory after installing its build dependencies. Then create the install bundle:

```sh
scripts/omarchy-bundle.sh /path/to/solar-forge-diagrams-0.1.0-2-x86_64.pkg.tar.zst
```

The bundle includes the verified package, installer, checksums and user/build/recovery guides. Recipe metadata uses local sources and disables automatic upstream sync because the alpha has no published release feed. This local unsigned delivery is not an official Omarchy repository listing. Repository submission needs a published source archive/checksum and a public source license selected by the owner. Once accepted and published, `omarchy pkg add solar-forge-diagrams` becomes the by-name install path. That command currently uses repository package names, so it cannot install this unpublished local archive.

## Docker development and artifacts

The Dockerfile pins Bun 1.3.11 and Rust 1.99.1 image digests and a fixed Debian package snapshot. Rust, Cargo and Bun downloads use build cache mounts; compiler caches stay outside exported artifacts. Builder glibc is compatible with newer Arch hosts. Container builds do not require or share the host display.

Use your existing Docker Engine or Docker Desktop context; inspect it with `docker context show`. This project never changes it. Run `docker compose build checks` then `docker compose run --rm checks`. To export artifacts without a running container, use `docker build --target frontend-artifacts --output type=local,dest=artifacts/frontend .` or `docker build --target native-artifacts --output type=local,dest=artifacts/native .`.

Alternatively `mkdir -p artifacts` and run `LOCAL_UID=$(id -u) LOCAL_GID=$(id -g) docker compose run --rm frontend` (or `native`). Compose writes with the selected host UID/GID. Docker Desktop may use a VM; choose mounts/contexts explicitly. Neither image is the installed application runtime, and Docker is never required to launch the executable.

Build validation and any outstanding install/hardware checks are recorded in `docs/PROGRESS.md` and the current benchmark report. Do not treat a package recipe as proof of clean-install acceptance.
