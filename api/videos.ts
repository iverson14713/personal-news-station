export default async function handler(req, res) {
  const query = req.query.q || "BTC";

  const apiKey = process.env.YOUTUBE_API_KEY;

  try {
    const yt = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
        query
      )}&maxResults=5&order=date&type=video&key=${apiKey}`
    );

    const data = await yt.json();

    const videos =
      data.items?.map((item) => ({
        id: item.id.videoId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails.high.url,
        channel: item.snippet.channelTitle,
        publishedAt: item.snippet.publishedAt,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      })) || [];

    res.status(200).json(videos);
  } catch (e) {
    res.status(500).json({
      error: "youtube api failed",
    });
  }
}
