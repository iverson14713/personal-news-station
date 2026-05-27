/**
 * 影音 API：以 YouTube Search API 為主（三層 fallback），RSS 僅作補充／保底。
 * L1：近 7 天、優化查詢、嚴格品質
 * L2：近 30 天、放寬查詢與過濾
 * L3：寬搜尋 + 官方頻道 RSS／全預設 RSS 保底，避免整頁空白
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
const MAX_SEARCH_CALLS = 22;

/** L1：優化查詢（近 7 天） */
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

/** L2：放寬查詢（近 30 天） */
const FALLBACK_QUERIES: Record<string, string[]> = {
  NBA: ["NBA highlights", "NBA top plays", "ESPN NBA"],
  Curry: ["Stephen Curry highlights", "best Curry highlights", "Warriors highlights"],
  MLB: ["MLB highlights", "MLB today"],
  大谷翔平: ["Shohei Ohtani highlights", "Dodgers highlights"],
  季後賽: ["NBA playoff highlights", "MLB playoff highlights"],
  幣圈: ["crypto news", "cryptocurrency analysis"],
  BTC: ["Bitcoin analysis", "Bitcoin news"],
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
  科技: ["AI news", "tech news"],
  遊戲: ["gaming news IGN", "esports news"],
};

/** L3：固定寬搜尋（不限 7/30 天，高命中率） */
const LEVEL3_BROAD_SEARCHES: Record<string, string[]> = {
  NBA: ["NBA top plays", "NBA best dunks highlights"],
  Curry: ["best Stephen Curry highlights", "Stephen Curry clutch moments"],
  MLB: ["MLB best plays", "MLB highlights compilation"],
  大谷翔平: ["Shohei Ohtani best plays", "Ohtani highlights"],
  季後賽: ["NBA playoff moments", "MLB postseason highlights"],
  幣圈: ["crypto weekly recap", "cryptocurrency explained"],
  BTC: ["Bitcoin latest update", "Bitcoin weekly news"],
  ETH: ["Ethereum update", "Ethereum explained"],
  台股: ["Taiwan stock market explained", "TSMC news"],
  ETF: ["ETF explained for beginners", "stock market ETF"],
  美股: ["US stock market recap", "NASDAQ highlights"],
  財經: ["economy news recap", "Fed meeting explained"],
  國際: ["world news this week", "global headlines"],
  戰爭: ["war news analysis", "geopolitics explained"],
  台灣熱門: ["Taiwan news highlights", "Taiwan today"],
  影視: ["entertainment news recap", "Hollywood news"],
  電影: ["movie news recap", "box office news"],
  動漫: ["anime highlights", "anime news recap"],
  音樂: ["music industry weekly", "Billboard news"],
  潮流: ["sneaker releases news", "streetwear news"],
  科技: ["AI tech weekly", "technology news recap"],
  遊戲: ["gaming weekly news", "video game highlights"],
};

/** L3：官方頻道內搜尋（channelId + q） */
const OFFICIAL_CHANNEL_SEARCH: { channelId: string; q: string; themes: string[] }[] = [
  { channelId: "UCWJ2lwLlHCkVoAqpYF4O5A", q: "highlights", themes: ["nba", "curry", "playoff"] },
  { channelId: "UCPCFIQU--9TuJZCBhJoRoTw", q: "highlights", themes: ["mlb", "ohtani"] },
  { channelId: "UC67eENbDJN6-ms66ZDuGCBA", q: "Bitcoin", themes: ["btc", "crypto"] },
  { channelId: "UCRV_qKGWtv8VRBCvDGuyXDA", q: "Ethereum", themes: ["eth", "crypto"] },
  { channelId: "UCBJycsmduvYEL83Rd_FU90A", q: "tech", themes: ["tech"] },
  { channelId: "UCIFQdZNU27Vjw8XVVEUVqYQ", q: "review", themes: ["gaming"] },
  { channelId: "UC16niRr50-MSBwiO3Q_Dmw", q: "news", themes: ["war", "intl", "taiwan", "finance"] },
];

