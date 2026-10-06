import { RATE_LIMIT } from "@/config";
import { applyCors } from "./cors";
import { ApiError } from "./errors";
import { checkRateLimit, clientIp } from "./rate-limit";
import { errorResponse } from "./responses";

/**
 * Wraps every /api/v1 route handler. It rate limits first, then runs the
 * handler, then translates failures:
 *   - an ApiError becomes its own status and envelope;
 *   - anything else becomes a 500 whose body says nothing about the cause.
 *
 * The real error is logged server-side, so a stack trace, a Prisma message or
 * a connection string can never reach the client.
 */
export function withApi<Context>(
  handler: (request: Request, context: Context) => Promise<Response>,
): (request: Request, context: Context) => Promise<Response> {
  return async (request, context) => {
    // CORS headers go on every response, including the 429 and the 500, or a
    // browser client sees an opaque network failure instead of the real status.
    const limit = checkRateLimit(clientIp(request));
    if (!limit.allowed) {
      return applyCors(
        errorResponse(
          429,
          "RATE_LIMITED",
          `Rate limit of ${RATE_LIMIT.max} requests per ${RATE_LIMIT.windowSeconds}s exceeded.`,
          undefined,
          { "Retry-After": String(limit.retryAfterSeconds) },
        ),
      );
    }

    try {
      return applyCors(await handler(request, context));
    } catch (error) {
      if (error instanceof ApiError) {
        return applyCors(
          errorResponse(error.status, error.code, error.message, error.details),
        );
      }

      console.error("Unhandled error in API handler:", error);
      return applyCors(
        errorResponse(500, "INTERNAL_ERROR", "An unexpected error occurred. Please try again."),
      );
    }
  };
}
