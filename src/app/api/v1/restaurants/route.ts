import { withApi } from "@/lib/http/handler";
import { ok } from "@/lib/http/responses";
import { asDelegate, paginate } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { parseQuery } from "@/lib/validation/common";
import {
  restaurantListQuery,
  restaurantSorts,
  restaurantWhere,
} from "@/lib/validation/restaurants";

export const GET = withApi(async (request) => {
  const query = parseQuery(restaurantListQuery, request.url);
  const { data, meta } = await paginate(
    asDelegate(prisma.restaurant),
    query,
    restaurantSorts,
    restaurantWhere(query),
  );
  return ok(data, meta);
});
