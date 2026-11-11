#!/usr/bin/env bash
set -euo pipefail
target=${1:-shared}
case "$target" in shared|g03) ;; *) printf '%s\n' 'Expected shared or g03' >&2; exit 2;; esac
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd -- "$here/../../../.." && pwd)
python3 "$here/validate-source.py" "$target"
export PHASE2_AUDIT_TARGET="$target"
cd -- "$repo"
pnpm --dir apps/api exec jest --runInBand --config "$here/jest.config.cjs"
