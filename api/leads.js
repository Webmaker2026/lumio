import { requireAuth } from "../lib/auth.js";
import { listLeads } from "../lib/leads.js";

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const tenantId = req.query && req.query.tenantId;
  if (!tenantId) {
    res.status(400).json({ error: "Hiányzó tenantId." });
    return;
  }

  const leads = await listLeads(tenantId);
  res.status(200).json(leads);
}