const BAD_TITLE_STRICT = [
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
  "meme compilation",
  "try not to laugh",
  "prank",
  "asmr",
  "full album",
  "audio swap",
  "mashup",
  "tiktok",
  "#shorts",
  "shorts]",
];

const BAD_TITLE_RELAXED = [
  "official music video",
  "music video",
  "#shorts",
  "lyric video",
  " karaoke",
  "nightcore",
  "fan cam",
  "fancam",
];

function titleFailsStrict(title: string): boolean {
  const t = title.toLowerCase();
  for (const s of BAD_TITLE_STRICT) {
    if (t.includes(s)) return true;
  }
  if (/\bmv\b/i.test(title) || /\bm\/v\b/i.test(title) || /\bpmv\b/i.test(title))
    return true;
  return false;
}

function titleFailsRelaxed(title: string): boolean {
  const t = title.toLowerCase();
  for (const s of BAD_TITLE_RELAXED) {
    if (t.includes(s)) return true;
  }
  return false;
}

function channelIsMusicOnly(channel: string): boolean {
  const c = channel.toLowerCase();
  if (/\bvevo\b/.test(c)) return true;
  if (/- topic$/i.test(channel.trim())) return true;
  return false;
}

function passesLevel1(v: VideoOut, minPublishedMs: number): boolean {
  if (titleFailsStrict(v.title)) return false;
  if (channelIsMusicOnly(v.channel)) return false;
  if (publishedMs(v.publishedAt) < minPublishedMs) return false;
  return true;
}

function passesLevel2(v: VideoOut, minPublishedMs: number): boolean {
  if (titleFailsRelaxed(v.title)) return false;
  if (channelIsMusicOnly(v.channel)) return false;
  if (publishedMs(v.publishedAt) < minPublishedMs) return false;
  return true;
}

/** L3 搜尋結果：只擋最明顯垃圾 */
function passesLevel3Search(v: VideoOut): boolean {
  const t = v.title.toLowerCase();
  if (t.includes("official music video") || t.includes("#shorts")) return false;
  if (/\bvevo\b/i.test(v.channel)) return false;
  return true;
}

/** RSS 保底：只擋 VEVO／Topic */
function passesRssLastResort(v: VideoOut): boolean {
  if (/\bvevo\b/i.test(v.channel)) return false;
  if (/- topic$/i.test(v.channel.trim())) return false;
  if (v.title.toLowerCase().includes("#shorts")) return false;
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

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function sortVideosForDisplay(videos: VideoOut[]): VideoOut[] {
  return [...videos].sort((a, b) => {
    const ca = channelPreferenceScore(a.channel);
    const cb = channelPreferenceScore(b.channel);
    if (cb !== ca) return cb - ca;
    return publishedMs(b.publishedAt) - publishedMs(a.publishedAt);
  });
}

function dedupeMerge(
  existing: VideoOut[],
  incoming: VideoOut[],
  cap: number
): VideoOut[] {
  const seen = new Set(existing.map((v) => v.id));
  const out = [...existing];
  for (const v of sortVideosForDisplay(incoming)) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    out.push(v);
    if (out.length >= cap) break;
  }
  return sortVideosForDisplay(out).slice(0, cap);
}

