import { DEFAULT_CURRENCY } from "@/config";
import { unprocessable, type FieldIssue } from "@/lib/http/errors";
import { prisma } from "@/lib/prisma";
import type { CreateOrderBody } from "@/lib/validation/orders";

/**
 * Creates an order and its items in one transaction.
 *
 * Every referential and business rule is checked first and reported together
 * as a 422 naming each field, so a client gets one complete answer rather than
 * one error at a time. Name and price are snapshotted from the menu item here,
 * at create time, and never looked up again.
 */
export async function createOrder(body: CreateOrderBody) {
  return prisma.$transaction(async (tx) => {
    const issues: FieldIssue[] = [];

    const [customer, restaurant] = await Promise.all([
      tx.customer.findUnique({ where: { id: body.customerId } }),
      tx.restaurant.findUnique({ where: { id: body.restaurantId } }),
    ]);

    if (!customer) {
      issues.push({ field: "customerId", message: `No customer with id ${body.customerId}.` });
    }
    if (!restaurant) {
      issues.push({ field: "restaurantId", message: `No restaurant with id ${body.restaurantId}.` });
    }

    // The same menu item twice would violate the (orderId, menuItemId) unique
    // constraint; report it as a field error rather than letting it 500.
    const seen = new Set<string>();
    body.items.forEach((item, index) => {
      if (seen.has(item.menuItemId)) {
        issues.push({
          field: `items[${index}].menuItemId`,
          message: `Menu item ${item.menuItemId} appears more than once. Use one line with a larger quantity.`,
        });
      }
      seen.add(item.menuItemId);
    });

    const menuItems = await tx.menuItem.findMany({
      where: { id: { in: [...seen] } },
    });
    const byId = new Map(menuItems.map((item) => [item.id, item]));

    body.items.forEach((item, index) => {
      const menuItem = byId.get(item.menuItemId);
      if (!menuItem) {
        issues.push({
          field: `items[${index}].menuItemId`,
          message: `No menu item with id ${item.menuItemId}.`,
        });
        return;
      }
      if (menuItem.restaurantId !== body.restaurantId) {
        issues.push({
          field: `items[${index}].menuItemId`,
          message: `Menu item ${item.menuItemId} belongs to a different restaurant.`,
        });
      }
      if (!menuItem.isAvailable) {
        issues.push({
          field: `items[${index}].menuItemId`,
          message: `Menu item "${menuItem.name}" is currently unavailable.`,
        });
      }
    });

    if (issues.length > 0) throw unprocessable(issues);

    const lines = body.items.map((item) => {
      // Non-null: every id was confirmed present above.
      const menuItem = byId.get(item.menuItemId)!;
      return {
        menuItemId: menuItem.id,
        quantity: item.quantity,
        unitPriceMinor: menuItem.priceMinor,
        currency: menuItem.currency,
        nameSnapshot: menuItem.name,
      };
    });

    const totalMinor = lines.reduce(
      (sum, line) => sum + line.quantity * line.unitPriceMinor,
      0,
    );

    return tx.order.create({
      data: {
        customerId: body.customerId,
        restaurantId: body.restaurantId,
        status: "pending",
        totalMinor,
        currency: DEFAULT_CURRENCY,
        note: body.note ?? null,
        placedAt: new Date(),
        items: { create: lines },
      },
      include: { items: true },
    });
  });
}
