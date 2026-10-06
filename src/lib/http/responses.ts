import { NextResponse } from "next/server";

/** List meta, identical on every list endpoint. */
export type ListMeta = {
  total: number;
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
};

/** `{ "data": ..., "meta": ... }` — the only success shape. */
export function ok<T>(data: T, meta: Record<string, unknown> = {}, init?: ResponseInit) {
  return NextResponse.json({ data, meta }, init);
}

/** 201 with a Location header pointing at the created resource. */
export function created<T>(data: T, location: string) {
  return NextResponse.json({ data, meta: {} }, { status: 201, headers: { Location: location } });
}

/** 204, which carries no body at all. */
export function noContent() {
  return new NextResponse(null, { status: 204 });
}

/**
 * `{ "error": { "code", "message", "details"? } }` — the only error shape.
 * Never a 200 with an error inside it.
 */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown,
  headers?: Record<string, string>,
) {
  return NextResponse.json(
    { error: details === undefined ? { code, message } : { code, message, details } },
    { status, headers },
  );
}
