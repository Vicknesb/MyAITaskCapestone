import { Router } from "express";
import { prisma } from "../lib/db";
import { authenticate, AuthRequest } from "../middleware/authenticate";
import { connectRepoSchema } from "../lib/validation/schemas";
import { encryptToken, decryptToken } from "../lib/crypto/tokenEncryption";
import { fetchRepoMeta, GitHubError } from "../lib/github/client";

export const reposRouter = Router();

const MAX_REPOS = 10;

// ─── GET /api/repos ──────────────────────────────────────────────────────────

reposRouter.get("/", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const links = await prisma.userRepository.findMany({
    where: { user_id: req.userId },
    include: {
      repository: {
        include: {
          sync_logs: {
            orderBy: { started_at: "desc" },
            take: 1,
          },
        },
      },
    },
    orderBy: { connected_at: "desc" },
  });

  const repositories = links.map((l) => {
    const latest = l.repository.sync_logs[0] ?? null;
    return {
      id:              l.repository.id,
      github_repo_id:  l.repository.github_repo_id,
      full_name:       l.repository.full_name,
      owner:           l.repository.owner,
      name:            l.repository.name,
      description:     l.repository.description,
      is_private:      l.repository.is_private,
      default_branch:  l.repository.default_branch,
      connected_at:    l.connected_at,
      last_synced_at:  latest?.last_synced_at ?? null,
      sync_status:     latest?.status ?? null,
    };
  });

  res.json({ success: true, data: { repositories } });
});

// ─── POST /api/repos/connect ─────────────────────────────────────────────────

reposRouter.post("/connect", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const parsed = connectRepoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid input", code: "VALIDATION_ERROR",
      details: parsed.error.flatten().fieldErrors });
    return;
  }

  const { full_name, github_token } = parsed.data;

  // Enforce per-user repo limit
  const count = await prisma.userRepository.count({ where: { user_id: req.userId } });
  if (count >= MAX_REPOS) {
    res.status(422).json({ success: false, error: `Maximum ${MAX_REPOS} repositories allowed`, code: "REPO_LIMIT_EXCEEDED" });
    return;
  }

  // Validate token + fetch repo metadata from GitHub
  let meta: Awaited<ReturnType<typeof fetchRepoMeta>>;
  try {
    meta = await fetchRepoMeta(full_name, github_token);
  } catch (err) {
    const e = err as GitHubError;
    const status = e.code === "GITHUB_TOKEN_INVALID" ? 403 : e.code === "REPO_NOT_FOUND" ? 404 : 500;
    res.status(status).json({ success: false, error: e.message, code: e.code ?? "GITHUB_ERROR" });
    return;
  }

  // Upsert repository
  const { enc, iv, tag } = encryptToken(github_token, meta.id);
  const repository = await prisma.repository.upsert({
    where:  { github_repo_id: meta.id },
    update: { github_token_enc: enc, token_iv: iv, token_tag: tag, full_name: meta.full_name,
              description: meta.description, is_private: meta.private, default_branch: meta.default_branch },
    create: { github_repo_id: meta.id, full_name: meta.full_name, owner: meta.owner.login,
              name: meta.name, description: meta.description, is_private: meta.private,
              default_branch: meta.default_branch, github_token_enc: enc, token_iv: iv, token_tag: tag },
  });

  // Check if this user already connected this repo
  const existing = await prisma.userRepository.findUnique({
    where: { user_id_repository_id: { user_id: req.userId!, repository_id: repository.id } },
  });
  if (existing) {
    res.status(409).json({ success: false, error: "Repository already connected", code: "REPO_ALREADY_CONNECTED" });
    return;
  }

  const link = await prisma.userRepository.create({
    data: { user_id: req.userId!, repository_id: repository.id, role: "owner" },
  });

  // Queue initial sync log (actual sync engine wired in Phase 4)
  await prisma.syncLog.create({
    data: { repository_id: repository.id, triggered_by: "connect" },
  });

  res.status(201).json({
    success: true,
    data: { id: repository.id, full_name: repository.full_name,
            github_repo_id: repository.github_repo_id, connected_at: link.connected_at },
  });
});

// ─── DELETE /api/repos/:id ───────────────────────────────────────────────────

reposRouter.delete("/:id", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const link = await prisma.userRepository.findUnique({ where: { id: String(req.params["id"]) } });

  if (!link) {
    res.status(404).json({ success: false, error: "Connection not found", code: "NOT_FOUND" });
    return;
  }
  if (link.user_id !== req.userId) {
    res.status(403).json({ success: false, error: "Forbidden", code: "FORBIDDEN" });
    return;
  }

  await prisma.userRepository.delete({ where: { id: link.id } });

  // If no other users are connected, cascade-delete the repo and its data
  const remaining = await prisma.userRepository.count({ where: { repository_id: link.repository_id } });
  if (remaining === 0) {
    await prisma.repository.delete({ where: { id: link.repository_id } });
  }

  res.json({ success: true, data: { message: "Repository disconnected" } });
});

// ─── GET /api/repos/:id/files ─────────────────────────────────────────────────
// Browse contents of a connected GitHub repository.
// Query params: ?path= (default: root)  ?ref= (default: repo default_branch)

reposRouter.get("/:id/files", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const repository = await prisma.repository.findUnique({ where: { id: String(req.params["id"]) } });
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

  const rawPath = typeof req.query["path"] === "string" ? req.query["path"] : "";
  const rawRef  = typeof req.query["ref"]  === "string" ? req.query["ref"]  : repository.default_branch;

  // Block path traversal and reject characters that could manipulate the URL
  if (rawPath && !/^[\w\-./]+$/.test(rawPath)) {
    res.status(400).json({ success: false, error: "Invalid path", code: "INVALID_PATH" });
    return;
  }
  if (rawPath.split("/").some((seg) => seg === "..")) {
    res.status(400).json({ success: false, error: "Path traversal not allowed", code: "INVALID_PATH" });
    return;
  }

  const path = rawPath.replace(/^\/+/, ""); // strip leading slashes
  const ref  = rawRef;

  const token = decryptToken(repository.github_token_enc, repository.token_iv, repository.token_tag, repository.github_repo_id);
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const apiUrl = `https://api.github.com/repos/${repository.full_name}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;

  const ghRes = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (ghRes.status === 404) {
    res.status(404).json({ success: false, error: "Path not found in repository", code: "NOT_FOUND" });
    return;
  }
  if (!ghRes.ok) {
    res.status(502).json({ success: false, error: "GitHub API error", code: "GITHUB_ERROR" });
    return;
  }

  const data = await ghRes.json() as unknown;
  res.json({ success: true, data });
});
