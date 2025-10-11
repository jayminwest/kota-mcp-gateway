# Multi-Project Architecture Diagrams

## Current Architecture (Single Project)

```
┌─────────────────────────────────────────────────────┐
│                  Express Server                      │
│                                                       │
│  ┌────────────────────────────────────────────────┐ │
│  │         /api/kota-tasks                        │ │
│  │  (hardcoded route)                             │ │
│  └────────────────┬───────────────────────────────┘ │
│                   │                                  │
│  ┌────────────────▼───────────────────────────────┐ │
│  │         TasksDatabase                          │ │
│  │  (hardcoded 'kota_tasks.db')                   │ │
│  └────────────────┬───────────────────────────────┘ │
└───────────────────┼──────────────────────────────────┘
                    │
                    ▼
         ┌──────────────────┐
         │ kota_tasks.db    │
         └──────────────────┘
```

---

## Proposed Architecture (Multi-Project with Separate DBs)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Express Server                                   │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    Project Configuration                          │   │
│  │                   (data/projects.json)                            │   │
│  │                                                                    │   │
│  │  {                                                                 │   │
│  │    "projects": [                                                   │   │
│  │      { "id": "kotadb", "name": "KotaDB", "enabled": true },       │   │
│  │      { "id": "personal", "name": "Personal", "enabled": true },   │   │
│  │      { "id": "client-acme", "name": "Acme Corp", "enabled": true }│   │
│  │    ]                                                               │   │
│  │  }                                                                 │   │
│  └───────────────────────────┬──────────────────────────────────────┘   │
│                              │                                            │
│                              ▼                                            │
│         ┌────────────────────────────────────────────────┐               │
│         │      Dynamic Router Registration               │               │
│         │   (loops through enabled projects)             │               │
│         └─────┬──────────────┬──────────────┬───────────┘               │
│               │              │              │                             │
│    ┌──────────▼──────┐  ┌───▼──────┐  ┌───▼──────────┐                 │
│    │ /api/tasks/     │  │ /api/tasks/│  │ /api/tasks/  │                 │
│    │   kotadb        │  │  personal  │  │ client-acme  │                 │
│    │                 │  │            │  │              │                 │
│    │ TasksDatabase   │  │ TasksDatabase│  │TasksDatabase│                 │
│    │ (projectId:     │  │(projectId: │  │(projectId:   │                 │
│    │  'kotadb')      │  │'personal') │  │'client-acme')│                 │
│    └────────┬────────┘  └─────┬──────┘  └──────┬───────┘                 │
│             │                 │                 │                         │
└─────────────┼─────────────────┼─────────────────┼─────────────────────────┘
              │                 │                 │
              ▼                 ▼                 ▼
    ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
    │tasks_kotadb.db  │  │tasks_personal.db│  │tasks_client-    │
    │                 │  │                 │  │acme.db          │
    └─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## Backward Compatibility Layer

```
┌─────────────────────────────────────────────────────┐
│              Express Server                          │
│                                                       │
│  ┌────────────────────────────────────────────────┐ │
│  │  Old Route: /api/kota-tasks                    │ │
│  │  (backward compatibility alias)                │ │
│  └────────────────┬───────────────────────────────┘ │
│                   │                                  │
│                   │ redirects/rewrites to            │
│                   │                                  │
│  ┌────────────────▼───────────────────────────────┐ │
│  │  New Route: /api/tasks/kotadb                  │ │
│  │                                                 │ │
│  │  TasksDatabase(projectId: 'kotadb')            │ │
│  └────────────────┬───────────────────────────────┘ │
└───────────────────┼──────────────────────────────────┘
                    │
                    ▼
         ┌──────────────────┐
         │tasks_kotadb.db   │
         └──────────────────┘
```

---

## Request Flow: Multi-Project

```
1. Client Request
   │
   │  POST /api/tasks/personal
   │  { "title": "New task", "description": "..." }
   │
   ▼
2. Express Router
   │
   │  Matches route: /api/tasks/:project_id
   │  Extracts project_id: "personal"
   │
   ▼
3. Project-Specific TasksDatabase
   │
   │  TasksDatabase instance for "personal" project
   │  Connected to: tasks_personal.db
   │
   ▼
4. Database Operation
   │
   │  INSERT INTO tasks (task_id, title, description, ...)
   │  VALUES ('task-123', 'New task', '...', ...)
   │
   ▼
5. Response
   │
   │  201 Created
   │  { "task_id": "task-123", "title": "New task", ... }
   │
   └─► Client
```

