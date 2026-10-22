import bcrypt from "bcryptjs";
import type { RequestHandler } from "express";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config";
import type { Db } from "./db";
import { HttpError } from "./errors";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, "Password must be at least 10 characters").max(128),
});
const refreshSchema = z.object({ refreshToken: z.string().min(1) });

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires */
  expiresIn: number;
}

interface AccessClaims {
  sub: string;
  type: "access";
}
interface RefreshClaims {
  sub: string;
  jti: string;
  type: "refresh";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

// Same cost as a real hash, so a login for an unknown email takes as long as a wrong password
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser-not-a-real-password", 12);

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
  ) {}

  async register(email: string, password: string): Promise<TokenPair> {
    const existing = this.db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) throw new HttpError(409, "email_taken", "An account with this email already exists");

    const hash = await bcrypt.hash(password, 12);
    const { lastInsertRowid } = this.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run(email, hash);
    return this.issueTokens(Number(lastInsertRowid));
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const user = this.db.prepare("SELECT id, password_hash FROM users WHERE email = ?").get(email) as
      | { id: number; password_hash: string }
      | undefined;

    const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !valid) throw new HttpError(401, "invalid_credentials", "Email or password is incorrect");

    return this.issueTokens(user.id);
  }

  /** Exchanges a refresh token for a new pair. Each refresh token works exactly once. */
  refresh(refreshToken: string): TokenPair {
    const claims = this.verify<RefreshClaims>(refreshToken, "refresh");
    const userId = Number(claims.sub);

    const row = this.db.prepare("SELECT revoked FROM refresh_tokens WHERE jti = ? AND user_id = ?").get(claims.jti, userId) as
      | { revoked: number }
      | undefined;

    if (!row) throw new HttpError(401, "invalid_token", "Refresh token is not recognised");
    if (row.revoked) {
      // A rotated-away token was replayed: assume theft and log out every session
      this.revokeAllForUser(userId);
      throw new HttpError(401, "token_reused", "Refresh token was already used; all sessions have been signed out");
    }

    this.db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE jti = ?").run(claims.jti);
    return this.issueTokens(userId);
  }

  logout(refreshToken: string): void {
    try {
      const claims = this.verify<RefreshClaims>(refreshToken, "refresh");
      this.db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE jti = ?").run(claims.jti);
    } catch {
      // Logging out with an invalid token is a no-op
    }
  }

  /** Express middleware: requires a valid access token in the Authorization header. */
  requireAuth: RequestHandler = (req, _res, next) => {
    const header = req.header("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      return next(new HttpError(401, "missing_token", "Authorization header with a Bearer token is required"));
    }
    try {
      req.userId = Number(this.verify<AccessClaims>(token, "access").sub);
      next();
    } catch (err) {
      next(err);
    }
  };

  private issueTokens(userId: number): TokenPair {
    const jti = randomUUID();
    const now = Math.floor(Date.now() / 1000);

    const accessToken = jwt.sign({ type: "access" }, this.config.jwtSecret, {
      subject: String(userId),
      expiresIn: this.config.accessTokenTtlSeconds,
      algorithm: "HS256",
    });
    const refreshToken = jwt.sign({ type: "refresh", jti }, this.config.jwtSecret, {
      subject: String(userId),
      expiresIn: this.config.refreshTokenTtlSeconds,
      algorithm: "HS256",
    });

    this.db
      .prepare("INSERT INTO refresh_tokens (jti, user_id, expires_at) VALUES (?, ?, ?)")
      .run(jti, userId, now + this.config.refreshTokenTtlSeconds);
    // Housekeeping: drop this user's expired tokens
    this.db.prepare("DELETE FROM refresh_tokens WHERE user_id = ? AND expires_at < ?").run(userId, now);

    return { accessToken, refreshToken, expiresIn: this.config.accessTokenTtlSeconds };
  }

  private verify<T extends { type: string }>(token: string, type: T["type"]): T & { sub: string } {
    let claims: jwt.JwtPayload;
    try {
      // Pin the algorithm so a token signed with "none" or another algorithm is rejected
      claims = jwt.verify(token, this.config.jwtSecret, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    } catch (err) {
      const expired = err instanceof jwt.TokenExpiredError;
      throw new HttpError(401, expired ? "token_expired" : "invalid_token", expired ? "Token has expired" : "Token is invalid");
    }
    // An access token must not be usable as a refresh token, or vice versa
    if (claims.type !== type || !claims.sub) throw new HttpError(401, "invalid_token", "Token is invalid");
    return claims as T & { sub: string };
  }

  private revokeAllForUser(userId: number): void {
    this.db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?").run(userId);
  }
}

export function authRouter(auth: AuthService): Router {
  const router = Router();

  router.post("/register", async (req, res, next) => {
    try {
      const { email, password } = credentialsSchema.parse(req.body);
      res.status(201).json(await auth.register(email, password));
    } catch (err) {
      next(err);
    }
  });

  router.post("/login", async (req, res, next) => {
    try {
      const { email, password } = credentialsSchema.parse(req.body);
      res.json(await auth.login(email, password));
    } catch (err) {
      next(err);
    }
  });

  router.post("/refresh", (req, res, next) => {
    try {
      res.json(auth.refresh(refreshSchema.parse(req.body).refreshToken));
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", (req, res, next) => {
    try {
      auth.logout(refreshSchema.parse(req.body).refreshToken);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
