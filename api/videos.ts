/**
 * 影音 API：優先 YouTube Data API（省 quota：單次、maxResults 小），
 * 失敗／額度／無資料時改走 YouTube 頻道 RSS，最後使用預設新聞頻道 RSS。
 */

const YT_SEARCH = "https://www.googleapis.com/youtube/v3/search";
const YT_RSS = (channelId: string) =>
  `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

/** 上傳清單 feed（部分環境比 channel_id feed 更穩定） */
const YT_RSS_UPLOADS = (channelId: string) => {
  if (channelId.startsWith("UC") && channelId.length === 24) {
    return `https://www.youtube.com/feeds/videos.xml?playlist_id=UU${channelId.slice(2)}`;
  }
  return "";
};

const RSS_HEADERS: Record<string, string> = {
  Accept: "application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

type VideoOut = {
  id: string;
  title: string;
  url: string;
  channel: string;
  thumbnail: string;
  publishedAt: string;
  keyword: string;
};

const MAX_API_RESULTS = 5;

/**
 * 當 API 額度用盡且 RSS 在伺服器端無法取得時，仍回傳可播放的備援清單（皆為公開長期影片）。
 * 標題／頻道為固定字串，避免再依賴第三方 API。
 */
const STATIC_FALLBACK_VIDEOS: VideoOut[] = [
  {
    id: "M7lc1UVf-VE",
    title: "YouTube Developers Live: Embedded Web Player Customization",
    channel: "Google for Developers",
    thumbnail: "https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg",
    publishedAt: "2012-06-22T00:00:00.000Z",
    url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    keyword: "備援影音",
  },
  {
    id: "5MgBikgcWnY",
    title: "The first 20 hours -- how to learn anything | Josh Kaufman | TEDxCSU",
    channel: "TEDx Talks",
    thumbnail: "https://i.ytimg.com/vi/5MgBikgcWnY/hqdefault.jpg",
    publishedAt: "2013-03-14T00:00:00.000Z",
    url: "https://www.youtube.com/watch?v=5MgBikgcWnY",
    keyword: "備援影音",
  },
  {
    id: "jNQXAC9IVRw",
    title: "Me at the zoo",
    channel: "jawed",
    thumbnail: "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg",
    publishedAt: "2005-04-24T00:00:00.000Z",
    url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    keyword: "備援影音",
  },
  {
    id: "kJQP7kiw5Fk",
    title: "Luis Fonsi - Despacito ft. Daddy Yankee",
    channel: "LuisFonsiVEVO",
    thumbnail: "https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg",
    publishedAt: "2017-01-13T00:00:00.000Z",
    url: "https://www.youtube.com/watch?v=kJQP7kiw5Fk",
    keyword: "備援影音",
  },
  {
    id: "2LqzF5WauAw",
    title: "Interstellar (2014) | Original Theatrical Trailer 1 | Paramount Movies",
    channel: "Interstellar Movie",
    thumbnail: "https://i.ytimg.com/vi/2LqzF5WauAw/hqdefault.jpg",
    publishedAt: "2014-05-16T00:00:00.000Z",
    url: "https://www.youtube.com/watch?v=2LqzF5WauAw",
    keyword: "備援影音",
  },
  {
    id: "9bZkp7q19f0",
    title: "PSY - GANGNAM STYLE(강남스타일) M/V",
    channel: "officialpsy",
    thumbnail: "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg",
    publishedAt: "2012-07-15T00:00:00.000Z",
    url: "https://www.youtube.com/watch?v=9bZkp7q19f0",
    keyword: "備援影音",
  },
];

/** 主題對應 YouTube 頻道 RSS（channel_id）— 多個可輪替 */
const RSS_FEEDS: Record<string, string[]> = {
  nba: [
    "UCWJ2lwLlHCkVoAqpYF4O5A",
    "UCi-74PmZAF-JmKSxiQPTdBw",
  ],
  mlb: ["UCPCFIQU--9TuJZCBhJoRoTw"],
  taiwan: [
    "UC5nlbx1lFJ1vNBWxM9YQGTA",
    "UC7cSDz1mBBCcoSDkCRmqsKg",
    "UC4PTrU9THS1OqUp_PSoGHCw",
  ],
  finance: ["UCUMZ7gohGI9HcU9VNOKLYCQ", "UCvJJFu7leELUzLZ-BdAuG4A"],
  crypto: ["UC67eENbDJN6-ms66ZDuGCBA", "UCRV_qKGWtv8VRBCvDGuyXDA"],
};

const DEFAULT_NEWS_FEEDS = [
  "UCupvZG-5ko_eiAXpRVx06kw",
  "UC16niRr50-MSBwiO3Q_Dmw",
  "UC_x5XG1OV2P6uZZ5FSM9Ttw",
];

function decodeXmlText(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function parseYoutubeAtom(xml: string, maxPerFeed: number, keyword: string) {
  const videos: VideoOut[] = [];
  if (!xml.includes("<entry") || !xml.includes("</entry>")) return videos;

  const entryRe = /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml)) !== null && videos.length < maxPerFeed) {
    const block = m[1];
    const vidMatch =
      block.match(
        /<link[^>]*rel=["']alternate["'][^>]*href=["']https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/
      ) ||
      block.match(
        /href=["']https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})[^>]*rel=["']alternate["']/
      ) ||
      block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) ||
      block.match(/<id>yt:video:([^<]+)<\/id>/) ||
      block.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/);
    const id = vidMatch?.[1]?.trim();
    if (!id || id.length !== 11) continue;

    const titleRaw =
      block.match(/<title(?:[^>]*)>([^<]*)<\/title>/)?.[1]?.trim() || "YouTube 影片";
    const title = decodeXmlText(titleRaw);

    const channel =
      block.match(/<name>([^<]*)<\/name>/)?.[1]?.trim() || "YouTube";

    const publishedAt =
      block.match(/<published>([^<]+)<\/published>/)?.[1]?.trim() || "";

    const thumbMatch =
      block.match(/<media:thumbnail[^>]*url="([^"]+)"/) ||
      block.match(/<media:thumbnail[^>]*url='([^']+)'/);
    const thumbnail =
      thumbMatch?.[1] ||
      `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

    videos.push({
      id,
      title,
      url: `https://www.youtube.com/watch?v=${id}`,
      channel,
      thumbnail,
      publishedAt,
      keyword,
    });
  }
  return videos;
}

