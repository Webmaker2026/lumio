// Lead mentes es listazas. Kulcsok: lead:<tenantId>:<timestamp> + leads:<tenantId> lista az egyszeru listazashoz.

import { set, lpush, lrange } from "./store.js";

const PHONE_RE = /^(\+36|06|36)[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{3,4}$/;

export function isValidHungarianPhone(raw) {
  if (!raw || typeof raw !== "string") return false;
  return PHONE_RE.test(raw.trim());
}

export async function saveLead(tenantId, lead) {
  const timestamp = Date.now();
  const record = { ...lead, timestamp, createdAt: new Date(timestamp).toISOString() };
  const json = JSON.stringify(record);
  await set(`lead:${tenantId}:${timestamp}`, json);
  await lpush(`leads:${tenantId}`, json);
  return record;
}

export async function listLeads(tenantId, limit = 500) {
  const raw = await lrange(`leads:${tenantId}`, 0, limit - 1);
  return (raw || [])
    .map((r) => {
      try {
        return JSON.parse(r);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
