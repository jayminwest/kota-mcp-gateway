#!/usr/bin/env bash
set -euo pipefail

PLIST=~/Library/LaunchAgents/com.kota.backup.plist
LOG_FILE=~/Library/Logs/kota-data-backup.log
PROJECT_DIR="$(cd "$(dirname "$0")"/.. && pwd)"
BACKUP_SCRIPT="${PROJECT_DIR}/scripts/backup-data-to-ssd.sh"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.kota.backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${BACKUP_SCRIPT}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>3</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLIST

echo "LaunchAgent plist created: $PLIST"
echo ""
echo "To install, run:"
echo "  launchctl load $PLIST"
echo ""
echo "To test immediately:"
echo "  launchctl start com.kota.backup"
echo ""
echo "To check status:"
echo "  launchctl list | grep kota"
echo ""
echo "To uninstall:"
echo "  launchctl unload $PLIST"
