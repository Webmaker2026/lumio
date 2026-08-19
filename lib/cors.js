// Origin-ellenorzes a tenant allowedOrigins listaja alapjan. Wildcard sehol.

export function isOriginAllowed(origin, tenant) {
  if (!origin || !tenant || !Array.isArray(tenant.allowedOrigins)) return false;
  return tenant.allowedOrigins.includes(origin);
}

export function applyCors(req, res, tenant) {
  const origin = req.headers.origin;
  const allowed = isOriginAllowed(origin, tenant);
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
  }
  return allowed;
}
