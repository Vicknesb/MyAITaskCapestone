import jwt from "jsonwebtoken";
import { createHash } from "crypto";
import type { JWTPayload } from "../../types/auth";

const JWT_SECRET  = process.env.JWT_SECRET  ?? "dev-secret-not-for-production";
const JWT_EXPIRY  = 7 * 24 * 60 * 60; // 7 days in seconds

export function signToken(userId: string, sessionId: string): string {
  return jwt.sign({ sub: userId, sid: sessionId }, JWT_SECRET, {
    expiresIn: JWT_EXPIRY,
  });
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET) as JWTPayload;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
