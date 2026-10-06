import { badRequest } from "./http/errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A malformed id is a bad request (400). A well-formed id that matches no row
 * is a missing resource (404) — that distinction is the caller's, made by
 * looking the id up after this returns.
 */
export function parseId(value: string, resource: string): string {
  if (!UUID.test(value)) {
    throw badRequest(`"${value}" is not a valid ${resource} id. Expected a UUID.`);
  }
  return value.toLowerCase();
}
