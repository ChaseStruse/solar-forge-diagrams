# Releasing

Releases are GitHub Releases on `ChaseStruse/solar-forge-diagrams`. Each release carries the Omarchy install bundle under two names: a versioned one, and a fixed name that external pages (such as chasestruse.github.io) link to permanently:

```
https://github.com/ChaseStruse/solar-forge-diagrams/releases/latest/download/solar-forge-diagrams-omarchy-x86_64.tar.gz
```

`releases/latest` skips drafts and pre-releases. **Publish alpha releases as normal releases**, not pre-releases, or that link breaks.

## 1. Set the version

Pick `X.Y.Z` per [Semantic Versioning](https://semver.org/) and set it in all four manifests:

- `package.json` → `"version"`
- `src-tauri/Cargo.toml` → `version`
- `src-tauri/tauri.conf.json` → `"version"`
- `packaging/omarchy/pkgbuilds/solar-forge-diagrams/PKGBUILD` → `pkgver`, and reset `pkgrel=1`. Increase `pkgrel` only for packaging-only rebuilds of the same version.

Then refresh the lockfile's own entry (dependencies are unchanged), so `--locked` builds keep working:

```sh
cargo update --manifest-path src-tauri/Cargo.toml -p solar-forge-diagrams --offline
```

Move the `[Unreleased]` entries in `CHANGELOG.md` under a new `[X.Y.Z] — YYYY-MM-DD` heading, update `docs/STATUS.md`, and merge to `main`.

## 2. Verify

From a clean checkout of `main`:

```sh
bun install --frozen-lockfile
bun run verify
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo build --manifest-path src-tauri/Cargo.toml --release --features diagnostics --locked
./src-tauri/target/release/solar-forge-diagrams --smoke-test
```

## 3. Build the package and bundle

```sh
scripts/source-archive.sh          # fails if the four versions disagree
cp artifacts/solar-forge-diagrams-X.Y.Z.tar.gz packaging/omarchy/pkgbuilds/solar-forge-diagrams/
cd packaging/omarchy/pkgbuilds/solar-forge-diagrams
updpkgsums && makepkg --cleanbuild
cd -
scripts/omarchy-bundle.sh packaging/omarchy/pkgbuilds/solar-forge-diagrams/solar-forge-diagrams-X.Y.Z-1-x86_64.pkg.tar.zst
git checkout -- packaging/omarchy/pkgbuilds/solar-forge-diagrams/PKGBUILD   # drop the local checksum
```

This writes, in `artifacts/omarchy/`:

- `solar-forge-diagrams-X.Y.Z-1-omarchy-x86_64.tar.gz` (versioned bundle)
- `solar-forge-diagrams-omarchy-x86_64.tar.gz` (fixed-name copy)
- `solar-forge-diagrams-X.Y.Z-1-omarchy-x86_64.SHA256SUMS`

Extract the bundle in a scratch directory and run `./install.sh --check`, then install it and launch the app from `Super+Space` before publishing.

## 4. Publish

```sh
git tag -a vX.Y.Z -m "Solar Forge Diagrams X.Y.Z"
git push origin vX.Y.Z
gh release create vX.Y.Z \
  artifacts/omarchy/solar-forge-diagrams-X.Y.Z-1-omarchy-x86_64.tar.gz \
  artifacts/omarchy/solar-forge-diagrams-omarchy-x86_64.tar.gz \
  artifacts/omarchy/solar-forge-diagrams-X.Y.Z-1-omarchy-x86_64.SHA256SUMS \
  artifacts/solar-forge-diagrams-X.Y.Z.tar.gz \
  --title "Solar Forge Diagrams X.Y.Z" --notes-file <(sed -n '/^## \[X.Y.Z\]/,/^## \[/p' CHANGELOG.md | sed '1d;$d')
```

Afterwards confirm the fixed link downloads the new bundle:

```sh
curl -sIL https://github.com/ChaseStruse/solar-forge-diagrams/releases/latest/download/solar-forge-diagrams-omarchy-x86_64.tar.gz | grep -i '^location' | tail -1
```

Bundles are unsigned; the published `SHA256SUMS` lets users detect corruption.
