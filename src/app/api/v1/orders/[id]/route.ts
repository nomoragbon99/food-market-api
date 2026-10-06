import { notFound } from "@/lib/http/errors";
import { parseBody } from "@/lib/http/body";
import { withApi } from "@/lib/http/handler";
import { noContent, ok } from "@/lib/http/responses";
import { parseId } from "@/lib/ids";
import { assertTransition } from "@/lib/orders/transitions";
import { prisma } from "@/lib/prisma";
import { updateOrderBody, type OrderStatusName } from "@/lib/validation/orders";

type Context = { params: Promise<{ id: string }> };

export const GET = withApi<Context>(async (_request, { params }) => {
  const id = parseId((await params).id, "order");
  const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!order) throw notFound("order", id);
  return ok(order);
});

export const PATCH = withApi<Context>(async (request, { params }) => {
  const id = parseId((await params).id, "order");
  const body = await parseBody(updateOrderBody, request);

  const existing = await prisma.order.findUnique({ where: { id }, select: { status: true } });
  if (!existing) throw notFound("order", id);

  if (body.status !== undefined) {
    // The transition map is the single source of truth; a refused move is a 409.
    assertTransition(existing.status as OrderStatusName, body.status);
  }

  const order = await prisma.order.update({
    where: { id },
    data: {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
    },
    include: { items: true },
  });

  return ok(order);
});

export const DELETE = withApi<Context>(async (_request, { params }) => {
  const id = parseId((await params).id, "order");

  const existing = await prisma.order.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound("order", id);

  // Order items cascade with the order, per the schema's onDelete rule.
  await prisma.order.delete({ where: { id } });
  return noContent();
});
