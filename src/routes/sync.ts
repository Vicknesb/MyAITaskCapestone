import { Router } from "express";
import { prisma } from "../lib/db";
import { authenticate, AuthRequest } from "../middleware/authenticate";
import { SyncStatus } from "@prisma/client";
import { runSync } from "../lib/github/syncEngine";

export const syncRouter = Router();

// ─── POST /api/sync/:repoId ───────────────────────────────────────────────────

syncRouter.post("/:repoId", authenticate, async (req: AuthRequest, res): Promise<void> => {
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

  // Guard: reject if a sync is already running
  const running = await prisma.syncLog.findFirst({
    where: { repository_id: repository.id, status: SyncStatus.RUNNING },
  });
  if (running) {
    res.status(409).json({ success: false, error: "A sync is already in progress", code: "SYNC_IN_PROGRESS" });
    return;
  }

  const syncLog = await prisma.syncLog.create({
    data: { repository_id: repository.id, status: SyncStatus.PENDING, triggered_by: "manual" },
  });

  // Fire-and-forget: respond immediately, sync runs in background.
  setImmediate(() => { runSync(repository.id, syncLog.id).catch(() => undefined); });

  res.status(202).json({
    success: true,
    data: { sync_log_id: syncLog.id, status: syncLog.status },
  });
});
