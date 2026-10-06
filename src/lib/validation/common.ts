import { z } from "zod";
import { PAGINATION } from "@/config";
import { badRequest } from "@/lib/http/errors";
import type { SortOrder, SortSpec } from "@/lib/pagination";

/**
 * `limit`:
 *   - absent            -> PAGINATION.defaultLimit
 *   - above the maximum -> clamped down to it (not an error)
 *   - below 1, or not an integer -> 400
 */
const limitSchema = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    if (raw === undefined || raw === "") return PAGINATION.defaultLimit;
    if (!/^-?\d+$/.test(raw)) {
      ctx.addIssue({
        code: "custom",
        message: `limit must be a whole number between 1 and ${PAGINATION.maxLimit}, got "${raw}".`,
      });
      return z.NEVER;
    }
    const parsed = Number(raw);
    if (parsed < 1) {
      ctx.addIssue({
        code: "custom",
        message: `limit must be at least 1, got ${parsed}.`,
      });
      return z.NEVER;
    }
    return Math.min(parsed, PAGINATION.maxLimit);
  });

const orderSchema = z
  .enum(["asc", "desc"], { message: 'order must be "asc" or "desc".' })
  .optional()
  .default("desc");

const cursorSchema = z.string().min(1).optional();

/** A boolean filter given as a query string: `true` / `false` only. */
export const booleanParam = (name: string) =>
  z
    .enum(["true", "false"], { message: `${name} must be "true" or "false".` })
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true"));

/** A non-negative integer filter, e.g. a minor-unit price bound. */
export const intParam = (name: string) =>
  z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw === "") return undefined;
      if (!/^\d+$/.test(raw)) {
        ctx.addIssue({ code: "custom", message: `${name} must be a non-negative whole number.` });
        return z.NEVER;
      }
      return Number(raw);
    });

/** An ISO date filter. */
export const dateParam = (name: string) =>
  z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw === "") return undefined;
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        ctx.addIssue({ code: "custom", message: `${name} must be an ISO 8601 date.` });
        return z.NEVER;
      }
      return parsed;
    });

/** A UUID filter — malformed values are a bad request, not an empty result. */
export const uuidParam = (name: string) =>
  z.string().uuid({ message: `${name} must be a UUID.` }).optional();

/**
 * Builds a resource's query schema: the shared pagination parameters plus that
 * resource's own filters. `.strict()` is the point — an unknown query
 * parameter is a 400 rather than something silently ignored, so a typo like
 * `?citi=Lagos` cannot look like a successful request for all cities.
 */
export function listQuerySchema<Filters extends z.ZodRawShape>(
  sorts: SortSpec,
  filters: Filters,
  defaultSort: string,
) {
  const sortNames = Object.keys(sorts) as [string, ...string[]];
  return z
    .object({
      limit: limitSchema,
      sort: z
        .enum(sortNames, {
          message: `sort must be one of: ${sortNames.join(", ")}.`,
        })
        .optional()
        .default(defaultSort),
      order: orderSchema,
      cursor: cursorSchema,
      ...filters,
    })
    .strict();
}

/** Parses a URL's query string, turning any failure into a 400 that names the parameters. */
export function parseQuery<Schema extends z.ZodType>(
  schema: Schema,
  url: string,
): z.output<Schema> {
  const params = Object.fromEntries(new URL(url).searchParams.entries());
  const result = schema.safeParse(params);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      parameter: issue.path.join(".") || "(query)",
      message:
        issue.code === "unrecognized_keys"
          ? `Unknown query parameter(s): ${issue.keys.join(", ")}.`
          : issue.message,
    }));
    throw badRequest(issues[0]?.message ?? "Invalid query parameters.", issues);
  }

  return result.data;
}

/** The shape every list handler passes to `paginate`. */
export type ParsedListQuery = {
  limit: number;
  sort: string;
  order: SortOrder;
  cursor?: string | undefined;
};
