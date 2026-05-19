import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from "crypto";

if (!process.env.ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY environment variable is required but not set");
}

// Fixed application salt for HKDF domain separation (RFC 5869 §3.1).
// Non-empty salt strengthens key derivation against master-key compromise.
// IMPORTANT: changing this salt invalidates all previously encrypted tokens —
// run a re-encryption migration before deploying any change here.
const HKDF_SALT = Buffer.from("devpulse-v1-github-token-encryption");

function derivedKey(repoId: number): Buffer {
  const raw = Buffer.from(process.env.ENCRYPTION_KEY as string, "base64");
  if (raw.length < 32) {
    throw new Error("ENCRYPTION_KEY must decode to at least 32 bytes");
  }
  const master = raw.slice(0, 32);
  return Buffer.from(hkdfSync("sha256", master, HKDF_SALT, `devpulse-github-token-${repoId}`, 32));
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
