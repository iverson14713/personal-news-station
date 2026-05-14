/**
 * 影音 API：優先 YouTube Data API（主題優化查詢），
 * 失敗／額度／無資料時改走 YouTube 頻道 RSS，
 * 仍無資料且 API 可用時以「主題相關」搜尋備援（不再使用隨機熱門 MV 靜態池）。
 */

const YT_SEARCH = "https://www.googleapis.com/youtube/v3/search";
const YT_RSS = (channelId: string) =>
  `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

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

const MAX_RETURN = 5;
const PRIMARY_SEARCH_MAX = 12;
const FALLBACK_SEARCH_MAX = 15;
const MAX_FALLBACK_QUERIES = 8;

/** 主題 → 單一最佳化英文搜尋詞（避免只搜「NBA」「BTC」導致 MV／Shorts 洗版） */
const OPTIMIZED_QUERIES: Record<string, string> = {
  NBA: "NBA highlights today",
  Curry: "Stephen Curry game highlights",
  MLB: "MLB highlights today",
  大谷翔平: "Shohei Ohtani highlights",
  季後賽: "NBA MLB playoff highlights today",
  幣圈: "cryptocurrency market news today",
  BTC: "Bitcoin latest news analysis",
  ETH: "Ethereum latest news",
  台股: "Taiwan stock market TSMC news",
  ETF: "ETF stock market investing news",
  美股: "US stock market NASDAQ news today",
  財經: "Fed economy finance news today",
  國際: "world news geopolitics today",
  戰爭: "Ukraine Middle East conflict news",
  台灣熱門: "Taiwan breaking news today",
  影視: "TV entertainment industry news",
  電影: "new movies box office news",
  動漫: "anime news season update",
  音樂: "music industry news awards",
  潮流: "sneakers streetwear fashion news",
  科技: "AI tech industry news today",
  遊戲: "video game industry news review",
};

/** 主題 → 備援搜尋詞輪替 */
const FALLBACK_QUERIES: Record<string, string[]> = {
  NBA: ["NBA highlights", "NBA today", "ESPN NBA"],
  Curry: ["Stephen Curry highlights", "Warriors highlights"],
  MLB: ["MLB highlights", "MLB today"],
  大谷翔平: ["Shohei Ohtani highlights", "Dodgers highlights"],
  季後賽: ["NBA playoff highlights", "MLB playoff highlights"],
  幣圈: ["crypto news", "cryptocurrency analysis"],
  BTC: ["Bitcoin news", "crypto market news"],
  ETH: ["Ethereum news", "crypto market analysis"],
  台股: ["Taiwan stocks news", "TSMC stock news"],
  ETF: ["ETF investing news", "index fund news"],
  美股: ["US stocks news", "Wall Street news"],
  財經: ["Fed news", "global economy news"],
  國際: ["international news", "BBC world news"],
  戰爭: ["Ukraine war news", "geopolitics news"],
  台灣熱門: ["Taiwan news", "Taiwan politics news"],
  影視: ["Hollywood entertainment news", "TV series news"],
  電影: ["movie trailer news", "cinema box office"],
  動漫: ["anime news", "manga news"],
  音樂: ["music charts news", "concert tour news"],
  潮流: ["sneaker news", "fashion week news"],
  科技: ["AI news", "tech news The Verge"],
  遊戲: ["gaming news IGN", "esports news"],
};

const BAD_TITLE_SUBSTRINGS = [
  "official music video",
  "music video",
  " mv ",
  "（mv）",
  "(mv)",
  "lyrics",
  "lyric video",
  "karaoke",
  "remix",
  "nightcore",
  "dance cover",
  "dance practice",
  "fan cam",
  "fancam",
  "fancams",
  "meme compilation",
  "try not to laugh",
  "prank",
  "asmr",
  "1 hour",
  "10 hours",
  "full album",
  "audio swap",
  "mashup",
  "tiktok",
  "#shorts",
  "shorts]",
];

const BAD_TITLE_REGEX = [
  /\bmv\b/i,
  /\bm\/v\b/i,
  /\bpmv\b/i,
  /\[official video\]/i,
  /\bvertical\b/i,
];

const BANNER_TOPIC_FALLBACK =
  "備援模式：主題相關精選\n已切換至主題影音備援，最新來源暫時不可用。";

function titleLooksLowQuality(title: string): boolean {
  const t = title.toLowerCase();
  for (const s of BAD_TITLE_SUBSTRINGS) {
    if (t.includes(s)) return true;
  }
  for (const re of BAD_TITLE_REGEX) {
    if (re.test(title)) return true;
  }
  return false;
}

function channelLooksMusicOnly(channel: string): boolean {
  const c = channel.toLowerCase();
  if (/\bvevo\b/.test(c)) return true;
  if (/- topic$/i.test(channel.trim())) return true;
  return false;
}

function passesQualityGate(v: VideoOut): boolean {
  if (titleLooksLowQuality(v.title)) return false;
  if (channelLooksMusicOnly(v.channel)) return false;
  return true;
}

const PREFERRED_CHANNEL_RES = [
  /\bnba\b/i,
  /\bmlb\b/i,
  /\bespn\b/i,
  /\bofficial\b/i,
  /\bnews\b/i,
  /\bbloomberg\b/i,
  /\bcnbc\b/i,
  /\breuters\b/i,
  /\bbbc\b/i,
  /\bcnn\b/i,
  /\bthe verge\b/i,
  /\bmkbhd\b/i,
  /\bcoindesk\b/i,
  /\bcrypto\b/i,
  /\bhighlights\b/i,
  /\bhouse of highlights\b/i,
  /\bmlb network\b/i,
  /\bign\b/i,
  /\bgame spot\b/i,
  /\bpolygon\b/i,
];

function channelPreferenceScore(channel: string): number {
  const c = channel.toLowerCase();
  let s = 0;
  for (const re of PREFERRED_CHANNEL_RES) {
    if (re.test(c)) s += 4;
  }
  if (/\bvevo\b/.test(c)) s -= 20;
  return s;
}

function publishedMs(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function sortVideosForDisplay(videos: VideoOut[]): VideoOut[] {
  return [...videos].sort((a, b) => {
    const ca = channelPreferenceScore(a.channel);
    const cb = channelPreferenceScore(b.channel);
    if (cb !== ca) return cb - ca;
    return publishedMs(b.publishedAt) - publishedMs(a.publishedAt);
  });
}

function filterVideos(videos: VideoOut[]): VideoOut[] {
  return videos.filter(passesQualityGate);
}

function buildPrimarySearchQuery(labels: string[], custom: string): string {
  const c = custom.trim();
  if (c) return `${c} news analysis`.slice(0, 450);

  const parts: string[] = [];
  for (const lb of labels.slice(0, 5)) {
    const o = OPTIMIZED_QUERIES[lb];
    if (o) parts.push(`(${o})`);
  }
  if (parts.length === 0) return "Taiwan breaking news today";
  return parts.join(" OR ").slice(0, 450);
}

function collectTopicSearchQueries(labels: string[], custom: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (q: string) => {
    const t = q.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  const c = custom.trim();
  if (c) {
    push(`${c} news explained`);
    push(`${c} highlights analysis`);
  }

  for (const lb of labels) {
    const o = OPTIMIZED_QUERIES[lb];
    if (o) push(o);
    const fall = FALLBACK_QUERIES[lb];
    if (fall) for (const q of fall) push(q);
  }

  if (out.length === 0 && labels.length) {
    for (const lb of labels.slice(0, 3)) {
      push(`${lb} news highlights`);
    }
  }

  return out.slice(0, 24);
}

/** 主題對應 YouTube 頻道 RSS（channel_id） */
const RSS_FEEDS: Record<string, string[]> = {
  nba: ["UCWJ2lwLlHCkVoAqpYF4O5A", "UCi-74PmZAF-JmKSxiQPTdBw"],
  mlb: ["UCPCFIQU--9TuJZCBhJoRoTw"],
  taiwan: [
    "UC5nlbx1lFJ1vNBWxM9YQGTA",
    "UC7cSDz1mBBCcoSDkCRmqsKg",
    "UC4PTrU9THS1OqUp_PSoGHCw",
  ],
  finance: ["UCUMZ7gohGI9HcU9VNOKLYCQ", "UCvJJFu7leELUzLZ-BdAuG4A"],
  crypto: ["UC67eENbDJN6-ms66ZDuGCBA", "UCRV_qKGWtv8VRBCvDGuyXDA"],
  intl: ["UC16niRr50-MSBwiO3Q_Dmw", "UCupvZG-5ko_eiAXpRVx06kw"],
  tech: ["UCBJycsmduvYEL83Rd_FU90A", "UCXuqSBlHAE6Xw-yeJA0Tunw"],
  gaming: ["UCIFQdZNU27Vjw8XVVEUVqYQ", "UCbu2_Fn61izNqKlQuGnvyTw"],
  entertainment: ["UCupvZG-5ko_eiAXpRVx06kw"],
  movie: ["UCupvZG-5ko_eiAXpRVx06kw"],
  anime: ["UCIFQdZNU27Vjw8XVVEUVqYQ"],
  music: ["UC16niRr50-MSBwiO3Q_Dmw"],
  fashion: ["UC16niRr50-MSBwiO3Q_Dmw"],
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
      thumbMatch?.[1] || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

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
    L.includes("台灣") ||
    L.includes("台股")
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
  if (label === "戰爭" || label === "國際" || L.includes("戰爭") || L.includes("國際"))
    push("intl");
  if (label === "影視" || L.includes("影視") || L.includes("娛樂")) push("entertainment");
  if (label === "電影" || L.includes("電影") || L.includes("票房")) push("movie");
  if (label === "動漫" || L.includes("動漫") || L.includes("動畫")) push("anime");
  if (label === "音樂" || L.includes("音樂") || L.includes("演唱會")) push("music");
  if (label === "潮流" || L.includes("潮流") || L.includes("球鞋") || L.includes("穿搭"))
    push("fashion");
  if (label === "科技" || L.includes("科技") || L.includes("半導體") || L.includes("iphone"))
    push("tech");
  if (label === "遊戲" || L.includes("遊戲") || L.includes("steam") || L.includes("電競"))
    push("gaming");

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

type SearchOpts = {
  maxResults?: number;
  order?: "date" | "relevance" | "viewCount";
  relevanceLanguage?: string;
  regionCode?: string;
  videoDuration?: "short" | "medium" | "long" | "any";
};

async function tryYoutubeSearch(
  apiKey: string,
  q: string,
  keywordTag: string,
  opts?: SearchOpts
): Promise<
  | { ok: true; videos: VideoOut[] }
  | { ok: false; error: string; code?: string; quota?: boolean }
> {
  const url = new URL(YT_SEARCH);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", q.slice(0, 450));
  url.searchParams.set(
    "maxResults",
    String(Math.min(50, Math.max(1, opts?.maxResults ?? MAX_RETURN)))
  );
  url.searchParams.set("order", opts?.order ?? "date");
  url.searchParams.set("type", "video");
  url.searchParams.set("regionCode", opts?.regionCode ?? "TW");
  url.searchParams.set("relevanceLanguage", opts?.relevanceLanguage ?? "zh-Hant");
  url.searchParams.set("safeSearch", "moderate");
  if (opts?.videoDuration && opts.videoDuration !== "any") {
    url.searchParams.set("videoDuration", opts.videoDuration);
  }
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
    .filter((item: { id?: { videoId?: string }; snippet?: unknown }) =>
      Boolean(item.id?.videoId && item.snippet)
    )
    .map((item: {
      id: { videoId: string };
      snippet: {
        title?: string;
        channelTitle?: string;
        publishedAt?: string;
        thumbnails?: Record<string, { url?: string }>;
      };
    }) => {
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

async function runTopicApiFallback(
  apiKey: string,
  labels: string[],
  custom: string
): Promise<{ videos: VideoOut[]; quotaHit: boolean }> {
  const queries = collectTopicSearchQueries(labels, custom).slice(
    0,
    MAX_FALLBACK_QUERIES
  );
  const merged: VideoOut[] = [];
  const seen = new Set<string>();
  let quotaHit = false;

  const pushBatch = (batch: VideoOut[]) => {
    for (const v of batch) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      merged.push({ ...v, keyword: "備援精選" });
    }
  };

  for (const q of queries) {
    const r = await tryYoutubeSearch(apiKey, q, "備援精選", {
      maxResults: FALLBACK_SEARCH_MAX,
      order: "date",
      relevanceLanguage: "en",
      regionCode: "US",
      videoDuration: "medium",
    });
    if (!r.ok) {
      if (r.quota) {
        quotaHit = true;
        break;
      }
      continue;
    }
    pushBatch(r.videos);
    const good = sortVideosForDisplay(filterVideos(merged));
    if (good.length >= MAX_RETURN * 3) break;
  }

  if (
    sortVideosForDisplay(filterVideos(merged)).length < MAX_RETURN &&
    !quotaHit &&
    queries.length > 0
  ) {
    const longTry = await tryYoutubeSearch(
      apiKey,
      queries[0] || "world news today",
      "備援精選",
      {
        maxResults: FALLBACK_SEARCH_MAX,
        order: "date",
        relevanceLanguage: "en",
        regionCode: "US",
        videoDuration: "long",
      }
    );
    if (longTry.ok) {
      pushBatch(longTry.videos);
    } else if (!longTry.ok && longTry.quota) {
      quotaHit = true;
    }
  }

  const finalList = sortVideosForDisplay(filterVideos(merged)).slice(
    0,
    MAX_RETURN
  );

  return { videos: finalList, quotaHit };
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

  const apiKey = process.env.YOUTUBE_API_KEY || "";
  let banner: string | undefined;
  let badge: string | undefined;
  let youtubeApiQuotaBlocked = false;

  let source:
    | "youtube_api"
    | "youtube_rss"
    | "curated_rss"
    | "youtube_topic_fallback"
    | "empty" = "youtube_rss";

  let videos: VideoOut[] = [];

  const kwTag =
    labels.slice(0, 4).join(" · ") || (custom ? custom.slice(0, 40) : "精選影音");

  const primaryQ = buildPrimarySearchQuery(labels, custom);

  if (apiKey) {
    const apiTry = await tryYoutubeSearch(apiKey, primaryQ, kwTag, {
      maxResults: PRIMARY_SEARCH_MAX,
      order: "date",
      relevanceLanguage: "en",
      regionCode: "US",
      videoDuration: "medium",
    });
    if (apiTry.ok && apiTry.videos.length > 0) {
      const filtered = sortVideosForDisplay(filterVideos(apiTry.videos)).slice(
        0,
        MAX_RETURN
      );
      if (filtered.length > 0) {
        return res.status(200).json({
          ok: true,
          videos: filtered,
          source: "youtube_api",
        });
      }
    }
    if (!apiTry.ok) {
      if (apiTry.quota) {
        youtubeApiQuotaBlocked = true;
        banner = "今日影音額度已達上限，已切換為新聞影音模式";
      } else if (apiTry.error) {
        banner = "YouTube API 暫時無法使用，已改以新聞影音模式顯示";
      }
    }
  } else {
    banner = "未設定 API 金鑰，已改以新聞影音模式顯示";
  }

  const feedIds = feedsForLabels(labels.length ? labels : ["台灣熱門", "財經"]);
  const rssRaw = await fetchRssVideos(feedIds, 5, "RSS 新聞影音");
  videos = sortVideosForDisplay(filterVideos(rssRaw)).slice(0, MAX_RETURN);

  if (videos.length > 0) {
    source = "youtube_rss";
    return res.status(200).json({
      ok: true,
      videos,
      source,
      banner,
    });
  }

  const curated = await fetchRssVideos(DEFAULT_NEWS_FEEDS, 6, "國際新聞影音");
  videos = sortVideosForDisplay(filterVideos(curated)).slice(0, MAX_RETURN);
  source = "curated_rss";
  if (!banner) {
    banner = "已改為預設新聞影音來源";
  }

  if (videos.length > 0) {
    return res.status(200).json({
      ok: true,
      videos,
      source,
      banner,
    });
  }

  if (apiKey && !youtubeApiQuotaBlocked) {
    const fb = await runTopicApiFallback(apiKey, labels, custom);
    if (fb.quotaHit && !banner) {
      banner = "YouTube API 額度不足，無法進行主題備援搜尋";
    }
    if (fb.videos.length > 0) {
      source = "youtube_topic_fallback";
      badge = "備援精選";
      const extra = banner ? `\n${banner}` : "";
      banner = `${BANNER_TOPIC_FALLBACK}${extra}`;
      return res.status(200).json({
        ok: true,
        videos: fb.videos,
        source,
        banner,
        badge,
      });
    }
  }

  videos = [];
  source = "empty";
  const emptyLine = "目前沒有相關影音內容。";
  banner = banner ? `${emptyLine}\n${banner}` : emptyLine;

  return res.status(200).json({
    ok: true,
    videos,
    source,
    banner,
    badge: undefined,
  });
}
