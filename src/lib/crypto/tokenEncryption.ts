import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from "crypto";

if (!process.env.ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY environment variable is required but not set");
}

function derivedKey(repoId: number): Buffer {
  const raw = Buffer.from(process.env.ENCRYPTION_KEY as string, "base64");
  if (raw.length < 32) {
    throw new Error("ENCRYPTION_KEY must decode to at least 32 bytes");
  }
  const master = raw.slice(0, 32);
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), String(repoId), 32));
}

export function encryptToken(
  token: string,
  repoId: number
): { enc: string; iv: string; tag: string } {
  const key = derivedKey(repoId);
  const iv  = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    enc: enc.toString("base64"),
    iv:  iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptToken(
  enc: string,
  iv: string,
  tag: string,
  repoId: number
): string {
  const key      = derivedKey(repoId);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(enc, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
