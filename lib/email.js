// Resend REST API - ertesites uj leadrol.

const RESEND_API_URL = "https://api.resend.com/emails";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendLeadNotification({ to, tenantName, lead }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error("Resend környezeti változók hiányoznak (RESEND_API_KEY / LEAD_FROM_EMAIL)");
  }

  const rows = [
    ["Név", lead.nev],
    ["Telefon", lead.telefon],
    ["E-mail", lead.email],
    ["Város", lead.varos],
    ["Összefoglaló", lead.problema_osszefoglalo],
    ["Beérkezett", lead.createdAt],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<tr><td style="padding:4px 8px;color:#666;">${escapeHtml(label)}</td><td style="padding:4px 8px;">${escapeHtml(value)}</td></tr>`)
    .join("");

  const html = `<div style="font-family:sans-serif;">
    <h2>Új érdeklődő - ${escapeHtml(tenantName)}</h2>
    <table>${rows}</table>
  </div>`;

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Új érdeklődő - ${tenantName}`,
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend hiba (${res.status}): ${text}`);
  }

  return res.json();
}
