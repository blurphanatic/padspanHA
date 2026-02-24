#!/usr/bin/env python
"""
PadSpan HA release script.

Usage:
    python scripts/release.py <version>

Example:
    python scripts/release.py 0.4.22

What it does:
    1. Updates version in all source files
    2. Builds dist/padspan_ha.zip
    3. Commits, tags, and pushes
    4. Creates and publishes the GitHub release with the zip attached
"""

import sys
import re
import json
import zipfile
import pathlib
import subprocess
import datetime
import tempfile
import os

ROOT = pathlib.Path(__file__).parent.parent
INTEGRATION = ROOT / "custom_components" / "padspan_ha"
PANEL_JS = INTEGRATION / "www" / "padspan-ha" / "panel.js"
ZIP_PATH = ROOT / "dist" / "padspan_ha.zip"
REPO = "gbroeckling/padspanHA"


def run(cmd, check=True):
    print(f"  $ {cmd}")
    result = subprocess.run(cmd, shell=True, text=True, capture_output=True)
    if result.stdout.strip():
        print(f"    {result.stdout.strip()}")
    if check and result.returncode != 0:
        print(f"  ERROR: {result.stderr.strip()}")
        sys.exit(1)
    return result.stdout.strip()


def update_version_files(version, build_id):
    old_build_id = re.search(
        r'BUILD_ID = "(\w+)"',
        (INTEGRATION / "build_info.py").read_text(encoding="utf-8")
    )
    old_build_id = old_build_id.group(1) if old_build_id else None

    # manifest.json
    m = json.loads((INTEGRATION / "manifest.json").read_text(encoding="utf-8"))
    m["version"] = version
    (INTEGRATION / "manifest.json").write_text(
        json.dumps(m, indent=2) + "\n", encoding="utf-8"
    )
    print(f"  manifest.json        -> {version}")

    # const.py
    p = INTEGRATION / "const.py"
    p.write_text(
        re.sub(r'VERSION = "[^"]+"', f'VERSION = "{version}"', p.read_text(encoding="utf-8")),
        encoding="utf-8"
    )
    print(f"  const.py             -> {version}")

    # build_info.py
    p = INTEGRATION / "build_info.py"
    content = p.read_text(encoding="utf-8")
    content = re.sub(r'BUILD_VERSION = "[^"]+"', f'BUILD_VERSION = "{version}"', content)
    content = re.sub(r'BUILD_ID = "[^"]+"',      f'BUILD_ID = "{build_id}"',      content)
    p.write_text(content, encoding="utf-8")
    print(f"  build_info.py        -> {version} / {build_id}")

    # VERSION.txt
    (ROOT / "VERSION.txt").write_text(
        f"padspanHA package version: {version}\n", encoding="utf-8"
    )
    print(f"  VERSION.txt          -> {version}")

    # panel.js — version, build id, and all import cache-busters
    content = PANEL_JS.read_text(encoding="utf-8")
    content = re.sub(r'const APP_VERSION = "[^"]+"', f'const APP_VERSION = "{version}"', content)
    content = re.sub(r'const BUILD_ID = "[^"]+"',    f'const BUILD_ID = "{build_id}"',    content)
    # Replace ALL ?b= cache-busters in import lines regardless of their current value
    content = re.sub(r'\?b=\w+', f'?b={build_id}', content)
    PANEL_JS.write_text(content, encoding="utf-8")
    print(f"  panel.js             -> {version} / {build_id}")


def build_zip():
    ZIP_PATH.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(INTEGRATION.rglob("*")):
            if f.is_file() and "__pycache__" not in f.parts and f.suffix != ".pyc":
                zf.write(f, f.relative_to(INTEGRATION))
    count = len(zipfile.ZipFile(ZIP_PATH).namelist())
    print(f"  {count} files -> dist/padspan_ha.zip")


def git_commit_tag_push(version, tag):
    files = " ".join([
        "VERSION.txt",
        "dist/padspan_ha.zip",
        "custom_components/padspan_ha/manifest.json",
        "custom_components/padspan_ha/const.py",
        "custom_components/padspan_ha/build_info.py",
        "custom_components/padspan_ha/websocket.py",
        "custom_components/padspan_ha/maps_store.py",
        "custom_components/padspan_ha/calibration_store.py",
        "custom_components/padspan_ha/const.py",
        "custom_components/padspan_ha/www/padspan-ha/panel.js",
        "custom_components/padspan_ha/www/padspan-ha/styles.css",
        "custom_components/padspan_ha/www/padspan-ha/help_content.js",
        "custom_components/padspan_ha/www/padspan-ha/views/follow.js",
        "custom_components/padspan_ha/www/padspan-ha/views/overview.js",
        "custom_components/padspan_ha/www/padspan-ha/views/objects.js",
        "custom_components/padspan_ha/www/padspan-ha/views/bluetooth.js",
        "custom_components/padspan_ha/www/padspan-ha/views/settings.js",
        "custom_components/padspan_ha/www/padspan-ha/views/manage.js",
        "custom_components/padspan_ha/www/padspan-ha/views/maps.js",
        "custom_components/padspan_ha/www/padspan-ha/views/training.js",
        "custom_components/padspan_ha/www/padspan-ha/views/calibration.js",
        "scripts/release.py",
    ])
    run(f"git add {files}")
    run(f'git commit -m "chore: bump version to {tag}"')
    run(f"git tag {tag}")
    run("git push")
    run(f"git push origin {tag}")


def create_github_release(tag):
    notes = (
        f"## PadSpan HA {tag}\n\n"
        "### Install / Update\n"
        "Install or update via HACS using this repository as a custom repository."
    )
    with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False, encoding="utf-8") as f:
        f.write(notes)
        notes_file = f.name

    try:
        run(
            f'gh release create {tag} "{ZIP_PATH}" '
            f'--title "{tag}" '
            f'--notes-file "{notes_file}" '
            f'--repo {REPO}'
        )
    finally:
        os.unlink(notes_file)


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)

    version = sys.argv[1].lstrip("v")
    tag = f"v{version}"
    build_id = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")

    print(f"\n=== PadSpan HA Release: {tag}  build: {build_id} ===\n")

    print("Updating source files...")
    update_version_files(version, build_id)

    print("\nBuilding zip...")
    build_zip()

    print("\nCommitting, tagging, pushing...")
    git_commit_tag_push(version, tag)

    print("\nCreating GitHub release...")
    create_github_release(tag)

    print(f"\n=== Done! {tag} is live on GitHub. ===\n")


if __name__ == "__main__":
    main()
