import { z } from "zod";
import type { SortSpec } from "@/lib/pagination";
import { dateParam, listQuerySchema, uuidParam } from "./common";

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "delivered",
  "cancelled",
] as const;

export type OrderStatusName = (typeof ORDER_STATUSES)[number];

export const orderSorts: SortSpec = {
  placedAt: "date",
  totalMinor: "number",
  createdAt: "date",
};

export const orderListQuery = listQuerySchema(
  orderSorts,
  {
    status: z.enum(ORDER_STATUSES, {
      message: `status must be one of: ${ORDER_STATUSES.join(", ")}.`,
    }).optional(),
    customerId: uuidParam("customerId"),
    restaurantId: uuidParam("restaurantId"),
    placedFrom: dateParam("placedFrom"),
    placedTo: dateParam("placedTo"),
  },
  "placedAt",
);

export type OrderListQuery = z.output<typeof orderListQuery>;

export function orderWhere(query: OrderListQuery) {
  const where: Record<string, unknown> = {};
  if (query.status) where.status = query.status;
  if (query.customerId) where.customerId = query.customerId;
  if (query.restaurantId) where.restaurantId = query.restaurantId;
  if (query.placedFrom || query.placedTo) {
    where.placedAt = {
      ...(query.placedFrom ? { gte: query.placedFrom } : {}),
      ...(query.placedTo ? { lte: query.placedTo } : {}),
    };
  }
  return where;
}

/**
 * POST /api/v1/orders body. `.strict()` so an unexpected field is reported
 * rather than ignored; every failure is reported as a 422 naming the field.
 */
export const createOrderBody = z
  .object({
    customerId: z.string().uuid({ message: "customerId must be a UUID." }),
    restaurantId: z.string().uuid({ message: "restaurantId must be a UUID." }),
    note: z.string().max(500, "note must be at most 500 characters.").optional(),
    items: z
      .array(
        z
          .object({
            menuItemId: z.string().uuid({ message: "menuItemId must be a UUID." }),
            quantity: z
              .number()
              .int("quantity must be a whole number.")
              .min(1, "quantity must be at least 1."),
          })
          .strict(),
      )
      .min(1, "items must contain at least one item."),
  })
  .strict();

export type CreateOrderBody = z.output<typeof createOrderBody>;

/**
 * PATCH /api/v1/orders/:id body. Only `status` and `note` are accepted; any
 * other field is a 422. At least one of the two must be present.
 */
export const updateOrderBody = z
  .object({
    status: z.enum(ORDER_STATUSES, {
      message: `status must be one of: ${ORDER_STATUSES.join(", ")}.`,
    }).optional(),
    note: z.string().max(500, "note must be at most 500 characters.").nullable().optional(),
  })
  .strict()
  .refine((body) => body.status !== undefined || body.note !== undefined, {
    message: "Provide at least one of: status, note.",
  });

export type UpdateOrderBody = z.output<typeof updateOrderBody>;
