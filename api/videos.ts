export default async function handler(req: any, res: any) {
  const query = req.query.q || "BTC";
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    res.status(200).json([]);
    return;
  }

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("q", String(query));
    url.searchParams.set("maxResults", "15");
    url.searchParams.set("order", "date");
    url.searchParams.set("type", "video");
    url.searchParams.set("regionCode", "TW");
    url.searchParams.set("relevanceLanguage", "zh");
    url.searchParams.set("key", apiKey);

    const yt = await fetch(url.toString());
    const data = await yt.json();

    if (data.error) {
      console.error("[videos api]", data.error);
      res.status(200).json([]);
      return;
    }

    const videos = (data.items || [])
      .filter((item: any) => item.id?.videoId && item.snippet)
      .map((item: any) => {
        const th = item.snippet.thumbnails || {};
        const thumbnail =
          th.high?.url || th.medium?.url || th.default?.url || "";
        const id = item.id.videoId;
        return {
          id,
          title: item.snippet.title || "YouTube 影片",
          thumbnail,
          channel: item.snippet.channelTitle || "YouTube",
          publishedAt: item.snippet.publishedAt || "",
          url: `https://www.youtube.com/watch?v=${id}`,
        };
      });

    res.status(200).json(videos);
  } catch (e) {
    console.error("[videos api]", e);
    res.status(200).json([]);
  }
}
