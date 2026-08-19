import { ping } from "../lib/store.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const status = { ok: true, service: "lumio", redis: "unknown" };

  try {
    const result = await ping();
    status.redis = result === "PONG" ? "ok" : "unexpected_response";
  } catch (err) {
    status.ok = false;
    status.redis = "error";
    console.error("health check redis error:", err.message);
  }

  res.status(status.ok ? 200 : 503).json(status);
}
