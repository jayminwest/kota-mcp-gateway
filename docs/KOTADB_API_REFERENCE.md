# KotaDB Tasks API Reference

**Project**: KotaDB AI Developer Workflows
**Base URL**: `https://jaymins-mac-pro.tail1b7f44.ts.net`
**API Prefix**: `/api/tasks/kotadb`
**Authentication**: None (Tailscale network security)
**Content-Type**: `application/json`

---

## Quick Start

All KotaDB task endpoints are prefixed with `/api/tasks/kotadb`.

```bash
# Base endpoint for KotaDB project
BASE_URL="https://jaymins-mac-pro.tail1b7f44.ts.net/api/tasks/kotadb"

# Or for local development
BASE_URL="http://localhost:3000/api/tasks/kotadb"
```

---

## API Endpoints

### 1. List Tasks

**GET** `/api/tasks/kotadb`

Fetch tasks with optional filtering.

**Query Parameters**:
- `status` (string | string[]): Filter by status (pending, claimed, in_progress, completed, failed)
- `limit` (number): Maximum tasks to return (default: 10)
- `priority` (string): Filter by priority (low, medium, high)

**Examples**:
```bash
# Get all pending tasks
curl "${BASE_URL}?status=pending"

# Get high-priority pending tasks
curl "${BASE_URL}?status=pending&priority=high&limit=5"

# Get multiple statuses
curl "${BASE_URL}?status=pending&status=claimed"
```

**Response**: `200 OK`
```json
[
  {
    "task_id": "task-abc123",
    "title": "Add rate limiting middleware",
    "description": "Implement tier-based rate limiting for API endpoints...",
    "status": "pending",
    "priority": "high",
    "tags": {
      "model": "sonnet",
      "workflow": "complex"
    },
    "worktree": null,
    "created_at": "2025-10-11T10:30:00Z",
    "claimed_at": null,
    "completed_at": null,
    "adw_id": null,
    "result": null,
    "error": null
  }
]
```

---

### 2. Get Task by ID

**GET** `/api/tasks/kotadb/{task_id}`

Retrieve a specific task.

**Example**:
```bash
curl "${BASE_URL}/task-abc123"
```

**Response**: `200 OK`
```json
{
  "task_id": "task-abc123",
  "title": "Add rate limiting middleware",
  "description": "Implement tier-based rate limiting...",
  "status": "pending",
  "priority": "high",
  "tags": {
    "model": "sonnet",
    "workflow": "complex"
  },
  "worktree": null,
  "created_at": "2025-10-11T10:30:00Z",
  "claimed_at": null,
  "completed_at": null,
  "adw_id": null,
  "result": null,
  "error": null
}
```

**Error**: `404 Not Found`
```json
{
  "error": "Task not found",
  "task_id": "task-abc123",
  "timestamp": "2025-10-11T14:30:00Z"
}
```

---

### 3. Create Task

**POST** `/api/tasks/kotadb`

Create a new task in the KotaDB project.

**Request Body**:
```json
{
  "title": "Add rate limiting middleware",
  "description": "Implement tier-based rate limiting for API endpoints using the existing auth system. Should support free (100/hr), solo (1000/hr), and team (10000/hr) tiers.",
  "priority": "high",
  "tags": {
    "model": "sonnet",
    "workflow": "complex"
  },
  "worktree": null
}
```

**Required Fields**:
- `title` (string, 1-200 characters)
- `description` (string, 1-5000 characters)

**Optional Fields**:
- `priority` ("low" | "medium" | "high", default: "medium")
- `tags` (object, default: {})
- `worktree` (string | null, default: null)

**Example**:
```bash
curl -X POST "${BASE_URL}" \
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

**Response**: `201 Created`
```json
{
  "task_id": "task-xyz789",
  "title": "Fix typo in README",
  "description": "Change indexng to indexing on line 42",
  "status": "pending",
  "priority": "low",
  "tags": {
    "model": "sonnet",
    "workflow": "simple"
  },
  "worktree": null,
  "created_at": "2025-10-11T14:30:00Z",
  "claimed_at": null,
  "completed_at": null,
  "adw_id": null,
  "result": null,
  "error": null
}
```

---

### 4. Claim Task

**POST** `/api/tasks/kotadb/{task_id}/claim`

Claim a pending task for execution. This marks the task as `claimed` and associates it with your ADW instance.

**Request Body**:
```json
{
  "adw_id": "adw-12345",
  "worktree": "feat-rate-limiting"
}
```

**Required Fields**:
- `adw_id` (string): Your ADW execution ID

**Optional Fields**:
- `worktree` (string): Git worktree name for this task

**Example**:
```bash
curl -X POST "${BASE_URL}/task-abc123/claim" \
  -H "Content-Type: application/json" \
  -d '{
    "adw_id": "adw-12345",
    "worktree": "feat-rate-limiting"
  }'
