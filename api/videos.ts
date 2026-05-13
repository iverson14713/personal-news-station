export default async function handler(req: any, res: any) {
  const query = req.query.q || "NBA 最新";

  const url = `https://www.youtube.com/feeds/videos.xml?search_query=${encodeURIComponent(
    query
  )}`;

  try {
    const response = await fetch(url);
    const xml = await response.text();

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/xml");
    res.status(200).send(xml);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch videos" });
  }
}
