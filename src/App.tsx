import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

type Tab = "home" | "player" | "video" | "favorites" | "settings";

type NewsItem = {
  id: string;
  title: string;
  link: string;
  source: string;
  pubDate: string;
  selected: boolean;
  favorite: boolean;
};

type AiDuration = 1 | 3 | 5;

type AiHighlight = {
  level: string;
  title: string;
  summary: string;
};

type VideoItem = {
  id: string;
  title: string;
  link: string;
  channel: string;
  thumbnail: string;
  keyword: string;
  publishedAt: string;
};

type Topic = {
  label: string;
  query: string;
  icon: string;
};

const topics: Topic[] = [
  { label: "NBA", query: "NBA", icon: "🏀" },
  { label: "MLB", query: "MLB", icon: "⚾" },
  { label: "Curry", query: "Stephen Curry OR Curry 勇士", icon: "🔥" },
  { label: "大谷翔平", query: "大谷翔平 OR Shohei Ohtani", icon: "⚾" },
  { label: "季後賽", query: "NBA 季後賽 OR MLB 季後賽", icon: "🏆" },
  { label: "幣圈", query: "加密貨幣 OR 幣圈", icon: "₿" },
  { label: "BTC", query: "BTC OR 比特幣", icon: "₿" },
  { label: "ETH", query: "ETH OR 以太坊", icon: "💎" },
  { label: "台股", query: "台股 OR 台積電", icon: "📈" },
  { label: "ETF", query: "ETF OR 0050 OR 高股息", icon: "💰" },
  { label: "美股", query: "美股 OR Nvidia OR Tesla OR Apple", icon: "🇺🇸" },
  { label: "財經", query: "Fed OR 利率 OR CPI OR 降息", icon: "🏦" },
  { label: "國際", query: "國際局勢 OR 全球新聞", icon: "🌍" },
  { label: "戰爭", query: "俄烏戰爭 OR 烏克蘭戰爭 OR 以色列 OR 中東戰爭", icon: "⚠️" },
  { label: "台灣熱門", query: "台灣 熱門新聞 OR 台灣 即時", icon: "🇹🇼" },
  { label: "影視", query: "影視 OR 娛樂新聞", icon: "📺" },
  { label: "電影", query: "電影 OR 票房 OR Netflix", icon: "🎬" },
  { label: "動漫", query: "動漫 OR 動畫 OR 漫畫", icon: "🌀" },
  { label: "音樂", query: "音樂 OR 演唱會 OR 新歌", icon: "🎵" },
  { label: "潮流", query: "潮流 OR 球鞋 OR 穿搭", icon: "👟" },
  { label: "科技", query: "科技 OR AI OR iPhone OR 半導體", icon: "🤖" },
  { label: "遊戲", query: "遊戲 OR Steam OR Switch OR PS5 OR 電競", icon: "🎮" },
];

function cleanTitle(title: string) {
  return title.replace(/\s-\s.*$/, "").trim();
}

/** AI 精華：相同選取結果快取時間 */
const AI_SUMMARY_CACHE_KEY = "pns_ai_summary_v1";
const AI_SUMMARY_CACHE_MS = 30 * 60 * 1000;

function normalizeKey(title: string) {
  return title.replace(/[，。！？、\s\-｜|:：]/g, "").slice(0, 28);
}

/** 只顯示此時間內的新聞（預設 48 小時＝不含兩天前更早的稿件） */
const NEWS_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
/** 多抓一些 RSS 條目再過濾日期，避免過濾後筆數太少 */
const NEWS_RSS_ITEM_SCAN = 280;
/** 合併後最多顯示幾則 */
const NEWS_LIST_MAX = 48;
/**
 * 選中主題數 ≥ 此值且無自訂關鍵字時，改為每主題各抓 RSS 再合併。
 * （一次用超長 OR 查 Google News 常只回極少筆或 URL 過長）
 */
const NEWS_MULTI_TOPIC_MIN = 4;
/** 多主題模式下，每個主題最多先取幾則 RSS item 再合併過濾 */
const NEWS_PER_TOPIC_ITEM_SCAN = 130;

function parseNewsPubDate(raw: string | null | undefined): Date | null {
  if (!raw?.trim()) return null;
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

function isNewsFreshEnough(pubDateRaw: string, nowMs: number): boolean {
  const d = parseNewsPubDate(pubDateRaw);
  if (!d) return false;
  const age = nowMs - d.getTime();
  return age >= 0 && age <= NEWS_MAX_AGE_MS;
}

/** 已選新聞（最多 5 則）+ 稿長 快取用 fingerprint */
function aiSummaryCacheFingerprint(items: NewsItem[], duration: AiDuration): string {
  const base = [...items]
    .slice(0, 5)
    .map((n) => `${normalizeKey(n.title)}|${n.source.trim()}`)
    .sort()
    .join("\0");
  return `${duration}\0${base}`;
}

function formatVideoPublished(iso: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("zh-TW", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** 從 YouTube watch URL 取出 11 字元 video id（補足 API 偶發缺 id） */
function youtubeVideoIdFromUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, "https://www.youtube.com");
    const v = u.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
  } catch {
    /* ignore */
  }
  const m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})(?:&|$)/);
  return m?.[1] ?? null;
}

type RawVideoPayload = {
  id?: string;
  title?: string;
  url?: string;
  channel?: string;
  thumbnail?: string;
  publishedAt?: string;
  keyword?: string;
};

const VIDEO_CACHE_KEY = "pns_video_pack_v2";
const VIDEO_HOUR_MS = 60 * 60 * 1000;

function videoCacheFingerprint(labels: string[], custom: string) {
  return `${custom.trim()}|${[...labels].sort().join("\0")}`;
}

