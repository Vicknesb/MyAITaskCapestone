import { Router } from "express";
import { prisma } from "../lib/db";
import { authenticate, AuthRequest } from "../middleware/authenticate";
import { metricsQuerySchema, dashboardQuerySchema } from "../lib/validation/schemas";
import type { MetricType } from "@prisma/client";

export const metricsRouter = Router();

// ─── GET /api/metrics/:repoId ─────────────────────────────────────────────────

metricsRouter.get("/:repoId", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const parsed = metricsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid query params", code: "VALIDATION_ERROR" });
    return;
  }
  const { from, to, type } = parsed.data;

  const repository = await prisma.repository.findUnique({ where: { id: String(req.params["repoId"]) } });
  if (!repository) {
    res.status(404).json({ success: false, error: "Repository not found", code: "NOT_FOUND" });
    return;
  }

  const access = await prisma.userRepository.findUnique({
    where: { user_id_repository_id: { user_id: req.userId!, repository_id: repository.id } },
  });
  if (!access) {
    res.status(403).json({ success: false, error: "Forbidden", code: "FORBIDDEN" });
    return;
  }

  const metrics = await prisma.metric.findMany({
    where: {
      repository_id: repository.id,
      recorded_at:   { gte: from, lte: to },
      ...(type ? { type: type as MetricType } : {}),
    },
    orderBy: { recorded_at: "asc" },
  });

  res.json({
    success: true,
    data: {
      repository: { id: repository.id, full_name: repository.full_name },
      metrics: metrics.map((m) => ({
        id:          m.id,
        type:        m.type,
        recorded_at: m.recorded_at,
        period_days: m.period_days,
        payload:     m.payload,
      })),
    },
  });
});

// ─── GET /api/dashboard ───────────────────────────────────────────────────────

metricsRouter.get("/", authenticate, async (req: AuthRequest, res): Promise<void> => {
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

  // Latest metric per (repo, type) in the date window
  const allMetrics = await prisma.metric.findMany({
    where: { repository_id: { in: repoIds }, recorded_at: { gte: from, lte: to } },
    orderBy: { recorded_at: "desc" },
  });

  // Build per-repo map with the most recent payload per type
  const perRepoMap = new Map<string, Record<string, unknown>>();
  for (const m of allMetrics) {
    if (!perRepoMap.has(m.repository_id)) perRepoMap.set(m.repository_id, {});
    const entry = perRepoMap.get(m.repository_id)!;
    if (!entry[m.type]) entry[m.type] = m.payload; // first = most recent
  }

  const perRepo = links.map((l) => {
    const payloads = perRepoMap.get(l.repository_id) ?? {};
    return {
      repository_id:  l.repository_id,
      full_name:      l.repository.full_name,
      commit_freq:    payloads["COMMIT_FREQ"] ?? null,
      pr_stats:       payloads["PR_STATS"]    ?? null,
      activity:       payloads["ACTIVITY"]    ?? null,
      contributors:   payloads["CONTRIBUTOR"] ?? null,
    };
  });

  // Aggregate summary
  let totalCommits = 0;
  let totalMerged  = 0;
  const contributorSet = new Set<string>();

  for (const r of perRepo) {
    const cf = r.commit_freq as { commit_count?: number } | null;
    const pr = r.pr_stats   as { merged?: number }        | null;
    const co = r.contributors as { contributors?: { login: string }[] } | null;

    if (cf?.commit_count)         totalCommits += cf.commit_count;
    if (pr?.merged)               totalMerged  += pr.merged;
    if (co?.contributors) {
      co.contributors.forEach((c) => contributorSet.add(c.login));
    }
  }

  res.json({
    success: true,
    data: {
      period: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        total_commits:        totalCommits,
        total_prs_merged:     totalMerged,
        active_contributors:  contributorSet.size,
        repos_tracked:        repoIds.length,
      },
      per_repo: perRepo,
    },
  });
});
