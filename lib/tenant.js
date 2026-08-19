// Tenant betoltes, validalas, default ertekek - hogy egy felig kesz config se dobjon 500-at.

import { get } from "./store.js";

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
