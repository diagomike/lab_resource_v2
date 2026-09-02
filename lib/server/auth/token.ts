import { createHash, randomBytes } from "crypto";

/**
 * Tokens are ONE-WAY HASHED, by design.
 *
 * The raw token is returned exactly once — to be put in a cookie or an email link — and
 * only its SHA-256 digest is ever stored. A leaked database dump therefore reveals no
 * usable session or invitation secret.
 *
 * The consequence is deliberate and must not be "fixed": resending the same link is
 * architecturally impossible. Every resend regenerates the token and invalidates the old
 * one. Do not add a rawToken column to make resending easier.
 */

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** IP addresses are hashed too — useful for abuse correlation, useless as PII. */
export function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}
