// Authentication: scrypt password hashing, opaque random session tokens (only a SHA-256 is stored).
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { playerCosmetics, playerProfiles, sessions, users } from "@/db/schema";
import type { Appearance } from "@/game/shared/types";
import { fail } from "./http";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const COOKIE = "fm_session";
const SESSION_DAYS = 30;

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  isGuest: boolean;
  appearance: Appearance;
}

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string | null) {
  if (!stored) return false;
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const cache = new Map<string, { user: AuthUser; exp: number }>();
export const invalidateUserCache = (userId: string) => {
  for (const [k, v] of cache) if (v.user.id === userId) cache.delete(k);
};

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(sessions).values({ userId, tokenHash: sha(token), expiresAt });
  const store = await cookies();
  const prod = process.env.NODE_ENV === "production";
  const insecureCookie = process.env.COOKIE_INSECURE === "1";
  if (prod && insecureCookie) {
    console.warn("[security] COOKIE_INSECURE=1 is ignored in production; session cookies remain Secure.");
  }
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Always Secure in production (HTTPS). COOKIE_INSECURE is only for local
    // non-production testing over plain HTTP and is ignored in production.
    secure: prod ? true : !insecureCookie,
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) {
    const h = sha(token);
    cache.delete(h);
    await db.delete(sessions).where(eq(sessions.tokenHash, h));
  }
  store.delete(COOKIE);
}

export async function currentUser(): Promise<AuthUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  const h = sha(token);
  const hit = cache.get(h);
  if (hit && hit.exp > Date.now()) return hit.user;
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      isGuest: users.isGuest,
      displayName: playerProfiles.displayName,
      gender: playerCosmetics.gender,
      hair: playerCosmetics.hair,
      hairColor: playerCosmetics.hairColor,
      skin: playerCosmetics.skin,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(playerProfiles, eq(playerProfiles.userId, users.id))
    .leftJoin(playerCosmetics, eq(playerCosmetics.userId, users.id))
    .where(and(eq(sessions.tokenHash, h), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  const user: AuthUser = {
    id: r.id,
    username: r.username,
    isGuest: r.isGuest,
    displayName: r.displayName ?? r.username,
    appearance: { gender: (r.gender as "m" | "f") ?? "m", hair: r.hair ?? 0, hairColor: r.hairColor ?? 0, skin: r.skin ?? 1 },
  };
  cache.set(h, { user, exp: Date.now() + 30_000 });
  if (cache.size > 2000) for (const [k, v] of cache) if (v.exp < Date.now()) cache.delete(k);
  return user;
}

export async function requireUser(): Promise<AuthUser> {
  const u = await currentUser();
  if (!u) throw fail(401, "UNAUTHENTICATED", "Please sign in or continue as a guest");
  return u;
}

/** Creates the profile/cosmetics/statistics rows for a new user. */
export async function provisionUser(userId: string, displayName: string) {
  const { playerStatistics } = await import("@/db/schema");
  await db.insert(playerProfiles).values({ userId, displayName }).onConflictDoNothing();
  await db.insert(playerCosmetics).values({ userId }).onConflictDoNothing();
  await db.insert(playerStatistics).values({ userId }).onConflictDoNothing();
}
