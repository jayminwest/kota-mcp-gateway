# Multi-Project Extension Analysis for Home Server API

**Date**: 2025-10-11
**Current Status**: Single project (KotaDB hardcoded)
**Target State**: Multi-project support with isolated task queues

---

## Executive Summary

The current Home Server API implementation is KotaDB-specific with hardcoded paths (`/api/kota-tasks`) and database naming (`kota_tasks.db`). To support multiple projects (KotaDB, personal projects, client projects, etc.), we need to extend the system with **project namespacing** while maintaining the same task data schema and lifecycle management.

### Key Findings

1. **Current Architecture**: Single TasksDatabase instance with hardcoded naming
2. **Multi-tenancy Approach**: Three viable options analyzed below
3. **Minimal Impact**: Core task schema and logic remain unchanged
4. **API Changes**: URL structure needs project identification
5. **Backward Compatibility**: Can maintain existing `/api/kota-tasks` routes

---

## Current Implementation Analysis

### Current File Structure

```
src/
├── utils/
│   └── tasks-db.ts          # TasksDatabase class (hardcoded 'kota_tasks.db')
└── routes/
    └── tasks.ts             # Router mounted at '/api/kota-tasks'

data/
└── kota_tasks.db            # SQLite database (auto-created)
```

### Current Database Schema

```sql
CREATE TABLE kota_tasks (
    task_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    claimed_at TEXT,
    completed_at TEXT,
    priority TEXT,
    tags TEXT DEFAULT '{}',
    worktree TEXT,
    adw_id TEXT,
    result TEXT,
    error TEXT,
    CHECK (status IN ('pending', 'claimed', 'in_progress', 'completed', 'failed')),
    CHECK (priority IN ('low', 'medium', 'high') OR priority IS NULL)
);
```

### Current API Routes

- `GET /api/kota-tasks` - List tasks
- `GET /api/kota-tasks/:id` - Get task
- `POST /api/kota-tasks` - Create task
- `POST /api/kota-tasks/:id/claim` - Claim task
- `POST /api/kota-tasks/:id/start` - Start task
- `POST /api/kota-tasks/:id/complete` - Complete task
- `POST /api/kota-tasks/:id/fail` - Fail task
- `PATCH /api/kota-tasks/:id` - Update task
- `DELETE /api/kota-tasks/:id` - Delete task

---

## Multi-Project Architecture Options

### Option 1: Project-Scoped Routes (Recommended)

**Concept**: Add project identifier to URL path

**New URL Structure**:
```
/api/tasks/:project_id/...
```

**Examples**:
```
GET  /api/tasks/kotadb/tasks
GET  /api/tasks/personal/tasks
POST /api/tasks/client-acme/tasks
```

**Backward Compatibility**:
```
/api/kota-tasks → /api/tasks/kotadb  (alias or redirect)
```

#### Implementation Details

**1. Database Strategy**: One database per project

```
data/
├── tasks_kotadb.db
├── tasks_personal.db
└── tasks_client-acme.db
```

**2. TasksDatabase Modification**:

```typescript
// src/utils/tasks-db.ts
export class TasksDatabase {
  constructor(
    private readonly dataDir: string,
    private readonly projectId: string,  // NEW
    private readonly logger: Logger
  ) {}

  async init(): Promise<void> {
    const dbPath = path.join(this.dataDir, `tasks_${this.projectId}.db`);
    // ... rest remains the same
  }
}
```

**3. Router Factory**:

```typescript
// src/routes/tasks.ts - No changes needed to router logic
// Just pass different db instances per project
```

**4. Express Integration**:

```typescript
// src/index.ts
const projects = ['kotadb', 'personal', 'client-acme'];

for (const projectId of projects) {
  const db = new TasksDatabase(config.DATA_DIR, projectId, logger);
  await db.init();
  app.use(`/api/tasks/${projectId}`, createTasksRouter({ db, logger }));
}

// Backward compatibility alias
app.use('/api/kota-tasks', app._router.stack.find(
  layer => layer.path === '/api/tasks/kotadb'
).handle);
```

