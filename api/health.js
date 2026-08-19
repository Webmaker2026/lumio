import { ping, get, smembers } from "../lib/store.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const status = {
    ok: true,
    service: "lumio",
    redis: "unknown",
    env: {
      UPSTASH_REDIS_REST_URL: Boolean(process.env.UPSTASH_REDIS_REST_URL),
      UPSTASH_REDIS_REST_TOKEN: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
    },
  };

  try {
    const result = await ping();
    status.redis = result === "PONG" ? "ok" : "unexpected_response";
  } catch (err) {
    status.ok = false;
    status.redis = "error";
    console.error("health check redis error:", err.message);
  }

  const checkTenant = req.query && req.query.checkTenant;
  if (checkTenant) {
    try {
      const raw = await get(`tenant:${checkTenant}`);
      const index = await smembers("tenants:index");
      status.tenantCheck = {
        key: `tenant:${checkTenant}`,
        found: Boolean(raw),
        length: raw ? String(raw).length : 0,
        preview: raw ? String(raw).slice(0, 80) : null,
        index,
      };
    } catch (err) {
      status.tenantCheck = { error: err.message };
    }
  }

  res.status(status.ok ? 200 : 503).json(status);
}
