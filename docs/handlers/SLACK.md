Slack Handler Setup
===================

> Bundle: `slack` (auto-enabled). `toolkit_list_bundles {}` will confirm messaging integrations are ready before you start planning actions.

This guide walks you through configuring the Slack handler so the gateway can read conversations (channels, private groups, DMs) available to your user.

What you get
------------
- `slack_list_conversations`: enumerate channels, private groups, IMs, and MPIMs accessible to your account.
- `slack_get_messages`: fetch message history for any conversation, optionally filtered to your own posts.

Prerequisites
-------------
- Slack workspace where you can create/manage apps.
- Slack app created at https://api.slack.com/apps.
- Gateway running locally (default port: 8084).

Required scopes
---------------
In the Slack app dashboard under **OAuth & Permissions → User Token Scopes**, add:
- channels:history
- groups:history
- im:history
- mpim:history
- channels:read
- groups:read
- im:read
- mpim:read
- users:read

Environment variables
---------------------
Copy `.env.example` to `.env` if you have not already.

For the standard OAuth flow, define:

```
SLACK_CLIENT_ID=your_app_client_id
SLACK_CLIENT_SECRET=your_app_client_secret
SLACK_SIGNING_SECRET=optional_if_needed_later
SLACK_REDIRECT_URI=http://localhost:8084/auth/slack/callback
```

To skip the browser flow entirely, provide tokens directly via `.env`:

```
# Required
SLACK_USER_TOKEN=xoxp-your-user-token

# Recommended for richer metadata / filtering
SLACK_USER_ID=U01234567
SLACK_USER_SCOPE=channels:history,groups:history,...
SLACK_USER_REFRESH_TOKEN=xoxe-refresh-token-if-you-have-one
SLACK_USER_TOKEN_EXPIRES_AT=1731200000000  # optional, ms epoch
SLACK_TEAM_ID=T01234567
SLACK_TEAM_NAME=My Workspace

# Optional bot token if you also use bot operations
SLACK_BOT_TOKEN=xoxb-your-bot-token
```

When `SLACK_USER_TOKEN` is present the server uses it immediately and never prompts for `/auth/slack/start`.

OAuth flow
----------
1. **Start the gateway** with `npm run dev` (or use Docker) so it listens on port 8084.
2. **Expose HTTPS** by launching the tunnel helper:
   ```
   npm run tunnel:slack
   ```
   The script prints something like:
   ```
   Slack tunnel ready
     Local port: 8084
     Public base: https://your-subdomain.loca.lt
     OAuth redirect URL: https://your-subdomain.loca.lt/auth/slack/callback
   ```
   Copy the HTTPS redirect URL.
3. **Configure the app**: in Slack → OAuth & Permissions → Redirect URLs, paste the HTTPS URL and save.
4. **Authorize**: visit `https://your-subdomain.loca.lt/auth/slack/start` while the tunnel and server are running, then approve the consent screen. You should see “Slack authentication successful.” Tokens are saved to `data/slack/tokens.json`.
5. **Verify**: `curl https://your-subdomain.loca.lt/auth/slack/status` (or later `http://localhost:8084/auth/slack/status`). A successful response shows `{ "authenticated": true, ... }`.
6. **Use tools**: in your MCP client, call `slack_list_conversations` or `slack_get_messages`. Provide a conversation ID (e.g., `C012345`) and optional pagination parameters. Set `only_self=true` to filter to your own messages.

Manual token placement (file)
-----------------------------
If you prefer to manage tokens outside of environment variables, you can still drop a JSON payload in `data/slack/tokens.json`:
```
{
  "access_token": "xoxb-...",              // optional bot token
  "team": { "id": "T...", "name": "..." },
  "authed_user": {
    "id": "U...",
    "scope": "channels:history,...",
    "access_token": "xoxp-..."
  },
  "installed_at": 1731096265000
}
```
The file-based token store is still read if `SLACK_USER_TOKEN` is not defined.

Troubleshooting
---------------
- `npm run tunnel:slack` hangs: set `DEBUG=localtunnel*` before running, or use another tunneling service (ngrok, cloudflared).
- Slack redirect mismatch: the URL in Slack must match the tunnel output exactly.
- `authenticated: false`: rerun `/auth/slack/start`, or double-check `SLACK_USER_TOKEN`/related env vars or `data/slack/tokens.json`.
- `missing_scope` errors: verify the user token includes every scope above.

Security notes
--------------
- `.env` and `data/` are gitignored; never commit tokens or secrets.
- Handle `data/slack/tokens.json` as carefully as you would a password.

After completing the steps, the Slack handler will read any conversation available to your account.
