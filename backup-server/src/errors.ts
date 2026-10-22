import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: "invalid_request", message: "Request body is invalid", issues: err.issues });
    return;
  }
  // express.json() rejects bodies over the size limit with this type
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: "payload_too_large", message: "Backup is too large" });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "invalid_json", message: "Request body is not valid JSON" });
    return;
  }

  console.error(err);
  res.status(500).json({ error: "internal_error", message: "Something went wrong" });
};
