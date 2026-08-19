// IP + tenant alapu rate limit, Redis INCR + EXPIRE.

import { incr, expire } from "./store.js";

export function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

export async function checkRateLimit({ tenantId, ip, maxPerHour }) {
  const key = `ratelimit:${tenantId}:${ip}`;
  const count = await incr(key);
  if (count === 1) {
    await expire(key, 3600);
  }
  return { allowed: count <= maxPerHour, count, limit: maxPerHour };
}
