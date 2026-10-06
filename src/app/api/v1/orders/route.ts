import { parseBody } from "@/lib/http/body";
import { withApi } from "@/lib/http/handler";
import { created, ok } from "@/lib/http/responses";
import { createOrder } from "@/lib/orders/create";
import { asDelegate, paginate } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { parseQuery } from "@/lib/validation/common";
import {
  createOrderBody,
  orderListQuery,
  orderSorts,
  orderWhere,
} from "@/lib/validation/orders";

export const GET = withApi(async (request) => {
  const query = parseQuery(orderListQuery, request.url);
  const { data, meta } = await paginate(
    asDelegate(prisma.order),
    query,
    orderSorts,
    orderWhere(query),
  );
  return ok(data, meta);
});

export const POST = withApi(async (request) => {
  const body = await parseBody(createOrderBody, request);
  const order = await createOrder(body);
  return created(order, `/api/v1/orders/${order.id}`);
});
