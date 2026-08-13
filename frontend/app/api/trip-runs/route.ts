import {
  callBackend,
  forwardBackendResponse,
  proxyErrorResponse,
} from "@/lib/trip-api/server";

export async function POST(request: Request) {
  try {
    const response = await callBackend("/api/v1/trips/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
    });
    return forwardBackendResponse(response);
  } catch (error) {
    return proxyErrorResponse(error);
  }
}
