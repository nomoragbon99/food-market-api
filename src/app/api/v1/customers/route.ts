import { withApi } from "@/lib/http/handler";
import { ok } from "@/lib/http/responses";
import { asDelegate, paginate } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { parseQuery } from "@/lib/validation/common";
import { customerListQuery, customerSorts, customerWhere } from "@/lib/validation/customers";

export const GET = withApi(async (request) => {
  const query = parseQuery(customerListQuery, request.url);
  const { data, meta } = await paginate(
    asDelegate(prisma.customer),
    query,
    customerSorts,
    customerWhere(query),
  );
  return ok(data, meta);
});
