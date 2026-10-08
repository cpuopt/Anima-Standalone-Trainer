#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "${KREA2_PYTHON:-python3.12}" "$root/scripts/setup_krea2.py" "$@"
