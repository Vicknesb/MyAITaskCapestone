import { describe, it, expect } from "vitest";
import {
  transformCommits,
  transformPRs,
  derivePeakHour,
  deriveContributors,
  transformToActivityPayload,
  type GitHubCommit,
  type GitHubPR,
} from "./transformers";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCommit(
  daysAgo: number,
  options: { login?: string; name?: string; hourUtc?: number } = {}
): GitHubCommit {
  const { login, name = "Author", hourUtc = 12 } = options;
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return {
    sha: `sha-${daysAgo}-${Math.random()}`,
    commit: { author: { name, email: "a@b.com", date: d.toISOString() }, message: "msg" },
    author: login ? { login, avatar_url: `https://github.com/${login}.png` } : null,
  };
}

function makePR(
  daysAgo: number,
  state: "open" | "closed" | "merged",
  options: { login?: string; reviewers?: number } = {}
): GitHubPR {
  const { login, reviewers = 0 } = options;
  const created = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const merged_at =
    state === "merged"
      ? new Date(created.getTime() + 24 * 60 * 60 * 1000).toISOString()
      : null;
  const closed_at =
    state === "closed"
      ? new Date(created.getTime() + 24 * 60 * 60 * 1000).toISOString()
      : null;
  return {
    id: Math.floor(Math.random() * 100000),
    number: Math.floor(Math.random() * 100000),
    state: state === "open" ? "open" : "closed",
    title: "PR title",
    created_at: created.toISOString(),
    closed_at,
    merged_at,
    user: login ? { login, avatar_url: `https://github.com/${login}.png` } : null,
    requested_reviewers: Array(reviewers).fill({ login: "reviewer" }),
  };
}

// ─── transformCommits ─────────────────────────────────────────────────────────

describe("transformCommits", () => {
  it("returns zero count for empty array", () => {
    const result = transformCommits([], 7);
    expect(result.commit_count).toBe(0);
    expect(result.author_breakdown).toHaveLength(0);
  });

  it("counts only commits within the window", () => {
    const commits = [makeCommit(2), makeCommit(5), makeCommit(10)];
    const result = transformCommits(commits, 7);
    expect(result.commit_count).toBe(2);
  });

  it("excludes all commits older than period", () => {
    const result = transformCommits([makeCommit(8), makeCommit(15)], 7);
    expect(result.commit_count).toBe(0);
    expect(result.author_breakdown).toHaveLength(0);
  });

  it("aggregates commit counts by author login", () => {
    const commits = [
      makeCommit(1, { login: "alice" }),
      makeCommit(2, { login: "alice" }),
      makeCommit(3, { login: "bob" }),
    ];
    const result = transformCommits(commits, 7);
    expect(result.commit_count).toBe(3);
    expect(result.author_breakdown[0]).toMatchObject({ login: "alice", count: 2 });
    expect(result.author_breakdown[1]).toMatchObject({ login: "bob", count: 1 });
  });

  it("falls back to commit author name when github user is null", () => {
    const commits = [makeCommit(1, { name: "Jane Doe" })]; // author is null
    const result = transformCommits(commits, 7);
    expect(result.author_breakdown[0].login).toBe("Jane Doe");
    expect(result.author_breakdown[0].avatar_url).toBe("");
  });

  it("sorts author_breakdown by count descending", () => {
    const commits = [
      makeCommit(1, { login: "alice" }),
      makeCommit(2, { login: "bob" }),
      makeCommit(3, { login: "bob" }),
      makeCommit(4, { login: "bob" }),
    ];
    const result = transformCommits(commits, 7);
    expect(result.author_breakdown[0].login).toBe("bob");
    expect(result.author_breakdown[1].login).toBe("alice");
  });

  it("includes avatar_url for commits with a github author", () => {
    const commits = [makeCommit(1, { login: "dev" })];
    const result = transformCommits(commits, 7);
    expect(result.author_breakdown[0].avatar_url).toBe("https://github.com/dev.png");
  });
});

// ─── transformPRs ─────────────────────────────────────────────────────────────

