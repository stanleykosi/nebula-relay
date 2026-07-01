import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { ApiError, isApiError, toErrorMessage } from "./errors.js";
import { jsonSafe } from "./bridge/json.js";

export async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, "invalid_json", "request body must be JSON");
  }
}

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  origin: string
): void {
  writeCorsHeaders(response, origin);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(jsonSafe(body), null, 2)}\n`);
}

export function sendError(
  response: ServerResponse,
  error: unknown,
  origin: string
): void {
  const statusCode = isApiError(error) ? error.statusCode : 500;
  const code = isApiError(error) ? error.code : "internal_error";
  const details = isApiError(error) ? error.details : undefined;
  sendJson(
    response,
    statusCode,
    {
      error: {
        code,
        message: toErrorMessage(error),
        details,
      },
    },
    origin
  );
}

export function writeCorsHeaders(
  response: ServerResponse,
  origin: string
): void {
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader(
    "access-control-allow-headers",
    "content-type, idempotency-key"
  );
}

export function parseBody<T>(
  schema: z.ZodType<T>,
  body: unknown
): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_request",
      "request validation failed",
      parsed.error.flatten()
    );
  }
  return parsed.data;
}

export function pathParts(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean);
}
