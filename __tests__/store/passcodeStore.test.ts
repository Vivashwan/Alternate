import usePasscodeStore from "@/store/passcodeStore";

const state = () => usePasscodeStore.getState();
const NOW = new Date("2026-10-10T10:00:00Z").getTime();

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  usePasscodeStore.setState({
    passcodeEnabled: false, passcodeHash: null, passcodeSalt: null, failedAttempts: 0,
    lockoutUntil: null, forceLocked: false, autoLockTimeout: "5m", lastLockTime: null, maxFailedAttempts: 5,
  });
});
afterEach(() => jest.useRealTimers());

describe("passcode", () => {
  it("stores a salted hash, never the PIN itself", async () => {
    await state().setPasscode("4821");

    expect(state().passcodeEnabled).toBe(true);
    expect(state().passcodeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(state())).not.toContain("4821");
  });

  it("produces different hashes for the same PIN (random salt)", async () => {
    await state().setPasscode("4821");
    const first = state().passcodeHash;
    await state().setPasscode("4821");

    expect(state().passcodeHash).not.toBe(first);
  });

  it("accepts the right PIN and rejects a wrong one", async () => {
    await state().setPasscode("4821");

    expect(await state().verifyPin("0000")).toBe(false);
    expect(state().failedAttempts).toBe(1);
    expect(await state().verifyPin("4821")).toBe(true);
    expect(state().failedAttempts).toBe(0);
  });

  it("locks out for one minute after five wrong attempts", async () => {
    await state().setPasscode("4821");
    for (let i = 0; i < 5; i++) await state().verifyPin("0000");

    expect(state().isLockedOut()).toBe(true);
    await expect(state().verifyPin("4821")).rejects.toThrow("Too many failed attempts");

    jest.advanceTimersByTime(60_001);
    expect(state().isLockedOut()).toBe(false);
    expect(await state().verifyPin("4821")).toBe(true);
  });

  it("clearing the passcode resets lockout state", async () => {
    await state().setPasscode("4821");
    for (let i = 0; i < 5; i++) await state().verifyPin("0000");

    await state().clearPasscode();

    expect(state()).toMatchObject({ passcodeEnabled: false, passcodeHash: null, failedAttempts: 0, lockoutUntil: null });
  });
});

describe("auto-lock", () => {
  it("never locks when disabled", () => {
    usePasscodeStore.setState({ autoLockTimeout: "disabled", lastLockTime: NOW - 10 * 3600_000 });
    expect(state().shouldAutoLock()).toBe(false);
  });

  it("locks once the timeout has elapsed since going to background", () => {
    usePasscodeStore.setState({ autoLockTimeout: "5m" });
    state().recordLock();

    jest.advanceTimersByTime(5 * 60_000);
    expect(state().shouldAutoLock()).toBe(false);

    jest.advanceTimersByTime(1);
    expect(state().shouldAutoLock()).toBe(true);
  });

  it("locks on any return when set to immediately", () => {
    usePasscodeStore.setState({ autoLockTimeout: "immediately" });
    expect(state().shouldAutoLock()).toBe(false);

    state().recordLock();
    expect(state().shouldAutoLock()).toBe(true);
  });

  it("a manual lock wins until the user unlocks", () => {
    usePasscodeStore.setState({ autoLockTimeout: "disabled" });
    state().setForceLocked(true);
    expect(state().shouldAutoLock()).toBe(true);

    state().recordUnlock();
    expect(state().shouldAutoLock()).toBe(false);
  });
});
