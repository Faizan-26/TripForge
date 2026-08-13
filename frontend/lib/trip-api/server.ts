import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ProxyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function backendUrl() {
  const value = process.env.BACKEND_API_URL?.replace(/\/$/, "");
  if (!value) throw new ProxyError("The TripForge backend is not configured.", 503);
  return value;
}

async function accessToken() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new ProxyError("Your session expired. Sign in again to continue.", 401);
  }
  return data.session.access_token;
}

export function assertRunId(runId: string) {
  if (!UUID_PATTERN.test(runId)) throw new ProxyError("Invalid planning run identifier.", 400);
  return runId;
}

export async function callBackend(path: string, init: RequestInit = {}) {
  const token = await accessToken();
  return fetch(`${backendUrl()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
    cache: "no-store",
  });
}

export function forwardBackendResponse(response: Response, stream = false) {
  const headers = new Headers();
  headers.set("Content-Type", response.headers.get("Content-Type") ?? "application/json");
  headers.set("Cache-Control", "no-store");
  if (stream) {
    headers.set("X-Accel-Buffering", "no");
    headers.set("Connection", "keep-alive");
  }
  return new Response(response.body, { status: response.status, headers });
}

export function proxyErrorResponse(error: unknown) {
  if (error instanceof ProxyError) {
    return Response.json({ detail: error.message }, { status: error.status });
  }
  console.error("TripForge API proxy failed", error);
  return Response.json({ detail: "The planning service is unavailable." }, { status: 502 });
}
