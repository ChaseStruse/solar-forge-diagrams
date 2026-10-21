# syntax=docker/dockerfile:1.7
FROM oven/bun:1.3.11@sha256:38919894db4e117a37f74e3dca503e84f24d97f19cabc5f499a289c2a5d0db7c AS bun
FROM rust:1.99.1-bookworm@sha256:5f29c3b4cb8ad8c6f10df979595582dd67dd146ffebc70718e24ff2e5b4a194d AS tools
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
# Fixed Debian snapshot makes package resolution independent of current mirrors.
RUN printf 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20261015T000000Z bookworm main\ndeb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/20261015T000000Z bookworm-security main\n' > /etc/apt/sources.list \
 && rm -f /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf pkg-config ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /source
FROM tools AS dependencies
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile
COPY . .
FROM dependencies AS checks
RUN bun run verify
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/source/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --locked
FROM checks AS frontend
RUN mkdir /artifacts && cp -r dist /artifacts/frontend
FROM checks AS native
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/source/src-tauri/target cargo build --manifest-path src-tauri/Cargo.toml --release --locked \
 && mkdir /artifacts && cp src-tauri/target/release/solar-forge-diagrams /artifacts/
FROM scratch AS frontend-artifacts
COPY --from=frontend /artifacts/ /
FROM scratch AS native-artifacts
COPY --from=native /artifacts/ /

# Omarchy release package: makepkg needs Arch, so this builder is separate from the Debian checks above.
FROM archlinux:base-devel@sha256:0ccc8b2e55c0c26a6e501e892cc6b1cdea7cfdf77e432941320148b4dabd2bff AS omarchy-package
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
# Fixed Arch archive date (matching the base image) makes package resolution independent of current mirrors.
RUN echo 'Server = https://archive.archlinux.org/repos/2026/10/19/$repo/os/$arch' > /etc/pacman.d/mirrorlist \
 && pacman -Syyuu --noconfirm --needed rust pkgconf python webkit2gtk-4.1 gtk3 \
 && pacman -Scc --noconfirm \
 && useradd --create-home --uid 1000 builder
COPY scripts/container-package.sh /usr/local/bin/container-package
USER builder
# release-source is a named build context holding the git-archived source; see scripts/docker-release.sh.
RUN --mount=type=bind,from=release-source,target=/input \
    --mount=type=cache,target=/home/builder/.cargo,uid=1000,gid=1000 \
    --mount=type=cache,target=/home/builder/.bun/install/cache,uid=1000,gid=1000 \
    --mount=type=cache,target=/home/builder/cargo-target,uid=1000,gid=1000 \
    CARGO_HOME=/home/builder/.cargo CARGO_TARGET_DIR=/home/builder/cargo-target container-package /input /home/builder/out
FROM scratch AS release-artifacts
COPY --from=omarchy-package /home/builder/out/ /
