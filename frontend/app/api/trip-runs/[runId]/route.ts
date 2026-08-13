import {
  assertRunId,
  callBackend,
  forwardBackendResponse,
  proxyErrorResponse,
} from "@/lib/trip-api/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    const response = await callBackend(`/api/v1/runs/${assertRunId(runId)}`);
    return forwardBackendResponse(response);
  } catch (error) {
    return proxyErrorResponse(error);
  }
}
