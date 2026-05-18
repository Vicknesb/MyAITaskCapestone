import { z } from "zod";

export const registerSchema = z.object({
  email:    z.string().email().max(255),
  password: z.string().min(8).max(128),
  name:     z.string().max(100).optional(),
});

export const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

export const connectRepoSchema = z.object({
  full_name:    z.string().regex(/^[\w.-]+\/[\w.-]+$/, "Must be in owner/repo format"),
  github_token: z.string().min(20, "Token too short"),
});

export const metricsQuerySchema = z.object({
  from: z.string().optional().transform((v) =>
    v ? new Date(v) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  ),
  to: z.string().optional().transform((v) => (v ? new Date(v) : new Date())),
  type: z.enum(["COMMIT_FREQ", "PR_STATS", "ACTIVITY", "CONTRIBUTOR"]).optional(),
});

export const dashboardQuerySchema = z.object({
  from: z.string().optional().transform((v) =>
    v ? new Date(v) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  ),
  to: z.string().optional().transform((v) => (v ? new Date(v) : new Date())),
});