async function fetchRssVideos(
  channelIds: string[],
  perFeed: number,
  keyword: string
) {
  const out: VideoOut[] = [];
  const seen = new Set<string>();

  for (const cid of channelIds) {
    if (out.length >= 24) break;
    const uploadFeed = YT_RSS_UPLOADS(cid);
    const urls = uploadFeed ? [YT_RSS(cid), uploadFeed] : [YT_RSS(cid)];
    try {
      for (const feedUrl of urls) {
        const res = await fetch(feedUrl, { headers: RSS_HEADERS });
        if (!res.ok) continue;
        const xml = await res.text();
        const parsed = parseYoutubeAtom(xml, perFeed, keyword);
        for (const v of parsed) {
          if (seen.has(v.id)) continue;
          seen.add(v.id);
          out.push(v);
          if (out.length >= 28) return out;
        }
        if (parsed.length > 0) break;
      }
    } catch {
      continue;
    }
  }
  return out;
}

function classifyTopicLabel(label: string): string[] {
  const ids: string[] = [];
  const L = label.toLowerCase();

  const push = (key: keyof typeof RSS_FEEDS) => {
    ids.push(...(RSS_FEEDS[key] || []));
  };

  if (label === "NBA" || label === "Curry" || label === "季後賽" || L.includes("nba"))
    push("nba");
  if (label === "MLB" || label === "大谷翔平" || L.includes("mlb")) push("mlb");
  if (
    label === "台灣熱門" ||
    label === "台股" ||
    label === "戰爭" ||
    L.includes("台灣")
  )
    push("taiwan");
  if (label === "財經" || label === "美股" || label === "ETF") push("finance");
  if (
    label === "幣圈" ||
    label === "BTC" ||
    label === "ETH" ||
    L.includes("btc") ||
    L.includes("eth")
  )
    push("crypto");

  return [...new Set(ids)];
}

function feedsForLabels(labels: string[]) {
  const acc: string[] = [];
  for (const lb of labels) {
    acc.push(...classifyTopicLabel(lb));
  }
  const uniq = [...new Set(acc)];
  if (uniq.length === 0) return [...DEFAULT_NEWS_FEEDS];
  return uniq;
}

function isQuotaLike(message: string, code?: string) {
  const m = (message || "").toLowerCase();
  return (
    m.includes("quota") ||
    m.includes("exceeded") ||
    m.includes("ratelimit") ||
    code === "quotaExceeded" ||
    code === "dailyLimitExceeded" ||
    code === "403"
  );
}

