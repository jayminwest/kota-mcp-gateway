# Home Server API - KotaDB ADWs Integration

This document describes how to deploy and use the Home Server API for KotaDB AI Developer Workflows (ADWs) integration.

## Overview

The Home Server API provides REST endpoints for managing tasks that can be claimed and executed by KotaDB ADWs. The API is accessed securely via Tailscale without requiring authentication.

**Base URL**: `https://jaymins-mac-pro.tail1b7f44.ts.net`
**API Prefix**: `/api/tasks/:project_id` (e.g., `/api/tasks/kotadb`)
**Authentication**: None (Tailscale network security)
**Protocol**: HTTPS
**Content-Type**: `application/json`

## Recent Improvements

The following critical improvements were implemented to ensure production-ready quality:

### Concurrency Safety
- **Atomic Database Operations**: All status transitions now use atomic `UPDATE ... WHERE` statements to prevent race conditions
- **Claim Protection**: Multiple ADWs cannot claim the same task simultaneously
- **ADW ID Verification**: All lifecycle endpoints verify ADW ownership atomically

### Scalability
- **Pagination Support**: Added `offset` parameter for efficient task list traversal
- **Rate Limiting**: 100 requests/minute per IP to prevent abuse
- **Indexed Queries**: Database indexes on status, priority, created_at, and adw_id

### Input Validation
- **ADW ID Format**: Enforced alphanumeric + hyphens/underscores pattern
- **Zod Schemas**: Comprehensive validation for all request bodies
- **Error Messages**: Clear, actionable error responses with proper HTTP status codes

## Quick Start

### 1. Build the Project

```bash
npm run build
```

### 2. Start the Server

```bash
npm start
```

Or for development with hot reload:

```bash
npm run dev
```

### 3. Verify the API

```bash
# Check server health
curl http://localhost:3000/health

# List all tasks
curl http://localhost:3000/api/kota-tasks
```

## API Endpoints

### List Tasks

**GET** `/api/kota-tasks`

Query parameters:
- `status` (string | string[]): Filter by status (pending, claimed, in_progress, completed, failed)
- `limit` (number): Maximum number of tasks to return (default: 10)
- `offset` (number): Number of tasks to skip for pagination (default: 0)
- `priority` (string): Filter by priority (low, medium, high)

Examples:
```bash
# Get all pending tasks
curl "http://localhost:3000/api/kota-tasks?status=pending"

# Get multiple statuses
curl "http://localhost:3000/api/kota-tasks?status=pending&status=claimed&limit=20"

# Filter by priority
curl "http://localhost:3000/api/kota-tasks?status=pending&priority=high"

# Pagination
curl "http://localhost:3000/api/kota-tasks?status=pending&limit=10&offset=10"
```

### Get Task by ID

**GET** `/api/kota-tasks/:task_id`

Example:
```bash
curl "http://localhost:3000/api/kota-tasks/task-abc123"
```

### Create Task

**POST** `/api/kota-tasks`

Body:
```json
{
  "title": "Add rate limiting middleware",
  "description": "Implement tier-based rate limiting for API endpoints...",
  "priority": "high",
  "tags": {
    "model": "sonnet",
    "workflow": "complex"
  },
  "worktree": null
}
```

Example:
```bash
curl -X POST "http://localhost:3000/api/kota-tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Fix typo in README",
    "description": "Change indexng to indexing on line 42",
    "priority": "low",
    "tags": {
      "model": "sonnet",
      "workflow": "simple"
    }
  }'
```

### Claim Task

**POST** `/api/kota-tasks/:task_id/claim`

Body:
```json
{
  "adw_id": "abc12345",
  "worktree": "feat-rate-limiting"
}
```

Example:
```bash
curl -X POST "http://localhost:3000/api/kota-tasks/task-abc123/claim" \
  -H "Content-Type: application/json" \
  -d '{
    "adw_id": "abc12345",
    "worktree": "feat-rate-limiting"
  }'
```

### Start Task

**POST** `/api/kota-tasks/:task_id/start`

Body:
```json
{
  "adw_id": "abc12345"
}
```

Example:
```bash
curl -X POST "http://localhost:3000/api/kota-tasks/task-abc123/start" \
  -H "Content-Type: application/json" \
  -d '{
    "adw_id": "abc12345"
  }'
```

### Complete Task

**POST** `/api/kota-tasks/:task_id/complete`

Body:
```json
{
  "adw_id": "abc12345",
  "commit_hash": "a1b2c3d4e",
  "worktree": "feat-rate-limiting",
  "result": {
    "files_changed": 5,
    "lines_added": 247,
    "lines_removed": 18,
    "tests_passed": true,
    "plan_path": "specs/plan-abc12345.md"
  }
}
```

