import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec, HandlerConfig } from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import {
  TasksDatabase,
  type CreateTaskInput,
  type UpdateTaskInput,
} from '../utils/tasks-db.js';
import { loadProjects, getEnabledProjects, type ProjectConfig } from '../utils/projects-config.js';

const TaskStatusEnum = z.enum(['pending', 'claimed', 'in_progress', 'completed', 'failed']);
const TaskPriorityEnum = z.enum(['low', 'medium', 'high']);

const ListSchema = z.object({
  project_id: z.string().min(1).describe('Project ID to query tasks from'),
  status: z.union([TaskStatusEnum, z.array(TaskStatusEnum)]).optional().describe('Filter by task status'),
  priority: TaskPriorityEnum.optional().describe('Filter by priority level'),
  limit: z.number().int().min(1).max(100).optional().describe('Maximum number of tasks to return (default: 10)'),
  offset: z.number().int().min(0).optional().describe('Number of tasks to skip for pagination (default: 0)'),
}).strip();

const GetSchema = z.object({
  project_id: z.string().min(1).describe('Project ID'),
  task_id: z.string().min(1).describe('Task ID to retrieve'),
}).strip();

const CreateSchema = z.object({
  project_id: z.string().min(1).describe('Project ID to create task in'),
  title: z.string().min(1).max(200).describe('Task title'),
  description: z.string().min(1).max(5000).describe('Detailed task description'),
  priority: TaskPriorityEnum.optional().describe('Priority level (default: medium)'),
  tags: z.record(z.string()).optional().describe('Arbitrary tags as key-value pairs'),
  worktree: z.string().nullable().optional().describe('Git worktree name (optional)'),
}).strip();

const UpdateSchema = z.object({
  project_id: z.string().min(1).describe('Project ID'),
  task_id: z.string().min(1).describe('Task ID to update'),
  title: z.string().min(1).max(200).optional().describe('New title'),
  description: z.string().min(1).max(5000).optional().describe('New description'),
  priority: TaskPriorityEnum.optional().describe('New priority level'),
  tags: z.record(z.string()).optional().describe('New tags (replaces existing tags)'),
  worktree: z.string().optional().describe('New worktree name'),
}).strip();

const DeleteSchema = z.object({
  project_id: z.string().min(1).describe('Project ID'),
  task_id: z.string().min(1).describe('Task ID to delete'),
}).strip();

export class TasksHandler extends BaseHandler {
  readonly prefix = 'tasks';
  private dbCache: Map<string, TasksDatabase> = new Map();
  private projectsCache: ProjectConfig[] | null = null;

  constructor(opts: { logger: Logger; config: HandlerConfig }) {
    super(opts);
  }

  private async getProjects(): Promise<ProjectConfig[]> {
    if (!this.projectsCache) {
      this.projectsCache = await loadProjects(this.config.DATA_DIR, this.logger);
    }
    return this.projectsCache;
  }

  private async getDatabase(projectId: string): Promise<TasksDatabase> {
    // Check if project exists and is enabled
    const projects = await this.getProjects();
    const enabledProjects = getEnabledProjects(projects);
    const project = enabledProjects.find(p => p.id === projectId);

    if (!project) {
      throw new Error(`Project '${projectId}' not found or not enabled`);
    }

    // Return cached database or create new one
    if (!this.dbCache.has(projectId)) {
      const db = new TasksDatabase(this.config.DATA_DIR, projectId, this.logger);
      await db.init();
      this.dbCache.set(projectId, db);
    }

    return this.dbCache.get(projectId)!;
  }

  getTools(): ToolSpec[] {
    return [
      {
        action: 'list_projects',
        description: 'List available task queue projects',
        inputSchema: {},
      },
      {
        action: 'list',
        description: 'List tasks with optional filters (status, priority, pagination)',
        inputSchema: {
          project_id: ListSchema.shape.project_id,
          status: ListSchema.shape.status,
          priority: ListSchema.shape.priority,
          limit: ListSchema.shape.limit,
          offset: ListSchema.shape.offset,
        },
      },
      {
        action: 'get',
        description: 'Get a specific task by ID',
        inputSchema: {
          project_id: GetSchema.shape.project_id,
          task_id: GetSchema.shape.task_id,
        },
      },
      {
        action: 'create',
        description: 'Create a new task in a project queue',
        inputSchema: {
          project_id: CreateSchema.shape.project_id,
          title: CreateSchema.shape.title,
          description: CreateSchema.shape.description,
          priority: CreateSchema.shape.priority,
          tags: CreateSchema.shape.tags,
          worktree: CreateSchema.shape.worktree,
        },
      },
      {
        action: 'update',
        description: 'Update task metadata (title, description, priority, tags, worktree)',
        inputSchema: {
          project_id: UpdateSchema.shape.project_id,
          task_id: UpdateSchema.shape.task_id,
          title: UpdateSchema.shape.title,
          description: UpdateSchema.shape.description,
          priority: UpdateSchema.shape.priority,
          tags: UpdateSchema.shape.tags,
          worktree: UpdateSchema.shape.worktree,
        },
      },
      {
        action: 'delete',
        description: 'Delete a task by ID',
        inputSchema: {
          project_id: DeleteSchema.shape.project_id,
          task_id: DeleteSchema.shape.task_id,
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    try {
      switch (action) {
        case 'list_projects':
          return await this.handleListProjects();
        case 'list':
          return await this.handleList(args);
        case 'get':
          return await this.handleGet(args);
        case 'create':
          return await this.handleCreate(args);
        case 'update':
          return await this.handleUpdate(args);
        case 'delete':
          return await this.handleDelete(args);
        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
      }
    } catch (err: any) {
      this.logger.error({ err, action, args }, 'Tasks handler error');
      const message = err?.message || String(err);
      return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
    }
  }

  private async handleListProjects(): Promise<CallToolResult> {
    const projects = await this.getProjects();
    const enabledProjects = getEnabledProjects(projects);

    const result = {
      projects: enabledProjects.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
      })),
      count: enabledProjects.length,
    };

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }

  private async handleList(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(ListSchema, raw);
    const db = await this.getDatabase(parsed.project_id);

    const filters: any = {
      status: parsed.status,
      priority: parsed.priority,
      limit: parsed.limit,
      offset: parsed.offset,
    };

    const tasks = await db.listTasks(filters);

    return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
  }

  private async handleGet(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(GetSchema, raw);
    const db = await this.getDatabase(parsed.project_id);

    const task = await db.getTask(parsed.task_id);

    if (!task) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Task not found', task_id: parsed.task_id }) }],
        isError: true,
      };
    }

    return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
  }

  private async handleCreate(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(CreateSchema, raw);
    const db = await this.getDatabase(parsed.project_id);

    const input: CreateTaskInput = {
      title: parsed.title,
      description: parsed.description,
      priority: parsed.priority,
      tags: parsed.tags,
      worktree: parsed.worktree,
    };

    const task = await db.createTask(input);

    return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
  }

  private async handleUpdate(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(UpdateSchema, raw);
    const db = await this.getDatabase(parsed.project_id);

    const input: UpdateTaskInput = {
      title: parsed.title,
      description: parsed.description,
      priority: parsed.priority,
      tags: parsed.tags,
      worktree: parsed.worktree,
    };

    const task = await db.updateTask(parsed.task_id, input);

    return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
  }

  private async handleDelete(raw: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(DeleteSchema, raw);
    const db = await this.getDatabase(parsed.project_id);

    await db.deleteTask(parsed.task_id);

    return {
      content: [{ type: 'text', text: JSON.stringify({ success: true, task_id: parsed.task_id, deleted: true }) }],
    };
  }
}
