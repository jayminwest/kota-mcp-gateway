import { Router } from 'express';
import { z } from 'zod';
import type { Logger } from 'pino';
import type { TasksDatabase, TaskStatus } from '../utils/tasks-db.js';

interface RouterOptions {
  db: TasksDatabase;
  logger: Logger;
}

const TaskPrioritySchema = z.enum(['low', 'medium', 'high']);
const TaskStatusSchema = z.enum(['pending', 'claimed', 'in_progress', 'completed', 'failed']);

const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  priority: TaskPrioritySchema.optional(),
  tags: z.record(z.string()).optional(),
  worktree: z.string().nullable().optional(),
});

const ClaimTaskSchema = z.object({
  adw_id: z.string().min(1),
  worktree: z.string().optional(),
});

const StartTaskSchema = z.object({
  adw_id: z.string().min(1),
});

const CompleteTaskSchema = z.object({
  adw_id: z.string().min(1),
  commit_hash: z.string().optional(),
  worktree: z.string().optional(),
  result: z.record(z.any()).optional(),
});

const FailTaskSchema = z.object({
  adw_id: z.string().min(1),
  error: z.string().min(1),
  worktree: z.string().optional(),
});

const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(5000).optional(),
  priority: TaskPrioritySchema.optional(),
  tags: z.record(z.string()).optional(),
  worktree: z.string().optional(),
  status: z.any().optional(), // Used for validation error
});

