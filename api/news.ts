export default async function handler(req: any, res: any) {
  let query = String(req.query.q || "NBA OR MLB OR BTC").trim();
  /** 縮小 Google News RSS 時間範圍（前端仍會再依 pubDate 嚴格過濾） */
  if (query && !/\bwhen:\d+[dh]\b/i.test(query)) {
    query = `${query} when:2d`;
  }
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;

  const response = await fetch(url);
  const xml = await response.text();

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/xml");
  res.status(200).send(xml);
}
