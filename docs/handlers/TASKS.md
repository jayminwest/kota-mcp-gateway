# Tasks Handler

MCP handler for viewing and creating tasks in AI Developer Workflow (ADW) task queues across multiple projects.

## Overview

The Tasks handler provides read/write access to task queues, enabling Claude and other MCP clients to:
- List and filter tasks across project queues
- View task details
- Create new tasks with metadata
- Update task metadata
- Delete tasks

Task lifecycle operations (claim/start/complete/fail) are handled via the REST API for ADW automation.

Each project has an isolated SQLite task queue.

## Authentication

No authentication required - the handler accesses local SQLite databases in `data/tasks_*.db`.

## Configuration

Tasks are managed per-project via `data/projects.json`:

```json
{
  "projects": [
    {
      "id": "kotadb",
      "name": "KotaDB",
      "description": "Main KotaDB AI Developer Workflows",
      "enabled": true
    }
  ]
}
```

## Available Tools

### Project Management

#### `tasks_list_projects`
List all enabled projects.

**Input**: None

**Example**:
```json
{}
```

**Output**:
```json
{
  "projects": [
    {
      "id": "kotadb",
      "name": "KotaDB",
      "description": "Main KotaDB AI Developer Workflows"
    }
  ],
  "count": 1
}
```

---

### Task Lifecycle

#### `tasks_list`
List tasks with optional filters.

**Input**:
- `project_id` (string, required): Project to query
- `status` (string | string[], optional): Filter by status(es)
- `priority` (string, optional): Filter by priority (low, medium, high)
- `limit` (number, optional): Max tasks to return (default: 10, max: 100)
- `offset` (number, optional): Pagination offset (default: 0)

**Example**:
```json
{
  "project_id": "kotadb",
  "status": "pending",
  "priority": "high",
  "limit": 5
}
```

**Output**: Array of task objects

---

#### `tasks_get`
Get a specific task by ID.

**Input**:
- `project_id` (string, required)
- `task_id` (string, required)

**Example**:
```json
{
  "project_id": "kotadb",
  "task_id": "task-abc123"
}
```

---

#### `tasks_create`
Create a new task.

**Input**:
- `project_id` (string, required)
- `title` (string, required, 1-200 chars)
- `description` (string, required, 1-5000 chars)
- `priority` (string, optional): "low", "medium", "high" (default: "medium")
- `tags` (object, optional): Arbitrary key-value tags
- `worktree` (string | null, optional): Git worktree name

**Example**:
```json
{
  "project_id": "kotadb",
  "title": "Add rate limiting middleware",
  "description": "Implement tier-based rate limiting for API endpoints using existing auth system. Support free (100/hr), solo (1000/hr), and team (10000/hr) tiers.",
  "priority": "high",
  "tags": {
    "model": "sonnet",
    "workflow": "complex"
  }
}
```

---

### Task Management

#### `tasks_update`
Update task metadata (cannot change status).

**Input**:
- `project_id` (string, required)
- `task_id` (string, required)
- `title` (string, optional, 1-200 chars)
- `description` (string, optional, 1-5000 chars)
- `priority` (string, optional): "low", "medium", "high"
- `tags` (object, optional): Replaces existing tags
- `worktree` (string, optional)

**Example**:
```json
{
  "project_id": "kotadb",
  "task_id": "task-abc123",
  "priority": "high",
  "tags": {
    "model": "opus",
    "urgent": "true"
  }
}
```

---

#### `tasks_delete`
Delete a task by ID.

**Input**:
- `project_id` (string, required)
- `task_id` (string, required)

**Example**:
```json
{
  "project_id": "kotadb",
  "task_id": "task-abc123"
}
```

---

## Task Status Lifecycle

Tasks follow this lifecycle:

```
pending → claimed → in_progress → completed (terminal)
                                → failed (terminal)
```

**MCP Handler Scope**: This handler provides read/view access to all task statuses and allows creation of new `pending` tasks.

**Lifecycle Management**: State transitions (claim/start/complete/fail) are managed through the REST API at `/api/tasks/:project_id/*`. See `docs/KOTADB_API_REFERENCE.md` for details.

---

## Typical Usage

### Task Discovery and Creation

