# Solar Forge Diagrams for Omarchy

Native offline alpha for **x86_64 Omarchy**, tested on Omarchy 4.0.4. Download the latest bundle from https://github.com/ChaseStruse/solar-forge-diagrams/releases/latest. Extract it, open a terminal in its directory, then run:

```sh
./install.sh --check
./install.sh
```

The installer checks the OS, architecture, bundle checksums and package identity before opening the normal pacman install/upgrade transaction. It requests sudo in the terminal when needed. Dependencies are resolved from your configured Omarchy/Arch repositories; the first installation may need network access. The app itself works offline without Bun, Docker or a server.

Launch **Solar Forge Diagrams** from `Super+Space`. The package supplies the native launcher, icon and `.sforge.json` file association. Use the file manager's Open With action to select it; it does not force a new default. Portal file dialogs use the desktop's existing backend.

To upgrade, download and extract a newer bundle and run its installer. Existing version-1 diagrams remain supported. To remove the application, use Omarchy Menu → Remove → Package or:

```sh
omarchy pkg drop solar-forge-diagrams
```

Documents and XDG recovery data are preserved. The package uses standard desktop integration without editing Omarchy's managed configuration.

Read USER_GUIDE.md for editing and accepted alpha performance limits, DOCUMENTS.md for recovery, and BUILDING.md for source builds. SHA256SUMS detects bundle corruption; the bundle is unsigned and is not an official Omarchy repository release. Solar Forge Diagrams is MIT-licensed; bundled AWS and Kubernetes artwork keeps its own terms (see THIRD_PARTY_NOTICES.md in the installed license directory).

## Package recipe

`packaging/omarchy/pkgbuilds/solar-forge-diagrams/` in the source tree contains the PKGBUILD and `.omarchy/package.json` layout used by the [Omarchy Package Repository](https://github.com/omacom/omarchy-pkgs#contribute-a-package). The metadata selects local, manual updates (`sync: false`): new versions are installed from GitHub Releases. The source archive is supplied locally and its checksum must be filled before building.

Official repository submission additionally requires the recipe to fetch a published release archive with a fixed checksum. After repository acceptance and publication, `omarchy pkg add solar-forge-diagrams` would install by name. Until then use this installer, which uses `pacman -U`; `omarchy pkg add` accepts repository names, not local archive paths.