function labelThemes(label: string): string[] {
  const L = label.toLowerCase();
  const t: string[] = [];
  if (label === "NBA" || L.includes("nba")) t.push("nba");
  if (label === "Curry" || L.includes("curry")) t.push("curry");
  if (label === "季後賽" || L.includes("季後賽")) t.push("playoff");
  if (label === "MLB" || L.includes("mlb")) t.push("mlb");
  if (label === "大谷翔平" || L.includes("ohtani")) t.push("ohtani");
  if (label === "BTC" || L.includes("btc")) t.push("btc");
  if (label === "ETH" || L.includes("eth")) t.push("eth");
  if (label === "幣圈" || L.includes("加密")) t.push("crypto");
  if (label === "科技" || L.includes("科技")) t.push("tech");
  if (label === "戰爭" || L.includes("戰爭")) t.push("war");
  if (label === "國際" || L.includes("國際")) t.push("intl");
  if (label === "台灣熱門" || L.includes("台灣")) t.push("taiwan");
  if (label === "財經" || label === "美股" || label === "ETF" || label === "台股")
    t.push("finance");
  if (label === "潮流" || L.includes("潮流")) t.push("fashion");
  if (label === "音樂" || L.includes("音樂")) t.push("music");
  if (label === "電影" || L.includes("電影")) t.push("movie");
  if (label === "影視" || L.includes("影視")) t.push("entertainment");
  if (label === "動漫" || L.includes("動漫")) t.push("anime");
  if (label === "遊戲" || L.includes("遊戲")) t.push("gaming");
  if (t.length === 0) t.push("intl");
  return [...new Set(t)];
}

function collectThemesFromLabels(labels: string[]): string[] {
  const acc: string[] = [];
  for (const lb of labels) acc.push(...labelThemes(lb));
  return [...new Set(acc)];
}

/** 主題對應 YouTube 頻道 RSS（僅作補充／保底） */
const RSS_FEEDS: Record<string, string[]> = {
  nba: [
    "UCWJ2lwLlHCkVoAqpYF4O5A",
    "UCi-74PmZAF-JmKSxiQPTdBw",
    "UC9CoOnJkIBMdeaid9QYbPtw",
    "UCE26OVBc9isw-ii6g_kiEPA",
  ],
  mlb: ["UCPCFIQU--9TuJZCBhJoRoTw", "UCLFT-m-weWReNJBLKXPNthQ"],
  taiwan: [
    "UC5nlbx1lFJ1vNBWxM9YQGTA",
    "UC7cSDz1mBBCcoSDkCRmqsKg",
    "UC4PTrU9THS1OqUp_PSoGHCw",
  ],
  finance: ["UCUMZ7gohGI9HcU9VNOKLYCQ", "UCvJJFu7leELUzLZ-BdAuG4A", "UCV61sGxUSQlVasW7PHwoF9Q"],
  crypto: ["UC67eENbDJN6-ms66ZDuGCBA", "UCRV_qKGWtv8VRBCvDGuyXDA", "UCV61sGxUSQlVasW7PHwoF9Q"],
  intl: ["UC16niRr50-MSBwiO3Q_Dmw", "UCupvZG-5ko_eiAXpRVx06kw", "UCV61sGxUSQlVasW7PHwoF9Q"],
  tech: ["UCBJycsmduvYEL83Rd_FU90A", "UCXuqSBlHAE6Xw-yeJA0Tunw"],
  gaming: ["UCIFQdZNU27Vjw8XVVEUVqYQ", "UCbu2_Fn61izNqKlQuGnvyTw", "UCupvZG-5ko_eiAXpRVx06kw"],
  entertainment: ["UCupvZG-5ko_eiAXpRVx06kw", "UC16niRr50-MSBwiO3Q_Dmw"],
  movie: ["UCupvZG-5ko_eiAXpRVx06kw", "UC16niRr50-MSBwiO3Q_Dmw"],
  anime: ["UCIFQdZNU27Vjw8XVVEUVqYQ", "UCupvZG-5ko_eiAXpRVx06kw"],
  music: ["UC16niRr50-MSBwiO3Q_Dmw", "UCupvZG-5ko_eiAXpRVx06kw"],
  fashion: ["UC16niRr50-MSBwiO3Q_Dmw", "UCupvZG-5ko_eiAXpRVx06kw"],
};

const DEFAULT_NEWS_FEEDS = [
  "UCupvZG-5ko_eiAXpRVx06kw",
  "UC16niRr50-MSBwiO3Q_Dmw",
  "UC_x5XG1OV2P6uZZ5FSM9Ttw",
];

