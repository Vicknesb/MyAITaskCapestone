import { Router } from "express";
import { prisma } from "../lib/db";
import { authenticate, AuthRequest } from "../middleware/authenticate";
import { dashboardQuerySchema } from "../lib/validation/schemas";

export const dashboardRouter = Router();

dashboardRouter.get("/", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const parsed = dashboardQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid query params", code: "VALIDATION_ERROR" });
    return;
  }
  const { from, to } = parsed.data;

  const links = await prisma.userRepository.findMany({
    where: { user_id: req.userId },
    include: { repository: true },
  });

  const repoIds = links.map((l) => l.repository_id);

  const allMetrics = await prisma.metric.findMany({
    where: { repository_id: { in: repoIds }, recorded_at: { gte: from, lte: to } },
    orderBy: { recorded_at: "desc" },
  });

  // Most recent payload per (repo, type)
  const perRepoMap = new Map<string, Record<string, unknown>>();
  for (const m of allMetrics) {
    if (!perRepoMap.has(m.repository_id)) perRepoMap.set(m.repository_id, {});
    const entry = perRepoMap.get(m.repository_id)!;
    if (!entry[m.type]) entry[m.type] = m.payload;
  }

  const perRepo = links.map((l) => {
    const payloads = perRepoMap.get(l.repository_id) ?? {};
    return {
      repository_id: l.repository_id,
      full_name:     l.repository.full_name,
      commit_freq:   payloads["COMMIT_FREQ"] ?? null,
      pr_stats:      payloads["PR_STATS"]    ?? null,
      activity:      payloads["ACTIVITY"]    ?? null,
      contributors:  payloads["CONTRIBUTOR"] ?? null,
    };
  });

  let totalCommits = 0, totalMerged = 0;
  const contributorSet = new Set<string>();

  for (const r of perRepo) {
    const cf = r.commit_freq  as { commit_count?: number }              | null;
    const pr = r.pr_stats     as { merged?: number }                    | null;
    const co = r.contributors as { contributors?: { login: string }[] } | null;
    if (cf?.commit_count)   totalCommits += cf.commit_count;
    if (pr?.merged)         totalMerged  += pr.merged;
    co?.contributors?.forEach((c) => contributorSet.add(c.login));
  }

  res.json({
    success: true,
    data: {
      period:  { from: from.toISOString(), to: to.toISOString() },
      summary: {
        total_commits:       totalCommits,
        total_prs_merged:    totalMerged,
        active_contributors: contributorSet.size,
        repos_tracked:       repoIds.length,
      },
      per_repo: perRepo,
    },
  });
});
