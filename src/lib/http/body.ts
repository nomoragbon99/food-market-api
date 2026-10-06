import type { z } from "zod";
import { badRequest, unprocessable, type FieldIssue } from "./errors";

/**
 * Parses and validates a JSON body.
 *
 * Unparseable JSON is a 400 (the request is malformed). JSON that parses but
 * fails the schema is a 422 whose details name every offending field.
 */
export async function parseBody<Schema extends z.ZodType>(
  schema: Schema,
  request: Request,
): Promise<z.output<Schema>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw badRequest("The request body is not valid JSON.");
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues: FieldIssue[] = result.error.issues.map((issue) => {
      if (issue.code === "unrecognized_keys") {
        return {
          field: issue.keys.join(", "),
          message: `Unknown field(s): ${issue.keys.join(", ")}. Only the documented fields are accepted.`,
        };
      }
      return {
        field: issue.path.length > 0 ? issue.path.join(".") : "(body)",
        message: issue.message,
      };
    });
    throw unprocessable(issues);
  }

  return result.data;
}
