export default async function handler(req: any, res: any) {
  const query = req.query.q || "NBA OR MLB OR BTC";
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;

  const response = await fetch(url);
  const xml = await response.text();

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/xml");
  res.status(200).send(xml);
}
