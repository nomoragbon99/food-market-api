import { z } from "zod";
import type { SortSpec } from "@/lib/pagination";
import { intParam, listQuerySchema, uuidParam } from "./common";

export const orderItemSorts: SortSpec = {
  quantity: "number",
  unitPriceMinor: "number",
  createdAt: "date",
};

const filters = {
  orderId: uuidParam("orderId"),
  menuItemId: uuidParam("menuItemId"),
  minQuantity: intParam("minQuantity"),
};

export const orderItemListQuery = listQuerySchema(orderItemSorts, filters, "createdAt");

/** The nested route `/orders/:id/items` takes the order from the path. */
export const orderItemsForOrderQuery = listQuerySchema(
  orderItemSorts,
  { menuItemId: filters.menuItemId, minQuantity: filters.minQuantity },
  "createdAt",
);

export type OrderItemListQuery = z.output<typeof orderItemListQuery>;
export type OrderItemsForOrderQuery = z.output<typeof orderItemsForOrderQuery>;

export function orderItemWhere(query: OrderItemListQuery | OrderItemsForOrderQuery) {
  const where: Record<string, unknown> = {};
  if ("orderId" in query && query.orderId) where.orderId = query.orderId;
  if (query.menuItemId) where.menuItemId = query.menuItemId;
  if (query.minQuantity !== undefined) where.quantity = { gte: query.minQuantity };
  return where;
}
