import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type Db = Database.Database;

export function openDatabase(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One row per issued refresh token. Rotation marks the old row revoked; presenting
    -- a revoked token again means it was stolen, so the whole family is revoked.
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      jti        TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      revoked    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

    -- The server only ever sees the encrypted envelope; it cannot read contact data.
    CREATE TABLE IF NOT EXISTS backups (
      user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      envelope      TEXT NOT NULL,
      contact_count INTEGER NOT NULL,
      size_bytes    INTEGER NOT NULL,
      updated_at    TEXT NOT NULL
    );
  `);

  return db;
}