function classifyTopicLabel(label: string): string[] {
  const ids: string[] = [];
  const L = label.toLowerCase();
  const push = (key: keyof typeof RSS_FEEDS) => {
    ids.push(...(RSS_FEEDS[key] || []));
  };
  if (label === "NBA" || label === "Curry" || label === "季後賽" || L.includes("nba"))
    push("nba");
  if (label === "MLB" || label === "大谷翔平" || L.includes("mlb")) push("mlb");
  if (label === "台灣熱門" || label === "台股" || L.includes("台灣") || L.includes("台股"))
    push("taiwan");
  if (label === "財經" || label === "美股" || label === "ETF" || label === "台股")
    push("finance");
  if (label === "幣圈" || label === "BTC" || label === "ETH" || L.includes("btc") || L.includes("eth"))
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
  for (const lb of labels) acc.push(...classifyTopicLabel(lb));
  const uniq = [...new Set(acc)];
  if (uniq.length === 0) return [...DEFAULT_NEWS_FEEDS];
  return uniq;
}

function rssChannelIdsForRequest(labels: string[]): string[] {
  const topic = feedsForLabels(labels.length ? labels : ["台灣熱門", "財經"]);
  return [...new Set([...topic, ...DEFAULT_NEWS_FEEDS])];
}

function allRssChannelIds(): string[] {
  const s = new Set<string>(DEFAULT_NEWS_FEEDS);
  for (const arr of Object.values(RSS_FEEDS)) {
    for (const id of arr) s.add(id);
  }
  return [...s];
}

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
    const channel = block.match(/<name>([^<]*)<\/name>/)?.[1]?.trim() || "YouTube";
    const publishedAt =
      block.match(/<published>([^<]+)<\/published>/)?.[1]?.trim() || "";
    const thumbMatch =
      block.match(/<media:thumbnail[^>]*url="([^"]+)"/) ||
      block.match(/<media:thumbnail[^>]*url='([^']+)'/);
    const thumbnail = thumbMatch?.[1] || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
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
  keyword: string,
  maxChannels = 48,
  poolCap = 60
) {
  const out: VideoOut[] = [];
  const seen = new Set<string>();
  const ids = channelIds.slice(0, maxChannels);
  for (const cid of ids) {
    if (out.length >= poolCap) break;
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
          if (out.length >= poolCap) return out;
        }
        if (parsed.length > 0) break;
      }
    } catch {
      continue;
    }
  }
  return out;
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
  publishedAfter?: string;
  publishedBefore?: string;
  channelId?: string;
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
  url.searchParams.set("regionCode", opts?.regionCode ?? "US");
  url.searchParams.set("relevanceLanguage", opts?.relevanceLanguage ?? "en");
  url.searchParams.set("safeSearch", "moderate");
  if (opts?.channelId) {
    url.searchParams.set("channelId", opts.channelId);
  }
  if (opts?.publishedAfter) {
    url.searchParams.set("publishedAfter", opts.publishedAfter);
  }
  if (opts?.publishedBefore) {
    url.searchParams.set("publishedBefore", opts.publishedBefore);
  }
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

type PipelineState = {
  videos: VideoOut[];
  /** 實際進入搜尋的最深層級（用於 UI：僅在需要 L2/L3 時顯示備援文案） */
  searchDepthUsed: 1 | 2 | 3;
  quotaBlocked: boolean;
  searchCalls: number;
};

function applyFilterToPool(
  pool: VideoOut[],
  incoming: VideoOut[],
  filterFn: (v: VideoOut) => boolean,
  keyword: string,
  cap: number
): VideoOut[] {
  const tagged = incoming.map((v) => ({ ...v, keyword }));
  const ok = tagged.filter(filterFn);
  return dedupeMerge(pool, ok, cap);
}

