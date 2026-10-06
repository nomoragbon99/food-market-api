/**
 * A minimal, fetch-shaped client built on node:http(s).
 *
 * Why not global fetch: against Railway's edge, Node's undici-backed `fetch`
 * reliably fails with UND_ERR_CONNECT_TIMEOUT on this machine, while the same
 * request over node:https succeeds in well under a second. Forcing IPv4 with
 * dns.setDefaultResultOrder did not help. See BUILD_LOG.md entry 15.
 *
 * It supports only what the evidence scripts need: method, headers, a string
 * body, and a response with `status`, `headers.get()`, `text()` and `json()`.
 */
import http from "node:http";
import https from "node:https";

export function request(url, init = {}) {
  const target = new URL(url);
  const transport = target.protocol === "https:" ? https : http;

  const options = {
    method: init.method ?? "GET",
    headers: init.headers ?? {},
    // Explicit IPv4: the default resolution order is part of the failure above.
    family: 4,
    timeout: init.timeoutMs ?? 30000,
  };

  return new Promise((resolve, reject) => {
    const req = transport.request(target, options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          headers: { get: (name) => res.headers[name.toLowerCase()] ?? null },
          text: async () => text,
          json: async () => JSON.parse(text),
        });
      });
    });

    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
