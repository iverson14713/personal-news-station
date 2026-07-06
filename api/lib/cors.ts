/** CORS for Capacitor WebView (capacitor://) → Vercel HTTPS API */
export function applyCorsHeaders(
  res: { setHeader: (name: string, value: string) => void },
  methods = "GET, POST, OPTIONS"
): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Cron-Secret"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

export function handleOptionsPreflight(
  req: { method?: string },
  res: { status: (code: number) => { end: () => void } }
): boolean {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}