```

**Response**: `200 OK`
```json
{
  "task_id": "task-abc123",
  "title": "Add rate limiting middleware",
  "status": "claimed",
  "claimed_at": "2025-10-11T14:22:15Z",
  "adw_id": "adw-12345",
  "worktree": "feat-rate-limiting"
}
```

**Errors**:
- `404 Not Found`: Task doesn't exist
- `400 Bad Request`: Task is not in `pending` status
- `400 Bad Request`: Invalid adw_id

---

### 5. Start Task

**POST** `/api/tasks/kotadb/{task_id}/start`

Mark a claimed task as `in_progress`. Must be called after claiming and before completing.

**Request Body**:
```json
{
  "adw_id": "adw-12345"
}
```

**Example**:
```bash
curl -X POST "${BASE_URL}/task-abc123/start" \
  -H "Content-Type: application/json" \
  -d '{
    "adw_id": "adw-12345"
  }'
```

**Response**: `200 OK`
```json
{
  "task_id": "task-abc123",
  "status": "in_progress",
  "adw_id": "adw-12345"
}
```

**Errors**:
- `404 Not Found`: Task doesn't exist
- `400 Bad Request`: Task is not in `claimed` status
- `403 Forbidden`: ADW ID mismatch (you didn't claim this task)

---

### 6. Complete Task

**POST** `/api/tasks/kotadb/{task_id}/complete`

Mark a task as completed with execution results.

**Request Body**:
```json
{
  "adw_id": "adw-12345",
  "commit_hash": "a1b2c3d4e",
  "worktree": "feat-rate-limiting",
  "result": {
    "files_changed": 5,
    "lines_added": 247,
    "lines_removed": 18,
    "tests_passed": true,
    "plan_path": "docs/specs/plan-abc12345.md"
  }
}
```

**Required Fields**:
- `adw_id` (string): Your ADW execution ID

**Optional Fields**:
- `commit_hash` (string): Git commit hash
- `worktree` (string): Git worktree used
- `result` (object): Arbitrary result data

**Example**:
```bash
curl -X POST "${BASE_URL}/task-abc123/complete" \
  -H "Content-Type: application/json" \
  -d '{
    "adw_id": "adw-12345",
    "commit_hash": "a1b2c3d4e",
    "result": {
      "files_changed": 5,
      "tests_passed": true,
      "plan_path": "docs/specs/plan-abc12345.md"
    }
  }'
```

**Response**: `200 OK`
```json
{
  "task_id": "task-abc123",
  "title": "Add rate limiting middleware",
  "status": "completed",
  "completed_at": "2025-10-11T14:45:30Z",
  "adw_id": "adw-12345",
  "result": {
    "files_changed": 5,
    "tests_passed": true,
    "plan_path": "docs/specs/plan-abc12345.md",
    "commit_hash": "a1b2c3d4e"
  }
}
```

**Errors**:
- `404 Not Found`: Task doesn't exist
- `400 Bad Request`: Task is not in `claimed` or `in_progress` status
- `403 Forbidden`: ADW ID mismatch

---

### 7. Fail Task

**POST** `/api/tasks/kotadb/{task_id}/fail`

Mark a task as failed with error information.

**Request Body**:
```json
{
  "adw_id": "adw-12345",
  "error": "Planning phase failed: Could not parse requirements",
  "worktree": "feat-rate-limiting"
}
```

**Required Fields**:
- `adw_id` (string): Your ADW execution ID
- `error` (string): Error message

**Optional Fields**:
- `worktree` (string): Git worktree used

**Example**:
```bash
curl -X POST "${BASE_URL}/task-abc123/fail" \
  -H "Content-Type: application/json" \
  -d '{
    "adw_id": "adw-12345",
    "error": "Planning phase failed: Could not parse requirements"
  }'
```

**Response**: `200 OK`
```json
{
  "task_id": "task-abc123",
  "title": "Add rate limiting middleware",
  "status": "failed",
  "completed_at": "2025-10-11T14:45:30Z",
  "adw_id": "adw-12345",
  "error": "Planning phase failed: Could not parse requirements"
}
```

**Errors**:
- `404 Not Found`: Task doesn't exist
- `403 Forbidden`: ADW ID mismatch (if task already claimed by another ADW)

---

### 8. Update Task (Optional)

**PATCH** `/api/tasks/kotadb/{task_id}`

Update task metadata. Cannot update status - use lifecycle endpoints instead.

**Request Body** (all fields optional):
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

**Example**:
```bash
curl -X PATCH "${BASE_URL}/task-abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "priority": "high"
  }'
