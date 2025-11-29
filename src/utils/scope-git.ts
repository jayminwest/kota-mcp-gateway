import { exec } from 'child_process';
import { promisify } from 'util';
import type { Logger } from './logger.js';

const execAsync = promisify(exec);

export interface ScopeGitCommitResult {
  commit_hash: string;
  commit_message: string;
  undo_command: string;
}

export class ScopeGitManager {
  private logger: Logger;

  constructor(opts: { logger: Logger }) {
    this.logger = opts.logger;
  }

  /**
   * Commit a scope change to git with attribution
   */
  async commitScopeChange(
    filePath: string,
    reason: string,
    modifiedBy: string
  ): Promise<ScopeGitCommitResult> {
    try {
      // Get the directory containing the scope file
      const scopeDir = filePath.substring(0, filePath.lastIndexOf('/'));

      // Check if this is a git repository
      try {
        await execAsync('git rev-parse --git-dir', { cwd: scopeDir });
      } catch {
        throw new Error(`Not a git repository: ${scopeDir}`);
      }

      // Stage the file
      await execAsync(`git add "${filePath}"`, { cwd: scopeDir });

      // Create commit message with attribution
      const commitMessage = this.formatCommitMessage(reason, modifiedBy);

      // Commit the change
      await execAsync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, {
        cwd: scopeDir,
      });

      // Get the commit hash
      const { stdout: hash } = await execAsync('git rev-parse HEAD', { cwd: scopeDir });
      const commitHash = hash.trim();

      // Generate undo command
      const undoCommand = `git revert ${commitHash}`;

      this.logger.info({ commitHash, filePath }, 'Committed scope change');

      return {
        commit_hash: commitHash,
        commit_message: commitMessage,
        undo_command: undoCommand,
      };
    } catch (error) {
      this.logger.error({ error, filePath }, 'Failed to commit scope change');
      throw error;
    }
  }

  /**
   * Format a conventional commit message with attribution
   */
  private formatCommitMessage(reason: string, modifiedBy: string): string {
    return `feat(scopes): ${reason}\n\nModified-By: ${modifiedBy}\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
  }
}
