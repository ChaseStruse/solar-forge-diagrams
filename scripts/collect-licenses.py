#!/usr/bin/env python3
"""Collect unmodified dependency license files for a local binary package."""
import os
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tomllib

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1] if len(sys.argv) > 1 else root / 'artifacts/licenses')
out.mkdir(parents=True, exist_ok=True)
cargo_home = Path(os.environ.get('CARGO_HOME', Path.home() / '.cargo'))
tree = subprocess.check_output(['cargo', 'tree', '--manifest-path', str(root / 'src-tauri/Cargo.toml'), '--locked', '--target', 'x86_64-unknown-linux-gnu', '--edges', 'normal', '--prefix', 'none', '--format', '{p}'], text=True)
packages = sorted(set(re.findall(r'^([\w-]+) v([^\s]+)', tree, re.M)))
missing = []
for name, version in packages:
    if name == 'solar-forge-diagrams':
        continue
    locations = list((cargo_home / 'registry/src').glob(f'*/{name}-{version}'))
    if not locations:
        missing.append(f'{name} {version}: source unavailable')
        continue
    source = locations[0]
    metadata = tomllib.loads((source / 'Cargo.toml').read_text())['package']
    folder = out / f'{name}-{version}'
    folder.mkdir(exist_ok=True)
    (folder / 'METADATA.txt').write_text(f"{name} {version}\nLicense: {metadata.get('license', 'See license file')}\nRepository: {metadata.get('repository', '')}\n")
    files = [p for p in source.iterdir() if p.is_file() and p.name.upper().startswith(('LICENSE', 'LICENCE', 'COPYING', 'COPYRIGHT', 'NOTICE'))]
    license_file = metadata.get('license-file')
    if license_file and (source / license_file).is_file():
        files.append(source / license_file)
    for file in set(files):
        shutil.copyfile(file, folder / file.name)
    fallback = root / 'packaging/licenses' / f'{name}-{version}-LICENSE'
    if not files and fallback.is_file():
        shutil.copyfile(fallback, folder / 'LICENSE')
        files.append(fallback)
    if not files:
        missing.append(f'{name} {version}: {metadata.get("license", "unknown license")} (no packaged license text)')
three = out / 'three-0.183.2'
three.mkdir(exist_ok=True)
shutil.copyfile(root / 'node_modules/three/LICENSE', three / 'LICENSE')
yaml_metadata = json.loads((root / 'node_modules/yaml/package.json').read_text())
yaml_notice = out / f"yaml-{yaml_metadata['version']}"
yaml_notice.mkdir(exist_ok=True)
shutil.copyfile(root / 'node_modules/yaml/LICENSE', yaml_notice / 'LICENSE')
for filename in ['SOURCE_LICENSE.md', 'THIRD_PARTY_NOTICES.md']:
    shutil.copyfile(root / filename, out / filename)
shutil.copytree(root / 'assets/aws', out / 'aws-architecture-icons', dirs_exist_ok=True, ignore=shutil.ignore_patterns('*.svg'))
(out / 'LICENSE-REVIEW.txt').write_text('\n'.join(missing) + '\n' if missing else 'All normal-target package license texts collected.\n')
print(f'Collected notices for {len(packages)} Rust packages, Three.js, and yaml into {out}')
if missing:
    print('\n'.join(missing))
    sys.exit(1)
