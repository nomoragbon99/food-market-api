import { notFound } from "@/lib/http/errors";
import { withApi } from "@/lib/http/handler";
import { ok } from "@/lib/http/responses";
import { parseId } from "@/lib/ids";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };

export const GET = withApi<Context>(async (_request, { params }) => {
  const id = parseId((await params).id, "restaurant");
  const restaurant = await prisma.restaurant.findUnique({ where: { id } });
  if (!restaurant) throw notFound("restaurant", id);
  return ok(restaurant);
});
