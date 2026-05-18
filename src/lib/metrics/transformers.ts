// Pure transform functions: GitHub REST API shapes → DevPulse Metric payloads.
// No side effects; fully unit-testable in isolation.

export interface GitHubCommit {
  sha: string;
  commit: {
    author: { name: string; email: string; date: string };
    message: string;
  };
  author: { login: string; avatar_url: string } | null;
}

export interface GitHubPR {
  id: number;
  number: number;
  state: string;
  title: string;
  created_at: string;
  closed_at: string | null;
  merged_at: string | null;
  user: { login: string; avatar_url: string } | null;
  requested_reviewers: unknown[];
}

export interface CommitFreqPayload {
  commit_count: number;
  author_breakdown: { login: string; count: number; avatar_url: string }[];
}

export interface PrStatsPayload {
  open: number;
  merged: number;
  closed: number;
  avg_merge_time_hrs: number;
  review_count: number;
}

export interface ActivityPayload {
  active_days: number;
  peak_hour: number;
  push_events: number;
}

export interface ContributorPayload {
  contributors: { login: string; avatar_url: string; commits: number; prs: number }[];
}

export function transformCommits(
  commits: GitHubCommit[],
  periodDays: number
): CommitFreqPayload {
  const cutoff = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
  const inWindow = commits.filter(
    (c) => new Date(c.commit.author.date) >= cutoff
  );

  const authorMap = new Map<string, { count: number; avatar_url: string }>();
  for (const c of inWindow) {
    const login = c.author?.login ?? c.commit.author.name;
    const avatar = c.author?.avatar_url ?? "";
    const existing = authorMap.get(login);
    if (existing) {
      existing.count++;
    } else {
      authorMap.set(login, { count: 1, avatar_url: avatar });
    }
  }

  return {
    commit_count: inWindow.length,
    author_breakdown: Array.from(authorMap.entries())
      .map(([login, { count, avatar_url }]) => ({ login, count, avatar_url }))
      .sort((a, b) => b.count - a.count),
  };
}

export function transformPRs(
  prs: GitHubPR[],
  periodDays: number
): PrStatsPayload {
  const cutoff = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
  const inWindow = prs.filter((pr) => new Date(pr.created_at) >= cutoff);

  let open = 0, merged = 0, closed = 0, totalMergeMs = 0, mergeCount = 0;

  for (const pr of inWindow) {
    if (pr.merged_at) {
      merged++;
      const ms = new Date(pr.merged_at).getTime() - new Date(pr.created_at).getTime();
      totalMergeMs += ms;
      mergeCount++;
    } else if (pr.state === "closed") {
      closed++;
    } else {
      open++;
    }
  }

  return {
    open,
    merged,
    closed,
    avg_merge_time_hrs: mergeCount > 0 ? Math.round(totalMergeMs / mergeCount / 3_600_000 * 10) / 10 : 0,
    review_count: inWindow.reduce((sum, pr) => sum + (pr.requested_reviewers?.length ?? 0), 0),
  };
}

export function derivePeakHour(commits: GitHubCommit[]): number {
  if (commits.length === 0) return 0;
  const hourCounts = new Array<number>(24).fill(0);
  for (const c of commits) {
    const h = new Date(c.commit.author.date).getUTCHours();
    hourCounts[h]++;
  }
  return hourCounts.indexOf(Math.max(...hourCounts));
}

export function deriveContributors(
  commits: GitHubCommit[],
  prs: GitHubPR[],
  periodDays: number
): ContributorPayload {
  const cutoff = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const map = new Map<string, { avatar_url: string; commits: number; prs: number }>();

  for (const c of commits) {
    if (new Date(c.commit.author.date) < cutoff) continue;
    const login = c.author?.login ?? c.commit.author.name;
    const avatar = c.author?.avatar_url ?? "";
    const entry = map.get(login);
    if (entry) { entry.commits++; }
    else { map.set(login, { avatar_url: avatar, commits: 1, prs: 0 }); }
  }

  for (const pr of prs) {
    if (new Date(pr.created_at) < cutoff) continue;
    const login = pr.user?.login;
    if (!login) continue;
    const avatar = pr.user?.avatar_url ?? "";
    const entry = map.get(login);
    if (entry) { entry.prs++; }
    else { map.set(login, { avatar_url: avatar, commits: 0, prs: 1 }); }
  }

  return {
    contributors: Array.from(map.entries())
      .map(([login, v]) => ({ login, ...v }))
      .sort((a, b) => (b.commits + b.prs) - (a.commits + a.prs)),
  };
}

export function transformToActivityPayload(
  commits: GitHubCommit[],
  periodDays: number
): ActivityPayload {
  const cutoff = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
  const inWindow = commits.filter((c) => new Date(c.commit.author.date) >= cutoff);

  const activeDaySet = new Set<string>();
  for (const c of inWindow) {
    activeDaySet.add(new Date(c.commit.author.date).toISOString().slice(0, 10));
  }

  return {
    active_days: activeDaySet.size,
    peak_hour: derivePeakHour(inWindow),
    push_events: inWindow.length,
  };
}
