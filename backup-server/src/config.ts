export interface Config {
  port: number;
  jwtSecret: string;
  /** Access token lifetime in seconds. Short, because access tokens can't be revoked. */
  accessTokenTtlSeconds: number;
  /** Refresh token lifetime in seconds. Refresh tokens are stored and can be revoked. */
  refreshTokenTtlSeconds: number;
  databasePath: string;
  /** Largest encrypted backup accepted, in bytes (contact photos make backups large). */
  maxBackupBytes: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const jwtSecret = env.JWT_SECRET ?? "";
  if (jwtSecret.length < 32) {
    // Refuse to start with a guessable signing key rather than silently using a default
    throw new Error("JWT_SECRET must be set to at least 32 characters");
  }

  return {
    port: Number(env.PORT ?? 4000),
    jwtSecret,
    accessTokenTtlSeconds: Number(env.ACCESS_TOKEN_TTL_SECONDS ?? 15 * 60),
    refreshTokenTtlSeconds: Number(env.REFRESH_TOKEN_TTL_SECONDS ?? 30 * 24 * 3600),
    databasePath: env.DATABASE_PATH ?? "data/backups.db",
    maxBackupBytes: Number(env.MAX_BACKUP_BYTES ?? 20 * 1024 * 1024),
  };
}