async function tryYoutubeSearch(
  apiKey: string,
  q: string,
  keywordTag: string
): Promise<
  | { ok: true; videos: VideoOut[] }
  | { ok: false; error: string; code?: string; quota?: boolean }
> {
  const url = new URL(YT_SEARCH);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", q.slice(0, 450));
  url.searchParams.set("maxResults", String(MAX_API_RESULTS));
  url.searchParams.set("order", "date");
  url.searchParams.set("type", "video");
  url.searchParams.set("regionCode", "TW");
  url.searchParams.set("relevanceLanguage", "zh");
  url.searchParams.set("key", apiKey);

  const yt = await fetch(url.toString());
  const data = await yt.json();

  if (!yt.ok && !data?.error) {
    return {
      ok: false,
      error: `YouTube 連線異常（HTTP ${yt.status}）`,
      code: `HTTP_${yt.status}`,
    };
  }

  if (data?.error) {
    const errObj = data.error;
    const message =
      typeof errObj === "string"
        ? errObj
        : errObj.message ||
          errObj.errors?.[0]?.message ||
          "YouTube API 錯誤";
    const code =
      errObj.code != null
        ? String(errObj.code)
        : errObj.errors?.[0]?.reason != null
          ? String(errObj.errors[0].reason)
          : undefined;
    return {
      ok: false,
      error: message,
      code,
      quota: isQuotaLike(message, code),
    };
  }

  const videos: VideoOut[] = (data.items || [])
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
        keyword: keywordTag || "精選影音",
      };
    });

  return { ok: true, videos };
}

export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "private, max-age=300");

  const topicsRaw = String(req.query?.topics || "").trim();
  const custom = String(req.query?.custom || "").trim();

  const topicsDecoded = (() => {
    if (!topicsRaw) return "";
    try {
      return decodeURIComponent(topicsRaw);
    } catch {
      return topicsRaw;
    }
  })();

  const labels = topicsDecoded
    ? topicsDecoded
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const combinedQ =
    custom ||
    (labels.length > 0
      ? labels
          .slice(0, 6)
          .map((l) => `${l} 新聞`)
          .join(" OR ")
          .slice(0, 400)
      : "今日新聞");

  const apiKey = process.env.YOUTUBE_API_KEY || "";
  let banner: string | undefined;
  let source:
    | "youtube_api"
    | "youtube_rss"
    | "curated_rss"
    | "static_fallback" = "youtube_rss";
  let videos: VideoOut[] = [];

  const kwTag =
    labels.slice(0, 4).join(" · ") || (custom ? custom.slice(0, 40) : "精選影音");

  if (apiKey) {
    const apiTry = await tryYoutubeSearch(apiKey, combinedQ, kwTag);
    if (apiTry.ok && apiTry.videos.length > 0) {
      return res.status(200).json({
        ok: true,
        videos: apiTry.videos,
        source: "youtube_api",
      });
    }
    if (!apiTry.ok) {
      if (apiTry.quota) {
        banner = "今日影音額度已達上限，已切換為新聞影音模式";
      } else if (apiTry.error) {
        banner = "YouTube API 暫時無法使用，已改以新聞影音模式顯示";
      }
    }
  } else {
    banner = "未設定 API 金鑰，已改以新聞影音模式顯示";
  }

  const feedIds = feedsForLabels(labels.length ? labels : ["台灣熱門", "財經"]);
  videos = await fetchRssVideos(feedIds, 5, "RSS 新聞影音");

  if (videos.length > 0) {
    source = "youtube_rss";
    return res.status(200).json({
      ok: true,
      videos,
      source,
      banner,
    });
  }

  videos = await fetchRssVideos(DEFAULT_NEWS_FEEDS, 6, "國際新聞影音");
  source = "curated_rss";
  if (!banner) {
    banner = "已改為預設新聞影音來源";
  }

  if (videos.length === 0) {
    videos = STATIC_FALLBACK_VIDEOS.slice(0, MAX_API_RESULTS);
    source = "static_fallback";
    const extra = "RSS 無法取得最新影片，已改顯示備援精選";
    banner = banner ? `${banner}；${extra}` : extra;
  }

  return res.status(200).json({
    ok: true,
    videos,
    source,
    banner,
  });
}
