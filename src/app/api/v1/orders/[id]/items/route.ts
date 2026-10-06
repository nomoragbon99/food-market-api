import { notFound } from "@/lib/http/errors";
import { withApi } from "@/lib/http/handler";
import { ok } from "@/lib/http/responses";
import { parseId } from "@/lib/ids";
import { asDelegate, paginate } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { parseQuery } from "@/lib/validation/common";
import {
  orderItemSorts,
  orderItemWhere,
  orderItemsForOrderQuery,
} from "@/lib/validation/order-items";

type Context = { params: Promise<{ id: string }> };

export const GET = withApi<Context>(async (request, { params }) => {
  const orderId = parseId((await params).id, "order");

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
  if (!order) throw notFound("order", orderId);

  const query = parseQuery(orderItemsForOrderQuery, request.url);
  const { data, meta } = await paginate(asDelegate(prisma.orderItem), query, orderItemSorts, {
    ...orderItemWhere(query),
    orderId,
  });

  return ok(data, { ...meta, orderId });
});

// Shared CORS preflight answer, identical on every route.
export { preflight as OPTIONS } from "@/lib/http/cors";