function readVideoCache():
  | {
      fp: string;
      savedAt: number;
      videos: VideoItem[];
      banner: string | null;
      badge: string | null;
    }
  | null {
  try {
    const raw = localStorage.getItem(VIDEO_CACHE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as {
      fp?: string;
      savedAt?: number;
      videos?: VideoItem[];
      banner?: string | null;
      badge?: string | null;
    };
    if (!o?.fp || typeof o.savedAt !== "number" || !Array.isArray(o.videos)) return null;
    return {
      fp: o.fp,
      savedAt: o.savedAt,
      videos: o.videos,
      banner: o.banner ?? null,
      badge: typeof o.badge === "string" ? o.badge : null,
    };
  } catch {
    return null;
  }
}

function writeVideoCache(
  fp: string,
  videos: VideoItem[],
  banner: string | null,
  badge: string | null
) {
  try {
    localStorage.setItem(
      VIDEO_CACHE_KEY,
      JSON.stringify({ fp, savedAt: Date.now(), videos, banner, badge })
    );
  } catch {
    /* ignore quota */
  }
}

async function parseVideosApiResponse(res: Response): Promise<
  | {
      ok: true;
      videos: RawVideoPayload[];
      banner?: string;
      badge?: string;
      source?: string;
    }
  | { ok: false; error: string; code?: string }
> {
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, error: `無法解析伺服器回應（HTTP ${res.status}）` };
  }

  const d = data as Record<string, unknown>;

  if (!res.ok) {
    const errMsg =
      typeof d.error === "string"
        ? d.error
        : typeof d.message === "string"
          ? d.message
          : `請求失敗（HTTP ${res.status}）`;
    return {
      ok: false,
      error: errMsg,
      code: typeof d.code === "string" ? d.code : undefined,
    };
  }

  if (d.ok === false) {
    return {
      ok: false,
      error: typeof d.error === "string" ? d.error : "未知錯誤",
      code: typeof d.code === "string" ? d.code : undefined,
    };
  }

  if (d.ok === true && Array.isArray(d.videos)) {
    return {
      ok: true,
      videos: d.videos as RawVideoPayload[],
      banner: typeof d.banner === "string" ? d.banner : undefined,
      badge: typeof d.badge === "string" ? d.badge : undefined,
      source: typeof d.source === "string" ? d.source : undefined,
    };
  }

  if (Array.isArray(data)) {
    return { ok: true, videos: data as RawVideoPayload[] };
  }

  return { ok: false, error: "伺服器回傳格式無法辨識（需 ok + videos 或陣列）" };
}

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [selectedTopics, setSelectedTopics] = useState<string[]>([
    "NBA",
    "MLB",
    "大谷翔平",
    "Curry",
    "BTC",
  ]);
  const [customKeyword, setCustomKeyword] = useState("");
  const [news, setNews] = useState<NewsItem[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [favoriteLinks, setFavoriteLinks] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoBanner, setVideoBanner] = useState<string | null>(null);
  const [videoBadge, setVideoBadge] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState("");
  const [speed, setSpeed] = useState(1.2);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState("");
  const [aiScript, setAiScript] = useState("");
  const [aiHighlights, setAiHighlights] = useState<AiHighlight[]>([]);
  const [aiJsonFallback, setAiJsonFallback] = useState(false);
  const [aiDuration, setAiDuration] = useState<AiDuration>(1);
  const [selectedScriptDuration, setSelectedScriptDuration] = useState<
    AiDuration | null
  >(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const topicSelectionKeyRef = useRef<string | null>(null);

  const selectedNews = news.filter((n) => n.selected);
  const favoriteNews = news.filter((n) => n.favorite);

  const selectedTopicObjects = useMemo(
    () => topics.filter((t) => selectedTopics.includes(t.label)),
    [selectedTopics]
  );

  useEffect(() => {
    const saved = localStorage.getItem("favoriteLinks");
    if (saved) setFavoriteLinks(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem("favoriteLinks", JSON.stringify(favoriteLinks));
  }, [favoriteLinks]);

  useEffect(() => {
    const loadVoices = () => {
      const allVoices = window.speechSynthesis.getVoices();
      setVoices(allVoices);

      if (!voiceName && allVoices.length > 0) {
        const preferredVoice =
          allVoices.find(
            (v) =>
              v.lang.includes("zh") &&
              (v.name.includes("語舒") || v.name.includes("黎澈"))
          ) ||
          allVoices.find((v) => v.lang.includes("zh")) ||
          allVoices[0];

        setVoiceName(preferredVoice.name);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    setTimeout(loadVoices, 1000);
  }, []);

  const fetchNews = async () => {
    setLoading(true);

    const custom = customKeyword.trim();
    const topicObjs = selectedTopicObjects;

    try {
      const parser = new DOMParser();
      const nowMs = Date.now();
      let rawItems: Element[] = [];

      const usePerTopic = !custom && topicObjs.length >= NEWS_MULTI_TOPIC_MIN;

      if (usePerTopic) {
        const responseTexts = await Promise.all(
          topicObjs.map((t) =>
            fetch(`/api/news?q=${encodeURIComponent(t.query)}`).then((r) =>
              r.text()
            )
          )
        );
        for (const xmlText of responseTexts) {
          const xml = parser.parseFromString(xmlText, "text/xml");
          rawItems.push(
            ...Array.from(xml.querySelectorAll("item")).slice(
              0,
              NEWS_PER_TOPIC_ITEM_SCAN
            )
          );
        }
      } else {
        const query =
          custom ||
          (topicObjs.length > 0
            ? topicObjs.map((t) => `(${t.query})`).join(" OR ")
            : "今日熱門新聞");
        const res = await fetch(`/api/news?q=${encodeURIComponent(query)}`);
        const xmlText = await res.text();
        const xml = parser.parseFromString(xmlText, "text/xml");
        rawItems = Array.from(xml.querySelectorAll("item")).slice(
          0,
          NEWS_RSS_ITEM_SCAN
        );
      }

      const items = rawItems.slice(0, 900);

      type Row = NewsItem & { sortTime: number };
      const dated: Row[] = items
        .map((item, index) => {
          const rawTitle = item.querySelector("title")?.textContent || "無標題";
          const title = cleanTitle(rawTitle);
          const link = item.querySelector("link")?.textContent || "";
          const source =
            item.querySelector("source")?.textContent ||
            rawTitle.split(" - ").pop() ||
            "Google News";
          const pubDate = item.querySelector("pubDate")?.textContent || "";
          const t = parseNewsPubDate(pubDate)?.getTime() ?? 0;

          return {
            id: link || `${title}-${index}`,
            title,
            link,
            source,
            pubDate,
            selected: false,
            favorite: favoriteLinks.includes(link),
            sortTime: t,
          };
        })
        .filter((row) => isNewsFreshEnough(row.pubDate, nowMs))
        .sort((a, b) => b.sortTime - a.sortTime);

      const seenTitles = new Set<string>();
      const seenLinks = new Set<string>();
      const parsedNews: NewsItem[] = [];
      for (const row of dated) {
        if (row.link && seenLinks.has(row.link)) continue;
        const key = normalizeKey(row.title);
        if (!key || seenTitles.has(key)) continue;
        seenTitles.add(key);
        if (row.link) seenLinks.add(row.link);
        parsedNews.push({
          id: row.id,
          title: row.title,
          link: row.link,
          source: row.source,
          pubDate: row.pubDate,
          selected: parsedNews.length < 5,
          favorite: row.favorite,
        });
        if (parsedNews.length >= NEWS_LIST_MAX) break;
      }

      setNews(parsedNews);
      setAiScript("");
      setAiHighlights([]);
      setAiJsonFallback(false);
      setSelectedScriptDuration(null);
      setAiError(null);
      setLastUpdated(
        new Date().toLocaleTimeString("zh-TW", {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    } catch (error) {
      alert("新聞讀取失敗，請稍後再試");
      console.error(error);
    }

    setLoading(false);
  };

  const loadVideos = useCallback(
    async (force: boolean) => {
      const labels = selectedTopicObjects.map((t) => t.label);
      const custom = customKeyword.trim();
      const fp = videoCacheFingerprint(labels, custom);

      if (!force) {
        const hit = readVideoCache();
        if (
          hit &&
          hit.fp === fp &&
          Date.now() - hit.savedAt < VIDEO_HOUR_MS &&
          hit.videos.length > 0
        ) {
          setVideos(hit.videos);
          setVideoBanner(hit.banner);
          setVideoBadge(hit.badge);
          return;
        }
      }

      setVideoLoading(true);
      setVideoBanner(null);
      setVideoBadge(null);

      try {
        const topicsParam = encodeURIComponent(labels.join(","));
        const customParam = encodeURIComponent(custom);
        const res = await fetch(
          `/api/videos?pack=1&topics=${topicsParam}&custom=${customParam}`
        );
        const parsed = await parseVideosApiResponse(res);

        if (!parsed.ok) {
          setVideos([]);
          setVideoBadge(null);
          setVideoBanner(parsed.error || "暫時無法載入影音，請稍後再試。");
          return;
        }

        const mapped: VideoItem[] = parsed.videos
          .map((v) => {
            const link = String(v.url || "").trim();
            const fromUrl = youtubeVideoIdFromUrl(link);
            const id =
              (v.id && String(v.id).trim()) ||
              fromUrl ||
              "";
            return { raw: v, link, id };
          })
          .filter((row) => row.link && row.id.length === 11)
          .map((row) => ({
            id: row.id,
            title: row.raw.title || "YouTube 影片",
            link: row.link,
            channel: row.raw.channel || "YouTube",
            thumbnail: row.raw.thumbnail || "",
            keyword: row.raw.keyword || "影音",
            publishedAt: row.raw.publishedAt || "",
          }));

        setVideos(mapped);

        const notice =
          parsed.banner ||
          (mapped.length === 0
            ? "目前沒有相關影音內容。請稍後再按「更新影音」或調整主題。"
            : null);
        setVideoBanner(notice);
        setVideoBadge(parsed.badge ?? null);

        if (mapped.length > 0) {
          writeVideoCache(fp, mapped, parsed.banner ?? null, parsed.badge ?? null);
        }
      } catch (e) {
        console.error(e);
        setVideos([]);
        setVideoBadge(null);
        setVideoBanner(
          e instanceof Error ? e.message : "載入影音時發生錯誤，請稍後再試。"
        );
      } finally {
        setVideoLoading(false);
      }
    },
    [selectedTopicObjects, customKeyword]
  );

  useEffect(() => {
    void fetchNews();
  }, []);

  useEffect(() => {
    const key = [...selectedTopics].sort().join("\0");

    if (topicSelectionKeyRef.current === null) {
      topicSelectionKeyRef.current = key;
      return;
    }

    if (topicSelectionKeyRef.current === key) {
      return;
    }

    topicSelectionKeyRef.current = key;

    const timer = window.setTimeout(() => {
      void fetchNews();
    }, 450);

    return () => window.clearTimeout(timer);
  }, [selectedTopics]);

  useEffect(() => {
    if (tab !== "video") return;
    void loadVideos(false);
  }, [tab, loadVideos]);

  const updateMyNews = () => {
    setTab("home");
    void fetchNews();
  };

  const updateVideos = () => {
    setTab("video");
    void loadVideos(true);
  };

  const toggleTopic = (label: string) => {
    setSelectedTopics((prev) =>
      prev.includes(label) ? prev.filter((t) => t !== label) : [...prev, label]
    );
  };

  const selectAllTopics = () => {
    setSelectedTopics(topics.map((t) => t.label));
  };

  const clearTopics = () => {
    setSelectedTopics([]);
  };

  const resetDefaultTopics = () => {
    setSelectedTopics(["NBA", "MLB", "大谷翔平", "Curry", "BTC"]);
  };

  const toggleNews = (id: string) => {
    setNews((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, selected: !item.selected } : item
      )
    );
  };

  const toggleFavorite = (item: NewsItem) => {
    setNews((prev) =>
      prev.map((n) => (n.id === item.id ? { ...n, favorite: !n.favorite } : n))
    );

    setFavoriteLinks((prev) =>
      prev.includes(item.link)
        ? prev.filter((link) => link !== item.link)
        : [...prev, item.link]
    );
  };

  const selectAll = () => {
    setNews((prev) => prev.map((item) => ({ ...item, selected: true })));
  };

  const clearAll = () => {
    setNews((prev) => prev.map((item) => ({ ...item, selected: false })));
  };

  const clearFavorites = () => {
    setFavoriteLinks([]);
    setNews((prev) => prev.map((item) => ({ ...item, favorite: false })));
  };

  const createSpeech = (rate: number) => {
    const useAi = aiScript.trim().length > 0;
    const text = useAi
      ? aiScript.trim()
      : selectedNews
          .map((n, i) => `第 ${i + 1} 則新聞，${n.title}`)
          .join("。");

    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = "zh-TW";
    speech.rate = rate;

    const selectedVoice = voices.find((v) => v.name === voiceName);
    if (selectedVoice) speech.voice = selectedVoice;

    speech.onstart = () => setIsSpeaking(true);
    speech.onend = () => setIsSpeaking(false);
    speech.onerror = () => setIsSpeaking(false);

    return speech;
  };

  const speakNews = () => {
    window.speechSynthesis.cancel();

    const hasAi = aiScript.trim().length > 0;
    if (!hasAi && selectedNews.length === 0) {
      alert("請先選擇要播放的新聞，或先產生 AI 新聞稿");
      return;
    }

    window.speechSynthesis.speak(createSpeech(speed));
  };

  const stopSpeak = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  const changeSpeed = (newSpeed: number) => {
    setSpeed(newSpeed);

    const canReplay =
      isSpeaking && (aiScript.trim().length > 0 || selectedNews.length > 0);
    if (canReplay) {
      window.speechSynthesis.cancel();
      setTimeout(() => {
        window.speechSynthesis.speak(createSpeech(newSpeed));
      }, 120);
    }
  };

  function buildGptPromptFromItems(items: NewsItem[]): string {
    const newsText = items
      .map(
        (item, index) =>
          `${index + 1}. ${item.title}\n來源：${item.source}\n連結：${item.link}`
      )
      .join("\n\n");

    return `
請幫我把以下新聞整理成「AI個人新聞台」精華版：

要求：
1. 用繁體中文
2. 先列出今日最重要的 5 個重點
3. 每則用 2～3 句話解釋
4. 幫我判斷重要程度：🔥重大 / ⚠️注意 / ℹ️一般
5. 最後給我一段適合語音朗讀的 1 分鐘新聞稿
6. 避免誇大投資建議，只做資訊整理與風險提醒

新聞列表：
${newsText}
`;
  }

  async function copyGptPromptToClipboard(items: NewsItem[]): Promise<boolean> {
    const prompt = buildGptPromptFromItems(items);
    await navigator.clipboard.writeText(prompt);
    return true;
  }

  const copyGptPrompt = async () => {
    if (selectedNews.length === 0) {
      alert("請先選擇新聞");
      return;
    }
    try {
      await copyGptPromptToClipboard(selectedNews);
      alert("已複製 GPT 精華整理 Prompt");
    } catch {
      alert("無法寫入剪貼簿，請檢查瀏覽器權限");
    }
  };

  const runGptFallbackClipboard = async () => {
    if (selectedNews.length === 0) return;
    try {
      await copyGptPromptToClipboard(selectedNews);
      alert("AI 暫時無法使用，已將 GPT 精華 Prompt 複製到剪貼簿，可貼到 ChatGPT 使用");
    } catch {
      alert("AI 暫時無法使用，且無法寫入剪貼簿，請改用「GPT 精華」按鈕手動複製");
    }
  };

  const fetchAiSummary = async () => {
    const picked = selectedNews.slice(0, 5);
    if (picked.length === 0) {
      alert("請先選擇新聞");
      return;
    }

    const duration = aiDuration;
    setAiError(null);
    const fp = aiSummaryCacheFingerprint(picked, duration);

    try {
      const raw = localStorage.getItem(AI_SUMMARY_CACHE_KEY);
      if (raw) {
        const o = JSON.parse(raw) as {
          fp?: string;
          savedAt?: number;
          duration?: number;
          script?: string;
          highlights?: AiHighlight[];
          jsonFallback?: boolean;
        };
        if (
          o.fp === fp &&
          typeof o.savedAt === "number" &&
          Date.now() - o.savedAt < AI_SUMMARY_CACHE_MS &&
          typeof o.script === "string" &&
          o.script.length > 0
        ) {
          setAiError(null);
          setAiScript(o.script);
          setAiHighlights(Array.isArray(o.highlights) ? o.highlights : []);
          setAiJsonFallback(Boolean(o.jsonFallback));
          setSelectedScriptDuration(
            o.duration === 3 || o.duration === 5 ? o.duration : 1
          );
          return;
        }
      }
    } catch {
      /* ignore */
    }

    setAiLoading(true);
    setAiScript("");
    setAiHighlights([]);
    setAiJsonFallback(false);
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          duration,
          items: picked.map((n) => ({ title: n.title, source: n.source })),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        script?: string;
        highlights?: AiHighlight[];
        jsonFallback?: boolean;
        duration?: number;
        error?: string;
        code?: string;
      };

      if (!data.ok) {
        const msg =
          data.code === "NO_KEY"
            ? "尚未設定 AI API Key"
            : data.error || "AI 精華產生失敗";
        setAiError(msg);
        if (data.code !== "NO_KEY") {
          await runGptFallbackClipboard();
        }
        return;
      }

      const script = String(data.script || "").trim();
      if (!script) {
        setAiError("AI 未回傳有效內容");
        await runGptFallbackClipboard();
        return;
      }

      const highlights = Array.isArray(data.highlights) ? data.highlights : [];
      setAiScript(script);
      setAiHighlights(highlights);
      setAiJsonFallback(Boolean(data.jsonFallback));
      setSelectedScriptDuration(
        data.duration === 3 || data.duration === 5 ? data.duration : duration
      );

      try {
        localStorage.setItem(
          AI_SUMMARY_CACHE_KEY,
          JSON.stringify({
            fp,
            savedAt: Date.now(),
            duration,
            highlights,
            script,
            jsonFallback: Boolean(data.jsonFallback),
          })
        );
      } catch {
        /* ignore */
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "網路或伺服器錯誤");
      await runGptFallbackClipboard();
    } finally {
      setAiLoading(false);
    }
  };

  const copyAiScript = async () => {
    const t = aiScript.trim();
    if (!t) {
      alert("尚無 AI 新聞稿可複製");
      return;
    }
    try {
      await navigator.clipboard.writeText(t);
      alert("已複製 AI 新聞稿");
    } catch {
      alert("無法寫入剪貼簿，請檢查瀏覽器權限");
    }
  };

  const pageTitle =
    tab === "home"
      ? "首頁"
      : tab === "player"
      ? "播放控制台"
      : tab === "video"
      ? "影音新聞"
      : tab === "favorites"
      ? "收藏新聞"
      : "個人設定";

  return (
    <div style={styles.page}>
      <div style={styles.phone}>
        {tab === "home" ? (
          <header style={styles.homeHeader}>
            <div style={{ minWidth: 0 }}>
              <h1 style={styles.homeBrand}>AI個人新聞台</h1>
              <p style={styles.homeStats}>
                追蹤 <span style={styles.homeStatNum}>{selectedTopics.length}</span> 主題 ·
                已選 <span style={styles.homeStatNum}>{selectedNews.length}</span> 則
              </p>
            </div>
            {isSpeaking ? (
              <span style={styles.homeLivePill}>播放中</span>
            ) : null}
          </header>
        ) : (
          <header style={styles.headerOther}>
            <div>
              <div style={styles.kicker}>AI個人新聞台</div>
              <h1 style={styles.titleOther}>{pageTitle}</h1>
            </div>
            <div style={styles.logoOther}>🎙️</div>
          </header>
        )}

        {tab === "home" && (
          <>
            <div style={styles.searchBox}>
              <input
                value={customKeyword}
                onChange={(e) => setCustomKeyword(e.target.value)}
                placeholder="搜尋：俄烏戰爭、BTC、台積電..."
                style={styles.searchInput}
              />
              <button type="button" onClick={updateMyNews} style={styles.searchButton}>
                更新
              </button>
            </div>

            <div style={styles.homeToolbarScroll} className="hide-scrollbar">
              <button
                type="button"
                onClick={() => (isSpeaking ? stopSpeak() : speakNews())}
                style={{
                  ...styles.toolbarBtn,
                  ...(isSpeaking ? styles.toolbarBtnDanger : styles.toolbarBtnPlay),
                }}
              >
                {isSpeaking
                  ? "■ 停止"
                  : aiScript.trim()
                    ? "▶ 播放 AI 稿"
                    : "▶ 播放"}
              </button>
              <button
                type="button"
                onClick={() => void fetchAiSummary()}
                disabled={aiLoading || selectedNews.length === 0}
                style={{
                  ...styles.toolbarBtnAi,
                  opacity: aiLoading || selectedNews.length === 0 ? 0.65 : 1,
                  cursor:
                    aiLoading || selectedNews.length === 0
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {aiLoading ? "AI 分析中..." : "AI 精華"}
              </button>
              <button type="button" onClick={copyGptPrompt} style={styles.toolbarBtnGpt}>
                GPT 精華
              </button>
              <button
                type="button"
                onClick={updateMyNews}
                disabled={loading}
                style={{
                  ...styles.toolbarBtnNeutral,
                  opacity: loading ? 0.65 : 1,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                {loading ? "…" : "重新整理"}
              </button>
              <button
                type="button"
                onClick={() => setTab("settings")}
                style={styles.toolbarBtnNeutral}
              >
                設定主題
              </button>
            </div>

            <div style={styles.aiSummaryWrap}>
              <div style={styles.aiSummaryCard}>
                <div style={styles.aiSummaryHeaderRow}>
                  <span style={styles.aiSummaryKicker}>AI 精華</span>
                  {selectedScriptDuration != null && aiScript.trim() ? (
                    <span style={styles.aiSummaryBadge}>
                      已產生 · {selectedScriptDuration} 分鐘
                    </span>
                  ) : null}
                </div>

                <div style={styles.aiDurationRow} role="group" aria-label="AI 新聞稿長度">
                  {([1, 3, 5] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      disabled={aiLoading}
                      onClick={() => {
                        if (!aiLoading) setAiDuration(d);
                      }}
                      style={{
                        ...styles.aiDurationChip,
                        ...(aiDuration === d ? styles.aiDurationChipActive : {}),
                      }}
                    >
                      {d} 分鐘
                    </button>
                  ))}
                </div>

                {selectedScriptDuration != null &&
                selectedScriptDuration !== aiDuration &&
                aiScript.trim().length > 0 ? (
                  <div style={styles.aiStaleHint}>
                    已改為 {aiDuration} 分鐘模式，請再按「AI 精華」更新內容。
                  </div>
                ) : null}

                {aiLoading ? (
                  <div style={styles.aiSummaryLoading}>AI 分析中...</div>
                ) : aiError ? (
                  <div style={styles.aiSummaryError}>{aiError}</div>
                ) : aiScript.trim() || aiHighlights.length > 0 ? (
                  <>
                    {aiJsonFallback ? (
                      <div style={styles.aiJsonFallbackNote}>
                        （AI 回傳非標準 JSON，以下以純文字顯示）
                      </div>
                    ) : null}
                    {aiHighlights.length > 0 ? (
                      <div style={styles.aiHighlightsSection}>
                        <div style={styles.aiSubheading}>今日重點</div>
                        <ul style={styles.aiHighlightList}>
                          {aiHighlights.map((h, idx) => (
                            <li key={idx} style={styles.aiHighlightItem}>
                              <div style={styles.aiHighlightLevel}>{h.level}</div>
                              <div style={styles.aiHighlightTitle}>{h.title}</div>
                              <div style={styles.aiHighlightSummary}>{h.summary}</div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {aiScript.trim() ? (
                      <div style={styles.aiScriptSection}>
                        <div style={styles.aiSubheading}>AI 主播稿</div>
                        <div style={styles.aiSummaryBody}>{aiScript.trim()}</div>
                        <div style={styles.aiScriptActions}>
                          <button
                            type="button"
                            onClick={() => speakNews()}
                            style={styles.aiScriptPlayBtn}
                          >
                            播放 AI 新聞稿
                          </button>
                          <button
                            type="button"
                            onClick={() => void copyAiScript()}
                            style={styles.aiScriptCopyBtn}
                          >
                            複製 AI 新聞稿
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div style={styles.aiHintMuted}>
                    勾選新聞後按「AI 精華」，將依「{aiDuration}
                    分鐘」模式產生重點與主播稿（最多分析 5 則標題／來源）。
                  </div>
                )}
              </div>
            </div>

            <NewsList
              title="新聞"
              compact
              denseCards
              homeToolbar={{
                selectAll,
                clearAll,
                lastUpdated,
              }}
              news={news}
              loading={loading}
              toggleNews={toggleNews}
              toggleFavorite={toggleFavorite}
            />
          </>
        )}

        {tab === "player" && (
          <>
            <section style={styles.controlPanel}>
              <div style={styles.controlTitle}>
                播放設定 {isSpeaking ? "｜播放中" : ""}
              </div>

              <select
                value={voiceName}
                onChange={(e) => setVoiceName(e.target.value)}
                style={styles.select}
              >
                {voices.map((voice) => (
                  <option key={voice.name} value={voice.name}>
                    {voice.name}（{voice.lang}）
                  </option>
                ))}
              </select>

              <div style={styles.speedRow}>
                <span>速度 {speed.toFixed(1)}x</span>
                <input
                  type="range"
                  min="0.8"
                  max="2"
                  step="0.1"
                  value={speed}
                  onChange={(e) => changeSpeed(Number(e.target.value))}
                  style={{ width: "55%" }}
                />
              </div>

              <div style={styles.actionRow}>
                <button onClick={speakNews} style={styles.playSmallButton}>
                  {aiScript.trim() ? "播放 AI 新聞稿" : "播放選取新聞"}
                </button>
                <button onClick={stopSpeak} style={styles.stopButton}>
                  停止
                </button>
                <button
                  type="button"
                  onClick={() => void fetchAiSummary()}
                  disabled={aiLoading || selectedNews.length === 0}
                  style={{
                    ...styles.aiSummaryButtonSmall,
                    opacity: aiLoading || selectedNews.length === 0 ? 0.65 : 1,
                    cursor:
                      aiLoading || selectedNews.length === 0
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  {aiLoading ? "AI 分析中..." : "AI 精華"}
                </button>
                <button onClick={copyGptPrompt} style={styles.gptButton}>
                  GPT 精華
                </button>
              </div>
            </section>

            <div style={styles.aiSummaryWrap}>
              <div style={styles.aiSummaryCard}>
                <div style={styles.aiSummaryHeaderRow}>
                  <span style={styles.aiSummaryKicker}>AI 精華</span>
                  {selectedScriptDuration != null && aiScript.trim() ? (
                    <span style={styles.aiSummaryBadge}>
                      已產生 · {selectedScriptDuration} 分鐘
                    </span>
                  ) : null}
                </div>

                <div style={styles.aiDurationRow} role="group" aria-label="AI 新聞稿長度">
                  {([1, 3, 5] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      disabled={aiLoading}
                      onClick={() => {
                        if (!aiLoading) setAiDuration(d);
                      }}
                      style={{
                        ...styles.aiDurationChip,
                        ...(aiDuration === d ? styles.aiDurationChipActive : {}),
                      }}
                    >
                      {d} 分鐘
                    </button>
                  ))}
                </div>

                {selectedScriptDuration != null &&
                selectedScriptDuration !== aiDuration &&
                aiScript.trim().length > 0 ? (
                  <div style={styles.aiStaleHint}>
                    已改為 {aiDuration} 分鐘模式，請再按「AI 精華」更新內容。
                  </div>
                ) : null}

                {aiLoading ? (
                  <div style={styles.aiSummaryLoading}>AI 分析中...</div>
                ) : aiError ? (
                  <div style={styles.aiSummaryError}>{aiError}</div>
                ) : aiScript.trim() || aiHighlights.length > 0 ? (
                  <>
                    {aiJsonFallback ? (
                      <div style={styles.aiJsonFallbackNote}>
                        （AI 回傳非標準 JSON，以下以純文字顯示）
                      </div>
                    ) : null}
                    {aiHighlights.length > 0 ? (
                      <div style={styles.aiHighlightsSection}>
                        <div style={styles.aiSubheading}>今日重點</div>
                        <ul style={styles.aiHighlightList}>
                          {aiHighlights.map((h, idx) => (
                            <li key={idx} style={styles.aiHighlightItem}>
                              <div style={styles.aiHighlightLevel}>{h.level}</div>
                              <div style={styles.aiHighlightTitle}>{h.title}</div>
                              <div style={styles.aiHighlightSummary}>{h.summary}</div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {aiScript.trim() ? (
                      <div style={styles.aiScriptSection}>
                        <div style={styles.aiSubheading}>AI 主播稿</div>
                        <div style={styles.aiSummaryBody}>{aiScript.trim()}</div>
                        <div style={styles.aiScriptActions}>
                          <button
                            type="button"
                            onClick={() => speakNews()}
                            style={styles.aiScriptPlayBtn}
                          >
                            播放 AI 新聞稿
                          </button>
                          <button
                            type="button"
                            onClick={() => void copyAiScript()}
                            style={styles.aiScriptCopyBtn}
                          >
                            複製 AI 新聞稿
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div style={styles.aiHintMuted}>
                    勾選新聞後按「AI 精華」，將依「{aiDuration}
                    分鐘」模式產生重點與主播稿（最多分析 5 則標題／來源）。
                  </div>
                )}
              </div>
            </div>

            <NewsList
              title="即將播放"
              news={selectedNews}
              loading={false}
              toggleNews={toggleNews}
              toggleFavorite={toggleFavorite}
              emptyText="目前沒有選取新聞，請回首頁勾選。"
            />
          </>
        )}

        {tab === "video" && (
          <>
            <div style={styles.videoToolbar}>
              <button
                type="button"
                onClick={updateVideos}
                disabled={videoLoading}
                style={{
                  ...styles.videoRefreshBtn,
                  opacity: videoLoading ? 0.75 : 1,
                  cursor: videoLoading ? "not-allowed" : "pointer",
                }}
              >
                {videoLoading ? "更新中…" : "更新影音"}
              </button>
            </div>

            {videoBanner && (
              <div style={styles.videoInfoBanner} role="status">
                {videoBadge ? (
                  <span style={styles.videoBadgePill}>{videoBadge}</span>
                ) : null}
                <div
                  style={{
                    marginTop: videoBadge ? "10px" : 0,
                    whiteSpace: "pre-line",
                  }}
                >
                  {videoBanner}
                </div>
              </div>
            )}

            {videoLoading && (
              <div style={{ ...styles.loading, marginBottom: "12px" }}>影音讀取中…</div>
            )}

            <div style={styles.videoGrid}>
              {videos.map((video) => {
                const dateLine = formatVideoPublished(video.publishedAt);
                return (
                  <a
                    key={video.id}
                    href={video.link}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.videoTile}
                  >
                    <div style={styles.videoThumbWrap}>
                      {video.thumbnail ? (
                        <img
                          src={video.thumbnail}
                          alt=""
                          style={styles.videoThumbImg}
                        />
                      ) : (
                        <div style={styles.videoThumbPlaceholder}>▶</div>
                      )}
                      <span style={styles.videoPlayBadge}>▶</span>
                    </div>
                    <div style={styles.videoTileBody}>
                      <div style={styles.videoTileTitle}>{video.title}</div>
                      <div style={styles.videoTileMeta}>{video.channel}</div>
                      {dateLine ? (
                        <div style={styles.videoTileDate}>{dateLine}</div>
                      ) : null}
                      <div style={styles.videoKeywordTag}>{video.keyword}</div>
                    </div>
                  </a>
                );
              })}
            </div>

            {!videoLoading && videos.length === 0 && !videoBanner && (
              <div style={styles.loading}>
                目前沒有相關影音內容。可調整追蹤主題或稍後再按「更新影音」。
              </div>
            )}
          </>
        )}

        {tab === "favorites" && (
          <>
            <ActionButtons
              selectAll={selectAll}
              clearAll={clearAll}
              copyGptPrompt={copyGptPrompt}
            />

            <NewsList
              title="收藏新聞"
              news={favoriteNews}
              loading={false}
              toggleNews={toggleNews}
              toggleFavorite={toggleFavorite}
              emptyText="目前沒有收藏新聞。"
            />
          </>
        )}

        {tab === "settings" && (
          <>
            <section style={styles.controlPanel}>
              <div style={styles.controlTitle}>我的追蹤主題</div>

              <div style={styles.settingHint}>
                首頁會依照這些主題整理新聞與影音。想搜尋單一事件，可直接在首頁搜尋框輸入關鍵字。
              </div>

              <div style={styles.actionRow}>
                <button onClick={selectAllTopics} style={styles.miniButton}>
                  主題全選
                </button>
                <button onClick={clearTopics} style={styles.miniButton}>
                  清空主題
                </button>
                <button onClick={resetDefaultTopics} style={styles.gptButton}>
                  預設主題
                </button>
              </div>

              <div style={styles.topicGridSettings}>
                {topics.map((topic) => {
                  const active = selectedTopics.includes(topic.label);
                  return (
                    <button
                      key={topic.label}
                      onClick={() => toggleTopic(topic.label)}
                      style={{
                        ...styles.topicChip,
                        ...(active ? styles.topicChipActive : {}),
                      }}
                    >
                      <span>{topic.icon}</span> {topic.label}
                    </button>
                  );
                })}
              </div>
            </section>

            <section style={styles.controlPanel}>
              <div style={styles.controlTitle}>自訂關鍵字</div>
              <input
                value={customKeyword}
                onChange={(e) => setCustomKeyword(e.target.value)}
                placeholder="例如：俄烏戰爭、Solana、台積電..."
                style={styles.settingInput}
              />
              <button onClick={updateMyNews} style={styles.fullButton}>
                套用並更新新聞
              </button>
            </section>

            <section style={styles.controlPanel}>
              <div style={styles.controlTitle}>AI 精華（OpenAI）</div>
              <div style={styles.settingHint}>
                「AI 精華」由伺服端的{" "}
                <code style={{ color: "#93C5FD" }}>OPENAI_API_KEY</code>{" "}
                呼叫 OpenAI；請在部署環境（例如 Vercel Environment
                Variables）設定金鑰。可選 1／3／5 分鐘主播稿長度，回傳 JSON
                後於畫面呈現；未設定時會顯示提示，並可改用「GPT 精華」複製
                Prompt。
              </div>
            </section>

            <section style={styles.controlPanel}>
              <div style={styles.controlTitle}>語音設定</div>

              <select
                value={voiceName}
                onChange={(e) => setVoiceName(e.target.value)}
                style={styles.select}
              >
                {voices.map((voice) => (
                  <option key={voice.name} value={voice.name}>
                    {voice.name}（{voice.lang}）
                  </option>
                ))}
              </select>

              <div style={styles.speedRow}>
                <span>播放速度 {speed.toFixed(1)}x</span>
                <input
                  type="range"
                  min="0.8"
                  max="2"
                  step="0.1"
                  value={speed}
                  onChange={(e) => changeSpeed(Number(e.target.value))}
                  style={{ width: "55%" }}
                />
              </div>
            </section>

            <section style={styles.controlPanel}>
              <div style={styles.controlTitle}>收藏管理</div>
              <div style={styles.settingHint}>目前收藏 {favoriteNews.length} 則新聞。</div>
              <button onClick={clearFavorites} style={styles.dangerFullButton}>
                清除全部收藏
              </button>
            </section>
          </>
        )}

        <nav style={styles.bottomNav}>
          <button
            onClick={() => setTab("home")}
            style={tab === "home" ? styles.navItemActive : styles.navItem}
          >
            🏠<span>首頁</span>
          </button>

          <button
            onClick={() => setTab("player")}
            style={tab === "player" ? styles.navItemActive : styles.navItem}
          >
            🎧<span>播放</span>
          </button>

          <button
            onClick={() => setTab("video")}
            style={tab === "video" ? styles.navItemActive : styles.navItem}
          >
            📺<span>影音</span>
          </button>

          <button
            onClick={() => setTab("favorites")}
            style={tab === "favorites" ? styles.navItemActive : styles.navItem}
          >
            ⭐<span>收藏</span>
          </button>

          <button
            onClick={() => setTab("settings")}
            style={tab === "settings" ? styles.navItemActive : styles.navItem}
          >
            ⚙️<span>設定</span>
          </button>
        </nav>
      </div>
    </div>
  );
}

function ActionButtons({
  selectAll,
  clearAll,
  copyGptPrompt,
}: {
  selectAll: () => void;
  clearAll: () => void;
  copyGptPrompt: () => void;
}) {
  return (
    <div style={styles.actionRow}>
      <button onClick={selectAll} style={styles.miniButton}>
        全選
      </button>
      <button onClick={clearAll} style={styles.miniButton}>
        取消
      </button>
      <button onClick={copyGptPrompt} style={styles.gptButton}>
        GPT 精華
      </button>
    </div>
  );
}

function NewsList({
  title,
  news,
  loading,
  toggleNews,
  toggleFavorite,
  emptyText = "沒有新聞",
  compact = false,
  denseCards = false,
  homeToolbar,
}: {
  title: string;
  news: NewsItem[];
  loading: boolean;
  toggleNews: (id: string) => void;
  toggleFavorite: (item: NewsItem) => void;
  emptyText?: string;
  compact?: boolean;
  denseCards?: boolean;
  homeToolbar?: {
    selectAll: () => void;
    clearAll: () => void;
    lastUpdated: string;
  };
}) {
  const headerMerged = !!homeToolbar;

  return (
    <>
      <div
        style={{
          ...styles.sectionHeader,
          ...(compact ? styles.sectionHeaderCompact : {}),
          ...(headerMerged ? styles.sectionHeaderHomeMerged : {}),
        }}
      >
        {homeToolbar ? (
          <>
            <div style={styles.homeListHeaderLeft}>
              <button
                type="button"
                onClick={homeToolbar.selectAll}
                style={styles.tinyOutlineBtn}
              >
                全選
              </button>
              <button
                type="button"
                onClick={homeToolbar.clearAll}
                style={styles.tinyOutlineBtn}
              >
                取消
              </button>
            </div>
            <div style={styles.homeListHeaderMid}>
              <h2
                style={{
                  ...styles.sectionTitle,
                  ...(compact ? styles.sectionTitleCompact : {}),
                  ...styles.sectionTitleHomeInline,
                }}
              >
                {title}
              </h2>
              <span style={styles.countTextHome}>{news.length} 則</span>
            </div>
            <span style={styles.lastUpdatedHome}>
              {homeToolbar.lastUpdated
                ? `更新 ${homeToolbar.lastUpdated}`
                : "尚未更新"}
            </span>
          </>
        ) : (
          <>
            <h2
              style={{
                ...styles.sectionTitle,
                ...(compact ? styles.sectionTitleCompact : {}),
              }}
            >
              {title}
            </h2>
            <span style={styles.countText}>{news.length} 則</span>
          </>
        )}
      </div>

      {loading && (
        <div style={homeToolbar ? styles.loadingSlim : styles.loading}>新聞讀取中...</div>
      )}

      {!loading && news.length === 0 && (
        <div style={styles.loading}>{emptyText}</div>
      )}

      <div style={denseCards ? styles.newsListDense : styles.newsList}>
        {news.map((item, index) => (
          <article
            key={item.id}
            onClick={() => toggleNews(item.id)}
            style={{
              ...styles.newsCard,
              ...(denseCards ? styles.newsCardDense : {}),
              ...(item.selected ? styles.newsCardActive : {}),
            }}
          >
            <div style={styles.newsIndex}>
              {String(index + 1).padStart(2, "0")}
            </div>

            <div style={{ flex: 1 }}>
              <div style={styles.newsTitle}>
                {item.selected ? "✅ " : ""}
                {item.title}
              </div>

              <div style={styles.newsMeta}>
                <span>{item.source}</span>

                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(item);
                    }}
                    style={styles.favoriteButton}
                  >
                    {item.favorite ? "⭐" : "☆"}
                  </button>

                  <a
                    href={item.link}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={styles.link}
                  >
                    原文
                  </a>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: "100%",
    minHeight: "100dvh",
    margin: 0,
    padding: 0,
    overflowX: "hidden",
    background:
      "radial-gradient(circle at top left, #1D4ED8 0, transparent 28%), linear-gradient(180deg, #020617 0%, #0F172A 100%)",
    color: "white",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif',
  },
  phone: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: "460px",
    margin: "0 auto",
    paddingLeft: "max(16px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(16px, env(safe-area-inset-right, 0px))",
    paddingTop: "max(12px, env(safe-area-inset-top, 0px))",
    paddingBottom: "calc(92px + env(safe-area-inset-bottom, 0px))",
  },
  homeHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "10px",
    padding: "2px 0 4px",
  },
  homeBrand: {
    margin: 0,
    fontSize: "clamp(18px, 4.8vw, 21px)",
    fontWeight: 900,
    letterSpacing: "-0.02em",
    lineHeight: 1.2,
  },
  homeStats: {
    margin: "4px 0 0",
    color: "#94A3B8",
    fontSize: "12px",
    lineHeight: 1.35,
  },
  homeStatNum: { color: "#E2E8F0", fontWeight: 800 },
  homeLivePill: {
    flexShrink: 0,
    fontSize: "11px",
    fontWeight: 800,
    color: "#BFDBFE",
    background: "rgba(124,58,237,.35)",
    border: "1px solid rgba(167,139,250,.45)",
    borderRadius: "999px",
    padding: "5px 10px",
    marginTop: "0",
  },
  headerOther: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 0 14px",
    gap: "10px",
  },
  titleOther: {
    margin: "4px 0 0",
    fontSize: "clamp(17px, 4.5vw, 20px)",
    fontWeight: 900,
    letterSpacing: "-0.02em",
  },
  logoOther: {
    width: "44px",
    height: "44px",
    borderRadius: "16px",
    background: "linear-gradient(135deg, #2563EB, #7C3AED)",
    display: "grid",
    placeItems: "center",
    fontSize: "22px",
    flexShrink: 0,
    boxShadow: "0 8px 22px rgba(37,99,235,.28)",
  },
  homeToolbarScroll: {
    display: "flex",
    gap: "5px",
    overflowX: "auto",
    flexWrap: "nowrap",
    marginTop: "6px",
    paddingBottom: "2px",
    WebkitOverflowScrolling: "touch",
  },
  toolbarBtn: {
    flexShrink: 0,
    border: "none",
    borderRadius: "999px",
    padding: "7px 10px",
    fontSize: "11px",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  toolbarBtnPlay: {
    background: "linear-gradient(135deg, #2563EB, #4F46E5)",
    color: "white",
    boxShadow: "0 4px 14px rgba(37,99,235,.35)",
  },
  toolbarBtnDanger: {
    background: "rgba(220,38,38,.9)",
    color: "white",
  },
  toolbarBtnGpt: {
    background: "#7C3AED",
    color: "white",
    border: "none",
    borderRadius: "999px",
    padding: "7px 10px",
    fontSize: "11px",
    fontWeight: 800,
    cursor: "pointer",
    flexShrink: 0,
    whiteSpace: "nowrap",
  },
  toolbarBtnAi: {
    background: "linear-gradient(135deg, #0D9488, #059669)",
    color: "white",
    border: "none",
    borderRadius: "999px",
    padding: "7px 10px",
    fontSize: "11px",
    fontWeight: 800,
    cursor: "pointer",
    flexShrink: 0,
    whiteSpace: "nowrap",
  },
  toolbarBtnNeutral: {
    background: "rgba(255,255,255,.1)",
    color: "#E2E8F0",
    border: "1px solid rgba(255,255,255,.12)",
    borderRadius: "999px",
    padding: "7px 10px",
    fontSize: "11px",
    fontWeight: 700,
    cursor: "pointer",
    flexShrink: 0,
    whiteSpace: "nowrap",
  },
  tinyOutlineBtn: {
    background: "transparent",
    color: "#93C5FD",
    border: "1px solid rgba(147,197,253,.35)",
    borderRadius: "999px",
    padding: "4px 9px",
    fontSize: "10px",
    fontWeight: 700,
    cursor: "pointer",
  },
  searchBox: {
    display: "flex",
    gap: "6px",
    marginTop: "4px",
    background: "rgba(255,255,255,.08)",
    padding: "6px",
    borderRadius: "14px",
    border: "1px solid rgba(255,255,255,.08)",
  },
  searchInput: {
    flex: 1,
    background: "transparent",
    color: "white",
    border: "none",
    outline: "none",
    fontSize: "14px",
    padding: "8px",
  },
  searchButton: {
    background: "#22C55E",
    color: "white",
    border: "none",
    borderRadius: "13px",
    padding: "0 14px",
    fontWeight: 800,
    cursor: "pointer",
  },
  kicker: {
    color: "#93C5FD",
    fontSize: "10px",
    letterSpacing: "0.12em",
    fontWeight: 700,
    textTransform: "uppercase",
  },
  sectionHeaderCompact: {
    marginTop: "2px",
    marginBottom: "6px",
  },
  sectionTitleCompact: { fontSize: "14px" },
  sectionHeaderHomeMerged: {
    justifyContent: "flex-start",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    rowGap: "6px",
  },
  homeListHeaderLeft: {
    display: "flex",
    gap: "5px",
    flexShrink: 0,
    alignItems: "center",
  },
  homeListHeaderMid: {
    display: "flex",
    alignItems: "baseline",
    gap: "6px",
    flex: "1 1 88px",
    minWidth: 0,
  },
  sectionTitleHomeInline: { margin: 0, lineHeight: 1.2 },
  countTextHome: {
    fontSize: "11px",
    color: "#94A3B8",
    fontWeight: 600,
    flexShrink: 0,
  },
  lastUpdatedHome: {
    fontSize: "10px",
    color: "#64748B",
    marginLeft: "auto",
    flexShrink: 0,
    maxWidth: "100%",
    textAlign: "right",
  },
  updateButton: {
    background: "rgba(255,255,255,.12)",
    color: "white",
    border: "1px solid rgba(255,255,255,.12)",
    borderRadius: "999px",
    padding: "8px 12px",
    fontWeight: 800,
  },
  topicGridSettings: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    padding: "14px 0 4px",
  },
  topicChip: {
    whiteSpace: "nowrap",
    background: "rgba(255,255,255,.08)",
    color: "#CBD5E1",
    border: "1px solid rgba(255,255,255,.08)",
    padding: "9px 12px",
    borderRadius: "999px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "14px",
  },
  topicChipActive: { background: "white", color: "#0F172A" },
  controlPanel: {
    marginTop: "18px",
    background: "rgba(15,23,42,.82)",
    border: "1px solid rgba(255,255,255,.08)",
    borderRadius: "24px",
    padding: "16px",
  },
  controlTitle: { fontWeight: 900, marginBottom: "10px" },
  settingHint: {
    color: "#CBD5E1",
    fontSize: "13px",
    lineHeight: 1.5,
  },
  settingInput: {
    width: "100%",
    boxSizing: "border-box",
    background: "rgba(255,255,255,.08)",
    color: "white",
    border: "1px solid rgba(255,255,255,.12)",
    outline: "none",
    fontSize: "15px",
    padding: "12px",
    borderRadius: "14px",
    marginTop: "8px",
  },
  fullButton: {
    width: "100%",
    marginTop: "12px",
    background: "#22C55E",
    color: "white",
    border: "none",
    borderRadius: "14px",
    padding: "12px",
    fontWeight: 900,
    cursor: "pointer",
  },
  dangerFullButton: {
    width: "100%",
    marginTop: "12px",
    background: "#DC2626",
    color: "white",
    border: "none",
    borderRadius: "14px",
    padding: "12px",
    fontWeight: 900,
    cursor: "pointer",
  },
  select: {
    width: "100%",
    padding: "11px",
    borderRadius: "14px",
    border: "none",
    marginBottom: "12px",
  },
  speedRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    color: "#CBD5E1",
    fontSize: "14px",
  },
  actionRow: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px" },
  miniButton: {
    background: "#334155",
    color: "white",
    border: "none",
    borderRadius: "12px",
    padding: "9px 12px",
    cursor: "pointer",
    fontWeight: 700,
  },
  playSmallButton: {
    background: "#2563EB",
    color: "white",
    border: "none",
    borderRadius: "12px",
    padding: "9px 12px",
    cursor: "pointer",
    fontWeight: 800,
  },
  stopButton: {
    background: "#DC2626",
    color: "white",
    border: "none",
    borderRadius: "12px",
    padding: "9px 12px",
    cursor: "pointer",
    fontWeight: 700,
  },
  gptButton: {
    background: "#7C3AED",
    color: "white",
    border: "none",
    borderRadius: "12px",
    padding: "9px 12px",
    cursor: "pointer",
    fontWeight: 800,
  },
  aiSummaryButtonSmall: {
    background: "linear-gradient(135deg, #0D9488, #059669)",
    color: "white",
    border: "none",
    borderRadius: "12px",
    padding: "9px 12px",
    cursor: "pointer",
    fontWeight: 800,
  },
  aiSummaryWrap: {
    marginTop: "10px",
    marginBottom: "6px",
    minWidth: 0,
  },
  aiSummaryCard: {
    background: "rgba(15,23,42,.88)",
    border: "1px solid rgba(255,255,255,.1)",
    borderRadius: "18px",
    padding: "14px 14px 16px",
    minWidth: 0,
    boxSizing: "border-box",
  },
  aiSummaryHeaderRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    marginBottom: "10px",
  },
  aiSummaryKicker: {
    fontSize: "10px",
    color: "#5EEAD4",
    fontWeight: 800,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  aiSummaryBody: {
    fontSize: "14px",
    lineHeight: 1.55,
    color: "#E2E8F0",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  aiSummaryError: {
    color: "#FCA5A5",
    fontSize: "13px",
    lineHeight: 1.5,
    wordBreak: "break-word",
  },
  aiSummaryLoading: {
    color: "#94A3B8",
    fontSize: "14px",
    fontWeight: 700,
  },
  aiSummaryBadge: {
    fontSize: "10px",
    fontWeight: 800,
    color: "#A7F3D0",
    background: "rgba(16,185,129,.2)",
    border: "1px solid rgba(52,211,153,.4)",
    borderRadius: "999px",
    padding: "4px 9px",
    flexShrink: 0,
  },
  aiDurationRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    marginBottom: "12px",
  },
  aiDurationChip: {
    border: "1px solid rgba(255,255,255,.14)",
    background: "rgba(255,255,255,.06)",
    color: "#CBD5E1",
    borderRadius: "999px",
    padding: "6px 12px",
    fontSize: "11px",
    fontWeight: 800,
    cursor: "pointer",
    flexShrink: 0,
  },
  aiDurationChipActive: {
    background: "rgba(45,212,191,.22)",
    border: "1px solid rgba(45,212,191,.55)",
    color: "#ECFEFF",
  },
  aiStaleHint: {
    fontSize: "11px",
    color: "#FCD34D",
    marginBottom: "10px",
    lineHeight: 1.4,
  },
  aiJsonFallbackNote: {
    fontSize: "11px",
    color: "#94A3B8",
    marginBottom: "10px",
  },
  aiHighlightsSection: {
    marginBottom: "14px",
  },
  aiSubheading: {
    fontSize: "12px",
    fontWeight: 900,
    color: "#93C5FD",
    marginBottom: "8px",
  },
  aiHighlightList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  aiHighlightItem: {
    background: "rgba(255,255,255,.05)",
    border: "1px solid rgba(255,255,255,.08)",
    borderRadius: "14px",
    padding: "10px 11px",
  },
  aiHighlightLevel: {
    fontSize: "11px",
    fontWeight: 900,
    color: "#FDE68A",
    marginBottom: "4px",
  },
  aiHighlightTitle: {
    fontSize: "14px",
    fontWeight: 800,
    color: "#F1F5F9",
    lineHeight: 1.35,
    marginBottom: "4px",
  },
  aiHighlightSummary: {
    fontSize: "13px",
    lineHeight: 1.5,
    color: "#CBD5E1",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  aiScriptSection: {
    marginTop: "4px",
  },
  aiScriptActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "12px",
  },
  aiScriptPlayBtn: {
    background: "linear-gradient(135deg, #2563EB, #4F46E5)",
    color: "white",
    border: "none",
    borderRadius: "12px",
    padding: "9px 14px",
    fontWeight: 800,
    fontSize: "12px",
    cursor: "pointer",
  },
  aiScriptCopyBtn: {
    background: "rgba(255,255,255,.1)",
    color: "#E2E8F0",
    border: "1px solid rgba(255,255,255,.14)",
    borderRadius: "12px",
    padding: "9px 14px",
    fontWeight: 700,
    fontSize: "12px",
    cursor: "pointer",
  },
  aiHintMuted: {
    fontSize: "12px",
    lineHeight: 1.5,
    color: "#64748B",
    marginTop: "2px",
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "16px",
    marginBottom: "10px",
    gap: "10px",
  },
  sectionTitle: { margin: 0, fontSize: "20px", fontWeight: 900 },
  countText: { color: "#94A3B8", fontSize: "13px" },
  loading: {
    color: "#CBD5E1",
    background: "rgba(255,255,255,.08)",
    padding: "12px",
    borderRadius: "16px",
  },
  loadingSlim: {
    color: "#CBD5E1",
    background: "rgba(255,255,255,.06)",
    padding: "7px 10px",
    borderRadius: "12px",
    fontSize: "12px",
    marginBottom: "6px",
  },
  videoToolbar: {
    marginTop: "8px",
    marginBottom: "12px",
  },
  videoInfoBanner: {
    color: "#BFDBFE",
    background: "rgba(30,58,138,.45)",
    border: "1px solid rgba(96,165,250,.35)",
    borderRadius: "14px",
    padding: "12px 14px",
    fontSize: "13px",
    lineHeight: 1.45,
    marginBottom: "12px",
  },
  videoBadgePill: {
    display: "inline-block",
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.04em",
    color: "#0F172A",
    background: "linear-gradient(135deg, #FDE68A, #FBBF24)",
    padding: "4px 10px",
    borderRadius: "999px",
    border: "1px solid rgba(251,191,36,.6)",
  },
  videoRefreshBtn: {
    width: "100%",
    background: "linear-gradient(135deg, #2563EB, #7C3AED)",
    color: "white",
    border: "none",
    borderRadius: "16px",
    padding: "14px 16px",
    fontWeight: 900,
    fontSize: "15px",
    boxShadow: "0 12px 32px rgba(37,99,235,.3)",
  },
  videoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(152px, 1fr))",
    gap: "12px",
    paddingBottom: "8px",
  },
  videoTile: {
    display: "flex",
    flexDirection: "column",
    borderRadius: "16px",
    overflow: "hidden",
    background: "rgba(255,255,255,.07)",
    border: "1px solid rgba(255,255,255,.1)",
    textDecoration: "none",
    color: "white",
    minWidth: 0,
  },
  videoThumbWrap: {
    position: "relative",
    aspectRatio: "16 / 9",
    background: "rgba(15,23,42,.95)",
  },
  videoThumbImg: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  videoThumbPlaceholder: {
    width: "100%",
    height: "100%",
    display: "grid",
    placeItems: "center",
    fontSize: "28px",
    color: "#64748B",
    background: "linear-gradient(145deg, #1e293b, #0f172a)",
  },
  videoPlayBadge: {
    position: "absolute",
    right: "8px",
    bottom: "8px",
    width: "34px",
    height: "34px",
    borderRadius: "50%",
    background: "rgba(0,0,0,.62)",
    color: "white",
    display: "grid",
    placeItems: "center",
    fontSize: "13px",
    pointerEvents: "none",
  },
  videoTileBody: {
    padding: "10px 10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    flex: 1,
    minHeight: 0,
  },
  videoTileTitle: {
    fontSize: "13px",
    fontWeight: 800,
    lineHeight: 1.35,
    maxHeight: "3.6em",
    overflow: "hidden",
  },
  videoTileMeta: {
    fontSize: "11px",
    color: "#94A3B8",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  videoTileDate: {
    fontSize: "10px",
    color: "#64748B",
  },
  videoKeywordTag: {
    fontSize: "10px",
    color: "#93C5FD",
    fontWeight: 700,
    marginTop: "2px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  newsList: { display: "flex", flexDirection: "column", gap: "10px" },
  newsListDense: { display: "flex", flexDirection: "column", gap: "7px" },
  newsCard: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    background: "rgba(255,255,255,.07)",
    border: "1px solid rgba(255,255,255,.08)",
    borderRadius: "18px",
    padding: "13px",
    cursor: "pointer",
  },
  newsCardDense: {
    padding: "9px 11px",
    borderRadius: "14px",
  },
  newsCardActive: {
    background: "rgba(37,99,235,.26)",
    border: "1px solid rgba(147,197,253,.45)",
  },
  newsIndex: {
    width: "34px",
    height: "34px",
    borderRadius: "12px",
    background: "rgba(255,255,255,.1)",
    display: "grid",
    placeItems: "center",
    color: "#93C5FD",
    fontWeight: 900,
    fontSize: "12px",
    flexShrink: 0,
  },
  newsTitle: { fontSize: "15px", fontWeight: 800, lineHeight: 1.45 },
  newsMeta: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    color: "#94A3B8",
    marginTop: "8px",
    fontSize: "12px",
  },
  favoriteButton: {
    background: "transparent",
    border: "none",
    color: "#FACC15",
    cursor: "pointer",
    fontSize: "14px",
  },
  link: { color: "#93C5FD", textDecoration: "none", flexShrink: 0 },
  bottomNav: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    maxWidth: "100%",
    margin: 0,
    transform: "none",
    background: "rgba(15,23,42,.96)",
    border: "none",
    borderTop: "1px solid rgba(255,255,255,.1)",
    borderRadius: "20px 20px 0 0",
    paddingTop: "10px",
    paddingLeft: "max(10px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(10px, env(safe-area-inset-right, 0px))",
    paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))",
    display: "flex",
    justifyContent: "space-around",
    backdropFilter: "blur(18px)",
    boxShadow: "0 -8px 32px rgba(0,0,0,.35)",
  },
  navItem: {
    background: "transparent",
    border: "none",
    color: "#94A3B8",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "3px",
    fontSize: "11px",
    cursor: "pointer",
  },
  navItemActive: {
    background: "rgba(255,255,255,.12)",
    border: "none",
    color: "white",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "3px",
    fontSize: "11px",
    fontWeight: 800,
    borderRadius: "16px",
    padding: "8px 10px",
    cursor: "pointer",
  },
};
