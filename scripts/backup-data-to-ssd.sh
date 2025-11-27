#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${REPO_ROOT}/data"
VOLUME_PATH="/Volumes/kota_ssd"
TARGET_ROOT="${VOLUME_PATH}/backups"
TIMESTAMP="$(date '+%Y-%m-%d_%H-%M-%S')"
TARGET_DIR="${TARGET_ROOT}/${TIMESTAMP}"

# Wait up to 5 minutes for volume to be available (useful after system wake)
MAX_RETRIES=30
RETRY_INTERVAL=10
retry_count=0

while [[ $retry_count -lt $MAX_RETRIES ]]; do
  # Check if volume exists and is writable (not just a mount point directory)
  if [[ -d "${VOLUME_PATH}" ]] && /usr/bin/touch "${VOLUME_PATH}/.backup_test" 2>/dev/null; then
    /bin/rm -f "${VOLUME_PATH}/.backup_test"
    break
  fi

  retry_count=$((retry_count + 1))
  if [[ $retry_count -lt $MAX_RETRIES ]]; then
    echo "Volume not ready, waiting ${RETRY_INTERVAL}s (attempt ${retry_count}/${MAX_RETRIES})..." >&2
    /bin/sleep ${RETRY_INTERVAL}
  else
    echo "kota_ssd volume is not available after ${MAX_RETRIES} attempts" >&2
    exit 1
  fi
done

echo "Volume ${VOLUME_PATH} is available"

if [[ ! -d "${SOURCE_DIR}" ]]; then
  echo "Source data directory not found at ${SOURCE_DIR}" >&2
  exit 1
fi

/bin/mkdir -p "${TARGET_DIR}"

# Use full path to rsync for cron compatibility
/usr/bin/rsync -a --delete "${SOURCE_DIR}/" "${TARGET_DIR}/" \
  --exclude='.DS_Store' \
  --exclude='Thumbs.db'

echo "Backup completed: ${TARGET_DIR}"