async function runYoutubeSearchPipeline(
  apiKey: string,
  labels: string[],
  custom: string,
  kwTag: string
): Promise<PipelineState> {
  const state: PipelineState = {
    videos: [],
    searchDepthUsed: 1,
    quotaBlocked: false,
    searchCalls: 0,
  };

  const runOne = async (
    q: string,
    opts: SearchOpts,
    keyword: string
  ): Promise<VideoOut[]> => {
    if (state.quotaBlocked || state.searchCalls >= MAX_SEARCH_CALLS) return [];
    state.searchCalls += 1;
    const r = await tryYoutubeSearch(apiKey, q, keyword, opts);
    if (!r.ok) {
      if (r.quota) state.quotaBlocked = true;
      return [];
    }
    return r.videos;
  };

  const min7 = publishedMs(daysAgoIso(7));
  const min30 = publishedMs(daysAgoIso(30));

  const l1Queries: string[] = [];
  const c = custom.trim();
  if (c) l1Queries.push(`${c} latest news`);
  for (const lb of labels.slice(0, 5)) {
    const o = OPTIMIZED_QUERIES[lb];
    if (o) l1Queries.push(o);
  }
  if (l1Queries.length === 0) l1Queries.push("world news today");

  for (const q of l1Queries.slice(0, 6)) {
    const batch = await runOne(q, {
      maxResults: 12,
      order: "date",
      publishedAfter: daysAgoIso(7),
      relevanceLanguage: "en",
      regionCode: "US",
      videoDuration: "medium",
    }, "最新新聞影音");
    state.videos = applyFilterToPool(
      state.videos,
      batch,
      (v) => passesLevel1(v, min7),
      "最新新聞影音",
      MAX_RETURN
    );
    if (state.videos.length >= MAX_RETURN) return state;
    if (state.quotaBlocked) return state;
  }

  if (state.videos.length >= MAX_RETURN) return state;

  state.searchDepthUsed = 2;
  const l2Queries: string[] = [];
  for (const lb of labels.slice(0, 6)) {
    const arr = FALLBACK_QUERIES[lb];
    if (arr) l2Queries.push(...arr);
  }
  if (c) l2Queries.push(`${c} highlights`, `${c} analysis`);
  const seenQ = new Set(l1Queries);
  const l2Unique = l2Queries.filter((q) => {
    if (seenQ.has(q)) return false;
    seenQ.add(q);
    return true;
  });

  for (const q of l2Unique.slice(0, 6)) {
    const batch = await runOne(q, {
      maxResults: 15,
      order: "date",
      publishedAfter: daysAgoIso(30),
      relevanceLanguage: "en",
      regionCode: "US",
      videoDuration: "any",
    }, "主題精選");
    state.videos = applyFilterToPool(
      state.videos,
      batch,
      (v) => passesLevel2(v, min30),
      "主題精選",
      MAX_RETURN
    );
    if (state.videos.length >= MAX_RETURN) return state;
    if (state.quotaBlocked) return state;
  }

  if (state.videos.length >= MAX_RETURN) return state;

  state.searchDepthUsed = 3;
  const themes = collectThemesFromLabels(labels.length ? labels : ["台灣熱門"]);
  const l3Queries: string[] = [];
  for (const lb of labels.slice(0, 6)) {
    const arr = LEVEL3_BROAD_SEARCHES[lb];
    if (arr) l3Queries.push(...arr);
  }
  if (l3Queries.length === 0) {
    l3Queries.push("NBA top plays", "tech news recap", "crypto weekly recap");
  }
  const l3Seen = new Set<string>();
  const l3Unique = l3Queries.filter((q) => {
    if (l3Seen.has(q)) return false;
    l3Seen.add(q);
    return true;
  });

  for (const q of l3Unique.slice(0, 5)) {
    const batch = await runOne(
      q,
      {
        maxResults: 15,
        order: "relevance",
        relevanceLanguage: "en",
        regionCode: "US",
        videoDuration: "any",
      },
      "備援精選"
    );
    state.videos = applyFilterToPool(
      state.videos,
      batch,
      passesLevel3Search,
      "備援精選",
      MAX_RETURN
    );
    if (state.videos.length >= MAX_RETURN) return state;
    if (state.quotaBlocked) return state;
  }

  const themeSet = new Set(themes);
  const channelEntries =
    themeSet.size === 0
      ? OFFICIAL_CHANNEL_SEARCH.slice(0, 3)
      : OFFICIAL_CHANNEL_SEARCH.filter((e) => e.themes.some((t) => themeSet.has(t))).slice(
          0,
          4
        );
  const toRun = channelEntries.length > 0 ? channelEntries : OFFICIAL_CHANNEL_SEARCH.slice(0, 3);

  for (const entry of toRun) {
    if (state.videos.length >= MAX_RETURN || state.quotaBlocked) break;

    const batch = await runOne(entry.q, {
      maxResults: 8,
      order: "date",
      channelId: entry.channelId,
      relevanceLanguage: "en",
      regionCode: "US",
      videoDuration: "any",
    }, "備援精選");
    state.videos = applyFilterToPool(
      state.videos,
      batch,
      passesLevel3Search,
      "備援精選",
      MAX_RETURN
    );
  }

  return state;
}

