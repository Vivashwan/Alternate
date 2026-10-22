import { sessionStorage } from "@/lib/session-storage";
import { backupApi } from "@/store/backup/backupApi";
import { hydrateBackupSession, makeStore as createStore } from "@/store/backup/store";
import * as SecureStore from "expo-secure-store";

const SERVER = "https://backup.test";
const META = { contactCount: 12, sizeBytes: 2048, updatedAt: "2026-10-10T10:00:00.000Z" };

type Route = (req: Request) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;

/** Fakes the backup server: routes keyed by "METHOD /path". */
function mockServer(routes: Record<string, Route>) {
  const calls: string[] = [];
  jest.spyOn(global, "fetch").mockImplementation(async (input) => {
    const req = input as Request;
    const key = `${req.method} ${new URL(req.url).pathname}`;
    calls.push(key);
    const route = routes[key];
    const { status, body } = route ? await route(req) : { status: 404, body: { error: "not_found" } };
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  return calls;
}

// Track stores so RTK Query's cache-expiry timers can be cleared after each test
const stores: ReturnType<typeof createStore>[] = [];
const makeStore = (...args: Parameters<typeof createStore>) => {
  const store = createStore(...args);
  stores.push(store);
  return store;
};
afterEach(async () => {
  for (const store of stores.splice(0)) store.dispatch(backupApi.util.resetApiState());
  // RTK batches updates via requestAnimationFrame (a setTimeout under Jest); let it flush
  await new Promise((resolve) => setTimeout(resolve, 0));
});

const bearer = (req: Request) => req.headers.get("authorization");
const signedInStore = (accessToken: string | null = "stale-token") =>
  makeStore({ auth: { serverUrl: SERVER, email: "asha@example.com", accessToken, status: "signedIn" } });

beforeEach(async () => {
  jest.restoreAllMocks();
  (SecureStore as unknown as { __reset: () => void }).__reset();
});

describe("token refresh", () => {
  it("refreshes an expired access token and replays the request", async () => {
    await sessionStorage.saveRefreshToken("refresh-1");
    const calls = mockServer({
      "GET /backups/latest/meta": (req) =>
        bearer(req) === "Bearer fresh-token"
          ? { status: 200, body: META }
          : { status: 401, body: { error: "token_expired" } },
      "POST /auth/refresh": async (req) => {
        expect(await req.json()).toEqual({ refreshToken: "refresh-1" });
        return { status: 200, body: { accessToken: "fresh-token", refreshToken: "refresh-2", expiresIn: 900 } };
      },
    });
    const store = signedInStore();

    const result = await store.dispatch(backupApi.endpoints.getBackupMeta.initiate());

    expect(result.data).toEqual(META);
    expect(calls).toEqual(["GET /backups/latest/meta", "POST /auth/refresh", "GET /backups/latest/meta"]);
    expect(store.getState().auth.accessToken).toBe("fresh-token");
    // The rotated refresh token replaces the old one in secure storage
    await expect(sessionStorage.getRefreshToken()).resolves.toBe("refresh-2");
  });

  it("refreshes only once when several requests fail together", async () => {
    await sessionStorage.saveRefreshToken("refresh-1");
    let refreshes = 0;
    mockServer({
      "GET /backups/latest/meta": (req) =>
        bearer(req) === "Bearer fresh-token" ? { status: 200, body: META } : { status: 401 },
      "GET /backups/latest": (req) =>
        bearer(req) === "Bearer fresh-token" ? { status: 200, body: { ...META, envelope: {} } } : { status: 401 },
      "DELETE /backups/latest": (req) => (bearer(req) === "Bearer fresh-token" ? { status: 204 } : { status: 401 }),
      "POST /auth/refresh": async () => {
        refreshes++;
        await new Promise((resolve) => setTimeout(resolve, 20)); // slow network
        return { status: 200, body: { accessToken: "fresh-token", refreshToken: `refresh-${refreshes + 1}` } };
      },
    });
    const store = signedInStore();

    const results = await Promise.all([
      store.dispatch(backupApi.endpoints.getBackupMeta.initiate()),
      store.dispatch(backupApi.endpoints.downloadBackup.initiate()),
      store.dispatch(backupApi.endpoints.deleteBackup.initiate()),
    ]);

    expect(refreshes).toBe(1);
    expect(results.every((r) => !("error" in r) || r.error === undefined)).toBe(true);
  });

  it("signs out and forgets the refresh token when the refresh is rejected", async () => {
    await sessionStorage.saveRefreshToken("stolen-and-reused");
    mockServer({
      "GET /backups/latest/meta": () => ({ status: 401, body: { error: "token_expired" } }),
      "POST /auth/refresh": () => ({ status: 401, body: { error: "token_reused" } }),
    });
    const store = signedInStore();

    const result = await store.dispatch(backupApi.endpoints.getBackupMeta.initiate());

    expect(result.error).toMatchObject({ status: 401 });
    expect(store.getState().auth).toMatchObject({ status: "signedOut", accessToken: null, email: null });
    await expect(sessionStorage.getRefreshToken()).resolves.toBeNull();
  });

  it("does not try to refresh when a login itself is rejected", async () => {
    const calls = mockServer({
      "POST /auth/login": () => ({ status: 401, body: { error: "invalid_credentials", message: "Email or password is incorrect" } }),
    });
    const store = makeStore({ auth: { serverUrl: SERVER, email: null, accessToken: null, status: "signedOut" } });

    const result = await store.dispatch(
      backupApi.endpoints.login.initiate({ email: "asha@example.com", password: "wrong-password" }),
    );

    expect(result.error).toMatchObject({ status: 401, data: { message: "Email or password is incorrect" } });
    expect(calls).toEqual(["POST /auth/login"]);
    expect(store.getState().auth.status).toBe("signedOut");
  });
});

describe("session", () => {
  it("login keeps the access token in memory and the refresh token in secure storage", async () => {
    mockServer({
      "POST /auth/login": () => ({ status: 200, body: { accessToken: "access-1", refreshToken: "refresh-1", expiresIn: 900 } }),
    });
    const store = makeStore({ auth: { serverUrl: SERVER, email: null, accessToken: null, status: "signedOut" } });

    await store.dispatch(backupApi.endpoints.login.initiate({ email: "asha@example.com", password: "long-enough-pw" }));

    expect(store.getState().auth).toMatchObject({ status: "signedIn", email: "asha@example.com", accessToken: "access-1" });
    await expect(sessionStorage.getRefreshToken()).resolves.toBe("refresh-1");
    await expect(sessionStorage.loadSession()).resolves.toEqual({
      serverUrl: SERVER, email: "asha@example.com", hasRefreshToken: true,
    });
  });

  it("restores a saved session on app start, fetching an access token lazily", async () => {
    await sessionStorage.saveSession({ serverUrl: SERVER, email: "asha@example.com", refreshToken: "refresh-1" });
    const store = makeStore();

    await hydrateBackupSession(store);

    expect(store.getState().auth).toMatchObject({
      status: "signedIn", serverUrl: SERVER, email: "asha@example.com", accessToken: null,
    });
  });

  it("logout revokes the refresh token on the server and signs out locally", async () => {
    await sessionStorage.saveRefreshToken("refresh-1");
    let revoked: unknown;
    mockServer({ "POST /auth/logout": async (req) => ((revoked = await req.json()), { status: 204 }) });
    const store = signedInStore("access-1");

    await store.dispatch(backupApi.endpoints.logout.initiate());

    expect(revoked).toEqual({ refreshToken: "refresh-1" });
    expect(store.getState().auth.status).toBe("signedOut");
    await expect(sessionStorage.getRefreshToken()).resolves.toBeNull();
  });
});

describe("backup endpoints", () => {
  it("treats a 404 from the metadata endpoint as 'no backup yet'", async () => {
    mockServer({ "GET /backups/latest/meta": () => ({ status: 404, body: { error: "no_backup" } }) });

    const result = await signedInStore().dispatch(backupApi.endpoints.getBackupMeta.initiate());

    expect(result.data).toBeNull();
    expect(result.error).toBeUndefined();
  });

  it("refetches metadata after an upload", async () => {
    let count = 0;
    const calls = mockServer({
      "GET /backups/latest/meta": () => ({ status: 200, body: { ...META, contactCount: count } }),
      "PUT /backups/latest": () => ((count = 5), { status: 200, body: { ...META, contactCount: 5 } }),
    });
    const store = signedInStore("access-1");
    const subscription = store.dispatch(backupApi.endpoints.getBackupMeta.initiate());
    await subscription;

    await store.dispatch(backupApi.endpoints.uploadBackup.initiate({ envelope: {} as never, contactCount: 5 }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls.filter((c) => c === "GET /backups/latest/meta")).toHaveLength(2);
    subscription.unsubscribe();
  });

  it("explains a missing server URL instead of calling fetch", async () => {
    const fetchSpy = jest.spyOn(global, "fetch");
    const store = makeStore();

    const result = await store.dispatch(backupApi.endpoints.getBackupMeta.initiate());

    expect(result.error).toMatchObject({ error: "Set a backup server URL first" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
