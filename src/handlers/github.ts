import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { assertGitHubToken, getUserContributions, getViewerLogin, parseDateOrDefault, searchMentions, toISODateOnly } from '../utils/github.js';

const DetailEnum = z.enum(['numbers', 'titles', 'full']);

export class GitHubHandler extends BaseHandler {
  readonly prefix = 'github';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'activity_summary',
        description: 'Summarize GitHub activity for a user within a timeframe. Supports detail levels: numbers, titles, full.',
        inputSchema: {
          start: z.string().optional().describe('ISO date/time or YYYY-MM-DD. Defaults to 7 days ago.'),
          end: z.string().optional().describe('ISO date/time or YYYY-MM-DD. Defaults to now.'),
          detail: DetailEnum.optional().describe('Level of detail: numbers | titles | full'),
          username: z.string().optional().describe('GitHub username; defaults to viewer or GITHUB_USERNAME'),
          max_items: z.number().int().positive().max(100).optional().describe('Max list items for titles/full (default 20).'),
        },
      },
    ];
  }

  async execute(action: string, args: any): Promise<CallToolResult> {
    switch (action) {
      case 'activity_summary':
        return this.activitySummary(args);
      default:
        return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
    }
  }

  private async activitySummary(args: any): Promise<CallToolResult> {
    const parsed = z.object({
      start: z.string().optional(),
      end: z.string().optional(),
      detail: DetailEnum.default('numbers').optional(),
      username: z.string().optional(),
      max_items: z.number().int().positive().max(100).default(20).optional(),
    }).parse(args || {});

    const token = assertGitHubToken(this.config);

    const startDate = parseDateOrDefault(parsed.start, 7, false);
    const endDate = parseDateOrDefault(parsed.end, 7, true);

    // Normalize to ISO for GraphQL and YYYY-MM-DD range for search
    const fromISO = startDate.toISOString();
    const toISO = endDate.toISOString();
    const fromDateOnly = toISODateOnly(startDate);
    const toDateOnly = toISODateOnly(endDate);

    let login = parsed.username || this.config.GITHUB_USERNAME || '';
    if (!login) login = await getViewerLogin(token);

    // Fetch contributions and mentions
    const [contrib, mentions] = await Promise.all([
      getUserContributions(token, { login, fromISO, toISO }),
      parsed.detail === 'numbers' ? Promise.resolve(null) : searchMentions(token, login, fromDateOnly, toDateOnly, parsed.max_items || 20),
    ]);

    const c = contrib.user.contributionsCollection;

    // Repo-level breakdown
    const repoCommits: Record<string, number> = {};
    for (const r of c.commitContributionsByRepository || []) {
      const name = r.repository?.nameWithOwner || '(unknown)';
      const n = r.contributions?.totalCount || 0;
      repoCommits[name] = (repoCommits[name] || 0) + n;
    }

    const prNodes = (c.pullRequestContributionsByRepository || []).flatMap((r: any) => r.contributions?.nodes || []);
    const issueNodes = (c.issueContributionsByRepository || []).flatMap((r: any) => r.contributions?.nodes || []);
    const reviewNodes = (c.pullRequestReviewContributionsByRepository || []).flatMap((r: any) => r.contributions?.nodes || []);

    const mergedPRs = prNodes.filter((n: any) => n.pullRequest?.merged).length;

    // Top repositories touched (by total of all contributions we saw)
    const repoActivity: Record<string, number> = { ...repoCommits };
    for (const n of prNodes) {
      const repo = n.pullRequest?.url?.split('/')?.slice(3,5).join('/') || '';
      if (repo) repoActivity[repo] = (repoActivity[repo] || 0) + 1;
    }
    for (const n of issueNodes) {
      const repo = n.issue?.url?.split('/')?.slice(3,5).join('/') || '';
      if (repo) repoActivity[repo] = (repoActivity[repo] || 0) + 1;
    }
    for (const n of reviewNodes) {
      const repo = n.pullRequest?.url?.split('/')?.slice(3,5).join('/') || '';
      if (repo) repoActivity[repo] = (repoActivity[repo] || 0) + 1;
    }
    const topRepos = Object.entries(repoActivity).sort((a,b) => b[1]-a[1]).slice(0, 5);

    const lines: string[] = [];
    lines.push(`GitHub activity for @${login} (${fromDateOnly} → ${toDateOnly})`);
    lines.push('');
    lines.push('Totals:');
    lines.push(`- Commits: ${c.totalCommitContributions}${c.hasAnyRestrictedContributions && c.restrictedContributionsCount ? ` (+${c.restrictedContributionsCount} restricted)` : ''}`);
    lines.push(`- PRs opened: ${c.totalPullRequestContributions} (merged: ${mergedPRs})`);
    lines.push(`- PR reviews: ${c.totalPullRequestReviewContributions}`);
    lines.push(`- Issues opened: ${c.totalIssueContributions}`);
    if (mentions) lines.push(`- Issues/PRs mentioning you (updated in window): ${mentions.search.issueCount}`);

    if (topRepos.length) {
      lines.push('');
      lines.push('Top repos touched:');
      for (const [repo, score] of topRepos) lines.push(`- ${repo}: ${score} activities`);
    }

    if (parsed.detail !== 'numbers') {
      const max = parsed.max_items || 20;
      const prList = prNodes.slice(0, max).map((n: any) => `• PR: ${n.pullRequest.title} — ${n.pullRequest.url}`);
      const issueList = issueNodes.slice(0, max).map((n: any) => `• Issue: ${n.issue.title} — ${n.issue.url}`);
      const reviewList = reviewNodes.slice(0, max).map((n: any) => `• Review on: ${n.pullRequest.title} — ${n.pullRequest.url}`);

      if (prList.length) {
        lines.push('');
        lines.push(`Pull Requests (${Math.min(prList.length, max)} shown):`);
        lines.push(...prList);
      }
      if (issueList.length) {
        lines.push('');
        lines.push(`Issues (${Math.min(issueList.length, max)} shown):`);
        lines.push(...issueList);
      }
      if (reviewList.length && parsed.detail === 'full') {
        lines.push('');
        lines.push(`Reviews (${Math.min(reviewList.length, max)} shown):`);
        lines.push(...reviewList);
      }
      if (mentions && mentions.search?.nodes?.length) {
        const mentionList = mentions.search.nodes.slice(0, max).map((n: any) => `• Mention: ${n.title} — ${n.url}`);
        lines.push('');
        lines.push(`Mentioned Items (${Math.min(mentionList.length, max)} shown):`);
        lines.push(...mentionList);
      }

      if (parsed.detail !== 'full') {
        lines.push('');
        lines.push('Note: Commit messages are not listed in this mode.');
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
}