async function rssBonusFill(
  labels: string[],
  existing: VideoOut[],
  cap: number
): Promise<VideoOut[]> {
  const feedIds = rssChannelIdsForRequest(labels.length ? labels : ["台灣熱門", "財經"]);
  const raw = await fetchRssVideos(feedIds, 12, "RSS 補充", 36, 50);
  const ok = raw.filter(passesRssLastResort);
  const tagged = ok.map((v) => ({ ...v, keyword: "RSS 補充" }));
  return dedupeMerge(existing, tagged, cap);
}

async function lastResortRssGuarantee(labels: string[]): Promise<VideoOut[]> {
  const primary = rssChannelIdsForRequest(labels.length ? labels : ["台灣熱門", "財經"]);
  let raw = await fetchRssVideos(primary, 20, "主題精選", 48, 80);
  let picked = sortVideosForDisplay(raw.filter(passesRssLastResort)).slice(0, MAX_RETURN);
  if (picked.length >= MAX_RETURN) {
    return picked.map((v) => ({ ...v, keyword: "主題精選（非即時）" }));
  }
  raw = await fetchRssVideos(allRssChannelIds(), 15, "主題精選", 60, 100);
  picked = sortVideosForDisplay(raw.filter(passesRssLastResort)).slice(0, MAX_RETURN);
  return picked.map((v) => ({ ...v, keyword: "主題精選（非即時）" }));
}