function asyncHandler<T extends (req: any, res: any, next: any) => Promise<unknown>>(
  fn: T
) {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function errorResponse(
  res: any,
  status: number,
  error: string,
  details?: any
) {
  const response: any = {
    error,
    timestamp: new Date().toISOString(),
  };

  if (details) {
    response.details = details;
  }

  res.status(status).json(response);
}

export function createTasksRouter(opts: RouterOptions): Router {
  const { db, logger } = opts;
  const router = Router();

  // GET /api/kota-tasks - List tasks with filters
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const { status, limit, priority } = req.query;

      let statusFilter: TaskStatus | TaskStatus[] | undefined;

      if (status) {
        if (Array.isArray(status)) {
          statusFilter = status as TaskStatus[];
        } else {
          statusFilter = status as TaskStatus;
        }
      }

      const filters = {
        status: statusFilter,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        priority: priority as any,
      };

      const tasks = await db.listTasks(filters);
      logger.debug({ filters, count: tasks.length }, 'Listed tasks');
      res.json(tasks);
    })
  );

  // GET /api/kota-tasks/:task_id - Get task by ID
  router.get(
    '/:task_id',
    asyncHandler(async (req, res) => {
      const { task_id } = req.params;
      const task = await db.getTask(task_id);

      if (!task) {
        return errorResponse(res, 404, 'Task not found', { task_id });
      }

      logger.debug({ task_id }, 'Retrieved task');
      res.json(task);
    })
  );

  // POST /api/kota-tasks - Create task
  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const validation = CreateTaskSchema.safeParse(req.body);

      if (!validation.success) {
        const details: Record<string, string> = {};
        validation.error.errors.forEach((err) => {
          const field = err.path.join('.');
          details[field] = err.message;
        });
        return errorResponse(res, 400, 'Validation failed', details);
      }

      const task = await db.createTask(validation.data);
      logger.info({ task_id: task.task_id, title: task.title }, 'Task created');
      res.status(201).json(task);
    })
  );

  // POST /api/kota-tasks/:task_id/claim - Claim task
  router.post(
    '/:task_id/claim',
    asyncHandler(async (req, res) => {
      const { task_id } = req.params;
      const validation = ClaimTaskSchema.safeParse(req.body);

      if (!validation.success) {
        const details: Record<string, string> = {};
        validation.error.errors.forEach((err) => {
          const field = err.path.join('.');
          details[field] = err.message;
        });
        return errorResponse(res, 400, 'Validation failed', details);
      }

      try {
        const task = await db.claimTask(task_id, validation.data);
        logger.info({ task_id, adw_id: validation.data.adw_id }, 'Task claimed');
        res.json({
          task_id: task.task_id,
          title: task.title,
          status: task.status,
          claimed_at: task.claimed_at,
          adw_id: task.adw_id,
          worktree: task.worktree,
        });
      } catch (error: any) {
        if (error.message === 'Task not found') {
          return errorResponse(res, 404, 'Task not found', { task_id });
        }
        if (error.message.includes('Cannot claim')) {
          const task = await db.getTask(task_id);
          return errorResponse(
            res,
            400,
            error.message,
            {
              task_id,
              current_status: task?.status,
            }
          );
        }
        throw error;
      }
    })
  );

  // POST /api/kota-tasks/:task_id/start - Start task
  router.post(
    '/:task_id/start',
    asyncHandler(async (req, res) => {
      const { task_id } = req.params;
      const validation = StartTaskSchema.safeParse(req.body);

      if (!validation.success) {
        const details: Record<string, string> = {};
        validation.error.errors.forEach((err) => {
          const field = err.path.join('.');
          details[field] = err.message;
        });
        return errorResponse(res, 400, 'Validation failed', details);
      }

      try {
        const task = await db.startTask(task_id, validation.data);
        logger.info({ task_id, adw_id: validation.data.adw_id }, 'Task started');
        res.json({
          task_id: task.task_id,
          status: task.status,
          adw_id: task.adw_id,
        });
      } catch (error: any) {
        if (error.message === 'Task not found') {
          return errorResponse(res, 404, 'Task not found', { task_id });
        }
        if (error.message.includes('Cannot start')) {
          const task = await db.getTask(task_id);
          return errorResponse(
            res,
            400,
            error.message,
            {
              task_id,
              current_status: task?.status,
            }
          );
        }
        if (error.message === 'ADW ID mismatch') {
          return errorResponse(res, 403, 'ADW ID mismatch', { task_id });
        }
        throw error;
      }
    })
  );

  // POST /api/kota-tasks/:task_id/complete - Complete task
  router.post(
    '/:task_id/complete',
    asyncHandler(async (req, res) => {
      const { task_id } = req.params;
      const validation = CompleteTaskSchema.safeParse(req.body);

      if (!validation.success) {
        const details: Record<string, string> = {};
        validation.error.errors.forEach((err) => {
          const field = err.path.join('.');
          details[field] = err.message;
        });
        return errorResponse(res, 400, 'Validation failed', details);
      }

      try {
        const task = await db.completeTask(task_id, validation.data);
        logger.info({ task_id, adw_id: validation.data.adw_id }, 'Task completed');
        res.json({
          task_id: task.task_id,
          title: task.title,
          status: task.status,
          completed_at: task.completed_at,
          adw_id: task.adw_id,
          result: task.result,
        });
      } catch (error: any) {
        if (error.message === 'Task not found') {
          return errorResponse(res, 404, 'Task not found', { task_id });
        }
        if (error.message.includes('Cannot complete')) {
          const task = await db.getTask(task_id);
          return errorResponse(
            res,
            400,
            error.message,
            {
              task_id,
              current_status: task?.status,
            }
          );
        }
        if (error.message === 'ADW ID mismatch') {
          return errorResponse(res, 403, 'ADW ID mismatch', { task_id });
        }
        throw error;
      }
    })
  );

  // POST /api/kota-tasks/:task_id/fail - Fail task
  router.post(
    '/:task_id/fail',
    asyncHandler(async (req, res) => {
      const { task_id } = req.params;
      const validation = FailTaskSchema.safeParse(req.body);

      if (!validation.success) {
        const details: Record<string, string> = {};
        validation.error.errors.forEach((err) => {
          const field = err.path.join('.');
          details[field] = err.message;
        });
        return errorResponse(res, 400, 'Validation failed', details);
      }

      try {
        const task = await db.failTask(task_id, validation.data);
        logger.info({ task_id, adw_id: validation.data.adw_id, error: validation.data.error }, 'Task failed');
        res.json({
          task_id: task.task_id,
          title: task.title,
          status: task.status,
          completed_at: task.completed_at,
          adw_id: task.adw_id,
          error: task.error,
        });
      } catch (error: any) {
        if (error.message === 'Task not found') {
          return errorResponse(res, 404, 'Task not found', { task_id });
        }
        if (error.message === 'ADW ID mismatch') {
          return errorResponse(res, 403, 'ADW ID mismatch', { task_id });
        }
        throw error;
      }
    })
  );

  // PATCH /api/kota-tasks/:task_id - Update task
  router.patch(
    '/:task_id',
    asyncHandler(async (req, res) => {
      const { task_id } = req.params;
      const validation = UpdateTaskSchema.safeParse(req.body);

      if (!validation.success) {
        const details: Record<string, string> = {};
        validation.error.errors.forEach((err) => {
          const field = err.path.join('.');
          details[field] = err.message;
        });
        return errorResponse(res, 400, 'Validation failed', details);
      }

      // Check if trying to update status directly
      if (validation.data.status !== undefined) {
        return errorResponse(
          res,
          400,
          'Cannot update status directly. Use /claim, /start, /complete, or /fail endpoints.'
        );
      }

      try {
        const task = await db.updateTask(task_id, validation.data);
        logger.info({ task_id, updates: Object.keys(validation.data) }, 'Task updated');
        res.json(task);
      } catch (error: any) {
        if (error.message === 'Task not found') {
          return errorResponse(res, 404, 'Task not found', { task_id });
        }
        throw error;
      }
    })
  );

  // DELETE /api/kota-tasks/:task_id - Delete task
  router.delete(
    '/:task_id',
    asyncHandler(async (req, res) => {
      const { task_id } = req.params;

      try {
        await db.deleteTask(task_id);
        logger.info({ task_id }, 'Task deleted');
        res.status(204).send();
      } catch (error: any) {
        if (error.message === 'Task not found') {
          return errorResponse(res, 404, 'Task not found', { task_id });
        }
        throw error;
      }
    })
  );

  return router;
}
