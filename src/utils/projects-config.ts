import fs from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';

export interface ProjectConfig {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
}

const ProjectConfigSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Project ID must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean(),
});

const ProjectsFileSchema = z.object({
  projects: z.array(ProjectConfigSchema),
});

export async function loadProjects(dataDir: string, logger: Logger): Promise<ProjectConfig[]> {
  const configPath = path.join(dataDir, 'projects.json');

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const data = JSON.parse(content);

    const validation = ProjectsFileSchema.safeParse(data);

    if (!validation.success) {
      logger.error({ errors: validation.error.errors, configPath }, 'Invalid projects.json format');
      throw new Error('Invalid projects.json format');
    }

    const projects = validation.data.projects;

    // Check for duplicate IDs
    const ids = new Set<string>();
    for (const project of projects) {
      if (ids.has(project.id)) {
        throw new Error(`Duplicate project ID: ${project.id}`);
      }
      ids.add(project.id);
    }

    logger.info({ count: projects.length, enabled: projects.filter(p => p.enabled).length }, 'Projects loaded');

    return projects;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      logger.warn({ configPath }, 'projects.json not found, creating default config');

      const defaultProjects: ProjectConfig[] = [
        {
          id: 'kotadb',
          name: 'KotaDB',
          description: 'Main KotaDB AI Developer Workflows',
          enabled: true,
        },
      ];

      await saveProjects(dataDir, defaultProjects, logger);
      return defaultProjects;
    }

    throw error;
  }
}

export async function saveProjects(
  dataDir: string,
  projects: ProjectConfig[],
  logger: Logger
): Promise<void> {
  const configPath = path.join(dataDir, 'projects.json');

  const data = {
    projects,
    _comment: 'Project configuration for Home Server API. Add/remove projects here and restart the server.',
  };

  await fs.writeFile(configPath, JSON.stringify(data, null, 2), 'utf-8');
  logger.info({ configPath, count: projects.length }, 'Projects config saved');
}

export function getProjectById(projects: ProjectConfig[], id: string): ProjectConfig | undefined {
  return projects.find(p => p.id === id);
}

export function getEnabledProjects(projects: ProjectConfig[]): ProjectConfig[] {
  return projects.filter(p => p.enabled);
}
