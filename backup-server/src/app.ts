import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { AuthService, authRouter } from "./auth";
import { backupRouter } from "./backups";
import type { Config } from "./config";
import type { Db } from "./db";
import { errorHandler, HttpError } from "./errors";

export function createApp(db: Db, config: Config, options: { authRateLimit?: number } = {}) {
  const app = express();
  const auth = new AuthService(db, config);

  app.disable("x-powered-by");
  app.use(helmet());
  // Encrypted contact photos are base64, so allow headroom over the raw byte limit
  app.use(express.json({ limit: config.maxBackupBytes }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // Slow down password guessing: per-IP limit on the credential endpoints
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: options.authRateLimit ?? 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new HttpError(429, "rate_limited", "Too many attempts, try again later")),
  });

  app.use("/auth", authLimiter, authRouter(auth));
  app.use("/backups", auth.requireAuth, backupRouter(db));

  app.use((_req, _res, next) => next(new HttpError(404, "not_found", "Route not found")));
  app.use(errorHandler);

  return app;
}
