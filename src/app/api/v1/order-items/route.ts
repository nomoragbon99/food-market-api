import { withApi } from "@/lib/http/handler";
import { ok } from "@/lib/http/responses";
import { asDelegate, paginate } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { parseQuery } from "@/lib/validation/common";
import {
  orderItemListQuery,
  orderItemSorts,
  orderItemWhere,
} from "@/lib/validation/order-items";

export const GET = withApi(async (request) => {
  const query = parseQuery(orderItemListQuery, request.url);
  const { data, meta } = await paginate(
    asDelegate(prisma.orderItem),
    query,
    orderItemSorts,
    orderItemWhere(query),
  );
  return ok(data, meta);
});
