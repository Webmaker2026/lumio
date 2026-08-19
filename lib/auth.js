// Admin jelszo ellenorzes: Authorization: Bearer <ADMIN_PASSWORD>

export function isAuthorized(req) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return false;
  return Boolean(process.env.ADMIN_PASSWORD) && token === process.env.ADMIN_PASSWORD;
}

export function requireAuth(req, res) {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}