#### Pros & Cons

**Pros**:
- ✅ Complete data isolation per project
- ✅ Simple to understand and maintain
- ✅ Easy to backup/restore individual projects
- ✅ No schema changes required
- ✅ Clean RESTful URLs
- ✅ Per-project database scaling

**Cons**:
- ❌ Need to configure projects upfront (or add dynamic registration)
- ❌ More database connections (minimal overhead for SQLite)
- ❌ Can't query across projects easily

---

### Option 2: Single Database with Project Column

**Concept**: Add `project_id` column to single tasks table

**URL Structure**: Same as Option 1
```
/api/tasks/:project_id/...
```

#### Implementation Details

**1. Database Strategy**: Single shared database

```
data/
└── tasks.db  (contains all projects)
```

**2. Schema Modification**:

```sql
CREATE TABLE tasks (
    task_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,  -- NEW
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    -- ... rest unchanged
);

CREATE INDEX idx_project_id ON tasks(project_id);
CREATE INDEX idx_project_status ON tasks(project_id, status);
```

**3. TasksDatabase Modification**:

```typescript
export class TasksDatabase {
  constructor(
    private readonly dataDir: string,
    private readonly projectId: string,
    private readonly logger: Logger
  ) {}

  async listTasks(filters: ListTasksFilters = {}): Promise<Task[]> {
    // Add WHERE project_id = ? to all queries
    let query = 'SELECT * FROM tasks WHERE project_id = ?';
    const params: any[] = [this.projectId];
    // ... rest of filter logic
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    // Add project_id to INSERT
    await db.run(
      `INSERT INTO tasks (
        task_id, project_id, title, description, ...
      ) VALUES (?, ?, ?, ?, ...)`,
      taskId,
      this.projectId,  // NEW
      input.title,
      // ...
    );
  }

  // Update all other methods similarly
}
```

#### Pros & Cons

**Pros**:
- ✅ Single database file
- ✅ Easier to query across projects (for admin/analytics)
- ✅ Simpler deployment (one db file)
- ✅ Can add project-agnostic queries easily

**Cons**:
- ❌ Schema migration required
- ❌ More complex queries (always filter by project_id)
- ❌ Potential for data leaks if project_id forgotten in query
- ❌ All projects share same database connection pool

---

### Option 3: Dynamic Project Registry with Config

**Concept**: Projects defined in config file, dynamically loaded

**Configuration**: Add projects config

```typescript
// src/utils/projects-config.ts
export interface ProjectConfig {
  id: string;
  name: string;
  description?: string;
  dataDir?: string;  // Optional: project-specific data dir
  enabled: boolean;
}

export async function loadProjects(dataDir: string): Promise<ProjectConfig[]> {
  const configPath = path.join(dataDir, 'projects.json');
  // Load and validate projects
}
```

**Example Config**:

```json
// data/projects.json
{
  "projects": [
    {
      "id": "kotadb",
      "name": "KotaDB",
      "description": "Main KotaDB project",
      "enabled": true
    },
    {
      "id": "personal",
      "name": "Personal Projects",
      "enabled": true
    },
    {
      "id": "client-acme",
      "name": "Acme Corp Client",
      "dataDir": "./data/clients/acme",
      "enabled": true
    }
  ]
}
```

**Express Integration**:

```typescript
// src/index.ts
const projects = await loadProjects(config.DATA_DIR);

for (const project of projects.filter(p => p.enabled)) {
  const projectDataDir = project.dataDir || config.DATA_DIR;
  const db = new TasksDatabase(projectDataDir, project.id, logger);
  await db.init();

  app.use(`/api/tasks/${project.id}`, createTasksRouter({
    db,
    logger,
    projectName: project.name
  }));

  logger.info({ projectId: project.id, projectName: project.name }, 'Project registered');
}

// Backward compatibility
app.use('/api/kota-tasks', (req, res, next) => {
  req.url = req.url.replace('/api/kota-tasks', '/api/tasks/kotadb');
  next();
});
```

#### Pros & Cons

