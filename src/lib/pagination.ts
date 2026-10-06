import { PAGINATION } from "@/config";
import { badRequest } from "./http/errors";
import type { ListMeta } from "./http/responses";

/** The kind of a sortable column, which decides how a cursor value is decoded. */
export type SortType = "string" | "number" | "date";

/** Allowed sort fields for a resource: Prisma field name -> column kind. */
export type SortSpec = Record<string, SortType>;

export type SortOrder = "asc" | "desc";

/**
 * Cursor payload. Opaque to clients — base64url of this object — but it carries
 * the sort and order it was issued for, so a cursor cannot be replayed against
 * a different ordering, where it would silently skip or repeat rows.
 */
type CursorPayload = {
  /** Version, so the format can change without misreading old cursors. */
  v: 1;
  /** Sort field. */
  s: string;
  /** Sort order. */
  o: SortOrder;
  /** Last row's sort value, as a string. */
  k: string;
  /** Last row's id, the tiebreaker. */
  i: string;
};

function encodeValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function encodeCursor(
  sort: string,
  order: SortOrder,
  row: Record<string, unknown>,
): string {
  const payload: CursorPayload = {
    v: 1,
    s: sort,
    o: order,
    k: encodeValue(row[sort]),
    i: String(row.id),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Decoded cursor, with the sort value converted back to its column type. */
export type DecodedCursor = { value: string | number | Date; id: string };

export function decodeCursor(
  raw: string,
  sort: string,
  order: SortOrder,
  type: SortType,
): DecodedCursor {
  let payload: CursorPayload;
  try {
    payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as CursorPayload;
  } catch {
    throw badRequest("The cursor is not valid. Use the nextCursor value from a previous response.");
  }

  if (payload?.v !== 1 || typeof payload.i !== "string" || typeof payload.k !== "string") {
    throw badRequest("The cursor is not valid. Use the nextCursor value from a previous response.");
  }

  // A cursor is only meaningful for the ordering it was produced under.
  if (payload.s !== sort || payload.o !== order) {
    throw badRequest(
      `This cursor was issued for sort=${payload.s}&order=${payload.o} but the request asked for sort=${sort}&order=${order}. Start the list again without a cursor.`,
    );
  }

  let value: string | number | Date = payload.k;
  if (type === "number") {
    value = Number(payload.k);
    if (!Number.isFinite(value)) throw badRequest("The cursor is not valid.");
  } else if (type === "date") {
    value = new Date(payload.k);
    if (Number.isNaN(value.getTime())) throw badRequest("The cursor is not valid.");
  }

  return { value, id: payload.i };
}

/**
 * Keyset predicate: everything strictly after (sortValue, id) in the requested
 * direction. The id tiebreaker is what makes rows with equal sort values
 * paginate deterministically.
 */
function keysetWhere(sort: string, order: SortOrder, cursor: DecodedCursor) {
  const operator = order === "asc" ? "gt" : "lt";
  return {
    OR: [
      { [sort]: { [operator]: cursor.value } },
      { AND: [{ [sort]: cursor.value }, { id: { [operator]: cursor.id } }] },
    ],
  };
}

/** The slice of a Prisma delegate this module needs. */
export type Delegate = {
  findMany: (args: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
  count: (args: Record<string, unknown>) => Promise<number>;
};

/**
 * Narrows a Prisma model delegate to the two methods used here. Prisma's
 * generated delegate types are far more specific than this module needs, and
 * they differ per model, so one cast at the call site keeps `paginate` generic
 * without leaking model generics through every list handler.
 */
export function asDelegate(delegate: unknown): Delegate {
  return delegate as Delegate;
}

export type ListQuery = {
  limit: number;
  sort: string;
  order: SortOrder;
  cursor?: string | undefined;
};

/**
 * Runs a cursor-paginated list query and builds its meta.
 *
 * `total` is counted under the same filters but without the cursor, so it is
 * the size of the whole filtered set rather than of the page.
 */
export async function paginate<T extends Record<string, unknown>>(
  delegate: Delegate,
  query: ListQuery,
  sorts: SortSpec,
  where: Record<string, unknown> = {},
  include?: Record<string, unknown>,
): Promise<{ data: T[]; meta: ListMeta }> {
  const { limit, sort, order, cursor } = query;
  const sortType = sorts[sort];
  if (!sortType) {
    // Unreachable via HTTP: the Zod schema rejects unknown sort fields first.
    throw badRequest(`Cannot sort by "${sort}".`);
  }

  const cursorWhere = cursor ? keysetWhere(sort, order, decodeCursor(cursor, sort, order, sortType)) : {};
  const filtered = Object.keys(where).length > 0 ? where : {};

  const [rows, total] = await Promise.all([
    delegate.findMany({
      where: { AND: [filtered, cursorWhere] },
      orderBy: [{ [sort]: order }, { id: order }],
      // One extra row tells us whether another page exists, without a second query.
      take: limit + 1,
      ...(include ? { include } : {}),
    }),
    delegate.count({ where: filtered }),
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);

  return {
    data: page as T[],
    meta: {
      total,
      limit,
      nextCursor: hasMore && last ? encodeCursor(sort, order, last) : null,
      hasMore,
    },
  };
}

export const { defaultLimit, maxLimit } = PAGINATION;
