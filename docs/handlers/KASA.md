Kasa (TP-Link) Setup and Usage

> Bundle: `kasa` (auto-enabled). Call `toolkit_list_bundles {}` to see it alongside other device integrations.

Approach
- Uses Kasa Cloud API (unofficial) via https://wap.tplinkcloud.com to list and control devices.
- Stores a session token under `./data/kasa/tokens.json` and reuses it across runs.

Env
- `KASA_USERNAME=<email>`
- `KASA_PASSWORD=<password>`

Tools
- `kasa_list_devices` → returns `{ devices: [{ id, alias, model, status }] }`
- `kasa_control_device { device_id, action }` where action is `on` or `off`
  - `device_id` can be the deviceId or the alias returned by `kasa_list_devices`.

Notes
- This targets smart plugs and switches via `system.set_relay_state`. Some bulb models may require different commands; we can extend as needed.
- If the token expires, the gateway re-authenticates automatically.

Troubleshooting
- `Kasa error: Missing KASA_USERNAME/KASA_PASSWORD`: set credentials in `.env` and restart.
- `Kasa login error`: verify email/password and that your Kasa account is active.
