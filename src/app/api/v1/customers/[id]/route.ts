import { notFound } from "@/lib/http/errors";
import { withApi } from "@/lib/http/handler";
import { ok } from "@/lib/http/responses";
import { parseId } from "@/lib/ids";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };

export const GET = withApi<Context>(async (_request, { params }) => {
  const id = parseId((await params).id, "customer");
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) throw notFound("customer", id);
  return ok(customer);
});

// Shared CORS preflight answer, identical on every route.
export { preflight as OPTIONS } from "@/lib/http/cors";
