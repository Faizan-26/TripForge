import {
  callBackend,
  forwardBackendResponse,
  proxyErrorResponse,
} from "@/lib/trip-api/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const name = url.searchParams.get("name");
    if (!name || !/^places\/[^/]+\/photos\/[^/]+$/.test(name)) {
      return Response.json({ detail: "Invalid photo reference." }, { status: 400 });
    }
    const query = new URLSearchParams({ name, width: "1200", height: "900" });
    const response = await callBackend(`/api/v1/places/photos?${query}`, {
      headers: { Accept: "image/*" },
      signal: request.signal,
    });
    return forwardBackendResponse(response);
  } catch (error) {
    return proxyErrorResponse(error);
  }
}
