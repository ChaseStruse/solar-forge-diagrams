# Build and package

The installed app is native and offline. Bun, Rust, Docker and development servers are build tools, not runtime requirements. The only initial packaging target is x86_64 Arch/Omarchy. AppImage and optional M6 3D exploration remain deferred by the plan.

## Native development

Use Bun 1.3.11 and Rust 1.99.1. Install Arch packages `webkit2gtk-4.1 gtk3 rust pkgconf` and your desktop's normal XDG portal/file chooser backend. Do not modify compositor configuration. Run `bun install --frozen-lockfile`, `bun run verify`, and `cargo test --manifest-path src-tauri/Cargo.toml --locked`, then build with `cargo build --manifest-path src-tauri/Cargo.toml --release --locked`. Run `src-tauri/target/release/solar-forge-diagrams`. `bun run desktop` starts a development window; installed builds embed the frontend.

Opt-in native diagnostics: build with `--features diagnostics`, then run `--smoke-test`. For isolated testing set `XDG_DATA_HOME=/tmp/solar-forge-test-data`. Never report browser or container tests as native GUI/GPU certification.

## Arch package

After a reviewed commit, run `scripts/source-archive.sh`. Copy `artifacts/solar-forge-diagrams-0.1.0.tar.gz` beside `packaging/arch/PKGBUILD`. Replace `SKIP` with the printed SHA-256 (or run `updpkgsums`). From that directory run `makepkg --cleanbuild`, then inspect the package before installing with `pacman -U`. The recipe does not install build tools into the application package.

The package installs `/usr/bin/solar-forge-diagrams`, a desktop launcher, SVG app icon, and MIME definition for `*.sforge.json`. File-manager launch arguments reach the running application with unsaved-change protection. System MIME/icon database hooks are handled by Arch package infrastructure. Uninstalling the package preserves user-selected documents and XDG application data/recovery. No global shortcuts are installed. No artifacts are published automatically. A public source license has not been selected by the project owner; local packaging does not grant redistribution rights.

## Docker development and artifacts

The Dockerfile pins Bun 1.3.11 and Rust 1.99.1 image digests and a fixed Debian package snapshot. Rust, Cargo and Bun downloads use build cache mounts; compiler caches stay outside exported artifacts. Builder glibc is compatible with newer Arch hosts. Container builds do not require or share the host display.

Use your existing Docker Engine or Docker Desktop context; inspect it with `docker context show`. This project never changes it. Run `docker compose build checks` then `docker compose run --rm checks`. To export artifacts without a running container, use `docker build --target frontend-artifacts --output type=local,dest=artifacts/frontend .` or `docker build --target native-artifacts --output type=local,dest=artifacts/native .`.

Alternatively `mkdir -p artifacts` and run `LOCAL_UID=$(id -u) LOCAL_GID=$(id -g) docker compose run --rm frontend` (or `native`). Compose writes with the selected host UID/GID. Docker Desktop may use a VM; choose mounts/contexts explicitly. Neither image is the installed application runtime, and Docker is never required to launch the executable.

Build validation and any outstanding install/hardware checks are recorded in `docs/PROGRESS.md` and the current benchmark report. Do not treat a package recipe as proof of clean-install acceptance.
