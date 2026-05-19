import { prisma } from "../db";
import { decryptToken } from "../crypto/tokenEncryption";
import { MetricType, SyncStatus } from "@prisma/client";
import {
  GitHubCommit, GitHubPR,
  transformCommits, transformPRs, transformToActivityPayload, deriveContributors,
} from "../metrics/transformers";

const GITHUB_API = "https://api.github.com";
const MAX_PAGES  = 10;
const PER_PAGE   = 100;

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function paginate<T>(url: string, token: string): Promise<{ items: T[]; rateRemaining: number | null }> {
  const items: T[] = [];
  let rateRemaining: number | null = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${url}&per_page=${PER_PAGE}&page=${page}`, {
      headers: ghHeaders(token),
    });

    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining !== null) rateRemaining = parseInt(remaining, 10);

    if (res.status === 409) break; // empty repo — GitHub returns 409 for /commits on empty repos
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`);

    const batch = (await res.json()) as T[];
    items.push(...batch);
    if (batch.length < PER_PAGE) break;
  }

  return { items, rateRemaining };
}

export async function runSync(repositoryId: string, syncLogId: string): Promise<void> {
  await prisma.syncLog.update({ where: { id: syncLogId }, data: { status: SyncStatus.RUNNING } });

  try {
    const repo = await prisma.repository.findUniqueOrThrow({ where: { id: repositoryId } });
    const token = decryptToken(repo.github_token_enc, repo.token_iv, repo.token_tag, repo.github_repo_id);

    // Determine incremental sync window
    const lastLog = await prisma.syncLog.findFirst({
      where: { repository_id: repositoryId, status: SyncStatus.SUCCESS },
      orderBy: { last_synced_at: "desc" },
    });
    const since = lastLog?.last_synced_at ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sinceIso = since.toISOString();

    const [owner, repoName] = repo.full_name.split("/");

    // Fetch commits since last sync
    const { items: commits, rateRemaining: commitRate } = await paginate<GitHubCommit>(
      `${GITHUB_API}/repos/${owner}/${repoName}/commits?sha=${repo.default_branch}&since=${sinceIso}`,
      token
    );

    // Fetch PRs updated since last sync
    const { items: prs, rateRemaining: prRate } = await paginate<GitHubPR>(
      `${GITHUB_API}/repos/${owner}/${repoName}/pulls?state=all&sort=updated&direction=desc`,
      token
    );

    const rateRemaining = prRate ?? commitRate;
    const recordedAt = new Date();

    // Build and upsert metrics for 7-day and 30-day windows
    for (const periodDays of [7, 30]) {
      await prisma.metric.upsert({
        where: { repository_id_type_recorded_at_period_days: { repository_id: repositoryId, type: MetricType.COMMIT_FREQ, recorded_at: recordedAt, period_days: periodDays } },
        create: { repository_id: repositoryId, type: MetricType.COMMIT_FREQ, recorded_at: recordedAt, period_days: periodDays, payload: transformCommits(commits, periodDays) as object },
        update: { payload: transformCommits(commits, periodDays) as object },
      });

      await prisma.metric.upsert({
        where: { repository_id_type_recorded_at_period_days: { repository_id: repositoryId, type: MetricType.PR_STATS, recorded_at: recordedAt, period_days: periodDays } },
        create: { repository_id: repositoryId, type: MetricType.PR_STATS, recorded_at: recordedAt, period_days: periodDays, payload: transformPRs(prs, periodDays) as object },
        update: { payload: transformPRs(prs, periodDays) as object },
      });

      await prisma.metric.upsert({
        where: { repository_id_type_recorded_at_period_days: { repository_id: repositoryId, type: MetricType.ACTIVITY, recorded_at: recordedAt, period_days: periodDays } },
        create: { repository_id: repositoryId, type: MetricType.ACTIVITY, recorded_at: recordedAt, period_days: periodDays, payload: transformToActivityPayload(commits, periodDays) as object },
        update: { payload: transformToActivityPayload(commits, periodDays) as object },
      });

      await prisma.metric.upsert({
        where: { repository_id_type_recorded_at_period_days: { repository_id: repositoryId, type: MetricType.CONTRIBUTOR, recorded_at: recordedAt, period_days: periodDays } },
        create: { repository_id: repositoryId, type: MetricType.CONTRIBUTOR, recorded_at: recordedAt, period_days: periodDays, payload: deriveContributors(commits, prs, periodDays) as object },
        update: { payload: deriveContributors(commits, prs, periodDays) as object },
      });
    }

    const lastItem = commits[0]?.commit.author.date ?? prs[0]?.created_at;

    await prisma.syncLog.update({
      where: { id: syncLogId },
      data: {
        status: SyncStatus.SUCCESS,
        finished_at: new Date(),
        items_fetched: commits.length + prs.length,
        last_synced_at: lastItem ? new Date(lastItem) : new Date(),
        github_rate_remaining: rateRemaining,
      },
    });
  } catch (err) {
    await prisma.syncLog.update({
      where: { id: syncLogId },
      data: {
        status: SyncStatus.FAILED,
        finished_at: new Date(),
        error_message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
