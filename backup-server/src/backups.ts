import { Router } from "express";
import { z } from "zod";
import type { Db } from "./db";
import { HttpError } from "./errors";

const base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/, "must be base64");

/**
 * The encrypted backup produced by the app (see lib/backup-crypto.ts). The server
 * validates its shape but holds no key: ciphertext, nonce and salt are opaque to it.
 */
export const envelopeSchema = z.object({
  version: z.literal(1),
  kdf: z.object({
    name: z.literal("scrypt"),
    N: z.number().int().min(1 << 14),
    r: z.number().int().positive(),
    p: z.number().int().positive(),
    salt: base64,
  }),
  cipher: z.literal("xchacha20-poly1305"),
  nonce: base64,
  ciphertext: base64,
});

const uploadSchema = z.object({
  envelope: envelopeSchema,
  contactCount: z.number().int().min(0).max(1_000_000),
});

interface BackupRow {
  envelope: string;
  contact_count: number;
  size_bytes: number;
  updated_at: string;
}

const metadata = (row: BackupRow) => ({
  contactCount: row.contact_count,
  sizeBytes: row.size_bytes,
  updatedAt: row.updated_at,
});

export function backupRouter(db: Db): Router {
  const router = Router();
  const findBackup = (userId: number) =>
    db.prepare("SELECT envelope, contact_count, size_bytes, updated_at FROM backups WHERE user_id = ?").get(userId) as
      | BackupRow
      | undefined;

  // Upsert: each account keeps one latest backup
  router.put("/latest", (req, res, next) => {
    try {
      const { envelope, contactCount } = uploadSchema.parse(req.body);
      const serialised = JSON.stringify(envelope);
      const updatedAt = new Date().toISOString();

      db.prepare(
        `INSERT INTO backups (user_id, envelope, contact_count, size_bytes, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           envelope = excluded.envelope, contact_count = excluded.contact_count,
           size_bytes = excluded.size_bytes, updated_at = excluded.updated_at`,
      ).run(req.userId, serialised, contactCount, Buffer.byteLength(serialised), updatedAt);

      res.json(metadata(findBackup(req.userId!)!));
    } catch (err) {
      next(err);
    }
  });

  router.get("/latest/meta", (req, res, next) => {
    const row = findBackup(req.userId!);
    if (!row) return next(new HttpError(404, "no_backup", "No backup has been uploaded yet"));
    res.json(metadata(row));
  });

  router.get("/latest", (req, res, next) => {
    const row = findBackup(req.userId!);
    if (!row) return next(new HttpError(404, "no_backup", "No backup has been uploaded yet"));
    res.json({ ...metadata(row), envelope: JSON.parse(row.envelope) });
  });

  router.delete("/latest", (req, res) => {
    db.prepare("DELETE FROM backups WHERE user_id = ?").run(req.userId);
    res.status(204).end();
  });

  return router;
}
