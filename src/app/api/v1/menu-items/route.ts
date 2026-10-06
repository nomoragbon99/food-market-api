import { withApi } from "@/lib/http/handler";
import { ok } from "@/lib/http/responses";
import { asDelegate, paginate } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { parseQuery } from "@/lib/validation/common";
import { menuItemListQuery, menuItemSorts, menuItemWhere } from "@/lib/validation/menu-items";

export const GET = withApi(async (request) => {
  const query = parseQuery(menuItemListQuery, request.url);
  const { data, meta } = await paginate(
    asDelegate(prisma.menuItem),
    query,
    menuItemSorts,
    menuItemWhere(query),
  );
  return ok(data, meta);
});
