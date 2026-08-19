import { getTenant, publicTenantView } from "../lib/tenant.js";
import { applyCors } from "../lib/cors.js";
import { checkRateLimit, getClientIp } from "../lib/ratelimit.js";
import { buildSystemPrompt } from "../lib/prompt.js";
import { runChat } from "../lib/claude.js";
import { hincrby } from "../lib/store.js";

const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_MESSAGES = 10;
const MAX_TOKENS = 800;

function currentYearMonth() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function sseWrite(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export default async function handler(req, res) {
  // A tenantId query-parameterkent is kell, mert a CORS preflight (OPTIONS)
  // kerésnek nincs body-ja, csak az Origin fejlec es az URL all rendelkezesre.
  const tenantId = (req.query && req.query.tenantId) || (req.body && req.body.tenantId);
  const tenant = tenantId ? await getTenant(tenantId) : null;

  if (req.method === "OPTIONS") {
    if (tenant) applyCors(req, res, tenant);
    res.status(204).end();
    return;
  }

  if (!tenant || tenant.active === false) {
    res.status(404).json({ error: "Ismeretlen vagy inaktív ügyfél." });
    return;
  }

  const corsAllowed = applyCors(req, res, tenant);
  if (!corsAllowed) {
    res.status(403).json({ error: "Ez a domain nincs engedélyezve ehhez az ügyfélhez." });
    return;
  }

  if (req.method === "GET") {
    res.status(200).json(publicTenantView(tenant));
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const ip = getClientIp(req);
  const rate = await checkRateLimit({
    tenantId: tenant.id,
    ip,
    maxPerHour: tenant.limits.maxMessagesPerIpPerHour,
  });
  if (!rate.allowed) {
    res.status(429).json({
      error: "Túl sok üzenetet küldött rövid idő alatt. Kérjük, próbálja később, vagy hívja ezt a számot: " +
        (tenant.escalation.phone || "elérhetőségeinket"),
      escalationPhone: tenant.escalation.phone || null,
    });
    return;
  }

  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : null;

  if (!messages || !messages.length) {
    res.status(400).json({ error: "Hiányzó üzenetlista." });
    return;
  }

  for (const m of messages) {
    if (!m || typeof m.content !== "string" || !["user", "assistant"].includes(m.role)) {
      res.status(400).json({ error: "Érvénytelen üzenetformátum." });
      return;
    }
    if (m.content.length > MAX_MESSAGE_CHARS) {
      res.status(400).json({ error: `Egy üzenet legfeljebb ${MAX_MESSAGE_CHARS} karakter lehet.` });
      return;
    }
  }

  const userTurns = messages.filter((m) => m.role === "user").length;
  if (userTurns > tenant.limits.maxMessagesPerConversation) {
    res.status(400).json({
      error: "Ez a beszélgetés elérte a hossz korlátját. Kérjük, vegye fel velünk a kapcsolatot közvetlenül.",
      escalationPhone: tenant.escalation.phone || null,
      escalationEmail: tenant.escalation.email || null,
    });
    return;
  }

  const trimmedMessages = messages.slice(-MAX_HISTORY_MESSAGES);
  const system = buildSystemPrompt(tenant);
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY hiányzik a környezeti változók közül.");
    res.status(500).json({ error: "A szolgáltatás jelenleg nem elérhető. Kérjük, próbálja később." });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  let streamFailed = false;
  let result;
  try {
    result = await runChat({
      apiKey,
      model: tenant.model,
      system,
      messages: trimmedMessages,
      tools: undefined,
      maxTokens: MAX_TOKENS,
      onTextDelta: (text) => sseWrite(res, { type: "delta", text }),
    });
  } catch (err) {
    streamFailed = true;
    console.error(`chat error tenant=${tenant.id}:`, err.message);
    sseWrite(res, {
      type: "error",
      message: "Hiba történt a válasz generálása közben. Kérjük, próbálja újra, vagy hívja ezt a számot: " +
        (tenant.escalation.phone || "elérhetőségeinket"),
      escalationPhone: tenant.escalation.phone || null,
    });
  }

  if (!streamFailed) {
    sseWrite(res, { type: "done" });

    const monthKey = `stats:${tenant.id}:${currentYearMonth()}`;
    const totalTokens = (result?.usage.input_tokens || 0) + (result?.usage.output_tokens || 0);
    try {
      await hincrby(monthKey, "messages", 1);
      await hincrby(monthKey, "tokens", totalTokens);
    } catch (err) {
      console.error(`stats increment error tenant=${tenant.id}:`, err.message);
    }
  }

  res.end();
}
