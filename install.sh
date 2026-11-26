#!/usr/bin/env bash
# PVE Hardware Monitor v0.1.7 — readable installer (no embedded payload).
# Run from a reviewed checkout for an offline installation.
# A standalone copy downloads one source archive from the official repository.
set -euo pipefail
umask 077

readonly VERSION='0.1.7'
readonly REPO='BlackMix/pve-cpu--gpu-memory-modern-monitor'

usage() {
    cat <<'HELP'
Usage: bash install.sh [check|install|repair|status|uninstall|activate]
       bash install.sh --version
       bash install.sh --help

With the source tree present next to this script, no download is needed.
A standalone copy downloads the repository from GitHub (PHM_REF defaults to main).
Set PHM_REF to a reviewed tag or full commit SHA to select a specific revision.
For a fully reviewed installation, clone or download the source first.
HELP
}

if (( $# > 1 )); then usage >&2; exit 2; fi
action=${1:-install}
case "$action" in
    --version) printf 'PVE Hardware Monitor v%s\n' "$VERSION"; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    check|install|repair|status|uninstall|activate) ;;
    *) usage >&2; exit 2 ;;
esac

require() {
    command -v "$1" >/dev/null 2>&1 || {
        printf 'Missing dependency: %s\n' "$1" >&2
        exit 1
    }
}
require python3

# Never search the current working directory when the script comes from stdin.
script=${BASH_SOURCE[0]:-}
if [[ -n "$script" && -f "$script" ]]; then
    source_dir=$(cd -- "$(dirname -- "$script")" && pwd -P)
    if [[ -e "$source_dir/install.py" || -e "$source_dir/src" ]]; then
        for file in install.py src/dashboard.js src/collector.py src/endpoint.pm src/pve-hardware-monitor.service; do
            if [[ ! -f "$source_dir/$file" ]]; then
                printf 'Incomplete local source tree: %s\n' "$file" >&2
                exit 1
            fi
        done
        if [[ ! -d "$source_dir/src/legacy" ]]; then
            echo 'Incomplete local source tree: src/legacy' >&2
            exit 1
        fi
        echo "Using local source: $source_dir"
        exec python3 -I "$source_dir/install.py" "$action"
    fi
fi

# Standalone mode: retrieve a single archive, so all files are from one revision.
require curl
require mktemp
ref=${PHM_REF:-main}
if [[ ! "$ref" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ || "$ref" == *..* ]]; then
    echo 'Invalid PHM_REF: use a branch name without slashes, tag, or full commit SHA.' >&2
    exit 2
fi
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
printf 'Fetching source from %s (ref: %s)\n' "$REPO" "$ref"
echo 'For source review before execution, use a local checkout instead.'
curl --fail --silent --show-error --location \
    --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --connect-timeout 15 --max-time 180 --retry 2 \
    "https://codeload.github.com/$REPO/tar.gz/$ref" \
    --output "$work/source.tar.gz"

# Extract only the regular source files used by install.py. Do not extract
# arbitrary paths, symlinks, hardlinks, permissions, or owners from the archive.
python3 -I - "$work/source.tar.gz" "$work/source" <<'PYTHON'
import re
import shutil
import sys
import tarfile
from pathlib import Path, PurePosixPath

archive, destination = Path(sys.argv[1]), Path(sys.argv[2])
required = {
    'install.py', 'src/dashboard.js', 'src/collector.py',
    'src/endpoint.pm', 'src/pve-hardware-monitor.service',
}
legacy = re.compile(r'src/legacy/(?:dashboard-[A-Za-z0-9._-]+\.js|collector-v[A-Za-z0-9._-]+\.py)\Z')
seen = set()
roots = set()
with tarfile.open(archive, 'r:gz') as package:
    for member in package:
        path = PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or len(path.parts) < 2:
            continue
        relative = '/'.join(path.parts[1:])
        if relative not in required and not legacy.fullmatch(relative):
            continue
        if not member.isfile() or relative in seen or member.size > 16 * 1024 * 1024:
            raise SystemExit(f'Unsafe or duplicate source entry: {member.name}')
        roots.add(path.parts[0])
        if len(roots) != 1:
            raise SystemExit('Source archive contains multiple roots.')
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        with package.extractfile(member) as source, target.open('xb') as output:
            shutil.copyfileobj(source, output)
        seen.add(relative)
missing = required - seen
if not any(p.startswith('src/legacy/dashboard-') for p in seen):
    missing.add('src/legacy/dashboard-*.js')
if missing:
    raise SystemExit('Incomplete source archive: ' + ', '.join(sorted(missing)))
PYTHON

# Keep the existing installer responsible for host checks, backups, patches,
# service restarts, rollback, and uninstall. No changes to those mechanisms.
python3 -I "$work/source/install.py" "$action"
