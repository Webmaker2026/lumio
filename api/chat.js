import { getTenant, publicTenantView } from "../lib/tenant.js";
import { applyCors } from "../lib/cors.js";
import { isAuthorized } from "../lib/auth.js";
import { checkRateLimit, getClientIp } from "../lib/ratelimit.js";
import { buildSystemPrompt } from "../lib/prompt.js";
import { runChat } from "../lib/claude.js";
import { hincrby } from "../lib/store.js";
import { buildPricingTool, calculatePrice } from "../lib/pricing.js";
import { saveLead, isValidHungarianPhone } from "../lib/leads.js";
import { sendLeadNotification } from "../lib/email.js";

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

function buildLeadTool(tenant) {
  if (!tenant.lead.enabled) return null;
  return {
    name: "lead_rogzites",
    description:
      "Rögzíti az érdeklődő elérhetőségét, hogy felvegyék vele a kapcsolatot. Csak akkor hívd, ha a felhasználó hozzájárult az adatkezeléshez, és megadta legalább a nevét és telefonszámát.",
    input_schema: {
      type: "object",
      properties: {
        nev: { type: "string", description: "Az érdeklődő neve" },
        telefon: { type: "string", description: "Telefonszám" },
        email: { type: "string", description: "E-mail cím (opcionális)" },
        problema_osszefoglalo: { type: "string", description: "Rövid összefoglaló arról, mire van szüksége" },
        varos: { type: "string", description: "Város (opcionális)" },
        hozzajarulas: { type: "boolean", description: "A felhasználó elfogadta-e az adatkezelési tájékoztatót" },
      },
      required: ["nev", "telefon", "hozzajarulas"],
    },
  };
}

async function handleLeadCapture(tenant, input) {
  if (!tenant.lead.enabled) {
    return { error: "A kapcsolatfelvétel jelenleg nem elérhető ennél az ügyfélnél." };
  }
  if (!input.hozzajarulas) {
    return { error: "Adatkezelési hozzájárulás nélkül nem rögzíthető az adat. Kérdezd meg a felhasználót, hogy elfogadja-e." };
  }
  const missing = ["nev", "telefon"].filter((f) => !input[f]);
  if (missing.length) {
    return { needs: missing };
  }
  if (!isValidHungarianPhone(input.telefon)) {
    return { error: "A megadott telefonszám formátuma nem tűnik érvényesnek. Kérd meg, hogy adja meg újra." };
  }

  const lead = await saveLead(tenant.id, {
    nev: input.nev,
    telefon: input.telefon,
    email: input.email || null,
    problema_osszefoglalo: input.problema_osszefoglalo || null,
    varos: input.varos || null,
  });

  if (tenant.lead.notifyEmail) {
    try {
      await sendLeadNotification({ to: tenant.lead.notifyEmail, tenantName: tenant.name, lead });
    } catch (err) {
      console.error(`lead email error tenant=${tenant.id}:`, err.message);
    }
  }

  try {
    await hincrby(`stats:${tenant.id}:${currentYearMonth()}`, "leads", 1);
  } catch (err) {
    console.error(`stats lead increment error tenant=${tenant.id}:`, err.message);
  }

  return { ok: true, uzenet: "Az adatokat rögzítettük, hamarosan felveszik Önnel a kapcsolatot." };
}

async function executeTool(tenant, name, input) {
  if (name === "arkalkulacio") {
    return calculatePrice(tenant, input || {});
  }
  if (name === "lead_rogzites") {
    return handleLeadCapture(tenant, input || {});
  }
  return { error: "Ismeretlen eszköz." };
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

  // Admin (bearer jelszóval hitelesített) kérés az admin élő próbához - ez sajat
  // domainrol (PUBLIC_BASE_URL) hivja az API-t, nem a tenant allowedOrigins listajarol.
  const isAdminRequest = isAuthorized(req);

  const corsAllowed = applyCors(req, res, tenant);
  if (!corsAllowed && !isAdminRequest) {
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
  const rate = isAdminRequest
    ? { allowed: true }
    : await checkRateLimit({
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

  const tools = [buildPricingTool(tenant), buildLeadTool(tenant)].filter(Boolean);

  let streamFailed = false;
  let result;
  try {
    result = await runChat({
      apiKey,
      model: tenant.model,
      system,
      messages: trimmedMessages,
      tools: tools.length ? tools : undefined,
      maxTokens: MAX_TOKENS,
      executeTool: (name, input) => executeTool(tenant, name, input),
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
