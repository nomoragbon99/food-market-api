import { notFound } from "@/lib/http/errors";
import { withApi } from "@/lib/http/handler";
import { ok } from "@/lib/http/responses";
import { parseId } from "@/lib/ids";
import { asDelegate, paginate } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { parseQuery } from "@/lib/validation/common";
import { menuItemSorts, menuItemWhere, restaurantMenuQuery } from "@/lib/validation/menu-items";

type Context = { params: Promise<{ id: string }> };

export const GET = withApi<Context>(async (request, { params }) => {
  const restaurantId = parseId((await params).id, "restaurant");

  // A menu for a restaurant that does not exist is a 404, not an empty list.
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true },
  });
  if (!restaurant) throw notFound("restaurant", restaurantId);

  const query = parseQuery(restaurantMenuQuery, request.url);
  const { data, meta } = await paginate(asDelegate(prisma.menuItem), query, menuItemSorts, {
    ...menuItemWhere(query),
    restaurantId,
  });

  return ok(data, { ...meta, restaurantId });
});

// Shared CORS preflight answer, identical on every route.
export { preflight as OPTIONS } from "@/lib/http/cors";