```javascript
// 1. List available projects
tasks_list_projects {}

// 2. View pending tasks
tasks_list {
  "project_id": "kotadb",
  "status": "pending",
  "priority": "high",
  "limit": 10
}

// 3. Create a new task
tasks_create {
  "project_id": "kotadb",
  "title": "Add rate limiting middleware",
  "description": "Implement tier-based rate limiting...",
  "priority": "high",
  "tags": {
    "model": "sonnet",
    "workflow": "complex"
  }
}

// 4. View task details
tasks_get {
  "project_id": "kotadb",
  "task_id": "task-abc123"
}

// 5. Update task metadata
tasks_update {
  "project_id": "kotadb",
  "task_id": "task-abc123",
  "priority": "high"
}
```

### ADW Automation

For automated task execution (claim/start/complete/fail), use the REST API:
- See `docs/KOTADB_API_REFERENCE.md` for REST endpoints
- Lifecycle operations require ADW ID tracking
- REST API available at `/api/tasks/:project_id/*`

---

## Task Object Schema

```typescript
{
  task_id: string;           // e.g., "task-abc123"
  title: string;             // Task title
  description: string;       // Detailed description
  status: 'pending' | 'claimed' | 'in_progress' | 'completed' | 'failed';
  created_at: string;        // ISO timestamp
  claimed_at: string | null; // ISO timestamp when claimed
  completed_at: string | null; // ISO timestamp when completed/failed
  priority: 'low' | 'medium' | 'high' | null;
  tags: Record<string, string>; // Arbitrary key-value tags
  worktree: string | null;   // Git worktree name
  adw_id: string | null;     // ADW execution ID (set when claimed)
  result: Record<string, any> | null; // Result data (set when completed)
  error: string | null;      // Error message (set when failed)
}
```

---

## Common Task Tags

While `tags` accepts any key-value pairs, here are common conventions:

```json
{
  "model": "sonnet" | "opus",        // Preferred Claude model
  "workflow": "simple" | "complex",  // Task complexity
  "repository": "github.com/...",    // Target repo (if not default)
  "priority_boost": "urgent",        // Flag urgent tasks
  "estimated_hours": "2"             // Time estimate
}
```

---

## Error Handling

All errors are returned as:
```json
{
  "error": "Human-readable error message"
}
```

**Common Errors**:
- `Project '<id>' not found or not enabled`
- `Task not found`

---

## Notes

- Each project has an isolated SQLite database (`data/tasks_<project_id>.db`)
- Tasks are ordered by `created_at DESC` in list queries
- The handler caches database connections per project for efficiency
- Projects are loaded from `data/projects.json` on first access
- Use `tasks_list_projects` to discover available queues
- Task lifecycle operations (claim/start/complete/fail) require REST API access

---

## REST API Integration

The Tasks handler provides read/create/update/delete access. For full ADW lifecycle management:

- **MCP Tools** (this handler): View, create, update, delete tasks
- **REST API** (`/api/tasks/:project_id/*`): Claim, start, complete, fail operations

**Example**:
- MCP: `tasks_list { "project_id": "kotadb", "status": "pending" }`
- REST: `GET /api/tasks/kotadb?status=pending`

See `docs/KOTADB_API_REFERENCE.md` for complete REST API documentation.

---

## Examples

### Create and view tasks
```json
// List projects
tasks_list_projects {}

// Create a task
tasks_create {
  "project_id": "kotadb",
  "title": "Fix typo in README",
  "description": "Change 'indexng' to 'indexing' on line 42",
  "priority": "low"
}

// List pending tasks
tasks_list {
  "project_id": "kotadb",
  "status": "pending",
  "limit": 10
}

// Get task details
tasks_get {
  "project_id": "kotadb",
  "task_id": "task-xyz789"
}

// Update priority
tasks_update {
  "project_id": "kotadb",
  "task_id": "task-xyz789",
  "priority": "high"
}
```

### Filter by multiple statuses
```json
tasks_list {
  "project_id": "kotadb",
  "status": ["claimed", "in_progress"],
  "limit": 10
}
```

### Pagination
```json
// Page 1
tasks_list {
  "project_id": "kotadb",
  "status": "completed",
  "limit": 10,
  "offset": 0
}

// Page 2
tasks_list {
  "project_id": "kotadb",
  "status": "completed",
  "limit": 10,
  "offset": 10
}
```