Example:
```bash
curl -X POST "http://localhost:3000/api/kota-tasks/task-abc123/complete" \
  -H "Content-Type: application/json" \
  -d '{
    "adw_id": "abc12345",
    "commit_hash": "a1b2c3d4e",
    "result": {
      "files_changed": 5,
      "tests_passed": true
    }
  }'
```

### Fail Task

**POST** `/api/kota-tasks/:task_id/fail`

Body:
```json
{
  "adw_id": "abc12345",
  "error": "Claude Code error: Failed to create plan file. Permission denied.",
  "worktree": "feat-rate-limiting"
}
```

Example:
```bash
curl -X POST "http://localhost:3000/api/kota-tasks/task-abc123/fail" \
  -H "Content-Type: application/json" \
  -d '{
    "adw_id": "abc12345",
    "error": "Planning phase failed: Could not parse requirements"
  }'
```

### Update Task

**PATCH** `/api/kota-tasks/:task_id`

Body (all fields optional):
```json
{
  "title": "Updated title",
  "description": "Updated description",
  "priority": "high",
  "tags": {
    "model": "opus"
  },
  "worktree": "new-worktree-name"
}
```

Example:
```bash
curl -X PATCH "http://localhost:3000/api/kota-tasks/task-abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "priority": "high"
  }'
```

### Delete Task

**DELETE** `/api/kota-tasks/:task_id`

Example:
```bash
curl -X DELETE "http://localhost:3000/api/kota-tasks/task-abc123"
```

## Task Status Transitions

Valid transitions:
```
pending → claimed → in_progress → completed
                                → failed

pending → failed  (error before claiming)
claimed → failed  (error before starting work)
```

Invalid transitions (will return 400 Bad Request):
```
completed → *  (completed tasks are terminal)
failed → *     (failed tasks are terminal)
pending → completed  (must be claimed first)
pending → in_progress  (must be claimed first)
```

## Data Storage

Tasks are stored in an SQLite database at:
```
data/kota_tasks.db
```

The database is automatically created on first run and includes proper indexes for common queries.

## Deployment to Home Server (jaymins-mac-pro)

### Option 1: systemd Service (Recommended)

1. Build the project:
   ```bash
   npm run build
   ```

2. Create a systemd service file:
   ```bash
   sudo nano /etc/systemd/system/kota-gateway.service
   ```

3. Add the following configuration:
   ```ini
   [Unit]
   Description=KOTA MCP Gateway
   After=network.target

   [Service]
   Type=simple
   User=jaymin
   WorkingDirectory=/Users/jaymin/kota-mcp-gateway
   Environment=NODE_ENV=production
   ExecStart=/usr/bin/node /Users/jaymin/kota-mcp-gateway/dist/index.js
   Restart=always
   RestartSec=10

   [Install]
   WantedBy=multi-user.target
   ```

4. Enable and start the service:
   ```bash
   sudo systemctl enable kota-gateway
   sudo systemctl start kota-gateway
   ```

5. Check status:
   ```bash
   sudo systemctl status kota-gateway
   ```

### Option 2: PM2 Process Manager

1. Install PM2 globally:
   ```bash
   npm install -g pm2
   ```

2. Build and start:
   ```bash
   npm run build
   pm2 start dist/index.js --name kota-gateway
   ```

3. Set PM2 to start on boot:
   ```bash
   pm2 startup
   pm2 save
   ```

4. Monitor:
   ```bash
   pm2 status
   pm2 logs kota-gateway
   ```

### Option 3: tmux Session (Quick Testing)

1. Start a tmux session:
   ```bash
   tmux new -s kota-gateway
   ```

2. Start the server:
   ```bash
   npm run dev
   ```

3. Detach from session: `Ctrl+B`, then `D`

4. Reattach later:
   ```bash
   tmux attach -t kota-gateway
   ```

## HTTPS Setup with Tailscale

Tailscale automatically provides HTTPS certificates for your Tailnet. To enable HTTPS:

1. Enable HTTPS in Tailscale:
   ```bash
   tailscale cert jaymins-mac-pro
   ```

2. This will generate certificates at:
   ```
   /var/lib/tailscale/certs/jaymins-mac-pro.tail1b7f44.ts.net.crt
   /var/lib/tailscale/certs/jaymins-mac-pro.tail1b7f44.ts.net.key
   ```

3. Update your Express app to use HTTPS (if needed), or use a reverse proxy like Caddy or nginx.

## Security Considerations

### Network Security
- Tailscale provides encrypted tunnel
- No public internet exposure
- No authentication needed (trusted Tailscale network)

### Input Validation
- All inputs are validated using Zod schemas
- Title: 1-200 characters
- Description: 1-5000 characters
- ADW ID: Must contain only alphanumeric characters, hyphens, and underscores
- Status transitions are enforced at the database layer with atomic updates

