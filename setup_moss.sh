#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "${MOSS_PYTHON:-python3.12}" "$root/scripts/setup_moss.py" "$@"
