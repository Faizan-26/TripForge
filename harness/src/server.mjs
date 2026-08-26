import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.mjs";
import { buildRuntime } from "./runtime.mjs";

export function createServer({ config = loadConfig(), runtime = buildRuntime(config) } = {}) {
  return http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        return json(response, 200, {
          status: "ok",
          mode: config.mode,
          platform: process.platform,
          plugins: {
            progress: config.mode === "deepseek",
            google_places: config.mode === "deepseek" && Boolean(config.googleMapsEnabled),
            google_routes: config.mode === "deepseek" && Boolean(config.googleRoutesEnabled),
          },
        });
      }
      if (request.method !== "POST" || request.url !== "/internal/v1/execute") {
        return json(response, 404, { detail: "Not found" });
      }
      if (!authorized(request.headers.authorization, config.serviceToken)) {
        return json(response, 401, { detail: "Unauthorized" });
      }

      const payload = validateExecuteRequest(
        await readJson(request, config.maxRequestBytes),
      );
      const controller = new AbortController();
      request.on("aborted", () => controller.abort());
      response.on("close", () => {
        if (!response.writableEnded) controller.abort();
      });
      response.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      for await (const update of runtime.execute(payload, controller.signal)) {
        response.write(`${JSON.stringify(update)}\n`);
      }
      response.end();
    } catch (error) {
      process.stderr.write(`[harness] execution failed: ${safeLogMessage(error)}\n`);
      if (response.headersSent) {
        if (!response.destroyed) {
          response.end(`${JSON.stringify({
            kind: "failed",
            error: {
              code: "HARNESS_EXECUTION_FAILED",
              message: publicFailureMessage(error),
            },
          })}\n`);
        }
        return;
      }
      json(response, error.statusCode ?? 500, {
        detail: error.statusCode ? error.message : "Harness execution failed",
      });
    }
  });
}

function publicFailureMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/cancelled|aborted/iu.test(message)) return "Trip planning was cancelled.";
  if (/exceeded .*ms|timed? out/iu.test(message)) {
    return "Trip planning took too long. Please try again.";
  }
  return "The planning model stopped before completing its response. Please try again.";
}

function safeLogMessage(error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  return message
    .replace(/Bearer\s+[^\s]+/giu, "Bearer [redacted]")
    .replace(/\b(?:sk|gsk)-[A-Za-z0-9_-]+\b/gu, "[redacted]")
    .slice(0, 4000);
}

export function validateExecuteRequest(value) {
  if (!value || typeof value !== "object") throw badRequest("JSON object required");
  for (const field of ["run_id", "conversation_id", "message"]) {
    if (typeof value[field] !== "string" || !value[field].trim()) {
      throw badRequest(`${field} is required`);
    }
  }
  if (value.message.length > 20_000) throw badRequest("message is too long");
  return value;
}

function authorized(header, token) {
  const actual = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function readJson(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw badRequest("Invalid JSON");
  }
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function json(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const server = createServer({ config });
  server.listen(config.port, config.host, () => {
    process.stdout.write(`TripForge Harness listening on http://${config.host}:${config.port}\n`);
  });
}