describe("transformPRs", () => {
  it("returns all zeros for empty array", () => {
    expect(transformPRs([], 7)).toEqual({
      open: 0, merged: 0, closed: 0, avg_merge_time_hrs: 0, review_count: 0,
    });
  });

  it("counts open, merged, and closed PRs correctly", () => {
    const prs = [
      makePR(1, "open"),
      makePR(2, "merged"),
      makePR(3, "closed"),
    ];
    const result = transformPRs(prs, 7);
    expect(result.open).toBe(1);
    expect(result.merged).toBe(1);
    expect(result.closed).toBe(1);
  });

  it("excludes PRs outside the window", () => {
    const result = transformPRs([makePR(10, "open"), makePR(20, "merged")], 7);
    expect(result.open).toBe(0);
    expect(result.merged).toBe(0);
  });

  it("calculates average merge time in hours (merged 24h after creation)", () => {
    const prs = [makePR(2, "merged"), makePR(3, "merged")];
    const result = transformPRs(prs, 7);
    expect(result.avg_merge_time_hrs).toBe(24);
  });

  it("returns 0 avg_merge_time_hrs when no PRs are merged", () => {
    const result = transformPRs([makePR(1, "open"), makePR(2, "closed")], 7);
    expect(result.avg_merge_time_hrs).toBe(0);
  });

  it("sums review_count across all in-window PRs", () => {
    const prs = [
      makePR(1, "open", { reviewers: 2 }),
      makePR(2, "open", { reviewers: 3 }),
    ];
    expect(transformPRs(prs, 7).review_count).toBe(5);
  });

  it("handles PR with undefined requested_reviewers gracefully", () => {
    const pr: GitHubPR = {
      id: 1, number: 1, state: "open", title: "t",
      created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      closed_at: null, merged_at: null, user: null,
      requested_reviewers: undefined as unknown as unknown[],
    };
    expect(transformPRs([pr], 7).review_count).toBe(0);
  });

  it("rounds avg_merge_time_hrs to one decimal place", () => {
    // Create two PRs with merge times that produce a non-integer average
    const created1 = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const created2 = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    const pr1: GitHubPR = {
      ...makePR(5, "merged"),
      created_at: created1.toISOString(),
      merged_at: new Date(created1.getTime() + 1.5 * 60 * 60 * 1000).toISOString(),
    };
    const pr2: GitHubPR = {
      ...makePR(4, "merged"),
      created_at: created2.toISOString(),
      merged_at: new Date(created2.getTime() + 2.5 * 60 * 60 * 1000).toISOString(),
    };
    const result = transformPRs([pr1, pr2], 7);
    // avg = (1.5 + 2.5) / 2 = 2.0
    expect(result.avg_merge_time_hrs).toBe(2);
  });
});

// ─── derivePeakHour ───────────────────────────────────────────────────────────

describe("derivePeakHour", () => {
  it("returns 0 for empty array", () => {
    expect(derivePeakHour([])).toBe(0);
  });

  it("returns the UTC hour with the most commits", () => {
    const commits = [
      makeCommit(1, { hourUtc: 10 }),
      makeCommit(2, { hourUtc: 10 }),
      makeCommit(3, { hourUtc: 14 }),
    ];
    expect(derivePeakHour(commits)).toBe(10);
  });

  it("handles a single commit", () => {
    const commits = [makeCommit(1, { hourUtc: 7 })];
    expect(derivePeakHour(commits)).toBe(7);
  });

  it("handles midnight (hour 0) as peak", () => {
    const commits = [
      makeCommit(1, { hourUtc: 0 }),
      makeCommit(2, { hourUtc: 0 }),
      makeCommit(3, { hourUtc: 5 }),
    ];
    expect(derivePeakHour(commits)).toBe(0);
  });
});

// ─── deriveContributors ───────────────────────────────────────────────────────

