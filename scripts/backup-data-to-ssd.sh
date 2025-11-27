#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${REPO_ROOT}/data"
VOLUME_PATH="/Volumes/kota_ssd"
TARGET_ROOT="${VOLUME_PATH}/backups"
TIMESTAMP="$(date '+%Y-%m-%d_%H-%M-%S')"
TARGET_DIR="${TARGET_ROOT}/${TIMESTAMP}"

if [[ ! -d "${VOLUME_PATH}" ]]; then
  echo "kota_ssd volume is not mounted at ${VOLUME_PATH}" >&2
  exit 1
fi

if [[ ! -d "${SOURCE_DIR}" ]]; then
  echo "Source data directory not found at ${SOURCE_DIR}" >&2
  exit 1
fi

mkdir -p "${TARGET_DIR}" >/dev/null 2>&1

rsync -a --delete "${SOURCE_DIR}/" "${TARGET_DIR}/" \
  --exclude='.DS_Store' \
  --exclude='Thumbs.db'

echo "Backup completed: ${TARGET_DIR}"
