import { conflict } from "@/lib/http/errors";
import type { OrderStatusName } from "@/lib/validation/orders";

/**
 * The only place order status moves are defined.
 *
 * Forward through the lifecycle one step at a time, and cancellable from any
 * state before delivery. `delivered` and `cancelled` are terminal.
 */
export const ORDER_TRANSITIONS: Record<OrderStatusName, readonly OrderStatusName[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: OrderStatusName, to: OrderStatusName): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/**
 * Throws a 409 explaining the refusal. A rejected move is a conflict with the
 * order's current state, not a malformed request, so it is not a 422.
 */
export function assertTransition(from: OrderStatusName, to: OrderStatusName): void {
  if (from === to) {
    throw conflict(`Order is already ${from}.`, { from, to });
  }
  if (!canTransition(from, to)) {
    const allowed = ORDER_TRANSITIONS[from];
    throw conflict(
      allowed.length === 0
        ? `Cannot change status: ${from} is a terminal state.`
        : `Cannot change status from ${from} to ${to}. Allowed from ${from}: ${allowed.join(", ")}.`,
      { from, to, allowed },
    );
  }
}