**Pros**:
- ✅ Most flexible approach
- ✅ Easy to add/remove projects without code changes
- ✅ Per-project configuration (separate data dirs, etc.)
- ✅ Clean separation of concerns
- ✅ Can disable projects without deleting data

**Cons**:
- ❌ Additional config layer to maintain
- ❌ More complex initial setup
- ❌ Need validation and error handling for config

---

## Recommended Approach

**Recommendation**: **Option 3** (Dynamic Project Registry) built on top of **Option 1** (Separate Databases)

### Why This Combination?

1. **Data Isolation**: Each project has its own SQLite database
2. **Flexibility**: Add/remove projects via config without code changes
3. **No Schema Changes**: Existing task schema works as-is
4. **Scalability**: Easy to move project databases to different servers
5. **Security**: Project data naturally isolated
6. **Backward Compatible**: Can alias `/api/kota-tasks` to `/api/tasks/kotadb`

---

## Implementation Roadmap

### Phase 1: Add Project Parameter (Minimal Changes)

**Goal**: Make existing code project-aware without breaking anything

**Changes**:

1. **TasksDatabase Constructor**:
   ```typescript
   constructor(
     private readonly dataDir: string,
     private readonly projectId: string = 'kotadb',  // Default for backward compat
     private readonly logger: Logger
   ) {}
   ```

2. **Database File Naming**:
   ```typescript
   const dbPath = path.join(this.dataDir, `tasks_${this.projectId}.db`);
   ```

3. **Test**: Verify existing `/api/kota-tasks` routes still work

**Files Modified**:
- `src/utils/tasks-db.ts` (1 line change in constructor, 1 line in init)
- `src/index.ts` (pass 'kotadb' as project ID)

**Backward Compatible**: ✅ Yes

---

### Phase 2: Add Project Configuration

**Goal**: Enable multi-project via config

**Changes**:

1. **Create Projects Config**:
   ```typescript
   // src/utils/projects-config.ts
   export interface ProjectConfig {
     id: string;
     name: string;
     description?: string;
     enabled: boolean;
   }

   export async function loadProjects(dataDir: string): Promise<ProjectConfig[]>
   ```

2. **Default Config**:
   ```json
   // data/projects.json
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

3. **Update Express Integration**:
   ```typescript
   // src/index.ts
   const projects = await loadProjects(config.DATA_DIR);

   for (const project of projects.filter(p => p.enabled)) {
     const db = new TasksDatabase(config.DATA_DIR, project.id, logger);
     await db.init();
     app.use(`/api/tasks/${project.id}`, createTasksRouter({ db, logger }));
   }

   // Alias for backward compatibility
   app.use('/api/kota-tasks', (req, res, next) => {
     req.url = req.url.replace('/api/kota-tasks', '/api/tasks/kotadb');
     next();
   });
   ```

**Files Added**:
- `src/utils/projects-config.ts` (new)
- `data/projects.json` (new)

**Files Modified**:
- `src/index.ts` (replace hardcoded init with dynamic loop)

**Backward Compatible**: ✅ Yes (via alias)

---

### Phase 3: Add Project Management API (Optional)

**Goal**: Manage projects via API instead of editing JSON

**New Endpoints**:
```
GET    /api/projects          - List all projects
GET    /api/projects/:id      - Get project details
POST   /api/projects          - Create new project
PATCH  /api/projects/:id      - Update project config
DELETE /api/projects/:id      - Disable project (soft delete)
```

**Example Response**:
```json
{
  "projects": [
    {
      "id": "kotadb",
      "name": "KotaDB",
      "description": "Main KotaDB AI Developer Workflows",
      "enabled": true,
      "stats": {
        "total_tasks": 45,
        "pending": 3,
        "completed": 42,
        "failed": 0
      },
      "created_at": "2025-10-11T16:00:00Z"
    }
  ]
}
```

**Files Added**:
- `src/routes/projects.ts` (new)
- `src/utils/projects-db.ts` (new, for persisting project metadata)

---

## Migration Path for Existing Data

### If Using Option 1 (Separate DBs)

**Current State**:
```
data/kota_tasks.db
```

**Target State**:
```
data/tasks_kotadb.db
```

**Migration**:
```bash
# Rename existing database
mv data/kota_tasks.db data/tasks_kotadb.db
```

That's it! No schema changes needed.

---

### If Using Option 2 (Single DB with project_id)

**Migration SQL**:
```sql
-- 1. Add project_id column with default
ALTER TABLE kota_tasks ADD COLUMN project_id TEXT DEFAULT 'kotadb';

