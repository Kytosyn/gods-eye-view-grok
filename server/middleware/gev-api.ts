/**
 * Production /api/* broker for God's Eye View data layers.
 * Dev uses the same handlers via Vite configureServer in gev/vite.config.js.
 */
interface GrokEvent {
  url: URL;
  req: {
    method: string;
    headers: Headers;
    body?: ReadableStream<Uint8Array> | null;
  };
}

export default async function gevApiMiddleware(
  event: GrokEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const path = event.url.pathname;
  if (!path.startsWith("/api/")) return next();

  const { dispatchGevProxy } = await import("../../gev/connect-adapter.mjs");

  const method = (event.req.method ?? "GET").toUpperCase();
  const headers = event.req.headers ?? new Headers();
  const body =
    method === "GET" || method === "HEAD" ? undefined : (event.req.body ?? undefined);

  const request = new Request(event.url, {
    method,
    headers,
    body,
  } as RequestInit);

  try {
    const response = await dispatchGevProxy(request);
    if (response) return response;
  } catch (error) {
    console.error("[gev-api] proxy failed:", error);
    return new Response(JSON.stringify({ error: "Upstream proxy failed" }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  return next();
}
