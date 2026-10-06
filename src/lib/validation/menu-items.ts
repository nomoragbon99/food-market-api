import { z } from "zod";
import type { SortSpec } from "@/lib/pagination";
import { booleanParam, intParam, listQuerySchema, uuidParam } from "./common";

export const menuItemSorts: SortSpec = {
  name: "string",
  priceMinor: "number",
  createdAt: "date",
};

const filters = {
  restaurantId: uuidParam("restaurantId"),
  category: z.string().min(1).max(60).optional(),
  isAvailable: booleanParam("isAvailable"),
  minPrice: intParam("minPrice"),
  maxPrice: intParam("maxPrice"),
};

export const menuItemListQuery = listQuerySchema(menuItemSorts, filters, "createdAt");

/**
 * The nested route `/restaurants/:id/menu` takes the restaurant from the path,
 * so `restaurantId` is not accepted as a query parameter there.
 */
export const restaurantMenuQuery = listQuerySchema(
  menuItemSorts,
  {
    category: filters.category,
    isAvailable: filters.isAvailable,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
  },
  "createdAt",
);

export type MenuItemListQuery = z.output<typeof menuItemListQuery>;
export type RestaurantMenuQuery = z.output<typeof restaurantMenuQuery>;

export function menuItemWhere(query: MenuItemListQuery | RestaurantMenuQuery) {
  const where: Record<string, unknown> = {};
  if ("restaurantId" in query && query.restaurantId) where.restaurantId = query.restaurantId;
  if (query.category) where.category = query.category;
  if (query.isAvailable !== undefined) where.isAvailable = query.isAvailable;
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    where.priceMinor = {
      ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
      ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
    };
  }
  return where;
}