### Rate Limiting

Rate limiting is enabled by default:

- **Limit**: 100 requests per minute per IP address
- **Window**: 1 minute sliding window
- **Headers**: Rate limit info in `RateLimit-*` headers
- **Blocked Response**: `429 Too Many Requests`

Configuration in `src/index.ts`:
```typescript
const tasksRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(`/api/tasks/${project.id}`, tasksRateLimiter, createTasksRouter({ db, logger }));
```

## Environment Variables

The server uses the following environment variables (configured in `.env`):

```env
PORT=3000
DATA_DIR=./data
MCP_AUTH_TOKEN=your-secret-token  # Optional for MCP endpoints
```

## Monitoring and Logs

The server uses Pino for structured logging. Logs include:

- Task creation events
- Status transitions
- API request details
- Database operations
- Errors and warnings

Example log output:
```json
{
  "level": "info",
  "time": 1728655200000,
  "taskId": "task-abc123",
  "title": "Add rate limiting",
  "msg": "Task created"
}
```

## Troubleshooting

### Database locked error

If you see "database is locked" errors:
1. Check that only one instance is running
2. Restart the server
3. If persists, delete `data/kota_tasks.db` and restart

### Port already in use

If port 3000 is already in use:
1. Change PORT in `.env`
2. Or find and kill the process: `lsof -ti:3000 | xargs kill -9`

### Cannot connect from Tailscale

1. Verify Tailscale is running: `tailscale status`
2. Check firewall rules allow port 3000
3. Ensure server is listening on 0.0.0.0, not 127.0.0.1

## Testing

Run the build and type check:
```bash
npm run build
npm run typecheck
```

Test the API with curl:
```bash
# Create a test task
curl -X POST "http://localhost:3000/api/kota-tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Task",
    "description": "Testing the API",
    "priority": "low"
  }'

# List tasks
curl "http://localhost:3000/api/kota-tasks"

# Claim the task (use the task_id from the create response)
curl -X POST "http://localhost:3000/api/kota-tasks/task-xxxxx/claim" \
  -H "Content-Type: application/json" \
  -d '{
    "adw_id": "test-adw-001",
    "worktree": "test-branch"
  }'
```

## Integration with KotaDB ADWs

The typical workflow for ADW integration:

1. **Task Creation**: Create tasks from KotaDB UI or automation
2. **Task Discovery**: ADW polls `/api/kota-tasks?status=pending`
3. **Claim Task**: ADW claims a task with its unique `adw_id`
4. **Start Work**: ADW starts the task, marking it as `in_progress`
5. **Complete/Fail**: ADW reports completion or failure with results

Example ADW pseudo-code:
```python
# 1. Poll for pending tasks
tasks = requests.get(f"{BASE_URL}/api/kota-tasks?status=pending&limit=1").json()
if not tasks:
    return

task = tasks[0]
task_id = task['task_id']

# 2. Claim the task
requests.post(
    f"{BASE_URL}/api/kota-tasks/{task_id}/claim",
    json={"adw_id": ADW_ID, "worktree": "auto-generated"}
)

# 3. Start the task
requests.post(
    f"{BASE_URL}/api/kota-tasks/{task_id}/start",
    json={"adw_id": ADW_ID}
)

# 4. Execute the work
try:
    result = execute_task(task)

    # 5. Mark as complete
    requests.post(
        f"{BASE_URL}/api/kota-tasks/{task_id}/complete",
        json={
            "adw_id": ADW_ID,
            "result": result,
            "commit_hash": result.get('commit_hash')
        }
    )
except Exception as e:
    # 5. Mark as failed
    requests.post(
        f"{BASE_URL}/api/kota-tasks/{task_id}/fail",
        json={
            "adw_id": ADW_ID,
            "error": str(e)
        }
    )
```

## Architecture

```
┌──────────────────────┐
│   KotaDB ADWs        │
│   (Claude Agents)    │
└──────────┬───────────┘
           │
           │ HTTPS over Tailscale
           │
┌──────────▼───────────┐
│   Express Server     │
│   (index.ts)         │
├──────────────────────┤
│  /api/kota-tasks     │
│  (routes/tasks.ts)   │
└──────────┬───────────┘
           │
           │ SQLite
           │
┌──────────▼───────────┐
│   TasksDatabase      │
│   (utils/tasks-db.ts)│
└──────────────────────┘
           │
┌──────────▼───────────┐
│  data/kota_tasks.db  │
└──────────────────────┘
```

## API Reference

For the complete API specification, see:
- [docs/specs/001-home-server-api.md](../specs/001-home-server-api.md)

## Support

For issues or questions:
- Check logs: `pm2 logs kota-gateway` or `journalctl -u kota-gateway`
- Review this documentation
- Check the main project README: [README.md](../README.md)
