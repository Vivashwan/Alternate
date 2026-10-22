import * as SecureStore from "expo-secure-store";

/**
 * Persists the backup session. The refresh token goes in the OS keystore
 * (Android Keystore / iOS Keychain) via expo-secure-store; the short-lived access
 * token is only ever held in memory.
 */
const KEYS = {
  refreshToken: "backup.refreshToken",
  serverUrl: "backup.serverUrl",
  email: "backup.email",
} as const;

export type StoredSession = { serverUrl: string; email: string; hasRefreshToken: boolean };

export const sessionStorage = {
  getRefreshToken: () => SecureStore.getItemAsync(KEYS.refreshToken),

  async saveSession(session: { serverUrl: string; email: string; refreshToken: string }) {
    await Promise.all([
      SecureStore.setItemAsync(KEYS.refreshToken, session.refreshToken),
      SecureStore.setItemAsync(KEYS.serverUrl, session.serverUrl),
      SecureStore.setItemAsync(KEYS.email, session.email),
    ]);
  },

  saveRefreshToken: (token: string) => SecureStore.setItemAsync(KEYS.refreshToken, token),

  async loadSession(): Promise<StoredSession | null> {
    const [serverUrl, email, refreshToken] = await Promise.all([
      SecureStore.getItemAsync(KEYS.serverUrl),
      SecureStore.getItemAsync(KEYS.email),
      SecureStore.getItemAsync(KEYS.refreshToken),
    ]);
    if (!serverUrl || !email) return null;
    return { serverUrl, email, hasRefreshToken: !!refreshToken };
  },

  /** Signing out forgets the tokens but keeps the server URL for convenience. */
  async clearTokens() {
    await SecureStore.deleteItemAsync(KEYS.refreshToken);
  },
};
