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
