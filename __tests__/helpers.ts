import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";
import { signToken } from "../src/lib/auth/jwt";
import { hashToken } from "../src/lib/auth/jwt";
import type { User } from "@prisma/client";

/** Wipe all rows in FK-safe order between tests. */
export async function resetDb(): Promise<void> {
  await prisma.syncLog.deleteMany();
  await prisma.metric.deleteMany();
  await prisma.userRepository.deleteMany();
  await prisma.repository.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
}

/** Create a user and a valid session; return both plus the raw JWT. */
export async function createAuthUser(
  email = "test@example.com",
  password = "Password123!"
): Promise<{ user: User; token: string }> {
  const user = await prisma.user.create({
    data: {
      email,
      name: "Test User",
      password_hash: await hashPassword(password),
    },
  });

  const sessionId = `sess-${Date.now()}`;
  const token     = signToken(user.id, sessionId);
  const tokenHash = hashToken(token);

  await prisma.session.create({
    data: {
      id:         sessionId,
      user_id:    user.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return { user, token };
}

/** Disconnect Prisma after the test file finishes. */
export async function teardown(): Promise<void> {
  await prisma.$disconnect();
}
