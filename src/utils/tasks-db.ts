import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'node:path';
import type { Logger } from 'pino';
import { randomUUID } from 'node:crypto';

export type TaskStatus = 'pending' | 'claimed' | 'in_progress' | 'completed' | 'failed';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface Task {
  task_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  created_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  priority: TaskPriority | null;
  tags: Record<string, string>;
  worktree: string | null;
  adw_id: string | null;
  result: Record<string, any> | null;
  error: string | null;
}

export interface CreateTaskInput {
  title: string;
  description: string;
  priority?: TaskPriority;
  tags?: Record<string, string>;
  worktree?: string | null;
}

export interface ClaimTaskInput {
  adw_id: string;
  worktree?: string;
}

export interface StartTaskInput {
  adw_id: string;
}

export interface CompleteTaskInput {
  adw_id: string;
  commit_hash?: string;
  worktree?: string;
  result?: Record<string, any>;
}

export interface FailTaskInput {
  adw_id: string;
  error: string;
  worktree?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  tags?: Record<string, string>;
  worktree?: string;
}

export interface ListTasksFilters {
  status?: TaskStatus | TaskStatus[];
  priority?: TaskPriority;
  limit?: number;
}

export class TasksDatabase {
  private db: Database | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly logger: Logger
  ) {}

  async init(): Promise<void> {
    const dbPath = path.join(this.dataDir, 'kota_tasks.db');
    this.db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS kota_tasks (
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

      CREATE INDEX IF NOT EXISTS idx_status ON kota_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_priority ON kota_tasks(priority);
      CREATE INDEX IF NOT EXISTS idx_created_at ON kota_tasks(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_adw_id ON kota_tasks(adw_id);
    `);

    this.logger.info({ dbPath }, 'Tasks database initialized');
  }

  private ensureDb(): Database {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  private parseTask(row: any): Task {
    return {
      ...row,
      tags: row.tags ? JSON.parse(row.tags) : {},
      result: row.result ? JSON.parse(row.result) : null,
    };
  }

  async listTasks(filters: ListTasksFilters = {}): Promise<Task[]> {
    const db = this.ensureDb();
    const { status, priority, limit = 10 } = filters;

    let query = 'SELECT * FROM kota_tasks WHERE 1=1';
    const params: any[] = [];

    if (status) {
      if (Array.isArray(status)) {
        const placeholders = status.map(() => '?').join(',');
        query += ` AND status IN (${placeholders})`;
        params.push(...status);
      } else {
        query += ' AND status = ?';
        params.push(status);
      }
    }

    if (priority) {
      query += ' AND priority = ?';
      params.push(priority);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = await db.all(query, ...params);
    return rows.map(row => this.parseTask(row));
  }

  async getTask(taskId: string): Promise<Task | null> {
    const db = this.ensureDb();
    const row = await db.get(
      'SELECT * FROM kota_tasks WHERE task_id = ?',
      taskId
    );
    return row ? this.parseTask(row) : null;
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const db = this.ensureDb();
    const taskId = `task-${randomUUID().slice(0, 8)}`;
    const createdAt = new Date().toISOString();
    const priority = input.priority || 'medium';
    const tags = JSON.stringify(input.tags || {});

    await db.run(
      `INSERT INTO kota_tasks (
        task_id, title, description, status, created_at,
        priority, tags, worktree
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      taskId,
      input.title,
      input.description,
      'pending',
      createdAt,
      priority,
      tags,
      input.worktree || null
    );

    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error('Failed to create task');
    }

    this.logger.info({ taskId, title: input.title }, 'Task created');
    return task;
  }

  async claimTask(taskId: string, input: ClaimTaskInput): Promise<Task> {
    const db = this.ensureDb();
    const task = await this.getTask(taskId);

    if (!task) {
      throw new Error('Task not found');
    }

    if (task.status !== 'pending') {
      throw new Error(`Cannot claim task with status '${task.status}'`);
    }

    const claimedAt = new Date().toISOString();

    await db.run(
      `UPDATE kota_tasks
       SET status = ?, claimed_at = ?, adw_id = ?, worktree = COALESCE(?, worktree)
       WHERE task_id = ?`,
      'claimed',
      claimedAt,
      input.adw_id,
      input.worktree,
      taskId
    );

    const updatedTask = await this.getTask(taskId);
    if (!updatedTask) {
      throw new Error('Failed to claim task');
    }

    this.logger.info({ taskId, adw_id: input.adw_id }, 'Task claimed');
    return updatedTask;
  }

  async startTask(taskId: string, input: StartTaskInput): Promise<Task> {
    const db = this.ensureDb();
    const task = await this.getTask(taskId);

    if (!task) {
      throw new Error('Task not found');
    }

    if (task.status !== 'claimed') {
      throw new Error(
        `Cannot start task with status '${task.status}'. Must be claimed first.`
      );
    }

    if (task.adw_id !== input.adw_id) {
      throw new Error('ADW ID mismatch');
    }

    await db.run(
      'UPDATE kota_tasks SET status = ? WHERE task_id = ?',
      'in_progress',
      taskId
    );

    const updatedTask = await this.getTask(taskId);
    if (!updatedTask) {
      throw new Error('Failed to start task');
    }

    this.logger.info({ taskId, adw_id: input.adw_id }, 'Task started');
    return updatedTask;
  }

  async completeTask(taskId: string, input: CompleteTaskInput): Promise<Task> {
    const db = this.ensureDb();
    const task = await this.getTask(taskId);

    if (!task) {
      throw new Error('Task not found');
    }

    if (!['claimed', 'in_progress'].includes(task.status)) {
      throw new Error(
        `Cannot complete task with status '${task.status}'`
      );
    }

    if (task.adw_id !== input.adw_id) {
      throw new Error('ADW ID mismatch');
    }

    const completedAt = new Date().toISOString();
    const result = input.result || {};

    // Include commit_hash in result if provided
    if (input.commit_hash) {
      result.commit_hash = input.commit_hash;
    }

    await db.run(
      `UPDATE kota_tasks
       SET status = ?, completed_at = ?, result = ?, worktree = COALESCE(?, worktree)
       WHERE task_id = ?`,
      'completed',
      completedAt,
      JSON.stringify(result),
      input.worktree,
      taskId
    );

    const updatedTask = await this.getTask(taskId);
    if (!updatedTask) {
      throw new Error('Failed to complete task');
    }

    this.logger.info({ taskId, adw_id: input.adw_id }, 'Task completed');
    return updatedTask;
  }

  async failTask(taskId: string, input: FailTaskInput): Promise<Task> {
    const db = this.ensureDb();
    const task = await this.getTask(taskId);

    if (!task) {
      throw new Error('Task not found');
    }

    if (task.adw_id && task.adw_id !== input.adw_id) {
      throw new Error('ADW ID mismatch');
    }

    const completedAt = new Date().toISOString();

    await db.run(
      `UPDATE kota_tasks
       SET status = ?, completed_at = ?, error = ?, worktree = COALESCE(?, worktree), adw_id = COALESCE(adw_id, ?)
       WHERE task_id = ?`,
      'failed',
      completedAt,
      input.error,
      input.worktree,
      input.adw_id,
      taskId
    );

    const updatedTask = await this.getTask(taskId);
    if (!updatedTask) {
      throw new Error('Failed to fail task');
    }

    this.logger.info({ taskId, adw_id: input.adw_id, error: input.error }, 'Task failed');
    return updatedTask;
  }

  async updateTask(taskId: string, input: UpdateTaskInput): Promise<Task> {
    const db = this.ensureDb();
    const task = await this.getTask(taskId);

    if (!task) {
      throw new Error('Task not found');
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (input.title !== undefined) {
      updates.push('title = ?');
      params.push(input.title);
    }

    if (input.description !== undefined) {
      updates.push('description = ?');
      params.push(input.description);
    }

    if (input.priority !== undefined) {
      updates.push('priority = ?');
      params.push(input.priority);
    }

    if (input.tags !== undefined) {
      updates.push('tags = ?');
      params.push(JSON.stringify(input.tags));
    }

    if (input.worktree !== undefined) {
      updates.push('worktree = ?');
      params.push(input.worktree);
    }

    if (updates.length === 0) {
      return task;
    }

    params.push(taskId);

    await db.run(
      `UPDATE kota_tasks SET ${updates.join(', ')} WHERE task_id = ?`,
      ...params
    );

    const updatedTask = await this.getTask(taskId);
    if (!updatedTask) {
      throw new Error('Failed to update task');
    }

    this.logger.info({ taskId, updates: Object.keys(input) }, 'Task updated');
    return updatedTask;
  }

  async deleteTask(taskId: string): Promise<void> {
    const db = this.ensureDb();
    const task = await this.getTask(taskId);

    if (!task) {
      throw new Error('Task not found');
    }

    await db.run('DELETE FROM kota_tasks WHERE task_id = ?', taskId);
    this.logger.info({ taskId }, 'Task deleted');
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      this.logger.info('Tasks database closed');
    }
  }
}
