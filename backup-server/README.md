# Alternate Backup Server

Optional, self-hostable backup API for Alternate. It is **zero-knowledge**: the app
encrypts contacts on the device (scrypt + XChaCha20-Poly1305) before upload, so the
server only ever stores ciphertext and can't read anyone's contacts.

## Run

```bash
docker build -t alternate-backup-server .
docker run -p 4000:4000 \
  -e JWT_SECRET="$(openssl rand -base64 48)" \
  -v alternate-data:/app/data \
  alternate-backup-server
```

Then enter the server URL in **Settings → Encrypted Cloud Backup** in the app.
Put it behind HTTPS (e.g. a reverse proxy) for real use.

| Variable | Default | |
|---|---|---|
| `JWT_SECRET` | *(required, ≥ 32 chars)* | Server refuses to start without it |
| `PORT` | `4000` | |
| `DATABASE_PATH` | `data/backups.db` | SQLite file |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | Short-lived, held only in app memory |
| `REFRESH_TOKEN_TTL_SECONDS` | `2592000` | Stored in the device keystore |
| `MAX_BACKUP_BYTES` | `20971520` | Request size limit |

## API

| Method | Path | Auth | |
|---|---|---|---|
| `POST` | `/auth/register` | – | `{ email, password }` → token pair |
| `POST` | `/auth/login` | – | `{ email, password }` → token pair |
| `POST` | `/auth/refresh` | – | `{ refreshToken }` → new pair (rotation) |
| `POST` | `/auth/logout` | – | `{ refreshToken }` → revokes it |
| `GET` | `/backups/latest/meta` | Bearer | `{ contactCount, sizeBytes, updatedAt }` |
| `GET` | `/backups/latest` | Bearer | metadata + encrypted `envelope` |
| `PUT` | `/backups/latest` | Bearer | `{ envelope, contactCount }` (replaces) |
| `DELETE` | `/backups/latest` | Bearer | |

## Security design

- **JWT access tokens** (HS256, algorithm pinned) expire after 15 minutes. Access and refresh tokens carry a `type` claim and can't be used in place of each other.
- **Rotating refresh tokens** work exactly once. Replaying a used one is treated as theft and revokes every session for that account.
- **Passwords** are hashed with bcrypt (cost 12). Logins for unknown emails do equal work, so response timing doesn't reveal which emails exist.
- **Rate limiting** on `/auth/*`, `helmet` security headers, request size limits, and `zod` validation of every body, including the shape and minimum KDF cost of uploaded envelopes.

## Develop

```bash
npm install
npm test          # 28 Jest + Supertest tests
npm run typecheck
npm run build && JWT_SECRET=... npm start
```
