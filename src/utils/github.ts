import type { AppConfig } from './config.js';

const GITHUB_GRAPHQL = 'https://api.github.com/graphql';

export async function ghGraphQL<T = any>(token: string, query: string, variables?: Record<string, any>): Promise<T> {
  const res = await fetch(GITHUB_GRAPHQL, {
    method: 'POST',
    headers: {
      'Authorization': `bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub GraphQL error: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
  }
  const json: any = await res.json();
  if (json.errors && json.errors.length) {
    const msg = json.errors.map((e: any) => e.message).join('; ');
    throw new Error(`GitHub GraphQL: ${msg}`);
  }
  return json.data as T;
}

export async function getViewerLogin(token: string): Promise<string> {
  const data = await ghGraphQL<{ viewer: { login: string } }>(token, `
    query { viewer { login } }
  `);
  return data.viewer.login;
}

export interface ContributionsArgs {
  login: string;
  fromISO: string; // ISO string
  toISO: string;   // ISO string
}

export async function getUserContributions(token: string, args: ContributionsArgs) {
  const data = await ghGraphQL<any>(token, `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          hasAnyRestrictedContributions
          restrictedContributionsCount
          totalCommitContributions
          totalIssueContributions
          totalPullRequestContributions
          totalPullRequestReviewContributions

          commitContributionsByRepository(maxRepositories: 100) {
            repository { nameWithOwner isPrivate }
            contributions(first: 1) { totalCount }
          }
          pullRequestContributionsByRepository(maxRepositories: 50) {
            repository { nameWithOwner isPrivate }
            contributions(first: 50) {
              totalCount
              nodes {
                pullRequest {
                  number
                  title
                  url
                  state
                  merged
                  createdAt
                  mergedAt
                }
              }
            }
          }
          issueContributionsByRepository(maxRepositories: 50) {
            repository { nameWithOwner isPrivate }
            contributions(first: 50) {
              totalCount
              nodes {
                issue {
                  number
                  title
                  url
                  state
                  createdAt
                }
              }
            }
          }
          pullRequestReviewContributionsByRepository(maxRepositories: 50) {
            repository { nameWithOwner isPrivate }
            contributions(first: 50) {
              totalCount
              nodes {
                pullRequestReview { submittedAt state url }
                pullRequest { number title url }
              }
            }
          }
        }
      }
      rateLimit { remaining limit resetAt cost }
    }
  `, { login: args.login, from: args.fromISO, to: args.toISO });
  return data;
}

export async function searchMentions(
  token: string,
  login: string,
  fromDate: string,
  toDate: string,
  first = 20,
  repos?: string[],
) {
  const range = `${fromDate}..${toDate}`; // YYYY-MM-DD..YYYY-MM-DD
  const qualifiers = [`mentions:${login}`, `updated:${range}`];
  if (repos && repos.length) qualifiers.push(...repos.map((repo) => `repo:${repo}`));
  const query = qualifiers.join(' ');
  const data = await ghGraphQL<any>(token, `
    query($query: String!, $first: Int!) {
      search(query: $query, type: ISSUE, first: $first) {
        issueCount
        nodes {
          ... on Issue {
            __typename
            title
            url
            number
            state
            createdAt
            updatedAt
            repository { nameWithOwner }
          }
          ... on PullRequest {
            __typename
            title
            url
            number
            state
            createdAt
            updatedAt
            repository { nameWithOwner }
          }
        }
      }
      rateLimit { remaining limit resetAt cost }
    }
  `, { query, first });
  return data;
}

export async function getRateStatus(token: string) {
  const data = await ghGraphQL<any>(token, `
    query { viewer { login } rateLimit { remaining limit resetAt cost } }
  `);
  return data;
}

export function toISODateOnly(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDateOrDefault(input?: string, fallbackDays = 7, end = false): Date {
  if (input) {
    const dt = new Date(input);
    if (!isNaN(dt.getTime())) return dt;
  }
  const now = new Date();
  if (end) return now;
  const start = new Date(now.getTime() - fallbackDays * 24 * 60 * 60 * 1000);
  return start;
}

export function assertGitHubToken(config: AppConfig): string {
  const token = config.GITHUB_TOKEN || '';
  if (!token) throw new Error('Missing GITHUB_TOKEN in environment');
  return token;
}
