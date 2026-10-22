// The caller-ID native module (Kotlin/Swift) does not exist under Jest; tests
// control its behaviour through this mock.
jest.mock("@/modules/caller-id", () => ({
  __esModule: true,
  default: {
    getAllCallerInfo: jest.fn().mockResolvedValue([]),
    storeCallerInfo: jest.fn().mockResolvedValue(true),
    storeMultipleCallerInfo: jest.fn().mockResolvedValue(true),
    removeCallerInfo: jest.fn().mockResolvedValue(true),
    removeMultipleCallerInfo: jest.fn().mockResolvedValue(true),
    getDialCountryCode: jest.fn().mockReturnValue("IN"),
  },
}));

// Back expo-crypto with Node's crypto so hashing behaves exactly like the device
jest.mock("expo-crypto", () => {
  const nodeCrypto = require("crypto");
  return {
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    randomUUID: () => nodeCrypto.randomUUID(),
    getRandomBytes: (n: number) => nodeCrypto.getRandomValues(new Uint8Array(n)),
    digestStringAsync: async (_algorithm: string, data: string) =>
      nodeCrypto.createHash("sha256").update(data).digest("hex"),
  };
});

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
    __reset: () => store.clear(),
  };
});

// React Native's Jest preset implements requestAnimationFrame with jest.now(), which
// throws if a frame fires after a test file finishes. Redux Toolkit batches store
// notifications on animation frames, so use a teardown-safe version.
global.requestAnimationFrame = (callback: FrameRequestCallback) =>
  setTimeout(() => callback(Date.now()), 0) as unknown as number;
