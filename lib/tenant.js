// Tenant betoltes, validalas, default ertekek - hogy egy felig kesz config se dobjon 500-at.

import { get, set, del, sadd, srem, smembers } from "./store.js";

const TENANT_INDEX_KEY = "tenants:index";
const ID_RE = /^[a-z0-9-]+$/;

export const DEFAULT_TENANT = {
  active: true,
  model: "claude-haiku-4-5-20251001",
  allowedOrigins: [],
  persona: {
    botName: "Asszisztens",
    greeting: "Üdvözlöm! Miben segíthetek?",
    tone: "Udvarias, tegeződés nélkül, tömör.",
    suggestedQuestions: [],
  },
  theme: {
    accent: "#1b4d3e",
    position: "right",
    launcherLabel: "Kérdése van?",
  },
  siteKnowledge: "",
  siteKnowledgeUpdatedAt: null,
  manualKnowledge: "",
  pricing: {
    enabled: false,
    currency: "HUF",
    rules: {},
    disclaimer: "A megadott ár tájékoztató jellegű, a végleges árat egyeztetés után tudjuk megadni.",
  },
  lead: {
    enabled: false,
    notifyEmail: "",
    requiredFields: ["nev", "telefon"],
    privacyUrl: "",
  },
  limits: {
    maxMessagesPerConversation: 25,
    maxMessagesPerIpPerHour: 30,
    maxKnowledgeChars: 60000,
  },
  escalation: {
    phone: "",
    email: "",
  },
};

function mergeDefaults(raw) {
  return {
    ...DEFAULT_TENANT,
    ...raw,
    persona: { ...DEFAULT_TENANT.persona, ...(raw.persona || {}) },
    theme: { ...DEFAULT_TENANT.theme, ...(raw.theme || {}) },
    pricing: {
      ...DEFAULT_TENANT.pricing,
      ...(raw.pricing || {}),
      rules: { ...((raw.pricing && raw.pricing.rules) || {}) },
    },
    lead: { ...DEFAULT_TENANT.lead, ...(raw.lead || {}) },
    limits: { ...DEFAULT_TENANT.limits, ...(raw.limits || {}) },
    escalation: { ...DEFAULT_TENANT.escalation, ...(raw.escalation || {}) },
  };
}

export async function getTenant(id) {
  if (!id || typeof id !== "string") return null;
  const raw = await get(`tenant:${id}`);
  if (!raw) return null;

  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }

  const tenant = mergeDefaults(parsed);
  tenant.id = parsed.id || id;
  return tenant;
}

export function isValidTenantId(id) {
  return typeof id === "string" && ID_RE.test(id) && id.length <= 64;
}

export async function listTenantIds() {
  const ids = await smembers(TENANT_INDEX_KEY);
  return (ids || []).sort();
}

export async function saveTenant(input) {
  if (!isValidTenantId(input.id)) {
    throw new Error("Érvénytelen tenant id (csak kisbetű, szám és kötőjel engedélyezett).");
  }
  const tenant = mergeDefaults(input);
  tenant.id = input.id;
  await set(`tenant:${tenant.id}`, JSON.stringify(tenant));
  await sadd(TENANT_INDEX_KEY, tenant.id);
  return tenant;
}

export async function deleteTenant(id) {
  if (!isValidTenantId(id)) return false;
  await del(`tenant:${id}`);
  await srem(TENANT_INDEX_KEY, id);
  return true;
}

// Amit a widget lathat: soha nem a teljes config (tudasanyag, arszabaly stb. tilos).
export function publicTenantView(tenant) {
  return {
    id: tenant.id,
    name: tenant.name,
    persona: tenant.persona,
    theme: tenant.theme,
    escalation: tenant.escalation,
    lead: {
      enabled: tenant.lead.enabled,
      requiredFields: tenant.lead.requiredFields,
      privacyUrl: tenant.lead.privacyUrl,
    },
    limits: {
      maxMessagesPerConversation: tenant.limits.maxMessagesPerConversation,
    },
  };
}
