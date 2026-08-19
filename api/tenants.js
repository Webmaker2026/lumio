import { requireAuth } from "../lib/auth.js";
import { getTenant, saveTenant, deleteTenant, listTenantIds, isValidTenantId } from "../lib/tenant.js";

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  if (req.method === "GET") {
    const id = req.query && req.query.id;
    if (id) {
      const tenant = await getTenant(id);
      if (!tenant) {
        res.status(404).json({ error: "Nincs ilyen ügyfél." });
        return;
      }
      res.status(200).json(tenant);
      return;
    }

    const ids = await listTenantIds();
    const tenants = [];
    for (const tenantId of ids) {
      const tenant = await getTenant(tenantId);
      if (tenant) {
        tenants.push({ id: tenant.id, name: tenant.name, active: tenant.active, model: tenant.model });
      }
    }
    res.status(200).json(tenants);
    return;
  }

  if (req.method === "POST") {
    const body = req.body || {};
    if (!isValidTenantId(body.id)) {
      res.status(400).json({ error: "Érvénytelen vagy hiányzó tenant id (csak kisbetű, szám, kötőjel)." });
      return;
    }
    try {
      const tenant = await saveTenant(body);
      res.status(200).json(tenant);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
    return;
  }

  if (req.method === "DELETE") {
    const id = req.query && req.query.id;
    if (!isValidTenantId(id)) {
      res.status(400).json({ error: "Érvénytelen tenant id." });
      return;
    }
    await deleteTenant(id);
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
