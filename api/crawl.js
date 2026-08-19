import { requireAuth } from "../lib/auth.js";
import { getTenant, saveTenant } from "../lib/tenant.js";
import { crawlSite } from "../lib/crawler.js";

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { tenantId, startUrl } = req.body || {};
  if (!tenantId || !startUrl) {
    res.status(400).json({ error: "Hiányzó tenantId vagy startUrl." });
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(startUrl);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") throw new Error("invalid protocol");
  } catch {
    res.status(400).json({ error: "Érvénytelen kezdő URL." });
    return;
  }

  const tenant = await getTenant(tenantId);
  if (!tenant) {
    res.status(404).json({ error: "Nincs ilyen ügyfél." });
    return;
  }

  try {
    const result = await crawlSite(parsedUrl.toString(), tenant.limits.maxKnowledgeChars);
    tenant.siteKnowledge = result.text;
    tenant.siteKnowledgeUpdatedAt = new Date().toISOString();
    await saveTenant(tenant);

    res.status(200).json({
      ok: true,
      pageCount: result.pageCount,
      totalChars: result.totalChars,
      truncated: result.truncated,
      pages: result.pages,
    });
  } catch (err) {
    console.error(`crawl error tenant=${tenantId}:`, err.message);
    res.status(500).json({ error: "A weboldal bejárása közben hiba történt." });
  }
}
