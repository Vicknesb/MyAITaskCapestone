import type { Request, Response, NextFunction } from "express";
import { verifyToken, signToken, hashToken } from "../lib/auth/jwt";
import { prisma } from "../lib/db";

export interface AuthRequest extends Request {
  userId?:    string;
  sessionId?: string;
}

const COOKIE_NAME   = "devpulse_session";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days ms
const RENEWAL_THRESHOLD_MS = 24 * 60 * 60 * 1000; // renew when < 24 h remaining

export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const raw =
    req.cookies?.devpulse_session ??
    req.headers.authorization?.replace(/^Bearer\s+/i, "");

  if (!raw) {
    res.status(401).json({ success: false, error: "Unauthorized", code: "UNAUTHORIZED" });
    return;
  }

  try {
    const payload   = verifyToken(raw);
    const tokenHash = hashToken(raw);

    const session = await prisma.session.findUnique({ where: { token_hash: tokenHash } });

    if (!session || session.expires_at < new Date()) {
      if (session) await prisma.session.delete({ where: { id: session.id } });
      res.status(401).json({ success: false, error: "Session expired or revoked", code: "UNAUTHORIZED" });
      return;
    }

    // Sliding renewal: if less than 24 h remaining, issue a fresh token
    const ttlRemaining = session.expires_at.getTime() - Date.now();
    if (ttlRemaining < RENEWAL_THRESHOLD_MS) {
      const newToken  = signToken(payload.sub, session.id);
      const newHash   = hashToken(newToken);
      const newExpiry = new Date(Date.now() + COOKIE_MAX_AGE);
      await prisma.session.update({
        where: { id: session.id },
        data:  { token_hash: newHash, expires_at: newExpiry },
      });
      res.cookie(COOKIE_NAME, newToken, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge:   COOKIE_MAX_AGE,
      });
    }

    req.userId    = payload.sub;
    req.sessionId = payload.sid;
    next();
  } catch {
    res.status(401).json({ success: false, error: "Invalid token", code: "UNAUTHORIZED" });
  }
}
