import {
  assertRunId,
  callBackend,
  forwardBackendResponse,
  proxyErrorResponse,
} from "@/lib/trip-api/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    const lastEventId = request.headers.get("Last-Event-ID");
    const response = await callBackend(`/api/v1/runs/${assertRunId(runId)}/events`, {
      headers: {
        Accept: "text/event-stream",
        ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
      },
      signal: request.signal,
    });
    return forwardBackendResponse(response, true);
  } catch (error) {
    return proxyErrorResponse(error);
  }
}
