import { applyCorsHeaders, handleOptionsPreflight } from "./lib/cors";

/**
 * 輕量健康檢查：供 iOS Capacitor WebView 測試能否 fetch Vercel API。
 * GET /api/ping → { ok: true }
 */
export default async function handler(req: any, res: any) {
  applyCorsHeaders(res, "GET, OPTIONS");

  if (handleOptionsPreflight(req, res)) {
    return;
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(405).json({ ok: false, error: "僅支援 GET" });
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(200).json({
    ok: true,
    service: "personal-news-station",
    route: "/api/ping",
    time: new Date().toISOString(),
  });
}
