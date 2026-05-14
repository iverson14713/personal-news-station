export default async function handler(req: any, res: any) {
  const query = String(req.query?.q ?? "").trim() || "BTC";
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      ok: false,
      error:
        "伺服器未設定 YOUTUBE_API_KEY。請在部署平台（例如 Vercel）的 Environment Variables 新增後重新部署，本機請在 .env 設定後重啟開發伺服器。",
      code: "MISSING_YOUTUBE_API_KEY",
    });
  }

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", "15");
    url.searchParams.set("order", "date");
    url.searchParams.set("type", "video");
    url.searchParams.set("regionCode", "TW");
    url.searchParams.set("relevanceLanguage", "zh");
    url.searchParams.set("key", apiKey);

    const yt = await fetch(url.toString());
    const data = await yt.json();

    if (!yt.ok && !data?.error) {
      return res.status(502).json({
        ok: false,
        error: `YouTube 連線異常（HTTP ${yt.status}）`,
        code: `HTTP_${yt.status}`,
      });
    }

    if (data?.error) {
      const errObj = data.error;
      const message =
        typeof errObj === "string"
          ? errObj
          : errObj.message ||
            errObj.errors?.[0]?.message ||
            "YouTube API 回傳錯誤";
      const code =
        errObj.code != null
          ? String(errObj.code)
          : errObj.errors?.[0]?.reason != null
            ? String(errObj.errors[0].reason)
            : undefined;

      return res.status(502).json({
        ok: false,
        error: message,
        code,
      });
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

    return res.status(200).json({ ok: true, videos });
  } catch (e: any) {
    console.error("[videos api]", e);
    return res.status(500).json({
      ok: false,
      error: e?.message || "伺服器處理 YouTube 請求時發生錯誤",
      code: "INTERNAL",
    });
  }
}
