import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base.js';
import type { ToolSpec } from '../types/index.js';
import { assertGitHubToken, getUserContributions, getViewerLogin, parseDateOrDefault, searchMentions, toISODateOnly } from '../utils/github.js';

const DetailEnum = z.enum(['numbers', 'titles', 'full']);
const RepoStringSchema = z
  .string()
  .trim()
  .min(3)
  .regex(/^[^/]+\/[^/]+$/, 'Repository must use owner/name format');
const RepoFilterSchema = z.union([
  RepoStringSchema,
  z.array(RepoStringSchema).min(1).max(10),
]);

const ActivitySummarySchema = z.object({
  start: z.string().optional().describe('ISO date/time or YYYY-MM-DD. Defaults to 7 days ago.'),
  end: z.string().optional().describe('ISO date/time or YYYY-MM-DD. Defaults to now.'),
  detail: DetailEnum.optional().describe('Level of detail: numbers | titles | full'),
  username: z.string().optional().describe('GitHub username; defaults to viewer or GITHUB_USERNAME'),
  max_items: z.coerce.number().int().positive().max(100).optional().describe('Max list items for titles/full (default 20).'),
  repo: RepoStringSchema.optional().describe('Single repository to filter (owner/name).'),
  repos: RepoFilterSchema.optional().describe('Repositories to filter (owner/name). Accepts string or array (max 10).'),
}).strip();

export class GitHubHandler extends BaseHandler {
  readonly prefix = 'github';

