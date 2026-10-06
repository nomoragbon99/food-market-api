import { notFound } from "@/lib/http/errors";
import { withApi } from "@/lib/http/handler";
import { ok } from "@/lib/http/responses";
import { parseId } from "@/lib/ids";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };

export const GET = withApi<Context>(async (_request, { params }) => {
  const id = parseId((await params).id, "order item");
  const orderItem = await prisma.orderItem.findUnique({ where: { id } });
  if (!orderItem) throw notFound("order item", id);
  return ok(orderItem);
});
