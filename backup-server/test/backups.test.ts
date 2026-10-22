import { makeApp, makeEnvelope, registerUser } from "./helpers";

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("backups", () => {
  it("returns 404 before anything is uploaded", async () => {
    const { api } = makeApp();
    const { accessToken } = await registerUser(api);

    const res = await api.get("/backups/latest/meta").set(authed(accessToken));

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("no_backup");
  });

  it("stores the envelope and returns it with metadata", async () => {
    const { api } = makeApp();
    const { accessToken } = await registerUser(api);

    const put = await api
      .put("/backups/latest")
      .set(authed(accessToken))
      .send({ envelope: makeEnvelope(), contactCount: 42 })
      .expect(200);
    expect(put.body).toEqual({ contactCount: 42, sizeBytes: expect.any(Number), updatedAt: expect.any(String) });

    const get = await api.get("/backups/latest").set(authed(accessToken)).expect(200);
    expect(get.body.envelope).toEqual(makeEnvelope());
    expect(get.body.contactCount).toBe(42);
  });

  it("keeps only the latest backup per account", async () => {
    const { api, db } = makeApp();
    const { accessToken } = await registerUser(api);

    for (const ciphertext of ["Zmlyc3Q=", "c2Vjb25k"]) {
      await api.put("/backups/latest").set(authed(accessToken)).send({ envelope: makeEnvelope(ciphertext), contactCount: 1 });
    }

    expect(db.prepare("SELECT COUNT(*) AS n FROM backups").get()).toEqual({ n: 1 });
    const get = await api.get("/backups/latest").set(authed(accessToken));
    expect(get.body.envelope.ciphertext).toBe("c2Vjb25k");
  });

  it("never shows one user's backup to another", async () => {
    const { api } = makeApp();
    const asha = await registerUser(api, "asha@example.com");
    const ravi = await registerUser(api, "ravi@example.com");
    await api.put("/backups/latest").set(authed(asha.accessToken)).send({ envelope: makeEnvelope(), contactCount: 3 });

    expect((await api.get("/backups/latest").set(authed(ravi.accessToken))).status).toBe(404);
  });

  it.each([
    ["an unknown cipher", { ...makeEnvelope(), cipher: "aes-128-ecb" }],
    ["a weak key-derivation cost", { ...makeEnvelope(), kdf: { ...makeEnvelope().kdf, N: 1024 } }],
    ["non-base64 ciphertext", makeEnvelope("not base64!!")],
    ["a missing nonce", { ...makeEnvelope(), nonce: undefined }],
  ])("rejects %s", async (_label, envelope) => {
    const { api } = makeApp();
    const { accessToken } = await registerUser(api);

    const res = await api.put("/backups/latest").set(authed(accessToken)).send({ envelope, contactCount: 1 });

    expect(res.status).toBe(400);
  });

  it("rejects uploads over the size limit", async () => {
    const { api } = makeApp({ maxBackupBytes: 2048 });
    const { accessToken } = await registerUser(api);

    const res = await api
      .put("/backups/latest")
      .set(authed(accessToken))
      .send({ envelope: makeEnvelope("A".repeat(4096)), contactCount: 1 });

    expect(res.status).toBe(413);
  });

  it("deletes the backup", async () => {
    const { api } = makeApp();
    const { accessToken } = await registerUser(api);
    await api.put("/backups/latest").set(authed(accessToken)).send({ envelope: makeEnvelope(), contactCount: 1 });

    await api.delete("/backups/latest").set(authed(accessToken)).expect(204);

    expect((await api.get("/backups/latest").set(authed(accessToken))).status).toBe(404);
  });

  it("deleting the account removes its backup and tokens (cascade)", async () => {
    const { api, db } = makeApp();
    const { accessToken } = await registerUser(api);
    await api.put("/backups/latest").set(authed(accessToken)).send({ envelope: makeEnvelope(), contactCount: 1 });

    db.prepare("DELETE FROM users").run();

    expect(db.prepare("SELECT COUNT(*) AS n FROM backups").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM refresh_tokens").get()).toEqual({ n: 0 });
  });
});