/** 預先定義精選（無 API、RSS 全失敗時仍避免空白；內容為新聞／科技教育向） */
const CURATED_STATIC_VIDEOS: VideoOut[] = [
  {
    id: "M7lc1UVf-VE",
    title: "YouTube 播放器與開發者資源（精選）",
    channel: "Google for Developers",
    publishedAt: "2012-06-22T00:00:00.000Z",
    url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    thumbnail: "https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg",
    keyword: "備援精選",
  },
  {
    id: "5MgBikgcWnY",
    title: "如何快速學會一件事（精選演講）",
    channel: "TEDx Talks",
    publishedAt: "2013-03-14T00:00:00.000Z",
    url: "https://www.youtube.com/watch?v=5MgBikgcWnY",
    thumbnail: "https://i.ytimg.com/vi/5MgBikgcWnY/hqdefault.jpg",
    keyword: "備援精選",
  },
  {
    id: "2LqzF5WauAw",
    title: "電影預告精選（非即時）",
    channel: "Paramount Pictures",
    publishedAt: "2014-05-16T00:00:00.000Z",
    url: "https://www.youtube.com/watch?v=2LqzF5WauAw",
    thumbnail: "https://i.ytimg.com/vi/2LqzF5WauAw/hqdefault.jpg",
    keyword: "備援精選",
  },
  {
    id: "wKJ9KzGQq0w",
    title: "Google 產品介紹（精選）",
    channel: "Google",
    publishedAt: "2012-04-24T00:00:00.000Z",
    url: "https://www.youtube.com/watch?v=wKJ9KzGQq0w",
    thumbnail: "https://i.ytimg.com/vi/wKJ9KzGQq0w/hqdefault.jpg",
    keyword: "備援精選",
  },
  {
    id: "jNQXAC9IVRw",
    title: "YouTube 歷史性首支影片（平台精選）",
    channel: "jawed",
    publishedAt: "2005-04-24T00:00:00.000Z",
    url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    thumbnail: "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg",
    keyword: "備援精選",
  },
];

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
  const kwTag =
    labels.slice(0, 4).join(" · ") || (custom ? custom.slice(0, 40) : "精選影音");

  let videos: VideoOut[] = [];
  let fallbackLevel: 1 | 2 | 3 = 1;
  let contentFlags: string[] = [];
  let banner: string | undefined;
  let badge: string | undefined;
  let source: string = "youtube_search";

  if (apiKey) {
    const pipe = await runYoutubeSearchPipeline(apiKey, labels, custom, kwTag);
    videos = pipe.videos.slice(0, MAX_RETURN);
    fallbackLevel = pipe.searchDepthUsed;

    if (pipe.quotaBlocked && videos.length === 0) {
      banner = "今日影音搜尋額度已達上限，改以頻道 RSS 與精選內容顯示。";
    } else if (pipe.quotaBlocked && videos.length > 0) {
      banner =
        "部分搜尋因額度受限未完成；以下為已取得之結果（可能非完整列表）。";
    }

    if (videos.length > 0 && videos.length < MAX_RETURN && !pipe.quotaBlocked) {
      videos = await rssBonusFill(
        labels.length ? labels : ["台灣熱門", "財經"],
        videos,
        MAX_RETURN
      );
      if (videos.some((v) => v.keyword && !v.keyword.includes("最新新聞影音"))) {
        source = "youtube_search_rss_bonus";
      }
    }
  } else {
    banner = "未設定 YouTube API 金鑰，改以頻道 RSS 與精選內容顯示。";
  }

  if (videos.length < MAX_RETURN) {
    const beforeMerge = videos.length;
    const rssFill = await lastResortRssGuarantee(labels);
    videos = dedupeMerge(videos, rssFill, MAX_RETURN);
    if (beforeMerge === 0 && videos.length > 0) {
      source = apiKey ? "youtube_rss_fallback" : "youtube_rss_only";
      fallbackLevel = 3;
    } else if (beforeMerge > 0 && videos.length > beforeMerge) {
      if (source === "youtube_search") source = "youtube_search_rss_fill";
    }
  }

  if (videos.length === 0) {
    videos = CURATED_STATIC_VIDEOS.slice(0, MAX_RETURN);
    fallbackLevel = 3;
    source = "curated_static";
    banner = banner
      ? `${banner}\n已改為平台精選內容（非即時、非個人化搜尋結果）。`
      : "目前無法連線取得主題影音，已改為平台精選內容（非即時）。";
  }

  if (fallbackLevel === 1 && videos.length > 0) {
    contentFlags = ["最新新聞影音"];
    badge = "最新新聞影音";
  } else if (fallbackLevel === 2 && videos.length > 0) {
    contentFlags = ["主題精選", "備援精選", "非即時內容"];
    badge = "主題精選 · 備援精選 · 非即時";
    if (!banner) {
      banner =
        "主題備援（Level 2）：已放寬至約 30 天內相關內容，與即時新聞未必同步。";
    }
  } else if (fallbackLevel === 3 && videos.length > 0) {
    contentFlags = ["主題精選", "備援精選", "非即時內容"];
    badge = "主題精選 · 備援精選 · 非即時";
    if (!banner) {
      banner =
        "最終保底（Level 3）：以下為寬鬆搜尋、官方頻道 RSS 或精選內容，可能較舊或非即時。";
    }
  }

  return res.status(200).json({
    ok: true,
    videos,
    source,
    fallbackLevel,
    contentFlags,
    badge,
    banner,
  });
}
