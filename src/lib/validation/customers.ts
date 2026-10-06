import { z } from "zod";
import type { SortSpec } from "@/lib/pagination";
import { listQuerySchema } from "./common";

export const customerSorts: SortSpec = {
  fullName: "string",
  createdAt: "date",
};

export const customerListQuery = listQuerySchema(
  customerSorts,
  {
    city: z.string().min(1).max(80).optional(),
    email: z.string().email({ message: "email must be a valid email address." }).optional(),
  },
  "createdAt",
);

export type CustomerListQuery = z.output<typeof customerListQuery>;

export function customerWhere(query: CustomerListQuery) {
  const where: Record<string, unknown> = {};
  if (query.city) where.city = query.city;
  if (query.email) where.email = query.email.toLowerCase();
  return where;
}
