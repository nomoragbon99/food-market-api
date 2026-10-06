/**
 * The one error type handlers throw. `withApi` turns it into the error
 * envelope; anything else becomes a 500 with no internals leaked.
 */
export type FieldIssue = { field: string; message: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** 400: the request itself is wrong — bad query parameter, unparseable id or cursor. */
export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "BAD_REQUEST", message, details);

/** 404: the id is well formed but no such row exists. */
export const notFound = (resource: string, id: string) =>
  new ApiError(404, "NOT_FOUND", `No ${resource} with id ${id}.`);

/** 409: the request is valid but conflicts with the resource's current state. */
export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, "CONFLICT", message, details);

/** 422: the body parsed but failed validation. `details` names every field. */
export const unprocessable = (issues: FieldIssue[]) =>
  new ApiError(422, "VALIDATION_FAILED", "The request body failed validation.", issues);