---

## Project Lifecycle: Adding New Project

```
Step 1: Update Config
┌───────────────────────────────┐
│ data/projects.json            │
│                               │
│ {                             │
│   "projects": [               │
│     ...                       │
│     {                         │
│       "id": "new-project",    │
│       "name": "New Project",  │
│       "enabled": true         │
│     }                         │
│   ]                           │
│ }                             │
└───────────────────────────────┘
              │
              ▼
Step 2: Restart Server
┌───────────────────────────────┐
│ npm restart                   │
│ or                            │
│ pm2 restart kota-gateway      │
└───────────────────────────────┘
              │
              ▼
Step 3: Auto-Registration
┌───────────────────────────────┐
│ Server reads projects.json    │
│ Creates TasksDatabase         │
│ Registers route:              │
│   /api/tasks/new-project      │
│ Creates DB file:              │
│   tasks_new-project.db        │
└───────────────────────────────┘
              │
              ▼
Step 4: Ready to Use
┌───────────────────────────────┐
│ POST /api/tasks/new-project   │
│ GET  /api/tasks/new-project   │
│ etc...                        │
└───────────────────────────────┘
```

---

## Database File Structure

### Current (Single Project)
```
data/
├── kota_tasks.db
└── ... (other data)
```

### After Migration (Multi-Project)
```
data/
├── projects.json              ← NEW: Project configuration
├── tasks_kotadb.db           ← Renamed from kota_tasks.db
├── tasks_personal.db         ← NEW: Personal project
├── tasks_client-acme.db      ← NEW: Client project
└── ... (other data)
```

---

## Alternative: Single Database with Project Column

```
┌─────────────────────────────────────────────────────────────┐
│                    Express Server                            │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ /api/tasks/  │  │ /api/tasks/  │  │ /api/tasks/  │      │
│  │   kotadb     │  │   personal   │  │ client-acme  │      │
│  │              │  │              │  │              │      │
│  │TasksDatabase │  │TasksDatabase │  │TasksDatabase │      │
│  │(projectId:   │  │(projectId:   │  │(projectId:   │      │
│  │ 'kotadb')    │  │ 'personal')  │  │'client-acme')│      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                 │               │
│         └─────────────────┼─────────────────┘               │
│                           │                                 │
└───────────────────────────┼─────────────────────────────────┘
                            │
                            ▼
                 ┌────────────────────┐
                 │    tasks.db        │
                 │  (shared database) │
                 │                    │
                 │  Table: tasks      │
                 │  ├─ project_id     │
                 │  ├─ task_id        │
                 │  ├─ title          │
                 │  ├─ description    │
                 │  └─ ...            │
                 │                    │
                 │  Query filtering:  │
                 │  WHERE project_id  │
                 │    = 'kotadb'      │
                 └────────────────────┘
```

### Query Pattern (Single DB Approach)

```sql
-- Each TasksDatabase instance filters by its project_id

-- TasksDatabase(projectId: 'kotadb')
SELECT * FROM tasks WHERE project_id = 'kotadb' AND status = 'pending';

-- TasksDatabase(projectId: 'personal')
SELECT * FROM tasks WHERE project_id = 'personal' AND status = 'pending';

-- Cross-project admin query (optional)
SELECT project_id, COUNT(*) as task_count
FROM tasks
GROUP BY project_id;
```

---

## Comparison: Separate DBs vs Single DB

### Separate Databases (Recommended)

```
Pros:
✅ Complete isolation       ┌─────────────┐  ┌─────────────┐
✅ Independent backups      │ Project A   │  │ Project B   │
✅ Easy to archive          │   DB        │  │   DB        │
✅ No cross-contamination   └─────────────┘  └─────────────┘
✅ Parallel write scaling

Cons:
❌ More files
❌ Cross-project queries harder
```

### Single Database

