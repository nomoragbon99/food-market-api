import { z } from "zod";
import type { SortSpec } from "@/lib/pagination";
import { booleanParam, intParam, listQuerySchema } from "./common";

export const restaurantSorts: SortSpec = {
  name: "string",
  rating: "number",
  deliveryFeeMinor: "number",
  createdAt: "date",
};

export const restaurantListQuery = listQuerySchema(
  restaurantSorts,
  {
    cuisine: z.string().min(1).max(60).optional(),
    city: z.string().min(1).max(80).optional(),
    isOpen: booleanParam("isOpen"),
    minDeliveryFee: intParam("minDeliveryFee"),
    maxDeliveryFee: intParam("maxDeliveryFee"),
  },
  "createdAt",
);

export type RestaurantListQuery = z.output<typeof restaurantListQuery>;

/** Translates the parsed filters into a Prisma `where`. */
export function restaurantWhere(query: RestaurantListQuery) {
  const where: Record<string, unknown> = {};
  if (query.cuisine) where.cuisine = query.cuisine;
  if (query.city) where.city = query.city;
  if (query.isOpen !== undefined) where.isOpen = query.isOpen;
  if (query.minDeliveryFee !== undefined || query.maxDeliveryFee !== undefined) {
    where.deliveryFeeMinor = {
      ...(query.minDeliveryFee !== undefined ? { gte: query.minDeliveryFee } : {}),
      ...(query.maxDeliveryFee !== undefined ? { lte: query.maxDeliveryFee } : {}),
    };
  }
  return where;
}
