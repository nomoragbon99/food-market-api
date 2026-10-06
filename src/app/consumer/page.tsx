"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";

/**
 * The one consumer page. It calls the deployed API from the browser over its
 * absolute URL — never a relative path, never localhost — so it exercises the
 * API exactly as any other third-party client would, including CORS.
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

type Restaurant = {
  id: string;
  name: string;
  cuisine: string;
  city: string;
  isOpen: boolean;
  rating: number;
  deliveryFeeMinor: number;
  currency: string;
};

type ListMeta = { total: number; limit: number; nextCursor: string | null; hasMore: boolean };

type LoadError = { code: string; message: string; retryAfterSeconds?: number };

const SORTS = [
  { value: "createdAt", label: "Newest" },
  { value: "name", label: "Name" },
  { value: "rating", label: "Rating" },
  { value: "deliveryFeeMinor", label: "Delivery fee" },
];

/**
 * Kobo to naira, for display only. The API always speaks minor units.
 * The locale is fixed rather than taken from the browser, so grouping
 * separators appear the same way for every visitor.
 */
const money = new Intl.NumberFormat("en-NG", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

const formatMoney = (minor: number, currency: string) =>
  `${currency} ${money.format(minor / 100)}`;

/** Rating is stored in tenths of a star: 45 means 4.5. */
const formatRating = (rating: number) => `${(rating / 10).toFixed(1)} / 5.0`;

type Filters = { city: string; cuisine: string; sort: string; order: "asc" | "desc" };

type PageResult =
  | { aborted: true; error?: never; data?: never; meta?: never }
  | { aborted: false; error: LoadError; data?: never; meta?: never }
  | { aborted: false; error?: never; data: Restaurant[]; meta: ListMeta };

/**
 * One request to the list endpoint. Kept outside the component so it holds no
 * state of its own: it reports what happened and lets the caller decide.
 */
async function fetchPage(
  filters: Filters,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<PageResult> {
  const params = new URLSearchParams({ sort: filters.sort, order: filters.order, limit: "10" });
  if (filters.city.trim()) params.set("city", filters.city.trim());
  if (filters.cuisine.trim()) params.set("cuisine", filters.cuisine.trim());
  if (cursor) params.set("cursor", cursor);

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/restaurants?${params}`, { signal });

    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const body = await response.json().catch(() => null);
      return {
        aborted: false,
        error: {
          code: body?.error?.code ?? `HTTP_${response.status}`,
          message: body?.error?.message ?? `Request failed with status ${response.status}.`,
          ...(response.status === 429 && retryAfter
            ? { retryAfterSeconds: Number(retryAfter) }
            : {}),
        },
      };
    }

    const body = (await response.json()) as { data: Restaurant[]; meta: ListMeta };
    return { aborted: false, data: body.data, meta: body.meta };
  } catch (error) {
    // An aborted request is a superseded one, not a failure to report.
    if (error instanceof DOMException && error.name === "AbortError") return { aborted: true };
    return {
      aborted: false,
      error: {
        code: "NETWORK_ERROR",
        message: `Could not reach the API at ${API_BASE_URL}. It may be down, or blocked by CORS.`,
      },
    };
  }
}

export default function ConsumerPage() {
  const [city, setCity] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [sort, setSort] = useState("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);
  /** Distinguishes the first load of a filter set from a "Next page" load. */
  const [loadingMore, setLoadingMore] = useState(false);

  /** Bumped by "Try again" to re-run the effect without changing the filters. */
  const [reloadToken, setReloadToken] = useState(0);

  // Reload from the first page whenever the filters, the sort or the token change.
  // The state updates live inside the nested async function, not in the effect
  // body, so this does not trigger a cascading render on mount.
  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      if (!API_BASE_URL) {
        setError({
          code: "CONFIG_MISSING",
          message:
            "NEXT_PUBLIC_API_BASE_URL is not set. This page calls the API over its absolute URL, so the variable must be present at build time.",
        });
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const result = await fetchPage({ city, cuisine, sort, order }, null, controller.signal);
      if (result.aborted) return;

      if (result.error) setError(result.error);
      else {
        setRestaurants(result.data);
        setMeta(result.meta);
      }
      setLoading(false);
    })();

    return () => controller.abort();
  }, [city, cuisine, sort, order, reloadToken]);

  /** "Next page": an event handler, so it may set state directly. */
  async function loadMore() {
    if (!meta?.nextCursor) return;
    setLoadingMore(true);
    const result = await fetchPage({ city, cuisine, sort, order }, meta.nextCursor);
    if (!result.aborted) {
      if (result.error) setError(result.error);
      else {
        // A cursor load appends to what is already on screen.
        setRestaurants((previous) => [...previous, ...result.data]);
        setMeta(result.meta);
      }
    }
    setLoadingMore(false);
  }

  const showEmpty = !loading && !error && restaurants.length === 0;

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Food market</h1>
      <p className={styles.subtitle}>
        Browsing restaurants from <code>{API_BASE_URL ?? "(NEXT_PUBLIC_API_BASE_URL not set)"}</code>
      </p>

      <form className={styles.controls} onSubmit={(event) => event.preventDefault()}>
        <div className={styles.field}>
          <label htmlFor="city">City</label>
          <input
            id="city"
            value={city}
            placeholder="e.g. Lagos"
            onChange={(event) => setCity(event.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="cuisine">Cuisine</label>
          <input
            id="cuisine"
            value={cuisine}
            placeholder="e.g. nigerian"
            onChange={(event) => setCuisine(event.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="sort">Sort by</label>
          <select id="sort" value={sort} onChange={(event) => setSort(event.target.value)}>
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label htmlFor="order">Direction</label>
          <select
            id="order"
            value={order}
            onChange={(event) => setOrder(event.target.value as "asc" | "desc")}
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </div>

        <button
          type="button"
          className={`${styles.button} ${styles.secondary}`}
          onClick={() => {
            setCity("");
            setCuisine("");
          }}
        >
          Clear filters
        </button>
      </form>

      {loading && <p className={styles.status}>Loading restaurants…</p>}

      {error && (
        <div className={styles.error} role="alert">
          <p>
            <strong>Could not load restaurants.</strong> {error.message}
          </p>
          {error.retryAfterSeconds !== undefined && (
            <p>Too many requests — try again in {error.retryAfterSeconds} seconds.</p>
          )}
          <p className={styles.errorCode}>{error.code}</p>
          <button type="button" className={styles.button} onClick={() => setReloadToken((token) => token + 1)}>
            Try again
          </button>
        </div>
      )}

      {showEmpty && (
        <p className={styles.status}>
          No restaurants match these filters. Try clearing the city or cuisine.
        </p>
      )}

      {!loading && !error && restaurants.length > 0 && (
        <>
          <ul className={styles.list}>
            {restaurants.map((restaurant) => (
              <li key={restaurant.id} className={styles.card}>
                <span className={styles.cardMain}>
                  <span className={styles.name}>{restaurant.name}</span>
                  <span className={styles.meta}>
                    {restaurant.cuisine} · {restaurant.city} ·{" "}
                    <span className={restaurant.isOpen ? styles.open : styles.closed}>
                      {restaurant.isOpen ? "Open" : "Closed"}
                    </span>
                  </span>
                </span>
                <span className={styles.cardSide}>
                  {formatRating(restaurant.rating)}
                  <br />
                  Delivery {formatMoney(restaurant.deliveryFeeMinor, restaurant.currency)}
                </span>
              </li>
            ))}
          </ul>

          <div className={styles.footer}>
            {meta?.hasMore && (
              <button
                type="button"
                className={styles.button}
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "Loading…" : "Next page"}
              </button>
            )}
            <span className={styles.count}>
              Showing {restaurants.length} of {meta?.total ?? 0}
              {meta && !meta.hasMore ? " — end of results" : ""}
            </span>
          </div>
        </>
      )}
    </main>
  );
}