```
Pros:
✅ Single file                  ┌─────────────────────┐
✅ Easy cross-project queries   │   Single DB         │
✅ Simpler backup               │                     │
                                │  ┌──────────────┐   │
Cons:                           │  │ Project A    │   │
❌ Shared resources             │  │ rows         │   │
❌ Migration required           │  ├──────────────┤   │
❌ Risk of data leaks           │  │ Project B    │   │
                                │  │ rows         │   │
                                │  └──────────────┘   │
                                └─────────────────────┘
```

---

## ADW Integration Flow

```
┌─────────────────┐
│   KotaDB ADW    │
│  (Project A)    │
└────────┬────────┘
         │
         │ 1. Poll for tasks
         │ GET /api/tasks/kotadb?status=pending
         │
         ▼
┌─────────────────────────────────┐
│     Home Server API              │
│                                  │
│  TasksDatabase('kotadb')        │
└────────┬────────────────────────┘
         │
         │ 2. Returns pending tasks
         │ [{ "task_id": "task-001", ... }]
         │
         ▼
┌─────────────────┐
│   KotaDB ADW    │
│                  │
│  3. Claim task   │
│  POST /api/tasks/kotadb/task-001/claim
└────────┬────────┘
         │
         │ 4. Execute work
         │ (git operations, code changes, tests)
         │
         ▼
┌─────────────────┐
│   KotaDB ADW    │
│                  │
│  5. Complete     │
│  POST /api/tasks/kotadb/task-001/complete
│  { "result": {...}, "commit_hash": "abc123" }
└─────────────────┘


┌─────────────────┐
│  Personal ADW   │
│  (Project B)    │
└────────┬────────┘
         │
         │ Same flow, different project
         │ GET /api/tasks/personal?status=pending
         │ POST /api/tasks/personal/task-002/claim
         │
         ▼
┌─────────────────────────────────┐
│     Home Server API              │
│                                  │
│  TasksDatabase('personal')      │
└──────────────────────────────────┘
```

---

## Security Model

### Current (No Isolation)
```
┌────────────────────────┐
│  All ADWs              │
│  access same endpoint  │
│                        │
│  /api/kota-tasks       │
└───────────┬────────────┘
            │
            ▼
     ┌──────────────┐
     │ Single DB    │
     │ All tasks    │
     └──────────────┘
```

### Multi-Project (With Isolation)
```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  KotaDB ADW  │    │ Personal ADW │    │  Client ADW  │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       │ /api/tasks/       │ /api/tasks/       │ /api/tasks/
       │   kotadb          │   personal        │   client-acme
       │                   │                   │
       ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ kotadb.db    │    │ personal.db  │    │ client-acme  │
│              │    │              │    │   .db        │
└──────────────┘    └──────────────┘    └──────────────┘

       ↑                   ↑                   ↑
       Cannot access ──────┴───────────────────┘
       other projects
```

### Future: Access Control (Optional)
```
┌────────────────────────────────────┐
│  Project Config                    │
│                                    │
│  {                                 │
│    "id": "client-acme",            │
│    "accessControl": {              │
│      "allowedClients": [           │
│        "adw-trusted-001"           │
│      ],                            │
│      "requireAuth": true           │
│    }                               │
│  }                                 │
└────────────────────────────────────┘
```

---

## Monitoring & Analytics

### Per-Project Metrics
```
GET /api/projects/kotadb/stats

{
  "project_id": "kotadb",
  "name": "KotaDB",
  "stats": {
    "total_tasks": 156,
    "by_status": {
      "pending": 5,
      "claimed": 2,
      "in_progress": 3,
      "completed": 142,
      "failed": 4
    },
    "avg_completion_time_hours": 2.3,
    "last_task_created": "2025-10-11T16:00:00Z"
  }
}
```

### Cross-Project Dashboard
```
GET /api/projects/summary

[
  {
    "project_id": "kotadb",
    "name": "KotaDB",
    "pending": 5,
    "in_progress": 3
  },
  {
    "project_id": "personal",
    "name": "Personal",
    "pending": 2,
    "in_progress": 1
  },
  {
    "project_id": "client-acme",
    "name": "Acme Corp",
    "pending": 0,
    "in_progress": 2
  }
]
```