describe("deriveContributors", () => {
  it("returns empty list for empty inputs", () => {
    expect(deriveContributors([], [], 7).contributors).toHaveLength(0);
  });

  it("counts commits and PRs per contributor", () => {
    const commits = [
      makeCommit(1, { login: "alice" }),
      makeCommit(2, { login: "alice" }),
    ];
    const prs = [makePR(1, "open", { login: "alice" })];
    const result = deriveContributors(commits, prs, 7);
    expect(result.contributors[0]).toMatchObject({ login: "alice", commits: 2, prs: 1 });
  });

  it("skips PRs where user is null", () => {
    const prs = [makePR(1, "open")]; // no login
    expect(deriveContributors([], prs, 7).contributors).toHaveLength(0);
  });

  it("filters both commits and PRs outside the window", () => {
    const commits = [makeCommit(10, { login: "alice" })];
    const prs = [makePR(10, "open", { login: "bob" })];
    expect(deriveContributors(commits, prs, 7).contributors).toHaveLength(0);
  });

  it("merges commit and PR stats for the same author", () => {
    const commits = [makeCommit(1, { login: "dev" })];
    const prs = [makePR(1, "merged", { login: "dev" })];
    const result = deriveContributors(commits, prs, 7);
    expect(result.contributors).toHaveLength(1);
    expect(result.contributors[0]).toMatchObject({ login: "dev", commits: 1, prs: 1 });
  });

  it("creates a contributor entry from PRs when no matching commit exists", () => {
    const prs = [makePR(1, "open", { login: "bob" })];
    const result = deriveContributors([], prs, 7);
    expect(result.contributors[0]).toMatchObject({ login: "bob", commits: 0, prs: 1 });
  });

  it("sorts contributors by total contributions descending", () => {
    const commits = [makeCommit(1, { login: "alice" })];
    const prs = [
      makePR(1, "open", { login: "bob" }),
      makePR(2, "open", { login: "bob" }),
      makePR(3, "open", { login: "bob" }),
    ];
    const result = deriveContributors(commits, prs, 7);
    expect(result.contributors[0].login).toBe("bob");
    expect(result.contributors[1].login).toBe("alice");
  });

  it("uses fallback name when commit has no github author", () => {
    const commits = [makeCommit(1, { name: "Ghost User" })]; // author null
    const result = deriveContributors(commits, [], 7);
    expect(result.contributors[0].login).toBe("Ghost User");
    expect(result.contributors[0].avatar_url).toBe("");
  });
});

// ─── transformToActivityPayload ───────────────────────────────────────────────

describe("transformToActivityPayload", () => {
  it("returns zeros for empty array", () => {
    expect(transformToActivityPayload([], 7)).toEqual({
      active_days: 0, peak_hour: 0, push_events: 0,
    });
  });

  it("counts unique active days (same-day commits count as one)", () => {
    const d1 = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const d2 = new Date(d1.getTime() + 30 * 60 * 1000); // 30 min later, same day
    const d3 = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const commits: GitHubCommit[] = [
      { sha: "a", commit: { author: { name: "A", email: "a@b.com", date: d1.toISOString() }, message: "m" }, author: null },
      { sha: "b", commit: { author: { name: "A", email: "a@b.com", date: d2.toISOString() }, message: "m" }, author: null },
      { sha: "c", commit: { author: { name: "A", email: "a@b.com", date: d3.toISOString() }, message: "m" }, author: null },
    ];
    const result = transformToActivityPayload(commits, 7);
    expect(result.active_days).toBe(2);
    expect(result.push_events).toBe(3);
  });

  it("excludes commits outside the window", () => {
    const result = transformToActivityPayload([makeCommit(8), makeCommit(15)], 7);
    expect(result.active_days).toBe(0);
    expect(result.push_events).toBe(0);
  });

  it("reports correct peak_hour from in-window commits", () => {
    const commits = [
      makeCommit(1, { hourUtc: 9 }),
      makeCommit(2, { hourUtc: 9 }),
      makeCommit(3, { hourUtc: 14 }),
    ];
    expect(transformToActivityPayload(commits, 7).peak_hour).toBe(9);
  });

  it("counts each commit as a push_event", () => {
    const commits = [makeCommit(1), makeCommit(2), makeCommit(3)];
    expect(transformToActivityPayload(commits, 7).push_events).toBe(3);
  });
});