-- 2. Rename table
ALTER TABLE kota_tasks RENAME TO tasks;

-- 3. Add indexes
CREATE INDEX idx_project_id ON tasks(project_id);
CREATE INDEX idx_project_status ON tasks(project_id, status);

-- 4. Remove default (force explicit project_id for new tasks)
-- SQLite doesn't support removing defaults, so handle in application code
```

---

## API URL Design Comparison

### Current (Single Project)
```
GET  /api/kota-tasks?status=pending
POST /api/kota-tasks
POST /api/kota-tasks/task-001/claim
```

### Proposed (Multi-Project)
```
GET  /api/tasks/kotadb?status=pending
GET  /api/tasks/personal?status=pending
POST /api/tasks/kotadb
POST /api/tasks/personal
POST /api/tasks/kotadb/task-001/claim
POST /api/tasks/personal/task-002/claim
```

### With Project Management API
```
GET  /api/projects
POST /api/projects
GET  /api/projects/kotadb/stats

GET  /api/tasks/kotadb?status=pending
POST /api/tasks/kotadb
```

---

## Task Schema Extension (Future)

While the core schema stays the same, you might want to add project-specific metadata in the `tags` field:

**Example Task Tags**:
```json
{
  "tags": {
    "model": "sonnet",
    "workflow": "complex",
    "project_type": "client",        // NEW: project classification
    "repository": "github.com/...",  // NEW: target repo
    "billing_code": "ACME-2024-Q4"   // NEW: client billing
  }
}
```

Or extend the schema later:
```sql
ALTER TABLE tasks ADD COLUMN repository_url TEXT;
ALTER TABLE tasks ADD COLUMN billing_code TEXT;
```

---

## Security Considerations

### Project Isolation

1. **Database Level**: Separate databases ensure complete isolation (Option 1)
2. **Query Level**: Always filter by project_id (Option 2)
3. **API Level**: Project ID required in URL (both options)

### Access Control (Future Enhancement)

You might want to add project-level access control:

```typescript
interface ProjectConfig {
  id: string;
  name: string;
  enabled: boolean;
  accessControl?: {
    allowedClients: string[];  // List of adw_ids that can access
    requireAuth: boolean;      // Require API key for this project
  };
}
```

---

## Performance Considerations

### Separate Databases (Option 1)

**Pros**:
- Each project has dedicated connection pool
- No cross-project query overhead
- Easy to archive old project databases

**Cons**:
- More file handles (negligible for SQLite)
- Can't query across projects without joins

**Recommendation**: Use SQLite's `ATTACH DATABASE` if cross-project queries needed:
```sql
ATTACH DATABASE 'tasks_personal.db' AS personal;
SELECT * FROM main.tasks UNION SELECT * FROM personal.tasks;
```

### Single Database (Option 2)

**Pros**:
- Single connection pool
- Easy cross-project analytics

**Cons**:
- All projects share I/O bandwidth
- Project_id filter on every query (minimal overhead with index)

**Recommendation**: Add composite indexes:
```sql
CREATE INDEX idx_project_status_created ON tasks(project_id, status, created_at DESC);
```

---

## Testing Strategy

### Unit Tests

1. **TasksDatabase**: Test with different project IDs
   ```typescript
   test('creates separate databases per project', async () => {
     const db1 = new TasksDatabase('./test-data', 'project1', logger);
     const db2 = new TasksDatabase('./test-data', 'project2', logger);
     await db1.init();
     await db2.init();

     // Verify separate db files exist
     expect(fs.existsSync('./test-data/tasks_project1.db')).toBe(true);
     expect(fs.existsSync('./test-data/tasks_project2.db')).toBe(true);
   });
   ```

2. **Project Config**: Validate configuration loading

### Integration Tests

1. **Multi-Project Routes**:
   ```bash
   # Create task in project1
   curl -X POST http://localhost:3001/api/tasks/project1 \
     -d '{"title":"Test","description":"Test task"}'

   # Verify not visible in project2
   curl http://localhost:3001/api/tasks/project2?status=pending
   # Should return empty array
   ```

2. **Backward Compatibility**:
   ```bash
   # Old route should still work
   curl http://localhost:3001/api/kota-tasks?status=pending

   # Should be equivalent to new route
   curl http://localhost:3001/api/tasks/kotadb?status=pending
   ```

---

## Code Changes Summary

### Minimal Implementation (Phase 1 + 2)

**Files to Modify**:
1. `src/utils/tasks-db.ts` - Add projectId parameter (2 lines)
2. `src/index.ts` - Dynamic project registration (10-15 lines)

**Files to Add**:
1. `src/utils/projects-config.ts` - Project config loader (~50 lines)
2. `data/projects.json` - Initial config (~10 lines)

**Total Changes**: ~75 lines of code

### Full Implementation (Phase 1 + 2 + 3)

**Additional Files**:
1. `src/routes/projects.ts` - Project management API (~200 lines)
2. `src/utils/projects-db.ts` - Project metadata storage (~150 lines)

**Total Changes**: ~425 lines of code

---

## Deployment Checklist

- [ ] Choose architecture option (Recommended: Option 3)
- [ ] Update TasksDatabase constructor with projectId parameter
- [ ] Create projects-config.ts utility
- [ ] Create initial projects.json with kotadb project
- [ ] Update index.ts for dynamic project registration
- [ ] Add backward compatibility alias for /api/kota-tasks
- [ ] Test all endpoints with new project-scoped URLs
- [ ] Migrate existing kota_tasks.db to tasks_kotadb.db
- [ ] Update HOME_SERVER_API.md documentation
- [ ] Update API specification with project URLs
- [ ] Test ADW integration with new URLs
- [ ] (Optional) Implement project management API

---

## Example: Adding a New Project

### Step 1: Edit Config

```json
// data/projects.json
{
  "projects": [
    {
      "id": "kotadb",
      "name": "KotaDB",
      "enabled": true
    },
    {
      "id": "personal-blog",
      "name": "Personal Blog",
      "description": "My personal website tasks",
      "enabled": true
    }
  ]
}
```

### Step 2: Restart Server

```bash
npm restart
# Or: pm2 restart kota-gateway
```

### Step 3: Start Using New Project

```bash
# Create a task
curl -X POST http://localhost:3001/api/tasks/personal-blog \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Write new blog post",
    "description": "Write about multi-project task management",
    "priority": "medium"
  }'

# List tasks
curl http://localhost:3001/api/tasks/personal-blog?status=pending
```

That's it! No code changes needed.

---

## Questions to Consider

Before implementing, decide on:

1. **Max Number of Projects**: Do you need 5 projects? 50? This affects whether separate DBs or single DB is better.

2. **Cross-Project Queries**: Will you ever need to query tasks across projects? (e.g., "show me all my pending tasks")

3. **Project Lifecycle**: Are projects long-lived or temporary? Should you support archiving?

4. **Access Control**: Will different ADWs have access to different projects?

5. **Project Metadata**: Do you need to track project-specific config (repo URL, default tags, etc.)?

---

## Conclusion

**Recommended Path**:
1. Start with **Option 1** (Separate Databases) + **Option 3** (Config-based)
2. Implement **Phase 1 + 2** first (~75 lines of code)
3. Add **Phase 3** (Management API) if needed later

This gives you:
- ✅ Clean project isolation
- ✅ No schema changes
- ✅ Easy to add projects
- ✅ Backward compatible
- ✅ Minimal code changes
- ✅ Future-proof architecture

The existing task schema, status transitions, and API logic all remain exactly the same - you're just adding a project dimension on top.