  getTools(): ToolSpec[] {
    return [
      {
        action: 'activity_summary',
        description: 'Summarize GitHub activity for a user within a timeframe. Supports detail levels: numbers, titles, full.',
        inputSchema: ActivitySummarySchema.shape,
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

  private async activitySummary(args: unknown): Promise<CallToolResult> {
    const parsed = this.parseArgs(ActivitySummarySchema, args);

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
    const detail = parsed.detail ?? 'numbers';
    const maxItems = parsed.max_items ?? 20;
    const repoFilters = normalizeRepoFilters(parsed.repo, parsed.repos);
    const matchesRepo = createRepoMatcher(repoFilters);

    const [contrib, mentions] = await Promise.all([
      getUserContributions(token, { login, fromISO, toISO }),
      detail === 'numbers'
        ? Promise.resolve(null)
        : searchMentions(token, login, fromDateOnly, toDateOnly, maxItems, repoFilters),
    ]);

    const c = contrib.user.contributionsCollection;

    const filteredCommitRepos = (c.commitContributionsByRepository || []).filter((r: any) =>
      matchesRepo(r.repository?.nameWithOwner)
    );
    const repoCommits: Record<string, number> = {};
    let totalCommitContributions = 0;
    for (const r of filteredCommitRepos) {
      const name = r.repository?.nameWithOwner || '(unknown)';
      const count = r.contributions?.totalCount || 0;
      repoCommits[name] = (repoCommits[name] || 0) + count;
      totalCommitContributions += count;
    }

    const prRepoContribs = (c.pullRequestContributionsByRepository || []).filter((r: any) =>
      matchesRepo(r.repository?.nameWithOwner)
    );
    const prEntries = prRepoContribs.flatMap((r: any) => {
      const repoName = r.repository?.nameWithOwner || '';
      const nodes = r.contributions?.nodes || [];
      return nodes.map((node: any) => ({ node, repoName }));
    });
    const totalPullRequestContributions = prRepoContribs.reduce(
      (acc: number, r: any) => acc + (r.contributions?.totalCount || 0),
      0,
    );

    const issueRepoContribs = (c.issueContributionsByRepository || []).filter((r: any) =>
      matchesRepo(r.repository?.nameWithOwner)
    );
    const issueEntries = issueRepoContribs.flatMap((r: any) => {
      const repoName = r.repository?.nameWithOwner || '';
      const nodes = r.contributions?.nodes || [];
      return nodes.map((node: any) => ({ node, repoName }));
    });
    const totalIssueContributions = issueRepoContribs.reduce(
      (acc: number, r: any) => acc + (r.contributions?.totalCount || 0),
      0,
    );

    const reviewRepoContribs = (c.pullRequestReviewContributionsByRepository || []).filter((r: any) =>
      matchesRepo(r.repository?.nameWithOwner)
    );
    const reviewEntries = reviewRepoContribs.flatMap((r: any) => {
      const repoName = r.repository?.nameWithOwner || '';
      const nodes = r.contributions?.nodes || [];
      return nodes.map((node: any) => ({ node, repoName }));
    });
    const totalReviewContributions = reviewRepoContribs.reduce(
      (acc: number, r: any) => acc + (r.contributions?.totalCount || 0),
      0,
    );

    const mergedPRs = prEntries.filter((entry: any) => entry.node.pullRequest?.merged).length;

    const repoActivity: Record<string, number> = { ...repoCommits };
    for (const { repoName } of prEntries) {
      if (repoName) repoActivity[repoName] = (repoActivity[repoName] || 0) + 1;
    }
    for (const { repoName } of issueEntries) {
      if (repoName) repoActivity[repoName] = (repoActivity[repoName] || 0) + 1;
    }
    for (const { repoName } of reviewEntries) {
      if (repoName) repoActivity[repoName] = (repoActivity[repoName] || 0) + 1;
    }
    const topRepos = Object.entries(repoActivity)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const mentionNodes = mentions?.search?.nodes || [];

    const lines: string[] = [];
    lines.push(`GitHub activity for @${login} (${fromDateOnly} → ${toDateOnly})`);
    if (repoFilters.length) lines.push(`Repos: ${repoFilters.join(', ')}`);
    lines.push('');
    lines.push('Totals:');
    const restrictedSuffix =
      !repoFilters.length && c.hasAnyRestrictedContributions && c.restrictedContributionsCount
        ? ` (+${c.restrictedContributionsCount} restricted)`
        : '';
    lines.push(`- Commits: ${totalCommitContributions}${restrictedSuffix}`);
    lines.push(`- PRs opened: ${totalPullRequestContributions} (merged: ${mergedPRs})`);
    lines.push(`- PR reviews: ${totalReviewContributions}`);
    lines.push(`- Issues opened: ${totalIssueContributions}`);
    if (mentions) lines.push(`- Issues/PRs mentioning you (updated in window): ${mentions.search.issueCount}`);

    if (topRepos.length) {
      lines.push('');
      lines.push('Top repos touched:');
      for (const [repo, score] of topRepos) lines.push(`- ${repo}: ${score} activities`);
    }

    if (detail !== 'numbers') {
      const max = maxItems;
      const prList = prEntries
        .slice(0, max)
        .map((entry: any) => `• PR: ${entry.node.pullRequest.title} — ${entry.node.pullRequest.url}`);
      const issueList = issueEntries
        .slice(0, max)
        .map((entry: any) => `• Issue: ${entry.node.issue.title} — ${entry.node.issue.url}`);
      const reviewList = reviewEntries
        .slice(0, max)
        .map((entry: any) => `• Review on: ${entry.node.pullRequest.title} — ${entry.node.pullRequest.url}`);

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
      if (reviewList.length && detail === 'full') {
        lines.push('');
        lines.push(`Reviews (${Math.min(reviewList.length, max)} shown):`);
        lines.push(...reviewList);
      }
      if (mentions && mentionNodes.length) {
        const mentionList = mentionNodes.slice(0, max).map((n: any) => `• Mention: ${n.title} — ${n.url}`);
        lines.push('');
        lines.push(`Mentioned Items (${Math.min(mentionList.length, max)} shown):`);
        lines.push(...mentionList);
      }

      if (detail !== 'full') {
        lines.push('');
        lines.push('Note: Commit messages are not listed in this mode.');
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
}

function normalizeRepoFilters(
  repo?: string,
  repos?: string | string[],
): string[] {
  const values: string[] = [];
  const add = (value?: string) => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    values.push(trimmed);
  };
  add(repo);
  if (Array.isArray(repos)) repos.forEach(add);
  else add(repos);
  return Array.from(new Set(values));
}

function createRepoMatcher(filters: string[]) {
  if (!filters.length) return (_repo?: string | null) => true;
  const normalized = new Set(filters.map((value) => value.toLowerCase()));
  return (repo?: string | null) => {
    if (!repo) return false;
    return normalized.has(repo.toLowerCase());
  };
}
