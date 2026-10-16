# Solar Forge Diagrams for Omarchy

Native offline alpha for **x86_64 Omarchy**, tested on Omarchy 4.0.4. Extract the bundle, open a terminal in its directory, then run:

```sh
./install.sh --check
./install.sh
```

The installer checks the OS, architecture, bundle checksums and package identity before opening the normal pacman install/upgrade transaction. It requests sudo in the terminal when needed. Dependencies are resolved from your configured Omarchy/Arch repositories; the first installation may need network access. The app itself works offline without Bun, Docker or a server.

Launch **Solar Forge Diagrams** from `Super+Space`. The package supplies the native launcher, icon and `.sforge.json` file association. Use the file manager's Open With action to select it; it does not force a new default. Portal file dialogs use the desktop's existing backend.

For an upgrade, extract the next bundle and run its installer. Existing version-1 diagrams remain supported. To remove the application, use Omarchy Menu → Remove → Package or:

```sh
omarchy pkg drop solar-forge-diagrams
```

Documents and XDG recovery data are preserved. The package uses standard desktop integration without editing Omarchy's managed configuration.

Read USER_GUIDE.md for editing and accepted alpha performance limits, DOCUMENTS.md for recovery, and BUILDING.md for source builds. SHA256SUMS detects bundle corruption; this local bundle is unsigned and is not an official Omarchy repository release.

## Package recipe

`packaging/omarchy/pkgbuilds/solar-forge-diagrams/` in the source tree contains the PKGBUILD and `.omarchy/package.json` layout used by the [Omarchy Package Repository](https://github.com/omacom/omarchy-pkgs#contribute-a-package). The metadata selects local, manual updates (`sync: false`): the alpha has no published upstream release feed. The source archive is supplied locally and its checksum must be filled before building. No placeholder upstream URL is invented.

Official repository submission requires a distributable, published source release with a fixed checksum and a source license chosen by the owner. After repository acceptance and publication, `omarchy pkg add solar-forge-diagrams` would install by name. Until then use this local installer, which uses `pacman -U`; `omarchy pkg add` accepts repository names, not local archive paths.
