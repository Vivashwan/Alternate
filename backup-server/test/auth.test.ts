import jwt from "jsonwebtoken";
import { loadConfig } from "../src/config";
import { makeApp, PASSWORD, registerUser, SECRET } from "./helpers";

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("config", () => {
  it("refuses to start without a strong JWT secret", () => {
    expect(() => loadConfig({ JWT_SECRET: "short" })).toThrow("JWT_SECRET");
    expect(() => loadConfig({})).toThrow("JWT_SECRET");
  });
});

describe("register", () => {
  it("creates an account and returns a token pair", async () => {
    const { api } = makeApp();

    const tokens = await registerUser(api);

    expect(tokens).toEqual({ accessToken: expect.any(String), refreshToken: expect.any(String), expiresIn: 900 });
  });

  it("rejects a duplicate email regardless of case", async () => {
    const { api } = makeApp();
    await registerUser(api, "asha@example.com");

    const res = await api.post("/auth/register").send({ email: "ASHA@Example.com", password: PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("email_taken");
  });

  it.each([
    ["a short password", { email: "a@example.com", password: "short" }],
    ["an invalid email", { email: "not-an-email", password: PASSWORD }],
    ["a missing field", { email: "a@example.com" }],
  ])("rejects %s", async (_label, body) => {
    const { api } = makeApp();
    const res = await api.post("/auth/register").send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("stores a bcrypt hash, not the password", async () => {
    const { api, db } = makeApp();
    await registerUser(api);

    const { password_hash } = db.prepare("SELECT password_hash FROM users").get() as { password_hash: string };
    expect(password_hash).toMatch(/^\$2[aby]\$12\$/);
    expect(password_hash).not.toContain(PASSWORD);
  });
});

describe("login", () => {
  it("returns tokens for correct credentials", async () => {
    const { api } = makeApp();
    await registerUser(api);

    const res = await api.post("/auth/login").send({ email: "asha@example.com", password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
  });

  it("gives the same error for a wrong password and an unknown email", async () => {
    const { api } = makeApp();
    await registerUser(api);

    const wrongPassword = await api.post("/auth/login").send({ email: "asha@example.com", password: "wrong-password-123" });
    const unknownEmail = await api.post("/auth/login").send({ email: "nobody@example.com", password: PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it("rate-limits repeated attempts", async () => {
    const { api } = makeApp({}, { authRateLimit: 3 });
    const attempt = () => api.post("/auth/login").send({ email: "x@example.com", password: "wrong-password-123" });

    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("rate_limited");
  });
});

describe("access tokens", () => {
  it("are required on backup routes", async () => {
    const { api } = makeApp();

    expect((await api.get("/backups/latest")).body.error).toBe("missing_token");
    expect((await api.get("/backups/latest").set(authed("garbage"))).body.error).toBe("invalid_token");
  });

  it("are rejected once expired", async () => {
    const { api } = makeApp();
    const expired = jwt.sign({ type: "access" }, SECRET, { subject: "1", expiresIn: -10 });

    const res = await api.get("/backups/latest").set(authed(expired));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("token_expired");
  });

  it("reject tokens signed with another key or with alg=none", async () => {
    const { api } = makeApp();
    const forged = jwt.sign({ type: "access" }, "another-secret-another-secret-another", { subject: "1" });
    const unsigned = jwt.sign({ type: "access" }, "", { subject: "1", algorithm: "none" });

    expect((await api.get("/backups/latest").set(authed(forged))).status).toBe(401);
    expect((await api.get("/backups/latest").set(authed(unsigned))).status).toBe(401);
  });

  it("cannot be swapped with refresh tokens", async () => {
    const { api } = makeApp();
    const { accessToken, refreshToken } = await registerUser(api);

    expect((await api.get("/backups/latest/meta").set(authed(refreshToken))).status).toBe(401);
    expect((await api.post("/auth/refresh").send({ refreshToken: accessToken })).status).toBe(401);
  });
});

describe("refresh tokens", () => {
  it("rotate: each one returns a new pair and works only once", async () => {
    const { api } = makeApp();
    const first = await registerUser(api);

    const rotated = await api.post("/auth/refresh").send({ refreshToken: first.refreshToken }).expect(200);
    expect(rotated.body.refreshToken).not.toBe(first.refreshToken);

    await api.get("/backups/latest/meta").set(authed(rotated.body.accessToken)).expect(404); // authenticated, just no backup
  });

  it("signs out every session when a used refresh token is replayed", async () => {
    const { api } = makeApp();
    const first = await registerUser(api);
    const rotated = (await api.post("/auth/refresh").send({ refreshToken: first.refreshToken })).body;

    // An attacker replays the stolen, already-used token
    const replay = await api.post("/auth/refresh").send({ refreshToken: first.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe("token_reused");

    // The legitimate user's newer token is now revoked too
    expect((await api.post("/auth/refresh").send({ refreshToken: rotated.refreshToken })).status).toBe(401);
  });

  it("stop working after logout", async () => {
    const { api } = makeApp();
    const { refreshToken } = await registerUser(api);

    await api.post("/auth/logout").send({ refreshToken }).expect(204);

    expect((await api.post("/auth/refresh").send({ refreshToken })).status).toBe(401);
  });
});
