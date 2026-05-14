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

/** 備援清單至少幾部；與主題合併後最多回傳幾部（避免 payload 過大） */
const MIN_STATIC_FALLBACK = 15;
const MAX_STATIC_FALLBACK = 30;

type VideoCatalogEntry = Omit<VideoOut, "keyword">;

function catalogVideo(
  id: string,
  title: string,
  channel: string,
  publishedAt: string
): VideoCatalogEntry {
  return {
    id,
    title,
    channel,
    publishedAt,
    url: `https://www.youtube.com/watch?v=${id}`,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

/**
 * 公開長期影片的固定 metadata（不依賴 RSS／第三方即時 API）。
 * 備援時依主題從下列清單挑片，keyword 會帶入主題標籤。
 */
const VIDEO_CATALOG: Record<string, VideoCatalogEntry> = Object.fromEntries(
  [
    catalogVideo(
      "M7lc1UVf-VE",
      "YouTube Developers Live: Embedded Web Player Customization",
      "Google for Developers",
      "2012-06-22T00:00:00.000Z"
    ),
    catalogVideo(
      "wKJ9KzGQq0w",
      "Go Google: Google Drive",
      "Google",
      "2012-04-24T00:00:00.000Z"
    ),
    catalogVideo(
      "5MgBikgcWnY",
      "The first 20 hours -- how to learn anything | Josh Kaufman | TEDxCSU",
      "TEDx Talks",
      "2013-03-14T00:00:00.000Z"
    ),
    catalogVideo("jNQXAC9IVRw", "Me at the zoo", "jawed", "2005-04-24T00:00:00.000Z"),
    catalogVideo(
      "SkVqJ1SGeL0",
      "Caminandes 3: Llamigos",
      "Blender",
      "2016-01-30T00:00:00.000Z"
    ),
    catalogVideo(
      "2LqzF5WauAw",
      "Interstellar (2014) | Original Theatrical Trailer 1 | Paramount Movies",
      "Interstellar Movie",
      "2014-05-16T00:00:00.000Z"
    ),
    catalogVideo(
      "ScNNfyq3d_w",
      "CASTLE OF GLASS [Official Music Video] [4K Upgrade] - Linkin Park",
      "Linkin Park",
      "2012-11-14T00:00:00.000Z"
    ),
    catalogVideo(
      "eVTXPUF4Oz4",
      "In The End [Official HD Music Video] - Linkin Park",
      "Linkin Park",
      "2009-10-26T00:00:00.000Z"
    ),
    catalogVideo(
      "60ItHLz5WEA",
      "Alan Walker - Faded",
      "Alan Walker",
      "2015-12-04T00:00:00.000Z"
    ),
    catalogVideo(
      "OPf0YbXqDm0",
      "Mark Ronson - Uptown Funk (Official Video) ft. Bruno Mars",
      "Mark Ronson",
      "2014-11-19T00:00:00.000Z"
    ),
    catalogVideo(
      "3GwjfUFyY6M",
      "Kool & The Gang - Celebration",
      "Kool & The Gang - Topic",
      "2013-08-01T00:00:00.000Z"
    ),
    catalogVideo(
      "9bZkp7q19f0",
      "PSY - GANGNAM STYLE(강남스타일) M/V",
      "officialpsy",
      "2012-07-15T00:00:00.000Z"
    ),
    catalogVideo(
      "kJQP7kiw5Fk",
      "Luis Fonsi - Despacito ft. Daddy Yankee",
      "LuisFonsiVEVO",
      "2017-01-13T00:00:00.000Z"
    ),
    catalogVideo(
      "CevxZvSJLk8",
      "Katy Perry - Roar (Official)",
      "KatyPerryVEVO",
      "2013-09-05T00:00:00.000Z"
    ),
    catalogVideo(
      "0KSOMA3QBU0",
      "Katy Perry - Dark Horse ft. Juicy J",
      "KatyPerryVEVO",
      "2013-12-19T00:00:00.000Z"
    ),
    catalogVideo(
      "pt8VYOfr8To",
      "Britney Spears - Work Bitch (Official Video)",
      "BritneySpearsVEVO",
      "2013-09-15T00:00:00.000Z"
    ),
    catalogVideo(
      "e-ORhEE9VVg",
      "Taylor Swift - Blank Space",
      "Taylor Swift",
      "2014-11-10T00:00:00.000Z"
    ),
    catalogVideo(
      "nfWlot6h_JM",
      "Taylor Swift - Shake It Off",
      "Taylor Swift",
      "2014-08-18T00:00:00.000Z"
    ),
    catalogVideo(
      "YQHsXMglC9A",
      "Adele - Hello (Official Music Video)",
      "Adele",
      "2015-10-22T00:00:00.000Z"
    ),
    catalogVideo(
      "SlPhMPnQ58k",
      "Maroon 5 - Memories (Official Video)",
      "Maroon5VEVO",
      "2019-09-30T00:00:00.000Z"
    ),
    catalogVideo(
      "RgKAFK5djSk",
      "Wiz Khalifa - See You Again ft. Charlie Puth [Official Video]",
      "Wiz Khalifa Music",
      "2015-04-06T00:00:00.000Z"
    ),
    catalogVideo(
      "PT2_F-1esPk",
      "The Chainsmokers - Closer (Lyric) ft. Halsey",
      "ChainsmokersVEVO",
      "2016-07-29T00:00:00.000Z"
    ),
    catalogVideo(
      "RBumgq5yVrA",
      "Passenger | Let Her Go (Official Video)",
      "Passenger",
      "2012-07-25T00:00:00.000Z"
    ),
    catalogVideo(
      "bx1Bh8ZvH84",
      "Oasis - Wonderwall (Official Video)",
      "OasisVEVO",
      "1995-10-02T00:00:00.000Z"
    ),
    catalogVideo(
      "fJ9rUzIMcZQ",
      "Queen – Bohemian Rhapsody (Official Video Remastered)",
      "Queen Official",
      "2008-08-01T00:00:00.000Z"
    ),
    catalogVideo(
      "hTWKbfoikeg",
      "Nirvana - Smells Like Teen Spirit (Official Music Video)",
      "NirvanaVEVO",
      "1991-09-29T00:00:00.000Z"
    ),
    catalogVideo(
      "YgSPaXgAdzE",
      "Beck - Loser (Official Music Video)",
      "BeckVEVO",
      "1993-03-01T00:00:00.000Z"
    ),
    catalogVideo(
      "YqeW9_5kURI",
      "Major Lazer & DJ Snake - Lean On (feat. MØ) [Official 4K Music Video]",
      "Major Lazer Official",
      "2015-03-23T00:00:00.000Z"
    ),
    catalogVideo(
      "L_jWHffIx5E",
      "Smash Mouth - All Star",
      "SmashMouthVEVO",
      "2009-06-16T00:00:00.000Z"
    ),
    catalogVideo(
      "ZyhrYis509A",
      "Aqua - Barbie Girl (Official Music Video)",
      "AquaVEVO",
      "1997-01-01T00:00:00.000Z"
    ),
    catalogVideo(
      "ysz5S6PUM-U",
      "Chilled Serenity #5",
      "Xquisite",
      "2020-01-01T00:00:00.000Z"
    ),
    catalogVideo(
      "E8gmARGvPlI",
      "Wham! - Last Christmas (Official Video)",
      "WhamVEVO",
      "1984-12-03T00:00:00.000Z"
    ),
    catalogVideo(
      "dQw4w9WgXcQ",
      "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
      "Rick Astley",
      "2020-10-29T00:00:00.000Z"
    ),
  ].map((v) => [v.id, v])
);

type StaticThemeKey =
  | "nba"
  | "mlb"
  | "sport"
  | "crypto"
  | "finance"
  | "taiwan_world"
  | "intl"
  | "entertainment"
  | "movie"
  | "anime"
  | "music"
  | "fashion"
  | "tech"
  | "gaming"
  | "general";

/** 每主題至少 15 個 id；內容與主題為「氛圍／類型」對應（備援用） */
const STATIC_THEME_IDS: Record<StaticThemeKey, string[]> = {
  nba: [
    "OPf0YbXqDm0",
    "3GwjfUFyY6M",
    "9bZkp7q19f0",
    "CevxZvSJLk8",
    "kJQP7kiw5Fk",
    "nfWlot6h_JM",
    "YqeW9_5kURI",
    "L_jWHffIx5E",
    "0KSOMA3QBU0",
    "pt8VYOfr8To",
    "RgKAFK5djSk",
    "SlPhMPnQ58k",
    "YQHsXMglC9A",
    "e-ORhEE9VVg",
    "ZyhrYis509A",
    "dQw4w9WgXcQ",
  ],
  mlb: [
    "RBumgq5yVrA",
    "bx1Bh8ZvH84",
    "fJ9rUzIMcZQ",
    "hTWKbfoikeg",
    "OPf0YbXqDm0",
    "3GwjfUFyY6M",
    "L_jWHffIx5E",
    "RgKAFK5djSk",
    "CevxZvSJLk8",
    "kJQP7kiw5Fk",
    "9bZkp7q19f0",
    "YqeW9_5kURI",
    "60ItHLz5WEA",
    "eVTXPUF4Oz4",
    "ScNNfyq3d_w",
    "E8gmARGvPlI",
  ],
  sport: [
    "OPf0YbXqDm0",
    "3GwjfUFyY6M",
    "L_jWHffIx5E",
    "RgKAFK5djSk",
    "CevxZvSJLk8",
    "9bZkp7q19f0",
    "kJQP7kiw5Fk",
    "nfWlot6h_JM",
    "YqeW9_5kURI",
    "0KSOMA3QBU0",
    "pt8VYOfr8To",
    "SlPhMPnQ58k",
    "YQHsXMglC9A",
    "e-ORhEE9VVg",
    "PT2_F-1esPk",
    "dQw4w9WgXcQ",
  ],
  crypto: [
    "5MgBikgcWnY",
    "M7lc1UVf-VE",
    "wKJ9KzGQq0w",
    "60ItHLz5WEA",
    "eVTXPUF4Oz4",
    "ScNNfyq3d_w",
    "YgSPaXgAdzE",
    "RBumgq5yVrA",
    "SlPhMPnQ58k",
    "YQHsXMglC9A",
    "PT2_F-1esPk",
    "nfWlot6h_JM",
    "e-ORhEE9VVg",
    "kJQP7kiw5Fk",
    "YqeW9_5kURI",
    "OPf0YbXqDm0",
  ],
  finance: [
    "5MgBikgcWnY",
    "M7lc1UVf-VE",
    "wKJ9KzGQq0w",
    "ScNNfyq3d_w",
    "eVTXPUF4Oz4",
    "RBumgq5yVrA",
    "YgSPaXgAdzE",
    "hTWKbfoikeg",
    "SlPhMPnQ58k",
    "YQHsXMglC9A",
    "PT2_F-1esPk",
    "bx1Bh8ZvH84",
    "fJ9rUzIMcZQ",
    "60ItHLz5WEA",
    "RgKAFK5djSk",
    "nfWlot6h_JM",
  ],
  taiwan_world: [
    "YQHsXMglC9A",
    "RgKAFK5djSk",
    "kJQP7kiw5Fk",
    "e-ORhEE9VVg",
    "nfWlot6h_JM",
    "PT2_F-1esPk",
    "RBumgq5yVrA",
    "YqeW9_5kURI",
    "OPf0YbXqDm0",
    "SlPhMPnQ58k",
    "CevxZvSJLk8",
    "0KSOMA3QBU0",
    "bx1Bh8ZvH84",
    "fJ9rUzIMcZQ",
    "hTWKbfoikeg",
    "dQw4w9WgXcQ",
  ],
  intl: [
    "ScNNfyq3d_w",
    "eVTXPUF4Oz4",
    "RgKAFK5djSk",
    "YqeW9_5kURI",
    "kJQP7kiw5Fk",
    "YQHsXMglC9A",
    "PT2_F-1esPk",
    "RBumgq5yVrA",
    "bx1Bh8ZvH84",
    "fJ9rUzIMcZQ",
    "hTWKbfoikeg",
    "e-ORhEE9VVg",
    "nfWlot6h_JM",
    "SlPhMPnQ58k",
    "60ItHLz5WEA",
    "OPf0YbXqDm0",
  ],
  entertainment: [
    "pt8VYOfr8To",
    "e-ORhEE9VVg",
    "nfWlot6h_JM",
    "0KSOMA3QBU0",
    "CevxZvSJLk8",
    "ZyhrYis509A",
    "9bZkp7q19f0",
    "kJQP7kiw5Fk",
    "2LqzF5WauAw",
    "YQHsXMglC9A",
    "SlPhMPnQ58k",
    "PT2_F-1esPk",
    "OPf0YbXqDm0",
    "RgKAFK5djSk",
    "dQw4w9WgXcQ",
    "YqeW9_5kURI",
  ],
  movie: [
    "2LqzF5WauAw",
    "fJ9rUzIMcZQ",
    "hTWKbfoikeg",
    "ScNNfyq3d_w",
    "YQHsXMglC9A",
    "e-ORhEE9VVg",
    "SlPhMPnQ58k",
    "PT2_F-1esPk",
    "0KSOMA3QBU0",
    "pt8VYOfr8To",
    "OPf0YbXqDm0",
    "kJQP7kiw5Fk",
    "9bZkp7q19f0",
    "CevxZvSJLk8",
    "RgKAFK5djSk",
    "nfWlot6h_JM",
  ],
  anime: [
    "SkVqJ1SGeL0",
    "ysz5S6PUM-U",
    "ZyhrYis509A",
    "9bZkp7q19f0",
    "CevxZvSJLk8",
    "0KSOMA3QBU0",
    "nfWlot6h_JM",
    "e-ORhEE9VVg",
    "kJQP7kiw5Fk",
    "YqeW9_5kURI",
    "L_jWHffIx5E",
    "SlPhMPnQ58k",
    "PT2_F-1esPk",
    "dQw4w9WgXcQ",
    "pt8VYOfr8To",
    "RgKAFK5djSk",
  ],
  music: [
    "kJQP7kiw5Fk",
    "9bZkp7q19f0",
    "e-ORhEE9VVg",
    "ZyhrYis509A",
    "RgKAFK5djSk",
    "YQHsXMglC9A",
    "SlPhMPnQ58k",
    "OPf0YbXqDm0",
    "3GwjfUFyY6M",
    "CevxZvSJLk8",
    "60ItHLz5WEA",
    "nfWlot6h_JM",
    "YqeW9_5kURI",
    "L_jWHffIx5E",
    "dQw4w9WgXcQ",
    "PT2_F-1esPk",
  ],
  fashion: [
    "pt8VYOfr8To",
    "e-ORhEE9VVg",
    "nfWlot6h_JM",
    "0KSOMA3QBU0",
    "CevxZvSJLk8",
    "ZyhrYis509A",
    "YQHsXMglC9A",
    "SlPhMPnQ58k",
    "OPf0YbXqDm0",
    "9bZkp7q19f0",
    "kJQP7kiw5Fk",
    "YqeW9_5kURI",
    "PT2_F-1esPk",
    "RgKAFK5djSk",
    "E8gmARGvPlI",
    "dQw4w9WgXcQ",
  ],
  tech: [
    "M7lc1UVf-VE",
    "wKJ9KzGQq0w",
    "5MgBikgcWnY",
    "jNQXAC9IVRw",
    "SkVqJ1SGeL0",
    "60ItHLz5WEA",
    "eVTXPUF4Oz4",
    "ScNNfyq3d_w",
    "YgSPaXgAdzE",
    "RBumgq5yVrA",
    "SlPhMPnQ58k",
    "YQHsXMglC9A",
    "PT2_F-1esPk",
    "nfWlot6h_JM",
    "OPf0YbXqDm0",
    "L_jWHffIx5E",
  ],
  gaming: [
    "SkVqJ1SGeL0",
    "L_jWHffIx5E",
    "60ItHLz5WEA",
    "9bZkp7q19f0",
    "M7lc1UVf-VE",
    "wKJ9KzGQq0w",
    "jNQXAC9IVRw",
    "dQw4w9WgXcQ",
    "YqeW9_5kURI",
    "OPf0YbXqDm0",
    "CevxZvSJLk8",
    "kJQP7kiw5Fk",
    "nfWlot6h_JM",
    "e-ORhEE9VVg",
    "SlPhMPnQ58k",
    "YQHsXMglC9A",
  ],
  general: [
    "M7lc1UVf-VE",
    "5MgBikgcWnY",
    "jNQXAC9IVRw",
    "2LqzF5WauAw",
    "YQHsXMglC9A",
    "RgKAFK5djSk",
    "kJQP7kiw5Fk",
    "e-ORhEE9VVg",
    "OPf0YbXqDm0",
    "9bZkp7q19f0",
    "ScNNfyq3d_w",
    "SkVqJ1SGeL0",
    "60ItHLz5WEA",
    "SlPhMPnQ58k",
    "PT2_F-1esPk",
    "RBumgq5yVrA",
    "fJ9rUzIMcZQ",
    "hTWKbfoikeg",
    "YqeW9_5kURI",
    "nfWlot6h_JM",
  ],
};

function videoFromCatalog(id: string, keyword: string): VideoOut | null {
  const base = VIDEO_CATALOG[id];
  if (!base) return null;
  return { ...base, keyword };
}

function idsToThemedVideos(ids: string[], keyword: string): VideoOut[] {
  const out: VideoOut[] = [];
  for (const id of ids) {
    const v = videoFromCatalog(id, keyword);
    if (v) out.push(v);
  }
  return out;
}

function scanTextForStaticThemes(text: string, push: (t: StaticThemeKey) => void) {
  const t = text.trim();
  if (!t) return;
  const L = t.toLowerCase();

  if (t === "NBA" || t === "Curry" || L.includes("nba") || L.includes("curry"))
    push("nba");
  if (t === "MLB" || t === "大谷翔平" || L.includes("mlb") || L.includes("ohtani"))
    push("mlb");
  if (t === "季後賽" || L.includes("季後賽") || L.includes("playoff")) {
    push("sport");
    push("nba");
    push("mlb");
  }

  if (
    t === "幣圈" ||
    t === "BTC" ||
    t === "ETH" ||
    L.includes("btc") ||
    L.includes("eth") ||
    L.includes("比特幣") ||
    L.includes("加密")
  )
    push("crypto");

  if (t === "財經" || t === "美股" || t === "ETF" || t === "台股" || L.includes("台股"))
    push("finance");

  if (t === "台灣熱門" || (L.includes("台灣") && !L.includes("台股"))) push("taiwan_world");
  if (t === "戰爭" || t === "國際" || L.includes("戰爭") || L.includes("國際"))
    push("intl");

  if (t === "影視" || L.includes("影視") || L.includes("娛樂")) push("entertainment");
  if (t === "電影" || L.includes("電影") || L.includes("票房")) push("movie");
  if (t === "動漫" || L.includes("動漫") || L.includes("動畫")) push("anime");
  if (t === "音樂" || L.includes("音樂") || L.includes("演唱會")) push("music");
  if (t === "潮流" || L.includes("潮流") || L.includes("球鞋") || L.includes("穿搭"))
    push("fashion");
  if (t === "科技" || L.includes("科技") || L.includes("半導體") || L.includes("iphone"))
    push("tech");
  if (t === "遊戲" || L.includes("遊戲") || L.includes("steam") || L.includes("電競"))
    push("gaming");
}

function staticThemeOrderForLabels(labels: string[], custom: string): StaticThemeKey[] {
  const order: StaticThemeKey[] = [];
  const seen = new Set<StaticThemeKey>();
  const push = (key: StaticThemeKey) => {
    if (seen.has(key)) return;
    seen.add(key);
    order.push(key);
  };

  for (const lb of labels) scanTextForStaticThemes(lb, push);
  scanTextForStaticThemes(custom, push);

  if (order.length === 0) push("general");
  return order;
}

function keywordLabelForTheme(theme: StaticThemeKey): string {
  const map: Record<StaticThemeKey, string> = {
    nba: "NBA",
    mlb: "MLB／棒球",
    sport: "季後賽／體育",
    crypto: "幣圈",
    finance: "財經／股市",
    taiwan_world: "台灣／華語熱門",
    intl: "國際／局勢",
    entertainment: "影視娛樂",
    movie: "電影",
    anime: "動漫",
    music: "音樂",
    fashion: "潮流",
    tech: "科技",
    gaming: "遊戲",
    general: "綜合",
  };
  return map[theme] || "綜合";
}

/** 依使用者主題合併備援池，去重後至少 {@link MIN_STATIC_FALLBACK} 部 */
function buildThemedStaticVideos(labels: string[], custom: string): VideoOut[] {
  const themes = staticThemeOrderForLabels(labels, custom);
  const seen = new Set<string>();
  const out: VideoOut[] = [];

  const appendPool = (theme: StaticThemeKey) => {
    const label = keywordLabelForTheme(theme);
    const ids = STATIC_THEME_IDS[theme] || STATIC_THEME_IDS.general;
    for (const v of idsToThemedVideos(ids, `備援 · ${label}`)) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      out.push(v);
      if (out.length >= MAX_STATIC_FALLBACK) return;
    }
  };

  for (const th of themes) {
    appendPool(th);
    if (out.length >= MAX_STATIC_FALLBACK) break;
  }

  if (out.length < MIN_STATIC_FALLBACK) appendPool("general");

  if (out.length < MIN_STATIC_FALLBACK) {
    for (const id of STATIC_THEME_IDS.general) {
      if (seen.has(id)) continue;
      const v = videoFromCatalog(id, "備援 · 綜合");
      if (!v) continue;
      seen.add(id);
      out.push(v);
      if (out.length >= MIN_STATIC_FALLBACK) break;
    }
  }

  return out.slice(0, MAX_STATIC_FALLBACK);
}

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
    const themeLabels = labels.length ? labels : ["台灣熱門", "財經"];
    videos = buildThemedStaticVideos(themeLabels, custom);
    source = "static_fallback";
    const extra = "RSS 無法取得最新影片，已改顯示與主題相關的備援精選";
    banner = banner ? `${banner}；${extra}` : extra;
  }

  return res.status(200).json({
    ok: true,
    videos,
    source,
    banner,
  });
}