```

**Response**: `200 OK` (returns full updated task)

**Errors**:
- `404 Not Found`: Task doesn't exist
- `400 Bad Request`: Attempted to update status directly

---

### 9. Delete Task

**DELETE** `/api/tasks/kotadb/{task_id}`

Delete a task from the KotaDB project.

**Example**:
```bash
curl -X DELETE "${BASE_URL}/task-abc123"
```

**Response**: `204 No Content`

**Errors**:
- `404 Not Found`: Task doesn't exist

---

## Typical ADW Workflow

Here's the recommended workflow for KotaDB ADW agents:

### 1. Poll for Pending Tasks
```bash
# Get high-priority pending tasks
curl "${BASE_URL}?status=pending&priority=high&limit=1"
```

### 2. Claim a Task
```bash
curl -X POST "${BASE_URL}/task-abc123/claim" \
  -H "Content-Type: application/json" \
  -d '{
    "adw_id": "adw-kotadb-001",
    "worktree": "auto-feat-rate-limiting"
  }'
```

### 3. Start the Task
```bash
curl -X POST "${BASE_URL}/task-abc123/start" \
  -H "Content-Type: application/json" \
  -d '{
    "adw_id": "adw-kotadb-001"
  }'
```

### 4. Execute Work
```python
# Your ADW does the actual work here:
# - Create git worktree
# - Generate implementation plan
# - Write code
# - Run tests
# - Create commit
```

### 5a. Complete Successfully
```bash
curl -X POST "${BASE_URL}/task-abc123/complete" \
  -H "Content-Type: application/json" \
  -d '{
    "adw_id": "adw-kotadb-001",
    "commit_hash": "a1b2c3d4e",
    "result": {
      "files_changed": 5,
      "tests_passed": true,
      "plan_path": "docs/specs/plan-001.md"
    }
  }'
```

### 5b. Or Fail with Error
```bash
curl -X POST "${BASE_URL}/task-abc123/fail" \
  -H "Content-Type: application/json" \
  -d '{
    "adw_id": "adw-kotadb-001",
    "error": "Test suite failed: 3 tests failing"
  }'
```

---

## Status Transitions

Valid state transitions:

```
pending → claimed → in_progress → completed
                                → failed

(Tasks can also fail from pending or claimed states)
```

**Rules**:
- Only `pending` tasks can be claimed
- Only `claimed` tasks can be started
- Only `claimed` or `in_progress` tasks can be completed
- `completed` and `failed` are terminal states (cannot transition out)

---

## Common Task Tags

While the `tags` field accepts any key-value pairs, here are common conventions for KotaDB:

```json
{
  "model": "sonnet" | "opus",           // Preferred Claude model
  "workflow": "simple" | "complex",     // Task complexity
  "repository": "github.com/...",       // Target repo (if not default)
  "priority_boost": "urgent",           // Flag urgent tasks
  "estimated_hours": "2"                // Time estimate
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Human-readable error message",
  "details": {
    "field": "Additional context"
  },
  "timestamp": "2025-10-11T14:30:00Z"
}
```

**Common HTTP Status Codes**:
- `200 OK`: Successful operation
- `201 Created`: Task created successfully
- `204 No Content`: Task deleted successfully
- `400 Bad Request`: Invalid input or state transition
- `403 Forbidden`: ADW ID mismatch
- `404 Not Found`: Task doesn't exist
- `500 Internal Server Error`: Server error

---

## Python Example

```python
import requests
from typing import Dict, List, Optional

BASE_URL = "https://jaymins-mac-pro.tail1b7f44.ts.net/api/tasks/kotadb"
ADW_ID = "adw-kotadb-001"

class KotaDBTaskClient:
    def __init__(self, base_url: str, adw_id: str):
        self.base_url = base_url
        self.adw_id = adw_id

    def get_pending_tasks(self, priority: Optional[str] = None, limit: int = 10) -> List[Dict]:
        """Fetch pending tasks."""
        params = {"status": "pending", "limit": limit}
        if priority:
            params["priority"] = priority

        response = requests.get(self.base_url, params=params)
        response.raise_for_status()
        return response.json()

    def claim_task(self, task_id: str, worktree: Optional[str] = None) -> Dict:
        """Claim a task for execution."""
        data = {"adw_id": self.adw_id}
        if worktree:
            data["worktree"] = worktree

        response = requests.post(
            f"{self.base_url}/{task_id}/claim",
            json=data
        )
        response.raise_for_status()
        return response.json()

    def start_task(self, task_id: str) -> Dict:
        """Start executing a claimed task."""
        response = requests.post(
            f"{self.base_url}/{task_id}/start",
            json={"adw_id": self.adw_id}
        )
        response.raise_for_status()
        return response.json()

    def complete_task(self, task_id: str, result: Dict, commit_hash: Optional[str] = None) -> Dict:
        """Mark task as completed."""
        data = {
            "adw_id": self.adw_id,
            "result": result
        }
        if commit_hash:
            data["commit_hash"] = commit_hash

        response = requests.post(
            f"{self.base_url}/{task_id}/complete",
            json=data
        )
        response.raise_for_status()
        return response.json()

    def fail_task(self, task_id: str, error: str) -> Dict:
        """Mark task as failed."""
        response = requests.post(
            f"{self.base_url}/{task_id}/fail",
            json={"adw_id": self.adw_id, "error": error}
        )
        response.raise_for_status()
        return response.json()

