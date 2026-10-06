/**
 * CORS for the whole v1 API.
 *
 * The API is public and read-mostly, with no cookies and no authentication, so
 * any origin may call it — that is the point of publishing it. Because
 * `Access-Control-Allow-Credentials` is never sent, a wildcard origin cannot be
 * used to ride on a user's session: there is no session to ride on.
 */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  // Clients need to read these two to paginate and to back off politely.
  "Access-Control-Expose-Headers": "Location, Retry-After",
  "Access-Control-Max-Age": "86400",
};

/** Copies the CORS headers onto a response that has already been built. */
export function applyCors(response: Response): Response {
  for (const [header, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(header, value);
  }
  return response;
}

/**
 * Preflight answer. Every route re-exports this as its OPTIONS handler, so a
 * browser's preflight is answered identically everywhere.
 */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
