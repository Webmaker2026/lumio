import { requireAuth } from "../lib/auth.js";
import { hgetall } from "../lib/store.js";
import { listTenantIds } from "../lib/tenant.js";

function currentYearMonth() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function parseStats(raw) {
  const entries = Array.isArray(raw) ? raw : [];
  const obj = {};
  for (let i = 0; i < entries.length; i += 2) {
    obj[entries[i]] = Number(entries[i + 1]) || 0;
  }
  return {
    messages: obj.messages || 0,
    tokens: obj.tokens || 0,
    leads: obj.leads || 0,
  };
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const month = (req.query && req.query.month) || currentYearMonth();
  const tenantId = req.query && req.query.tenantId;

  if (tenantId) {
    const raw = await hgetall(`stats:${tenantId}:${month}`);
    res.status(200).json({ tenantId, month, ...parseStats(raw) });
    return;
  }

  const ids = await listTenantIds();
  const result = [];
  for (const id of ids) {
    const raw = await hgetall(`stats:${id}:${month}`);
    result.push({ tenantId: id, month, ...parseStats(raw) });
  }
  res.status(200).json(result);
}
