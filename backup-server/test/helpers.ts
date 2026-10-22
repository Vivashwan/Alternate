import request from "supertest";
import { createApp } from "../src/app";
import type { Config } from "../src/config";
import { openDatabase } from "../src/db";

export const SECRET = "test-secret-that-is-definitely-longer-than-32-chars";

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    jwtSecret: SECRET,
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 3600,
    databasePath: ":memory:",
    maxBackupBytes: 1024 * 1024,
    ...overrides,
  };
}

export function makeApp(overrides: Partial<Config> = {}, options: { authRateLimit?: number } = {}) {
  const db = openDatabase(":memory:");
  const app = createApp(db, makeConfig(overrides), { authRateLimit: options.authRateLimit ?? 1000 });
  return { app, db, api: request(app) };
}

export const PASSWORD = "correct-horse-battery";

export async function registerUser(api: ReturnType<typeof request>, email = "asha@example.com") {
  const res = await api.post("/auth/register").send({ email, password: PASSWORD }).expect(201);
  return res.body as { accessToken: string; refreshToken: string; expiresIn: number };
}

/** A structurally valid envelope; the server never decrypts it. */
export function makeEnvelope(ciphertext = "c2VjcmV0LWNvbnRhY3RzLWVuY3J5cHRlZA==") {
  return {
    version: 1,
    kdf: { name: "scrypt", N: 1 << 15, r: 8, p: 1, salt: "c2FsdHNhbHRzYWx0c2FsdA==" },
    cipher: "xchacha20-poly1305",
    nonce: "bm9uY2Vub25jZW5vbmNlbm9uY2Vub25j",
    ciphertext,
  };
}
