import { Router } from "express";
import { prisma } from "../lib/db";
import { hashPassword, comparePassword } from "../lib/auth/password";
import { signToken, hashToken } from "../lib/auth/jwt";
import { authenticate, AuthRequest } from "../middleware/authenticate";
import { registerSchema, loginSchema } from "../lib/validation/schemas";

export const authRouter = Router();

const COOKIE_NAME = "devpulse_session";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days ms

// ─── POST /api/auth/register ─────────────────────────────────────────────────

authRouter.post("/register", async (req, res): Promise<void> => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid input", code: "VALIDATION_ERROR",
      details: parsed.error.flatten().fieldErrors });
    return;
  }

  const { email, password, name } = parsed.data;

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    res.status(409).json({ success: false, error: "Email already registered", code: "EMAIL_TAKEN" });
    return;
  }

  const user = await prisma.user.create({
    data: { email, name: name ?? null, password_hash: await hashPassword(password) },
  });

  // Auto-login: issue a session token so the client lands on dashboard immediately
  const expiresAt = new Date(Date.now() + COOKIE_MAX_AGE);
  const tempId    = `${user.id}-${Date.now()}`;
  const tempToken = signToken(user.id, tempId);
  const session   = await prisma.session.create({
    data: {
      user_id:    user.id,
      token_hash: hashToken(tempToken),
      expires_at: expiresAt,
      user_agent: req.headers["user-agent"] ?? null,
      ip_address: req.ip ?? null,
    },
  });
  const finalToken = signToken(user.id, session.id);
  await prisma.session.update({ where: { id: session.id }, data: { token_hash: hashToken(finalToken) } });

  res.cookie(COOKIE_NAME, finalToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge:   COOKIE_MAX_AGE,
  });

  res.status(201).json({
    success: true,
    data: { token: finalToken, user: { id: user.id, email: user.email, name: user.name } },
  });
});

// ─── POST /api/auth/login ────────────────────────────────────────────────────

authRouter.post("/login", async (req, res): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid input", code: "VALIDATION_ERROR" });
    return;
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

  // Constant-time rejection — same message for wrong email or wrong password
  if (!user || !(await comparePassword(password, user.password_hash))) {
    res.status(401).json({ success: false, error: "Invalid email or password", code: "INVALID_CREDENTIALS" });
    return;
  }

  const expiresAt = new Date(Date.now() + COOKIE_MAX_AGE);
  // Use a temp id so we can sign before creating the DB row
  const tempSessionId = `${user.id}-${Date.now()}`;
  const token         = signToken(user.id, tempSessionId);
  const tokenHash     = hashToken(token);

  const session = await prisma.session.create({
    data: {
      user_id:    user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      user_agent: req.headers["user-agent"] ?? null,
      ip_address: req.ip ?? null,
    },
  });

  // Re-sign with the real session id
  const finalToken = signToken(user.id, session.id);
  const finalHash  = hashToken(finalToken);
  await prisma.session.update({ where: { id: session.id }, data: { token_hash: finalHash } });

  res.cookie(COOKIE_NAME, finalToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge:   COOKIE_MAX_AGE,
  });

  res.status(200).json({
    success: true,
    data: { token: finalToken, expires_at: expiresAt.toISOString(), user: { id: user.id, email: user.email, name: user.name } },
  });
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────

authRouter.get("/me", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) {
    res.status(401).json({ success: false, error: "User not found", code: "UNAUTHORIZED" });
    return;
  }
  res.json({ success: true, data: { id: user.id, email: user.email, name: user.name, created_at: user.created_at } });
});

// ─── DELETE /api/auth/logout ─────────────────────────────────────────────────

authRouter.delete("/logout", authenticate, async (req: AuthRequest, res): Promise<void> => {
  await prisma.session.deleteMany({ where: { id: req.sessionId } });
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true, data: { message: "Logged out" } });
});