# Usage example
client = KotaDBTaskClient(BASE_URL, ADW_ID)

# Get a pending task
tasks = client.get_pending_tasks(priority="high", limit=1)
if not tasks:
    print("No pending tasks")
    exit(0)

task = tasks[0]
task_id = task["task_id"]
print(f"Found task: {task['title']}")

# Claim and execute
try:
    client.claim_task(task_id, worktree=f"auto-{task_id}")
    client.start_task(task_id)

    # ... do the actual work ...

    result = {
        "files_changed": 3,
        "tests_passed": True,
        "plan_path": "docs/specs/plan-001.md"
    }
    client.complete_task(task_id, result, commit_hash="abc123")
    print(f"Task {task_id} completed successfully")

except Exception as e:
    print(f"Task failed: {e}")
    client.fail_task(task_id, str(e))
```

---

## TypeScript/Node.js Example

```typescript
import axios, { AxiosInstance } from 'axios';

const BASE_URL = 'https://jaymins-mac-pro.tail1b7f44.ts.net/api/tasks/kotadb';
const ADW_ID = 'adw-kotadb-001';

interface Task {
  task_id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  tags: Record<string, string>;
  // ... other fields
}

class KotaDBTaskClient {
  private client: AxiosInstance;

  constructor(private baseURL: string, private adwId: string) {
    this.client = axios.create({ baseURL });
  }

  async getPendingTasks(priority?: string, limit: number = 10): Promise<Task[]> {
    const params: any = { status: 'pending', limit };
    if (priority) params.priority = priority;

    const response = await this.client.get('/', { params });
    return response.data;
  }

  async claimTask(taskId: string, worktree?: string): Promise<Task> {
    const data: any = { adw_id: this.adwId };
    if (worktree) data.worktree = worktree;

    const response = await this.client.post(`/${taskId}/claim`, data);
    return response.data;
  }

  async startTask(taskId: string): Promise<Task> {
    const response = await this.client.post(`/${taskId}/start`, {
      adw_id: this.adwId
    });
    return response.data;
  }

  async completeTask(
    taskId: string,
    result: Record<string, any>,
    commitHash?: string
  ): Promise<Task> {
    const data: any = { adw_id: this.adwId, result };
    if (commitHash) data.commit_hash = commitHash;

    const response = await this.client.post(`/${taskId}/complete`, data);
    return response.data;
  }

  async failTask(taskId: string, error: string): Promise<Task> {
    const response = await this.client.post(`/${taskId}/fail`, {
      adw_id: this.adwId,
      error
    });
    return response.data;
  }
}

// Usage
const client = new KotaDBTaskClient(BASE_URL, ADW_ID);

async function processTask() {
  const tasks = await client.getPendingTasks('high', 1);
  if (tasks.length === 0) {
    console.log('No pending tasks');
    return;
  }

  const task = tasks[0];
  console.log(`Processing: ${task.title}`);

  try {
    await client.claimTask(task.task_id, `auto-${task.task_id}`);
    await client.startTask(task.task_id);

    // ... do work ...

    await client.completeTask(task.task_id, {
      files_changed: 3,
      tests_passed: true
    });

    console.log('Task completed successfully');
  } catch (error) {
    console.error('Task failed:', error);
    await client.failTask(task.task_id, String(error));
  }
}

processTask();
```

---

## Rate Limiting

Currently no rate limiting is enforced since the API is only accessible via Tailscale. However, to be a good citizen:

- Poll for tasks at reasonable intervals (e.g., every 30-60 seconds)
- Don't claim tasks you can't execute immediately
- Always mark tasks as completed or failed - don't leave them in `claimed` state

---

## Support

For issues with the KotaDB Tasks API:
- Check server logs on jaymins-mac-pro
- Review this documentation
- Check the main API specification: `docs/HOME_SERVER_API.md`
