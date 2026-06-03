import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Headphones, Home, Settings, Star } from "lucide-react";
import {
  AI_DAILY_LIMIT_PRO,
  canAddCustomKeyword,
  canAddFavorite,
  canAddTopic,
  canUseDeepMode,
  canUseFiveMinuteScript,
  filterHistoryByPlan,
  formatProExpiresAt,
  getAiDailyLimit,
  getPlanLimits,
  getProStatus,
  isProActive,
  proSourceLabel,
  redeemPromoCode,
  resetProTestState,
  syncProDebugModeFromUrl,
  type ProStatus,
} from "./pro";

type Tab = "home" | "player" | "video" | "favorites" | "settings";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * 設為 `true` 可再次顯示底部「影音」Tab 與影音分頁。
 * `loadVideos`、`/api/videos` 與相關 state 均保留，僅隱藏 UI。
 * 目前因影音 fallback 品質不穩，先關閉以維持產品專業感。
 */
const ENABLE_VIDEO_NEWS_UI = false;

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

type AiHistoryEntry = {
  id: string;
  savedAt: number;
  duration: AiDuration;
  script: string;
  highlights: AiHighlight[];
  jsonFallback: boolean;
  newsTitles: string[];
};

type AiFavoriteEntry = {
  id: string;
  createdAt: number;
  duration: AiDuration;
  highlights: AiHighlight[];
  script: string;
  newsTitles: string[];
  selectedTopics?: string[];
  keyword?: string;
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
const AI_HISTORY_KEY = "pns_ai_history_v1";
const AI_HISTORY_MAX = 20;
const AI_FAVORITES_KEY = "pns_ai_favorites_v1";
const PLAYBACK_SPEED_KEY = "pns_playback_speed_v1";
const SPEED_MIN = 0.8;
const SPEED_MAX = 1.2;
const SPEED_STEP = 0.05;
const SPEED_DEFAULT = 1;
const SCRIPT_FONT_KEY = "pns_script_font_v1";
const AI_DAILY_QUOTA_KEY = "pns_ai_daily_quota_v1";

type ScriptFontSize = "sm" | "md" | "lg" | "xl";
type PlaybackMode = "ai" | "news" | null;

const PRO_PRICING = {
  monthly: { price: 49, label: "NT$49 / 月" },
  yearly: { price: 390, label: "NT$390 / 年", saveLabel: "約省 34%" },
} as const;

const ONBOARDING_SEEN_KEY = "pns_onboarding_seen_v1";
const SPLASH_SEEN_SESSION_KEY = "pns_splash_seen_session_v1";
const SPLASH_DURATION_MS = 1500;

const SELECTED_TOPICS_KEY = "pns_selected_topics_v1";
const CUSTOM_KEYWORD_KEY = "pns_custom_keyword_v1";
const CUSTOM_KEYWORDS_LIST_KEY = "pns_custom_keywords_v1";

type AiAnalysisMode = "normal" | "deep";

type UpgradeModalKind =
  | "general"
  | "five_minute"
  | "quota"
  | "topic"
  | "favorite"
  | "keyword"
  | "deep";

const DEFAULT_TOPICS = ["NBA", "MLB", "大谷翔平", "Curry", "BTC"];

function readSelectedTopics(): string[] {
  try {
    const raw = localStorage.getItem(SELECTED_TOPICS_KEY);
    if (!raw) return DEFAULT_TOPICS;
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return DEFAULT_TOPICS;
    const cleaned = arr
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((s) => s.trim());
    // 避免空陣列造成首頁無內容
    return cleaned.length > 0 ? cleaned : DEFAULT_TOPICS;
  } catch {
    return DEFAULT_TOPICS;
  }
}

function writeSelectedTopics(topics: string[]) {
  try {
    localStorage.setItem(SELECTED_TOPICS_KEY, JSON.stringify(topics));
  } catch {
    /* ignore */
  }
}

function readCustomKeyword(): string {
  try {
    const raw = localStorage.getItem(CUSTOM_KEYWORD_KEY);
    return typeof raw === "string" ? raw : "";
  } catch {
    return "";
  }
}

function writeCustomKeyword(v: string) {
  try {
    localStorage.setItem(CUSTOM_KEYWORD_KEY, v);
  } catch {
    /* ignore */
  }
}

function readSavedCustomKeywords(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEYWORDS_LIST_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((s) => s.trim());
  } catch {
    return [];
  }
}

function writeSavedCustomKeywords(list: string[]) {
  try {
    localStorage.setItem(CUSTOM_KEYWORDS_LIST_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function readAdSenseClientId(): string {
  try {
    const v = (import.meta as unknown as { env?: Record<string, unknown> })?.env?.[
      "VITE_GOOGLE_ADSENSE_CLIENT_ID"
    ];
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

const ADSENSE_HOME_SLOT_ID = "0000000000";
const ADSENSE_PLAYER_BANNER_SLOT_ID = "0000000000";

function readOnboardingSeen(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOnboardingSeen(seen: boolean) {
  try {
    localStorage.setItem(ONBOARDING_SEEN_KEY, seen ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function readSplashSeenSession(): boolean {
  try {
    return sessionStorage.getItem(SPLASH_SEEN_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSplashSeenSession() {
  try {
    sessionStorage.setItem(SPLASH_SEEN_SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

const SCRIPT_FONT_PX: Record<ScriptFontSize, number> = {
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
};

function readScriptFontSize(): ScriptFontSize {
  try {
    const v = localStorage.getItem(SCRIPT_FONT_KEY);
    if (v === "sm" || v === "md" || v === "lg" || v === "xl") return v;
  } catch {
    /* ignore */
  }
  return "md";
}

function todayYmdLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function readAiDailyQuota(): { date: string; used: number } {
  const today = todayYmdLocal();
  try {
    const raw = localStorage.getItem(AI_DAILY_QUOTA_KEY);
    if (!raw) return { date: today, used: 0 };
    const o = JSON.parse(raw) as { date?: unknown; used?: unknown };
    const date = typeof o?.date === "string" ? o.date : today;
    const used = typeof o?.used === "number" && o.used >= 0 ? Math.floor(o.used) : 0;
    if (date !== today) return { date: today, used: 0 };
    return { date, used };
  } catch {
    return { date: today, used: 0 };
  }
}

function writeAiDailyQuota(q: { date: string; used: number }) {
  try {
    localStorage.setItem(
      AI_DAILY_QUOTA_KEY,
      JSON.stringify({ date: q.date, used: Math.max(0, Math.floor(q.used)) })
    );
  } catch {
    /* ignore */
  }
}

function splitSpeechChunks(text: string): string[] {
  const raw = text
    // iOS TTS 穩定性：只在句號/逗號/分號/換行後切段，避免句子中斷
    .split(/(?<=[。！？!?;；，,])\s*|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (raw.length === 0) return text.trim() ? [text.trim()] : [];
  const merged: string[] = [];
  for (const part of raw) {
    if (merged.length > 0 && part.length < 10) {
      merged[merged.length - 1] += part;
    } else {
      merged.push(part);
    }
  }
  return merged;
}

function estimateChunkDurationMs(text: string, rate: number): number {
  return Math.max(650, Math.round((text.length * 92) / rate));
}

function findResumeIndex(text: string, approxIndex: number): number {
  const t = String(text || "");
  if (!t) return 0;
  const i = Math.max(0, Math.min(t.length, Math.floor(approxIndex)));
  // 從目前位置往後找最近的安全切點（標點/換行），避免從句子中間開始
  const forward = t.slice(i, Math.min(t.length, i + 80));
  const m = forward.match(/[。！？!?；;，,\n]/);
  if (m && m.index != null) {
    return Math.min(t.length, i + m.index + 1);
  }
  // fallback：往前找
  const back = t.slice(Math.max(0, i - 80), i);
  const backIdx = Math.max(
    back.lastIndexOf("。"),
    back.lastIndexOf("！"),
    back.lastIndexOf("？"),
    back.lastIndexOf("!"),
    back.lastIndexOf("?"),
    back.lastIndexOf("；"),
    back.lastIndexOf(";"),
    back.lastIndexOf("，"),
    back.lastIndexOf(","),
    back.lastIndexOf("\n")
  );
  if (backIdx >= 0) {
    return Math.max(0, i - 80 + backIdx + 1);
  }
  return i;
}

function formatRemainingTime(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `剩餘 ${m}:${String(s).padStart(2, "0")}` : `剩餘 ${sec} 秒`;
}

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
function aiSummaryCacheFingerprint(
  items: NewsItem[],
  duration: AiDuration,
  deepMode = false
): string {
  const base = [...items]
    .slice(0, 5)
    .map((n) => `${normalizeKey(n.title)}|${n.source.trim()}`)
    .sort()
    .join("\0");
  return `${duration}\0${deepMode ? "deep" : "normal"}\0${base}`;
}

type SummaryApiPayload = {
  ok?: boolean;
  script?: string;
  highlights?: AiHighlight[];
  jsonFallback?: boolean;
  duration?: number;
  error?: string;
  code?: string;
};

async function readSummaryApiPayload(
  res: Response
): Promise<{ data: SummaryApiPayload | null; error: string | null }> {
  const text = await res.text();
  if (!text.trim()) {
    return {
      data: null,
      error: res.ok
        ? "伺服器未回傳內容"
        : `AI 服務暫時無法使用（HTTP ${res.status}），請稍後再試`,
    };
  }
  try {
    return { data: JSON.parse(text) as SummaryApiPayload, error: null };
  } catch {
    if (
      res.status >= 500 ||
      /server error|FUNCTION_INVOCATION|timeout|timed out/i.test(text)
    ) {
      return {
        data: null,
        error:
          "AI 伺服器忙碌或逾時，請稍後再試；可改選較短時長或「一般整理」模式",
      };
    }
    return {
      data: null,
      error: `AI 服務回傳異常（HTTP ${res.status}），請稍後再試`,
    };
  }
}

function clampSpeed(n: number): number {
  const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, n));
  return Math.round(clamped / SPEED_STEP) * SPEED_STEP;
}

function readPlaybackSpeed(): number {
  try {
    const raw = localStorage.getItem(PLAYBACK_SPEED_KEY);
    if (!raw) return SPEED_DEFAULT;
    const n = Number(raw);
    if (Number.isNaN(n)) return SPEED_DEFAULT;
    return clampSpeed(n);
  } catch {
    return SPEED_DEFAULT;
  }
}

function readAiHistory(): AiHistoryEntry[] {
  try {
    const raw = localStorage.getItem(AI_HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (x): x is AiHistoryEntry =>
          !!x &&
          typeof x === "object" &&
          typeof (x as AiHistoryEntry).id === "string" &&
          typeof (x as AiHistoryEntry).script === "string"
      )
      .slice(0, AI_HISTORY_MAX);
  } catch {
    return [];
  }
}

function writeAiHistory(entries: AiHistoryEntry[]) {
  try {
    localStorage.setItem(
      AI_HISTORY_KEY,
      JSON.stringify(entries.slice(0, AI_HISTORY_MAX))
    );
  } catch {
    /* ignore */
  }
}

function readAiFavorites(): AiFavoriteEntry[] {
  try {
    const raw = localStorage.getItem(AI_FAVORITES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (x): x is AiFavoriteEntry =>
          !!x &&
          typeof x === "object" &&
          typeof (x as AiFavoriteEntry).id === "string" &&
          typeof (x as AiFavoriteEntry).script === "string" &&
          typeof (x as AiFavoriteEntry).createdAt === "number"
      )
      .slice(0, 100);
  } catch {
    return [];
  }
}

function writeAiFavorites(entries: AiFavoriteEntry[]) {
  try {
    localStorage.setItem(AI_FAVORITES_KEY, JSON.stringify(entries.slice(0, 100)));
  } catch {
    /* ignore */
  }
}

function formatAiHistoryWhen(savedAt: number) {
  try {
    return new Date(savedAt).toLocaleString("zh-TW", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
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

const VIDEO_CACHE_KEY = "pns_video_pack_v3";
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
      contentFlags: string[];
      fallbackLevel: number | null;
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
      contentFlags?: string[];
      fallbackLevel?: number | null;
    };
    if (!o?.fp || typeof o.savedAt !== "number" || !Array.isArray(o.videos)) return null;
    return {
      fp: o.fp,
      savedAt: o.savedAt,
      videos: o.videos,
      banner: o.banner ?? null,
      badge: typeof o.badge === "string" ? o.badge : null,
      contentFlags: Array.isArray(o.contentFlags)
        ? o.contentFlags.filter((x): x is string => typeof x === "string")
        : [],
      fallbackLevel:
        typeof o.fallbackLevel === "number" && (o.fallbackLevel === 1 || o.fallbackLevel === 2 || o.fallbackLevel === 3)
          ? o.fallbackLevel
          : null,
    };
  } catch {
    return null;
  }
}

function writeVideoCache(
  fp: string,
  videos: VideoItem[],
  banner: string | null,
  badge: string | null,
  contentFlags: string[],
  fallbackLevel: number | null
) {
  try {
    localStorage.setItem(
      VIDEO_CACHE_KEY,
      JSON.stringify({
        fp,
        savedAt: Date.now(),
        videos,
        banner,
        badge,
        contentFlags,
        fallbackLevel,
      })
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
      fallbackLevel?: number;
      contentFlags?: string[];
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
    const contentFlags = Array.isArray(d.contentFlags)
      ? (d.contentFlags as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined;
    const fl = d.fallbackLevel;
    const fallbackLevel =
      typeof fl === "number" && (fl === 1 || fl === 2 || fl === 3) ? fl : undefined;
    return {
      ok: true,
      videos: d.videos as RawVideoPayload[],
      banner: typeof d.banner === "string" ? d.banner : undefined,
      badge: typeof d.badge === "string" ? d.badge : undefined,
      source: typeof d.source === "string" ? d.source : undefined,
      fallbackLevel,
      contentFlags,
    };
  }

  if (Array.isArray(data)) {
    return { ok: true, videos: data as RawVideoPayload[] };
  }

  return { ok: false, error: "伺服器回傳格式無法辨識（需 ok + videos 或陣列）" };
}

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [selectedTopics, setSelectedTopics] = useState<string[]>(readSelectedTopics);
  const [customKeyword, setCustomKeyword] = useState(readCustomKeyword);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [favoriteLinks, setFavoriteLinks] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [newsBanner, setNewsBanner] = useState<string | null>(null);
  const [videoBanner, setVideoBanner] = useState<string | null>(null);
  const [videoBadge, setVideoBadge] = useState<string | null>(null);
  const [videoContentFlags, setVideoContentFlags] = useState<string[]>([]);
  const [lastUpdated, setLastUpdated] = useState("");
  const [speed, setSpeed] = useState(readPlaybackSpeed);
  const [aiDurationSheetOpen, setAiDurationSheetOpen] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState("");
  const [aiScript, setAiScript] = useState("");
  const [aiHighlights, setAiHighlights] = useState<AiHighlight[]>([]);
  const [aiJsonFallback, setAiJsonFallback] = useState(false);
  const [aiLastSavedAt, setAiLastSavedAt] = useState<number | null>(null);
  const [aiLastDuration, setAiLastDuration] = useState<AiDuration | null>(null);
  const [aiLastNewsTitles, setAiLastNewsTitles] = useState<string[]>([]);
  const [aiLastFp, setAiLastFp] = useState<string | null>(null);
  const [aiDuration, setAiDuration] = useState<AiDuration>(1);
  const [selectedScriptDuration, setSelectedScriptDuration] = useState<
    AiDuration | null
  >(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(-1);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [brokenVideoThumbIds, setBrokenVideoThumbIds] = useState<Record<string, true>>({});
  const [scriptFontSize, setScriptFontSize] = useState<ScriptFontSize>(readScriptFontSize);
  // v1 商業模式：免登入 + 廣告 + AI 次數限制（先固定 Free）
  const [proStatus, setProStatus] = useState<ProStatus>(() => getProStatus());
  const [showProDebugTools, setShowProDebugTools] = useState(() =>
    syncProDebugModeFromUrl()
  );
  const [upgradeModal, setUpgradeModal] = useState<UpgradeModalKind | null>(null);
  const [aiAnalysisMode, setAiAnalysisMode] = useState<AiAnalysisMode>("normal");
  const [savedCustomKeywords, setSavedCustomKeywords] = useState<string[]>(() =>
    readSavedCustomKeywords()
  );
  const [promoModalOpen, setPromoModalOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(() => !readOnboardingSeen());
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [splashOpen, setSplashOpen] = useState(() => !readSplashSeenSession());
  const [aiHistory, setAiHistory] = useState<AiHistoryEntry[]>(() => readAiHistory());
  const [activeAiHistoryId, setActiveAiHistoryId] = useState<string | null>(null);
  const [aiFavorites, setAiFavorites] = useState<AiFavoriteEntry[]>(() => readAiFavorites());
  const [aiQuota, setAiQuota] = useState(() => {
    const q = readAiDailyQuota();
    // 同步回寫一次，確保 key 存在、日期一致
    writeAiDailyQuota(q);
    return q;
  });

  const topicSelectionKeyRef = useRef<string | null>(null);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const currentSpeakTextRef = useRef<string>("");
  const speakStartedAtRef = useRef<number>(0);
  const lastBoundaryCharIndexRef = useRef<number>(0);
  const lastBoundaryAtRef = useRef<number>(0);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTtsErrorAtRef = useRef(0);
  const isManualStopRef = useRef(false);

  const selectedNews = news.filter((n) => n.selected);
  const favoriteNews = news.filter((n) => n.favorite);

  const isPro = isProActive(proStatus);
  const planLimits = useMemo(() => getPlanLimits(proStatus), [proStatus]);
  const aiDailyLimit = planLimits.aiDailyLimit;
  const aiQuotaRemaining = Math.max(0, aiDailyLimit - aiQuota.used);
  const visibleAiHistory = useMemo(
    () => filterHistoryByPlan(aiHistory, proStatus),
    [aiHistory, proStatus]
  );

  const refreshProStatus = useCallback(() => {
    setProStatus(getProStatus());
  }, []);

  const openProUpgrade = useCallback(() => {
    setUpgradeModal("general");
  }, []);

  const showProPaymentComingSoon = useCallback(() => {
    alert("Pro 訂閱即將開放，請稍後再試或使用兌換碼。");
  }, []);

  const setAiQuotaExhaustedMessage = useCallback(() => {
    if (isProActive(proStatus)) {
      setAiError("今日 AI 次數已用完，明天會自動重置");
    } else {
      setUpgradeModal("quota");
    }
  }, [proStatus]);

  const adSenseClientId = useMemo(() => readAdSenseClientId(), []);

  useEffect(() => {
    if (!adSenseClientId) return;
    const existingTagged = document.querySelector(
      `script[data-adsense-client="${adSenseClientId}"]`
    ) as HTMLScriptElement | null;
    if (existingTagged) return;

    // index.html may already include the AdSense script (without data attributes).
    const existingBySrc = Array.from(
      document.querySelectorAll('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]')
    ) as HTMLScriptElement[];
    if (existingBySrc.some((s) => (s.src ?? "").includes(`client=${encodeURIComponent(adSenseClientId)}`))) {
      return;
    }

    const s = document.createElement("script");
    s.async = true;
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(
      adSenseClientId
    )}`;
    s.crossOrigin = "anonymous";
    s.setAttribute("data-adsense-client", adSenseClientId);
    document.head.appendChild(s);
  }, [adSenseClientId]);

  useEffect(() => {
    refreshProStatus();
  }, [refreshProStatus]);

  useEffect(() => {
    setShowProDebugTools(syncProDebugModeFromUrl());
  }, [tab]);

  useEffect(() => {
    if (onboardingOpen) {
      // 避免進入 onboarding 時繼續播放
      window.speechSynthesis.cancel();
    }
  }, [onboardingOpen]);

  useEffect(() => {
    if (!splashOpen) return;
    const t = window.setTimeout(() => {
      writeSplashSeenSession();
      setSplashOpen(false);
    }, SPLASH_DURATION_MS);
    return () => window.clearTimeout(t);
  }, [splashOpen]);

  useEffect(() => {
    // 跨日自動重置（以本機 YYYY-MM-DD）
    const t = window.setInterval(() => {
      const today = todayYmdLocal();
      setAiQuota((prev) => {
        if (prev.date === today) return prev;
        const next = { date: today, used: 0 };
        writeAiDailyQuota(next);
        return next;
      });
    }, 10_000);
    return () => window.clearInterval(t);
  }, []);

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
    try {
      localStorage.setItem(SCRIPT_FONT_KEY, scriptFontSize);
    } catch {
      /* ignore */
    }
  }, [scriptFontSize]);

  useEffect(() => {
    writeSelectedTopics(selectedTopics);
  }, [selectedTopics]);

  useEffect(() => {
    writeCustomKeyword(customKeyword);
  }, [customKeyword]);

  useEffect(() => {
    return () => {
      if (progressTimerRef.current != null) {
        clearInterval(progressTimerRef.current);
      }
      window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    const latest = readAiHistory()[0];
    if (!latest?.script?.trim()) return;
    setAiScript(latest.script);
    setAiHighlights(latest.highlights ?? []);
    setAiJsonFallback(Boolean(latest.jsonFallback));
    setSelectedScriptDuration(latest.duration);
    setAiDuration(latest.duration);
    setActiveAiHistoryId(latest.id);
  }, []);

  const persistPlaybackSpeed = useCallback((rate: number) => {
    const next = clampSpeed(rate);
    setSpeed(next);
    try {
      localStorage.setItem(PLAYBACK_SPEED_KEY, String(next));
    } catch {
      /* ignore */
    }
    return next;
  }, []);

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
    setNewsBanner(null);

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
      setNews([]);
      setLastUpdated("");
      setNewsBanner("暫時無法載入新聞，請檢查網路後再試一次。");
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
          setVideoContentFlags(hit.contentFlags ?? []);
          return;
        }
      }

      setVideoLoading(true);
      setVideoBanner(null);
      setVideoBadge(null);
      setVideoContentFlags([]);

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
          setVideoContentFlags([]);
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
        setVideoContentFlags(parsed.contentFlags ?? []);

        if (mapped.length > 0) {
          writeVideoCache(
            fp,
            mapped,
            parsed.banner ?? null,
            parsed.badge ?? null,
            parsed.contentFlags ?? [],
            parsed.fallbackLevel ?? null
          );
        }
      } catch (e) {
        console.error(e);
        setVideos([]);
        setVideoBadge(null);
        setVideoContentFlags([]);
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
    if (!ENABLE_VIDEO_NEWS_UI && tab === "video") {
      setTab("home");
    }
  }, [tab]);

  useEffect(() => {
    if (!ENABLE_VIDEO_NEWS_UI || tab !== "video") return;
    void loadVideos(false);
  }, [tab, loadVideos]);

  const updateMyNews = () => {
    setTab("home");
    void fetchNews();
  };

  const updateVideos = () => {
    if (!ENABLE_VIDEO_NEWS_UI) return;
    setTab("video");
    void loadVideos(true);
  };

  const toggleTopic = (label: string) => {
    setSelectedTopics((prev) => {
      if (prev.includes(label)) {
        return prev.filter((t) => t !== label);
      }
      if (!canAddTopic(prev.length, proStatus)) {
        if (isProActive(proStatus)) {
          alert("已達 Pro 主題追蹤上限");
        } else {
          setUpgradeModal("topic");
        }
        return prev;
      }
      return [...prev, label];
    });
  };

  const selectAllTopics = () => {
    const limit = getPlanLimits(proStatus).topicLimit;
    setSelectedTopics(topics.map((t) => t.label).slice(0, limit));
  };

  const clearTopics = () => {
    setSelectedTopics([]);
  };

  const resetDefaultTopics = () => {
    setSelectedTopics(DEFAULT_TOPICS);
  };

  const toggleNews = (id: string) => {
    setNews((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, selected: !item.selected } : item
      )
    );
  };

  const toggleFavorite = (item: NewsItem) => {
    if (!item.favorite && !favoriteLinks.includes(item.link)) {
      if (!canAddFavorite(favoriteLinks.length, proStatus)) {
        if (isProActive(proStatus)) {
          alert("已達 Pro 收藏上限");
        } else {
          setUpgradeModal("favorite");
        }
        return;
      }
    }

    setNews((prev) =>
      prev.map((n) => (n.id === item.id ? { ...n, favorite: !n.favorite } : n))
    );

    setFavoriteLinks((prev) =>
      prev.includes(item.link)
        ? prev.filter((link) => link !== item.link)
        : [...prev, item.link]
    );
  };

  const addSavedCustomKeyword = () => {
    const kw = customKeyword.trim();
    if (!kw) {
      alert("請先輸入關鍵字");
      return;
    }
    if (savedCustomKeywords.includes(kw)) {
      alert("此關鍵字已在清單中");
      return;
    }
    if (!canAddCustomKeyword(savedCustomKeywords.length, proStatus)) {
      if (isProActive(proStatus)) {
        alert("已達 Pro 自訂關鍵字上限");
      } else {
        setUpgradeModal("keyword");
      }
      return;
    }
    const next = [...savedCustomKeywords, kw];
    setSavedCustomKeywords(next);
    writeSavedCustomKeywords(next);
  };

  const removeSavedCustomKeyword = (kw: string) => {
    const next = savedCustomKeywords.filter((k) => k !== kw);
    setSavedCustomKeywords(next);
    writeSavedCustomKeywords(next);
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

  const clearProgressTimer = () => {
    if (progressTimerRef.current != null) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  };

  const stopPlayback = useCallback(() => {
    isManualStopRef.current = true;
    currentUtteranceRef.current = null;

    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }

    clearProgressTimer();
    setIsSpeaking(false);
    setIsPaused(false);
    setCurrentChunkIndex(-1);
    setPlaybackProgress(0);
    setRemainingMs(0);
    setPlaybackMode(null);
    setTotalChunks(0);
  }, []);

  const pausePlayback = useCallback(() => {
    try {
      window.speechSynthesis.pause();
    } catch {
      /* ignore */
    }
    setIsPaused(true);
  }, []);

  const resumePlayback = useCallback(() => {
    try {
      window.speechSynthesis.resume();
    } catch {
      /* ignore */
    }
    setIsPaused(false);
  }, []);

  const startPlayback = useCallback((scriptOverride?: string) => {
    const scriptText = (scriptOverride ?? aiScript).trim();
    const hasAi = scriptText.length > 0;
    if (!hasAi && selectedNews.length === 0) {
      alert("請先選擇要播放的新聞，或先產生 AI 新聞稿");
      return;
    }

    isManualStopRef.current = false;

    const mode: PlaybackMode = hasAi ? "ai" : "news";
    const textToSpeak = hasAi
      ? scriptText
      : selectedNews.map((n, i) => `第 ${i + 1} 則新聞，${n.title}`).join("。");

    setPlaybackMode(mode);
    setTab("player");
    // 先顯示「準備播放」狀態，避免使用者覺得沒反應
    setIsSpeaking(true);
    setIsPaused(false);
    setPlaybackProgress(0);
    setRemainingMs(0);
    setCurrentChunkIndex(0);
    setTotalChunks(0);

    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }

    const selectedVoice = voices.find((v) => v.name === voiceName);
    const u = new SpeechSynthesisUtterance(textToSpeak);
    u.lang = "zh-TW";
    u.rate = speed;
    if (selectedVoice) u.voice = selectedVoice;
    currentUtteranceRef.current = u;
    currentSpeakTextRef.current = textToSpeak;
    speakStartedAtRef.current = Date.now();
    lastBoundaryCharIndexRef.current = 0;
    lastBoundaryAtRef.current = Date.now();

    u.onboundary = (ev) => {
      if (currentUtteranceRef.current !== u) return;
      const idx =
        typeof (ev as unknown as { charIndex?: unknown }).charIndex === "number"
          ? Number((ev as unknown as { charIndex: number }).charIndex)
          : NaN;
      if (!Number.isNaN(idx) && idx >= 0) {
        lastBoundaryCharIndexRef.current = idx;
        lastBoundaryAtRef.current = Date.now();
      }
    };

    u.onend = () => {
      if (currentUtteranceRef.current !== u) return;
      setIsSpeaking(false);
      setIsPaused(false);
      setPlaybackMode(null);
      currentUtteranceRef.current = null;
    };

    u.onerror = () => {
      if (currentUtteranceRef.current !== u) return;
      if (isManualStopRef.current) return;
      setIsSpeaking(false);
      setIsPaused(false);
      currentUtteranceRef.current = null;
      const now = Date.now();
      if (now - lastTtsErrorAtRef.current > 2500) {
        lastTtsErrorAtRef.current = now;
        alert("無法啟動語音朗讀。請確認裝置音量、靜音模式與瀏覽器語音權限。");
      }
    };

    try {
      window.speechSynthesis.speak(u);
    } catch {
      u.onerror?.(new Event("error"));
    }
  }, [aiScript, selectedNews, speed, voices, voiceName]);

  const togglePlayPause = useCallback(() => {
    if (isPaused) {
      resumePlayback();
      return;
    }
    if (isSpeaking) {
      pausePlayback();
      return;
    }
    startPlayback();
  }, [isPaused, isSpeaking, resumePlayback, pausePlayback, startPlayback]);

  const changeSpeed = (newSpeed: number) => {
    const next = persistPlaybackSpeed(newSpeed);
    if (!isSpeaking && !isPaused) return;

    // 播放中調速：從目前位置附近續播（cancel 屬正常行為，不顯示錯誤）
    const currentText = currentSpeakTextRef.current;
    if (!currentText.trim()) return;

    // 若 onboundary 有回報就用；否則用時間估算
    const boundaryIdx = lastBoundaryCharIndexRef.current;
    let approxIdx = boundaryIdx;
    if (!approxIdx || approxIdx <= 0) {
      const elapsedMs = Math.max(0, Date.now() - speakStartedAtRef.current);
      const estCharsPerMs = 1 / Math.max(1, estimateChunkDurationMs("一".repeat(100), speed) / 100);
      approxIdx = Math.floor(elapsedMs * estCharsPerMs);
    }

    const resumeAt = findResumeIndex(currentText, approxIdx);
    const remain = currentText.slice(resumeAt).trim();
    if (!remain) {
      stopPlayback();
      return;
    }

    const selectedVoice = voices.find((v) => v.name === voiceName);
    const u = new SpeechSynthesisUtterance(remain);
    u.lang = "zh-TW";
    u.rate = next;
    if (selectedVoice) u.voice = selectedVoice;

    // 進度 ref 更新，避免後續再次調速仍從頭
    currentUtteranceRef.current = u;
    currentSpeakTextRef.current = remain;
    speakStartedAtRef.current = Date.now();
    lastBoundaryCharIndexRef.current = 0;
    lastBoundaryAtRef.current = Date.now();

    u.onboundary = (ev) => {
      if (currentUtteranceRef.current !== u) return;
      const idx =
        typeof (ev as unknown as { charIndex?: unknown }).charIndex === "number"
          ? Number((ev as unknown as { charIndex: number }).charIndex)
          : NaN;
      if (!Number.isNaN(idx) && idx >= 0) {
        lastBoundaryCharIndexRef.current = idx;
        lastBoundaryAtRef.current = Date.now();
      }
    };
    u.onend = () => {
      if (currentUtteranceRef.current !== u) return;
      setIsSpeaking(false);
      setIsPaused(false);
      setPlaybackMode(null);
      currentUtteranceRef.current = null;
      currentSpeakTextRef.current = "";
    };
    u.onerror = () => {
      if (currentUtteranceRef.current !== u) return;
      if (isManualStopRef.current) return;
      setIsSpeaking(false);
      setIsPaused(false);
      currentUtteranceRef.current = null;
      currentSpeakTextRef.current = "";
      const now = Date.now();
      if (now - lastTtsErrorAtRef.current > 2500) {
        lastTtsErrorAtRef.current = now;
        alert("無法啟動語音朗讀。請確認裝置音量、靜音模式與瀏覽器語音權限。");
      }
    };

    // 調速的 cancel 是正常行為，避免誤報
    isManualStopRef.current = true;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
    isManualStopRef.current = false;
    setIsPaused(false);
    setIsSpeaking(true);
    try {
      window.speechSynthesis.speak(u);
    } catch {
      u.onerror?.(new Event("error"));
    }
  };

  const clearAiCache = () => {
    try {
      localStorage.removeItem(AI_SUMMARY_CACHE_KEY);
      localStorage.removeItem(AI_HISTORY_KEY);
    } catch {
      /* ignore */
    }
    setAiScript("");
    setAiHighlights([]);
    setAiJsonFallback(false);
    setAiError(null);
    setSelectedScriptDuration(null);
    setAiHistory([]);
    setActiveAiHistoryId(null);
  };

  const appendAiHistoryEntry = useCallback((entry: AiHistoryEntry) => {
    setAiHistory((prev) => {
      const next = [entry, ...prev.filter((e) => e.id !== entry.id)].slice(
        0,
        AI_HISTORY_MAX
      );
      writeAiHistory(next);
      return next;
    });
    setActiveAiHistoryId(entry.id);
  }, []);

  const removeAiHistoryEntry = useCallback((id: string) => {
    setAiHistory((prev) => {
      const next = prev.filter((e) => e.id !== id);
      writeAiHistory(next);
      return next;
    });
    setActiveAiHistoryId((cur) => (cur === id ? null : cur));
  }, []);

  const clearAllAiHistory = useCallback(() => {
    if (
      !window.confirm("確定清空全部 AI 歷史紀錄？此動作無法復原。")
    ) {
      return;
    }
    writeAiHistory([]);
    setAiHistory([]);
    setActiveAiHistoryId(null);
  }, []);

  const loadAiHistoryEntry = useCallback((entry: AiHistoryEntry) => {
    setAiScript(entry.script);
    setAiHighlights(entry.highlights ?? []);
    setAiJsonFallback(Boolean(entry.jsonFallback));
    setSelectedScriptDuration(entry.duration);
    setAiDuration(entry.duration);
    setAiError(null);
    setActiveAiHistoryId(entry.id);
    setTab("player");
  }, []);

  const copyAiScriptText = async (text: string) => {
    const t = text.trim();
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

  const playAiHistoryEntry = useCallback(
    (entry: AiHistoryEntry) => {
      setAiScript(entry.script);
      setAiHighlights(entry.highlights ?? []);
      setAiJsonFallback(Boolean(entry.jsonFallback));
      setSelectedScriptDuration(entry.duration);
      setAiDuration(entry.duration);
      setAiError(null);
      setActiveAiHistoryId(entry.id);
      setTab("player");
      startPlayback(entry.script);
    },
    [startPlayback]
  );

  const openAiAnalysis = () => {
    if (selectedNews.length === 0) {
      alert("請先勾選新聞");
      return;
    }
    const q = readAiDailyQuota();
    if (q.date !== todayYmdLocal()) {
      const next = { date: todayYmdLocal(), used: 0 };
      writeAiDailyQuota(next);
      setAiQuota(next);
    } else {
      setAiQuota(q);
    }
    const remaining = Math.max(0, getAiDailyLimit(proStatus) - q.used);
    if (remaining <= 0) {
      setAiQuotaExhaustedMessage();
      return;
    }
    setAiDurationSheetOpen(true);
  };

  const runAiAnalysisWithDuration = (duration: AiDuration) => {
    if (duration === 5 && !canUseFiveMinuteScript(proStatus)) {
      setAiDurationSheetOpen(false);
      setUpgradeModal("five_minute");
      return;
    }
    if (aiAnalysisMode === "deep" && !canUseDeepMode(proStatus)) {
      setAiDurationSheetOpen(false);
      setUpgradeModal("deep");
      return;
    }

    setAiDuration(duration);
    setAiDurationSheetOpen(false);
    void fetchAiSummary(duration);
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
3. 依重要程度動態調整每則篇幅（🔥多講、ℹ️簡短）
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

  const fetchAiSummary = async (durationOverride?: AiDuration) => {
    const picked = selectedNews.slice(0, 5);
    if (picked.length === 0) {
      alert("請先選擇新聞");
      return;
    }

    const duration = durationOverride ?? aiDuration;

    if (duration === 5 && !canUseFiveMinuteScript(proStatus)) {
      setUpgradeModal("five_minute");
      return;
    }
    if (aiAnalysisMode === "deep" && !canUseDeepMode(proStatus)) {
      setUpgradeModal("deep");
      return;
    }

    // 每次呼叫前先檢查今日額度（用完就阻止，不呼叫 API）
    const q = readAiDailyQuota();
    const today = todayYmdLocal();
    const normalized = q.date === today ? q : { date: today, used: 0 };
    if (q.date !== normalized.date || q.used !== normalized.used) {
      writeAiDailyQuota(normalized);
    }
    setAiQuota(normalized);
    const remaining = Math.max(0, getAiDailyLimit(proStatus) - normalized.used);
    if (remaining <= 0) {
      setAiQuotaExhaustedMessage();
      return;
    }
    setAiError(null);
    const deepMode = aiAnalysisMode === "deep" && canUseDeepMode(proStatus);
    const fp = aiSummaryCacheFingerprint(picked, duration, deepMode);

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
          newsTitles?: string[];
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
          setAiLastSavedAt(o.savedAt);
          setAiLastDuration(o.duration === 3 || o.duration === 5 ? o.duration : duration);
          setAiLastNewsTitles(
            Array.isArray(o.newsTitles) && o.newsTitles.every((t) => typeof t === "string")
              ? (o.newsTitles as string[])
              : picked.map((n) => n.title)
          );
          setAiLastFp(fp);
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
          deepMode,
          items: picked.map((n) => ({ title: n.title, source: n.source })),
        }),
      });
      const { data, error: parseError } = await readSummaryApiPayload(res);
      if (parseError || !data) {
        setAiError(parseError || "AI 精華產生失敗");
        await runGptFallbackClipboard();
        return;
      }

      if (!data.ok) {
        const msg =
          data.code === "NO_KEY"
            ? "尚未設定 AI API Key"
            : data.code === "TIMEOUT"
              ? "AI 產生逾時，請改選較短時長或一般整理模式後再試"
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

      const savedAt = Date.now();
      try {
        localStorage.setItem(
          AI_SUMMARY_CACHE_KEY,
          JSON.stringify({
            fp,
            savedAt,
            duration,
            highlights,
            script,
            jsonFallback: Boolean(data.jsonFallback),
            newsTitles: picked.map((n) => n.title),
          })
        );
      } catch {
        /* ignore */
      }

      const historyEntry: AiHistoryEntry = {
        id: `${savedAt}-${fp.slice(0, 48)}`,
        savedAt,
        duration:
          data.duration === 3 || data.duration === 5 ? data.duration : duration,
        script,
        highlights,
        jsonFallback: Boolean(data.jsonFallback),
        newsTitles: picked.map((n) => n.title),
      };
      appendAiHistoryEntry(historyEntry);
      setAiLastSavedAt(savedAt);
      setAiLastDuration(historyEntry.duration);
      setAiLastNewsTitles(historyEntry.newsTitles);
      setAiLastFp(fp);

      // 僅在成功產生後才扣次數（API 失敗 / 沒選新聞 / 回傳空字串都不扣）
      setAiQuota((prev) => {
        const today = todayYmdLocal();
        const base = prev.date === today ? prev : { date: today, used: 0 };
        const next = { date: today, used: base.used + 1 };
        writeAiDailyQuota(next);
        return next;
      });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "網路或伺服器錯誤");
      await runGptFallbackClipboard();
    } finally {
      setAiLoading(false);
    }
  };

  const copyAiScript = async () => {
    await copyAiScriptText(aiScript);
  };

  const currentAiFavoriteId = useMemo(() => {
    if (!aiLastFp) return null;
    const createdAt = typeof aiLastSavedAt === "number" ? aiLastSavedAt : null;
    if (!createdAt) return null;
    return `${createdAt}-${aiLastFp.slice(0, 48)}`;
  }, [aiLastFp, aiLastSavedAt]);

  const currentAiIsFavorited = useMemo(() => {
    if (!currentAiFavoriteId) return false;
    return aiFavorites.some((f) => f.id === currentAiFavoriteId);
  }, [aiFavorites, currentAiFavoriteId]);

  const toggleAiFavorite = useCallback(() => {
    const script = aiScript.trim();
    if (!script) {
      alert("尚無 AI 主播稿可收藏");
      return;
    }
    if (!aiLastFp || typeof aiLastSavedAt !== "number") {
      alert("此份 AI 主播稿尚未完成保存，請稍後再試。");
      return;
    }
    const id = `${aiLastSavedAt}-${aiLastFp.slice(0, 48)}`;
    setAiFavorites((prev) => {
      const exists = prev.some((x) => x.id === id);
      const next = exists
        ? prev.filter((x) => x.id !== id)
        : [
            {
              id,
              createdAt: aiLastSavedAt,
              duration: aiLastDuration ?? (selectedScriptDuration ?? 1),
              highlights: aiHighlights,
              script,
              newsTitles: aiLastNewsTitles,
              selectedTopics,
              keyword: customKeyword.trim() || undefined,
            },
            ...prev,
          ];
      writeAiFavorites(next);
      return next;
    });
  }, [
    aiScript,
    aiLastFp,
    aiLastSavedAt,
    aiLastDuration,
    selectedScriptDuration,
    aiHighlights,
    aiLastNewsTitles,
    selectedTopics,
    customKeyword,
  ]);

  const loadAiFavorite = useCallback(
    (fav: AiFavoriteEntry, autoplay: boolean) => {
      setAiScript(fav.script);
      setAiHighlights(fav.highlights ?? []);
      setAiJsonFallback(false);
      setSelectedScriptDuration(fav.duration);
      setAiDuration(fav.duration);
      setAiError(null);
      setAiLastSavedAt(fav.createdAt);
      setAiLastDuration(fav.duration);
      setAiLastNewsTitles(Array.isArray(fav.newsTitles) ? fav.newsTitles : []);
      setAiLastFp(fav.id.split("-").slice(1).join("-") || fav.id);
      setTab("player");
      if (autoplay) startPlayback(fav.script);
    },
    [startPlayback]
  );

  const pageTitle =
    tab === "home"
      ? "首頁"
      : tab === "player"
        ? "播放控制台"
        : tab === "video"
          ? ENABLE_VIDEO_NEWS_UI
            ? "影音新聞"
            : "首頁"
          : tab === "favorites"
            ? "收藏新聞"
            : "個人設定";

  const showFloatingPlayer = (isSpeaking || isPaused) && tab !== "player";

  return (
    <div style={styles.page}>
      <div
        style={{
          ...styles.phone,
          paddingBottom: showFloatingPlayer
            ? "calc(132px + env(safe-area-inset-bottom, 0px))"
            : styles.phone.paddingBottom,
        }}
      >
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
                onClick={() => startPlayback()}
                style={{
                  ...styles.toolbarBtn,
                  ...styles.toolbarBtnPlay,
                }}
              >
                {aiScript.trim() ? "▶ 播放 AI 稿" : "▶ 播放"}
              </button>
              <button
                type="button"
                onClick={openAiAnalysis}
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
                {aiLoading ? "AI 分析中..." : "✨ AI 分析"}
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

            {newsBanner ? (
              <div style={styles.videoInfoBanner} role="status">
                {newsBanner}
              </div>
            ) : null}

            {!isPro ? (
              <ProUpgradeCard
                variant="compact"
                proStatus={proStatus}
                onUpgrade={openProUpgrade}
                onRedeem={() => setPromoModalOpen(true)}
              />
            ) : null}

            <AiSummaryPanel
              aiLoading={aiLoading}
              aiError={aiError}
              aiScript={aiScript}
              aiHighlights={aiHighlights}
              aiJsonFallback={aiJsonFallback}
              selectedScriptDuration={selectedScriptDuration}
              scriptFontSize={scriptFontSize}
              onScriptFontSizeChange={setScriptFontSize}
              isSpeaking={isSpeaking}
              isPaused={isPaused}
              onPlayScript={(script) => startPlayback(script)}
              onStopScript={stopPlayback}
              onCopyScript={() => void copyAiScript()}
              onOpenAnalysis={openAiAnalysis}
              selectedNewsCount={selectedNews.length}
              isPro={isPro}
              aiQuotaRemaining={aiQuotaRemaining}
              aiDailyLimit={aiDailyLimit}
              onOpenProModal={openProUpgrade}
              aiFavorited={currentAiIsFavorited}
              onToggleAiFavorite={toggleAiFavorite}
            />

            <NewsList
              title="新聞"
              compact
              denseCards
              isPro={isPro}
              homeToolbar={{
                selectAll,
                clearAll,
                lastUpdated,
              }}
              news={news}
              loading={loading}
              toggleNews={toggleNews}
              toggleFavorite={toggleFavorite}
              emptyText="目前沒有新聞。可先按「更新」或稍後再試。"
            />

            <SiteFooter />
          </>
        )}

        {tab === "player" && (
          <>
            <PlayerDeck
              isSpeaking={isSpeaking}
              isPaused={isPaused}
              playbackProgress={playbackProgress}
              remainingMs={remainingMs}
              speed={speed}
              playbackMode={playbackMode}
              currentChunkIndex={currentChunkIndex}
              totalChunks={totalChunks}
              aiScript={aiScript}
              selectedNewsCount={selectedNews.length}
              voiceName={voiceName}
              voices={voices}
              onVoiceChange={setVoiceName}
              onSpeedChange={changeSpeed}
              onTogglePlayPause={togglePlayPause}
              onStop={stopPlayback}
              onStart={startPlayback}
              onOpenAnalysis={openAiAnalysis}
              aiLoading={aiLoading}
            />

            {!isPro ? (
              <AdSenseSlot
                clientId={readAdSenseClientId()}
                slotId={ADSENSE_PLAYER_BANNER_SLOT_ID}
                format="horizontal"
                placeholderVariant="banner"
              />
            ) : null}

            <AiSummaryPanel
              aiLoading={aiLoading}
              aiError={aiError}
              aiScript={aiScript}
              aiHighlights={aiHighlights}
              aiJsonFallback={aiJsonFallback}
              selectedScriptDuration={selectedScriptDuration}
              scriptFontSize={scriptFontSize}
              onScriptFontSizeChange={setScriptFontSize}
              isSpeaking={isSpeaking}
              isPaused={isPaused}
              onPlayScript={(script) => startPlayback(script)}
              onStopScript={stopPlayback}
              onCopyScript={() => void copyAiScript()}
              onOpenAnalysis={openAiAnalysis}
              selectedNewsCount={selectedNews.length}
              isPro={isPro}
              aiQuotaRemaining={aiQuotaRemaining}
              aiDailyLimit={aiDailyLimit}
              onOpenProModal={openProUpgrade}
              aiFavorited={currentAiIsFavorited}
              onToggleAiFavorite={toggleAiFavorite}
            />

            <NewsList
              title="即將播放"
              news={selectedNews}
              loading={false}
              toggleNews={toggleNews}
              toggleFavorite={toggleFavorite}
              emptyText="目前沒有選取新聞，請回首頁勾選。"
              playingIndex={
                playbackMode === "news" && currentChunkIndex >= 0
                  ? currentChunkIndex
                  : -1
              }
            />
          </>
        )}

        {ENABLE_VIDEO_NEWS_UI && tab === "video" && (
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

            {(videoBanner ||
              videoContentFlags.length > 0 ||
              videoBadge) && (
              <div style={styles.videoInfoBanner} role="status">
                {(videoContentFlags.length > 0 || videoBadge) && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      alignItems: "center",
                      marginBottom: videoBanner ? "10px" : 0,
                    }}
                  >
                    {(videoContentFlags.length > 0
                      ? videoContentFlags
                      : videoBadge
                        ? [videoBadge]
                        : []
                    ).map((label) => (
                      <span key={label} style={styles.videoBadgePill}>
                        {label}
                      </span>
                    ))}
                  </div>
                )}
                {videoBanner ? (
                  <div style={{ whiteSpace: "pre-line" }}>{videoBanner}</div>
                ) : null}
              </div>
            )}

            {videoLoading && (
              <div style={{ ...styles.loading, marginBottom: "12px" }}>影音讀取中…</div>
            )}

            <div style={styles.videoGrid}>
              {videos.map((video) => {
                const dateLine = formatVideoPublished(video.publishedAt);
                const thumbBroken = Boolean(brokenVideoThumbIds[video.id]);
                return (
                  <a
                    key={video.id}
                    href={video.link}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.videoTile}
                  >
                    <div style={styles.videoThumbWrap}>
                      {video.thumbnail && !thumbBroken ? (
                        <img
                          src={video.thumbnail}
                          alt=""
                          style={styles.videoThumbImg}
                          onError={() =>
                            setBrokenVideoThumbIds((prev) => ({ ...prev, [video.id]: true }))
                          }
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

            <AiFavoritesSection
              favorites={aiFavorites}
              onOpen={(fav) => loadAiFavorite(fav, true)}
              onPlay={(fav) => loadAiFavorite(fav, true)}
              onCopy={(fav) => void copyAiScriptText(fav.script)}
              onToggle={(id) => {
                setAiFavorites((prev) => {
                  const next = prev.filter((x) => x.id !== id);
                  writeAiFavorites(next);
                  return next;
                });
              }}
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
            <ProStatusCard proStatus={proStatus} showDebugTools={showProDebugTools} />

            {!isPro ? (
              <ProUpgradeCard
                variant="settings"
                proStatus={proStatus}
                onUpgrade={openProUpgrade}
                onRedeem={() => setPromoModalOpen(true)}
              />
            ) : null}

            <section style={styles.controlPanel}>
              <div style={styles.controlTitle}>帳號同步</div>
              <div style={styles.settingHint}>
                帳號同步功能即將開放，目前資料會保存在本機。
              </div>
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                style={styles.fullButton}
              >
                了解更多
              </button>
            </section>

            <section style={styles.controlPanel}>
              <div style={styles.controlTitle}>我的追蹤主題</div>

              <div style={styles.settingHint}>
                首頁會依照這些主題整理新聞。想搜尋單一事件，可直接在首頁搜尋框輸入關鍵字。
              </div>
              <div style={styles.settingHint}>
                已選 {selectedTopics.length} / {planLimits.topicLimit} 個主題
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
              <div style={styles.settingHint}>
                已儲存 {savedCustomKeywords.length} / {planLimits.customKeywordLimit} 個
              </div>
              <input
                value={customKeyword}
                onChange={(e) => setCustomKeyword(e.target.value)}
                placeholder="例如：俄烏戰爭、Solana、台積電..."
                style={styles.settingInput}
              />
              <div style={styles.actionRow}>
                <button type="button" onClick={addSavedCustomKeyword} style={styles.miniButton}>
                  加入關鍵字清單
                </button>
                <button onClick={updateMyNews} style={styles.gptButton}>
                  套用並更新新聞
                </button>
              </div>
              {savedCustomKeywords.length > 0 ? (
                <div style={styles.savedKeywordChips}>
                  {savedCustomKeywords.map((kw) => (
                    <span key={kw} style={styles.savedKeywordChip}>
                      {kw}
                      <button
                        type="button"
                        onClick={() => removeSavedCustomKeyword(kw)}
                        style={styles.savedKeywordChipRemove}
                        aria-label={`移除 ${kw}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </section>

            <AiHistorySection
              entries={visibleAiHistory}
              activeId={activeAiHistoryId}
              onSelect={loadAiHistoryEntry}
              onPlay={playAiHistoryEntry}
              onCopy={(entry) => void copyAiScriptText(entry.script)}
              onDelete={removeAiHistoryEntry}
              onClearAll={clearAllAiHistory}
              historyHint={
                isPro
                  ? "Pro 可顯示最近 180 天 AI 新聞稿歷史"
                  : "免費版顯示最近 7 天 AI 新聞稿歷史。升級 Pro 可保留更長時間"
              }
              hiddenOlderCount={aiHistory.length - visibleAiHistory.length}
            />

            <section style={styles.controlPanel}>
              <div style={styles.controlTitle}>AI 使用額度</div>
              <div style={styles.planQuotaRow}>
                <div style={styles.planQuotaLeft}>
                  <div style={styles.planQuotaTitle}>今日剩餘</div>
                  <div style={styles.planQuotaValue}>
                    {aiQuotaRemaining} / {aiDailyLimit} 次
                  </div>
                </div>
                <div style={styles.planQuotaRight}>
                  <div style={styles.planQuotaNote}>
                    {isPro ? "Pro 方案" : "Free 方案"}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.removeItem("pns_ai_daily_quota_v1");
                  } catch {
                    /* ignore */
                  }
                  setAiQuota({ date: todayYmdLocal(), used: 0 });
                  alert("已重置今日 AI 次數");
                }}
                style={styles.dangerFullButton}
              >
                重置 AI 次數
              </button>
            </section>

            <section style={styles.controlPanel}>
              <div style={styles.controlTitle}>語音設定</div>

              <select
                value={voiceName}
                onChange={(e) => {
                  isManualStopRef.current = true;
                  setVoiceName(e.target.value);
                }}
                style={styles.select}
              >
                {voices.map((voice) => (
                  <option key={voice.name} value={voice.name}>
                    {voice.name}（{voice.lang}）
                  </option>
                ))}
              </select>

              <div style={styles.speedRow}>
                <span>播放速度 {speed.toFixed(2)}x</span>
                <input
                  type="range"
                  min={String(SPEED_MIN)}
                  max={String(SPEED_MAX)}
                  step={String(SPEED_STEP)}
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

            <section style={styles.controlPanel}>
              <div style={styles.controlTitle}>幫助 / 關於</div>
              <button
                type="button"
                onClick={() => {
                  writeOnboardingSeen(false);
                  setOnboardingStep(0);
                  setOnboardingOpen(true);
                }}
                style={{ ...styles.toolbarBtnNeutral, width: "100%", marginTop: "10px" }}
              >
                重新觀看新手教學
              </button>
            </section>

            <section style={styles.controlPanel}>
              <div style={styles.controlTitle}>法律與隱私</div>
              <div style={styles.settingHint}>
                上架審查與使用者權益相關說明。
              </div>
              <div style={styles.legalLinksRow}>
                <a href="/privacy" style={styles.legalLink}>
                  隱私權政策
                </a>
                <a href="/terms" style={styles.legalLink}>
                  服務條款
                </a>
              </div>
            </section>
          </>
        )}

        <BottomNav tab={tab} setTab={setTab} />

        {showFloatingPlayer ? (
          <FloatingPlayerBar
            isPaused={isPaused}
            playbackProgress={playbackProgress}
            remainingMs={remainingMs}
            speed={speed}
            playbackMode={playbackMode}
            onTogglePlayPause={togglePlayPause}
            onStop={stopPlayback}
            onOpenPlayer={() => setTab("player")}
          />
        ) : null}

        {aiDurationSheetOpen ? (
          <AiDurationSheet
            loading={aiLoading}
            onClose={() => setAiDurationSheetOpen(false)}
            onSelect={runAiAnalysisWithDuration}
            isPro={isPro}
            analysisMode={aiAnalysisMode}
            onAnalysisModeChange={setAiAnalysisMode}
            onOpenProModal={(kind) => {
              setAiDurationSheetOpen(false);
              setUpgradeModal(kind);
            }}
          />
        ) : null}

        {upgradeModal ? (
          <UpgradeModal
            kind={upgradeModal}
            onClose={() => setUpgradeModal(null)}
            onRedeem={() => {
              setUpgradeModal(null);
              setPromoModalOpen(true);
            }}
            onUpgrade={showProPaymentComingSoon}
          />
        ) : null}

        {promoModalOpen ? (
          <PromoRedeemModal
            onClose={() => setPromoModalOpen(false)}
            onRedeemed={(status, message) => {
              setProStatus(status);
              setPromoModalOpen(false);
              alert(message);
            }}
          />
        ) : null}

        {splashOpen ? <SplashScreen /> : null}

        {authModalOpen ? (
          <AuthComingSoonModal onClose={() => setAuthModalOpen(false)} />
        ) : null}

        {onboardingOpen && !splashOpen ? (
          <OnboardingModal
            step={onboardingStep}
            onPrev={() => setOnboardingStep((s) => Math.max(0, s - 1))}
            onNext={() => setOnboardingStep((s) => Math.min(3, s + 1))}
            onSkip={() => {
              writeOnboardingSeen(true);
              setOnboardingOpen(false);
            }}
            onDone={() => {
              writeOnboardingSeen(true);
              setOnboardingOpen(false);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

const COLLAPSED_LINES = 5;
const HIGHLIGHT_PREVIEW_LINES = 2;

function CollapsibleHighlightItem({ highlight }: { highlight: AiHighlight }) {
  const [expanded, setExpanded] = useState(false);
  const summary = highlight.summary.trim();
  const needsCollapse =
    summary.length > 48 || summary.split("\n").length > HIGHLIGHT_PREVIEW_LINES;

  return (
    <li style={styles.aiHighlightItem}>
      <button
        type="button"
        className="ai-highlight-card"
        onClick={() => needsCollapse && setExpanded((v) => !v)}
        style={{
          ...styles.aiHighlightCardBtn,
          cursor: needsCollapse ? "pointer" : "default",
        }}
        aria-expanded={needsCollapse ? expanded : undefined}
      >
        <div style={styles.aiHighlightLevel}>{highlight.level}</div>
        <div style={styles.aiHighlightTitle}>{highlight.title}</div>
        {summary ? (
          <div
            className={expanded ? "ai-highlight-body-expanded" : "ai-highlight-body-collapsed"}
            style={{
              ...styles.aiHighlightSummary,
              ...(needsCollapse && !expanded
                ? {
                    display: "-webkit-box",
                    WebkitLineClamp: HIGHLIGHT_PREVIEW_LINES,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }
                : {}),
            }}
          >
            {summary}
          </div>
        ) : null}
        {needsCollapse ? (
          <span style={styles.aiHighlightExpandHint}>
            {expanded ? "▲ 收合" : "▼ 展開完整內容"}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function ScriptFontSizeControl({
  value,
  onChange,
}: {
  value: ScriptFontSize;
  onChange: (v: ScriptFontSize) => void;
}) {
  const options: { id: ScriptFontSize; label: string }[] = [
    { id: "sm", label: "小" },
    { id: "md", label: "中" },
    { id: "lg", label: "大" },
    { id: "xl", label: "超大" },
  ];
  return (
    <div style={styles.scriptFontRow} role="group" aria-label="主播稿字體大小">
      <span style={styles.scriptFontLabel}>字體</span>
      <div style={styles.scriptFontChips}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            style={{
              ...styles.scriptFontChip,
              ...(value === o.id ? styles.scriptFontChipActive : {}),
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function WaveformBars({ active }: { active: boolean }) {
  return (
    <div
      className={active ? "player-waveform player-waveform--active" : "player-waveform"}
      style={styles.waveform}
      aria-hidden
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="player-waveform-bar" style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </div>
  );
}

function PlayerDeck({
  isSpeaking,
  isPaused,
  playbackProgress,
  remainingMs,
  speed,
  playbackMode,
  currentChunkIndex,
  totalChunks,
  aiScript,
  selectedNewsCount,
  voiceName,
  voices,
  onVoiceChange,
  onSpeedChange,
  onTogglePlayPause,
  onStop,
  onStart,
  onOpenAnalysis,
  aiLoading,
}: {
  isSpeaking: boolean;
  isPaused: boolean;
  playbackProgress: number;
  remainingMs: number;
  speed: number;
  playbackMode: PlaybackMode;
  currentChunkIndex: number;
  totalChunks: number;
  aiScript: string;
  selectedNewsCount: number;
  voiceName: string;
  voices: SpeechSynthesisVoice[];
  onVoiceChange: (name: string) => void;
  onSpeedChange: (rate: number) => void;
  onTogglePlayPause: () => void;
  onStop: () => void;
  onStart: () => void;
  onOpenAnalysis: () => void;
  aiLoading: boolean;
}) {
  const active = isSpeaking || isPaused;
  const canPlay = aiScript.trim().length > 0 || selectedNewsCount > 0;
  const statusLabel = isPaused
    ? "已暫停"
    : isSpeaking
      ? playbackMode === "ai"
        ? "AI 主播稿播放中"
        : "新聞播放中"
      : "待播放";

  return (
    <section style={styles.playerDeck}>
      <div style={styles.playerDeckTop}>
        <WaveformBars active={isSpeaking && !isPaused} />
        <div style={styles.playerDeckMeta}>
          <div style={styles.playerStatus}>{statusLabel}</div>
          <div style={styles.playerSubMeta}>
            <span style={styles.playerSpeedTag}>{speed.toFixed(2)}x</span>
            {active && remainingMs > 0 ? (
              <span style={styles.playerRemaining}>{formatRemainingTime(remainingMs)}</span>
            ) : null}
          </div>
        </div>
      </div>

      <div style={styles.playerProgressTrack}>
        <div
          style={{
            ...styles.playerProgressFill,
            width: `${Math.round(playbackProgress * 100)}%`,
          }}
        />
      </div>

      <div style={styles.playerControlRow}>
        <button
          type="button"
          onClick={onTogglePlayPause}
          disabled={!active && !canPlay}
          style={styles.playerPlayBtn}
        >
          {isPaused ? "▶ 繼續" : isSpeaking ? "⏸ 暫停" : "▶ 播放"}
        </button>
        <button
          type="button"
          onClick={onStop}
          disabled={!active}
          style={{
            ...styles.playerStopBtn,
            opacity: active ? 1 : 0.45,
          }}
        >
          ■ 停止
        </button>
        {!active ? (
          <button
            type="button"
            onClick={onStart}
            disabled={!canPlay}
            style={{
              ...styles.playerAltPlayBtn,
              opacity: canPlay ? 1 : 0.5,
            }}
          >
            {aiScript.trim() ? "AI 稿" : "新聞"}
          </button>
        ) : null}
      </div>

      <select
        value={voiceName}
        onChange={(e) => onVoiceChange(e.target.value)}
        style={styles.select}
      >
        {voices.map((voice) => (
          <option key={voice.name} value={voice.name}>
            {voice.name}（{voice.lang}）
          </option>
        ))}
      </select>

      <div style={styles.speedRow}>
        <span>語速 {speed.toFixed(2)}x</span>
        <input
          type="range"
          min={String(SPEED_MIN)}
          max={String(SPEED_MAX)}
          step={String(SPEED_STEP)}
          value={speed}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          style={{ width: "58%" }}
        />
      </div>

      <button
        type="button"
        onClick={onOpenAnalysis}
        disabled={aiLoading || selectedNewsCount === 0}
        style={{
          ...styles.aiSummaryButtonSmall,
          width: "100%",
          marginTop: "4px",
          opacity: aiLoading || selectedNewsCount === 0 ? 0.65 : 1,
        }}
      >
        {aiLoading ? "AI 分析中..." : "✨ AI 分析"}
      </button>
    </section>
  );
}

function FloatingPlayerBar({
  isPaused,
  playbackProgress,
  remainingMs,
  speed,
  playbackMode,
  onTogglePlayPause,
  onStop,
  onOpenPlayer,
}: {
  isPaused: boolean;
  playbackProgress: number;
  remainingMs: number;
  speed: number;
  playbackMode: PlaybackMode;
  onTogglePlayPause: () => void;
  onStop: () => void;
  onOpenPlayer: () => void;
}) {
  return (
    <div style={styles.floatingPlayer} role="region" aria-label="迷你播放器">
      <button type="button" onClick={onOpenPlayer} style={styles.floatingPlayerMain}>
        <WaveformBars active={!isPaused} />
        <div style={styles.floatingPlayerText}>
          <span style={styles.floatingPlayerTitle}>
            {isPaused ? "已暫停" : playbackMode === "ai" ? "AI 主播稿" : "新聞播放"}
          </span>
          <span style={styles.floatingPlayerSub}>
            {speed.toFixed(2)}x · {formatRemainingTime(remainingMs)}
          </span>
        </div>
        <div style={styles.floatingProgressTrack}>
          <div
            style={{
              ...styles.floatingProgressFill,
              width: `${Math.round(playbackProgress * 100)}%`,
            }}
          />
        </div>
      </button>
      <button type="button" onClick={onTogglePlayPause} style={styles.floatingIconBtn}>
        {isPaused ? "▶" : "⏸"}
      </button>
      <button type="button" onClick={onStop} style={styles.floatingIconBtnStop}>
        ■
      </button>
    </div>
  );
}

function CollapsibleText({
  text,
  style,
  collapsedLines = COLLAPSED_LINES,
}: {
  text: string;
  style?: CSSProperties;
  collapsedLines?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = text.trim();
  const lineCount = trimmed.split("\n").length;
  const needsCollapse = trimmed.length > 180 || lineCount > collapsedLines;

  if (!needsCollapse) {
    return <div style={style}>{trimmed}</div>;
  }

  return (
    <div>
      <div
        className={expanded ? "ai-text-expanded" : "ai-text-collapsed"}
        style={{
          ...style,
          ...(expanded
            ? {}
            : {
                display: "-webkit-box",
                WebkitLineClamp: collapsedLines,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }),
        }}
      >
        {trimmed}
      </div>
      <button
        type="button"
        className="ai-expand-toggle"
        onClick={() => setExpanded((v) => !v)}
        style={styles.aiExpandToggle}
      >
        {expanded ? "▲ 收合內容" : "▼ 展開完整內容"}
      </button>
    </div>
  );
}

const HIGHLIGHTS_PREVIEW_COUNT = 2;
const HIGHLIGHTS_COLLAPSED_MAX_PX = 300;

function CollapsibleHighlightsSection({ highlights }: { highlights: AiHighlight[] }) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = highlights.length > HIGHLIGHTS_PREVIEW_COUNT;
  const visible = expanded
    ? highlights
    : highlights.slice(0, HIGHLIGHTS_PREVIEW_COUNT);

  return (
    <div style={styles.aiHighlightsSection}>
      <div style={styles.aiHighlightsSectionHead}>
        <span style={styles.aiSubheadingMuted}>今日重點</span>
        <span style={styles.aiHighlightsCount}>共 {highlights.length} 則</span>
      </div>

      <div
        className={
          expanded ? "ai-highlights-panel-expanded" : "ai-highlights-panel-collapsed"
        }
        style={{
          ...styles.aiHighlightsPanel,
          ...(hasMore && !expanded
            ? { maxHeight: `${HIGHLIGHTS_COLLAPSED_MAX_PX}px` }
            : {}),
        }}
      >
        <ul style={styles.aiHighlightList}>
          {visible.map((h, idx) => (
            <CollapsibleHighlightItem key={idx} highlight={h} />
          ))}
        </ul>
        {hasMore && !expanded ? <div style={styles.aiHighlightsFade} aria-hidden /> : null}
      </div>

      {hasMore ? (
        <button
          type="button"
          className="ai-highlights-section-toggle"
          onClick={() => setExpanded((v) => !v)}
          style={styles.aiHighlightsSectionToggle}
        >
          {expanded
            ? "▲ 收合重點新聞"
            : `▼ 展開更多重點新聞（還有 ${highlights.length - HIGHLIGHTS_PREVIEW_COUNT} 則）`}
        </button>
      ) : null}
    </div>
  );
}

const PRO_SELL_POINTS = [
  "解鎖 5 分鐘深度 AI 新聞稿",
  "每日 20 次 AI 產生額度",
  "追蹤更多主題與自訂關鍵字",
  "收藏與 AI 歷史保留更久",
  "移除所有廣告",
  "即將支援每日 AI 早報 / 晚報",
] as const;

function ProUpgradeCard({
  variant,
  proStatus,
  onUpgrade,
  onRedeem,
}: {
  variant: "compact" | "settings";
  proStatus: ProStatus;
  onUpgrade: () => void;
  onRedeem: () => void;
}) {
  if (isProActive(proStatus)) return null;

  const compact = variant === "compact";
  return (
    <div
      style={compact ? styles.proUpgradeCardCompact : styles.proUpgradeCardSettings}
      role="note"
      aria-label="升級 Pro"
    >
      <div style={styles.proUpgradeTitle}>升級 Pro，打造你的完整 AI 新聞台</div>
      {!compact ? (
        <>
          <p style={styles.proUpgradeSubtitle}>
            更多主題、更長新聞稿、深度解析、無廣告播放。
          </p>
          <ul style={styles.proUpgradeList}>
            {PRO_SELL_POINTS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </>
      ) : (
        <p style={styles.proUpgradeCompactSub}>
          無廣告 · 5 分鐘深度稿 · 每日 {AI_DAILY_LIMIT_PRO} 次 AI
        </p>
      )}
      <div style={styles.proUpgradePriceRow}>
        <span>月費 {PRO_PRICING.monthly.label}</span>
        <span style={styles.proUpgradePriceDot}>·</span>
        <span>年費 {PRO_PRICING.yearly.label}</span>
      </div>
      <div style={styles.proUpgradeBtnRow}>
        <button
          type="button"
          onClick={onUpgrade}
          style={styles.proUpgradePrimaryBtn}
          title="正式付款即將開放"
        >
          升級 Pro（即將開放）
        </button>
        <button type="button" onClick={onRedeem} style={styles.proUpgradeSecondaryBtn}>
          輸入兌換碼
        </button>
      </div>
      <p style={styles.proUpgradeFootnote}>正式付款即將開放（App Store / Google Play）</p>
    </div>
  );
}

function ProStatusCard({
  proStatus,
  showDebugTools,
}: {
  proStatus: ProStatus;
  showDebugTools: boolean;
}) {
  const active = isProActive(proStatus);
  const source = proSourceLabel(proStatus.proSource);
  const limits = getPlanLimits(proStatus);

  return (
    <section style={styles.controlPanel}>
      <div style={styles.controlTitle}>Pro 方案</div>
      {active ? (
        <>
          <div style={styles.proStatusLine}>
            <strong>目前方案：</strong>Pro
          </div>
          <div style={styles.proStatusLine}>
            <strong>到期日：</strong>
            {formatProExpiresAt(proStatus.proExpiresAt)}
          </div>
          <div style={styles.proStatusLine}>
            <strong>每日 AI 次數：</strong>
            {limits.aiDailyLimit} 次
          </div>
          <div style={styles.proStatusLine}>
            <strong>可追蹤主題：</strong>
            {limits.topicLimit} 個
          </div>
          <div style={styles.proStatusLine}>
            <strong>自訂關鍵字：</strong>
            {limits.customKeywordLimit} 個
          </div>
          <div style={styles.proStatusLine}>
            <strong>收藏上限：</strong>
            {limits.favoriteLimit} 則
          </div>
          <div style={styles.proStatusLine}>
            <strong>AI 歷史：</strong>最近 {limits.historyDays} 天
          </div>
          <div style={styles.proStatusLine}>已移除廣告</div>
          {source ? (
            <div style={styles.proStatusLine}>
              <strong>來源：</strong>
              {source}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div style={styles.proStatusLine}>
            <strong>目前方案：</strong>Free
          </div>
          <div style={styles.proStatusLine}>
            <strong>每日 AI 次數：</strong>
            {limits.aiDailyLimit} 次
          </div>
          <div style={styles.proStatusLine}>
            <strong>可追蹤主題：</strong>
            {limits.topicLimit} 個
          </div>
          <div style={styles.proStatusLine}>
            <strong>自訂關鍵字：</strong>
            {limits.customKeywordLimit} 個
          </div>
          <div style={styles.proStatusLine}>
            <strong>收藏上限：</strong>
            {limits.favoriteLimit} 則
          </div>
          <div style={styles.proStatusLine}>
            <strong>AI 歷史：</strong>最近 {limits.historyDays} 天
          </div>
          <div style={styles.settingHint}>
            升級 Pro 可解鎖 5 分鐘新聞稿、更多主題、更多收藏與無廣告體驗
          </div>
        </>
      )}

      {showDebugTools ? (
        <div style={styles.proDebugToolsBox}>
          <div style={styles.proDebugToolsLabel}>測試工具</div>
          <button
            type="button"
            onClick={() => {
              const ok = window.confirm(
                "確定要重置 Pro 測試狀態嗎？這只會清除本機 Pro 狀態，不會影響收藏、主題與 AI 歷史。"
              );
              if (!ok) return;
              resetProTestState();
              window.location.reload();
            }}
            style={styles.proDebugResetBtnProminent}
          >
            重置 Pro 測試狀態
          </button>
        </div>
      ) : (
        <p style={styles.proDebugHint}>
          測試 Free／Pro 切換：請在網址加上 <strong>?debug=1</strong> 後重新整理（或於主控台執行
          localStorage.setItem(&apos;pns_debug_mode&apos;,&apos;1&apos;)）
        </p>
      )}
    </section>
  );
}

function UpgradeModal({
  kind,
  onClose,
  onRedeem,
  onUpgrade,
}: {
  kind: UpgradeModalKind;
  onClose: () => void;
  onRedeem: () => void;
  onUpgrade: () => void;
}) {
  const renderLimitBody = () => {
    switch (kind) {
      case "topic":
        return (
          <>
            <div style={styles.proModalFocusTitle}>
              免費版最多追蹤 {getPlanLimits().topicLimit} 個主題
            </div>
            <p style={styles.proModalFocusBody}>
              升級 Pro 可追蹤更多主題，打造更完整的個人新聞台
            </p>
          </>
        );
      case "favorite":
        return (
          <>
            <div style={styles.proModalFocusTitle}>
              免費版最多收藏 {getPlanLimits().favoriteLimit} 則新聞
            </div>
            <p style={styles.proModalFocusBody}>
              升級 Pro 可收藏更多內容，方便之後回顧
            </p>
          </>
        );
      case "keyword":
        return (
          <>
            <div style={styles.proModalFocusTitle}>
              免費版最多新增 {getPlanLimits().customKeywordLimit} 個自訂關鍵字
            </div>
            <p style={styles.proModalFocusBody}>
              升級 Pro 可追蹤更多人物、球隊、股票、幣種與事件
            </p>
          </>
        );
      case "deep":
        return (
          <>
            <div style={styles.proModalFocusTitle}>深度解析模式為 Pro 專屬</div>
            <p style={styles.proModalFocusBody}>
              升級 Pro 可解鎖事件背景、影響與後續觀察的 AI 整理（不提供投資建議）
            </p>
          </>
        );
      case "quota":
        return (
          <>
            <div style={styles.proModalFocusTitle}>今日免費 AI 次數已用完</div>
            <p style={styles.proModalFocusBody}>明天會自動重置</p>
            <p style={styles.proModalFocusBody}>
              升級 Pro 可獲得每日 20 次 AI 額度、5 分鐘深度稿與無廣告體驗
            </p>
          </>
        );
      case "five_minute":
        return (
          <>
            <div style={styles.proModalFocusTitle}>5 分鐘深度新聞稿為 Pro 專屬</div>
            <p style={styles.proModalFocusBody}>
              適合通勤、開車、運動時完整收聽今日重點。
            </p>
            <p style={styles.proModalFocusBody}>
              升級 Pro 可解鎖 5 分鐘新聞稿、每日 20 次 AI 額度、更多主題追蹤與無廣告體驗。
            </p>
          </>
        );
      default:
        return null;
    }
  };

  const isLimitKind =
    kind === "topic" ||
    kind === "favorite" ||
    kind === "keyword" ||
    kind === "deep" ||
    kind === "quota" ||
    kind === "five_minute";

  return (
    <div style={styles.proModalBackdrop} onClick={onClose} role="presentation">
      <div
        style={styles.proModalPanel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="升級 Pro"
      >
        {isLimitKind ? (
          <div style={styles.proModalFocusBox}>{renderLimitBody()}</div>
        ) : null}

        {kind === "general" ? (
          <ProUpgradeCard
            variant="settings"
            proStatus={{ isPro: false, proExpiresAt: null, proSource: null }}
            onUpgrade={onUpgrade}
            onRedeem={onRedeem}
          />
        ) : (
          <div style={styles.proUpgradeBtnRow}>
            <button type="button" onClick={onUpgrade} style={styles.proUpgradePrimaryBtn}>
              升級 Pro（即將開放）
            </button>
            {kind === "five_minute" ? (
              <button type="button" onClick={onRedeem} style={styles.proUpgradeSecondaryBtn}>
                輸入兌換碼
              </button>
            ) : null}
            <button type="button" onClick={onClose} style={styles.proUpgradeSecondaryBtn}>
              {kind === "quota" ? "明天再用" : "稍後再說"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PromoRedeemModal({
  onClose,
  onRedeemed,
}: {
  onClose: () => void;
  onRedeemed: (status: ProStatus, message: string) => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const result = await redeemPromoCode(trimmed);
      if (result.ok) {
        onRedeemed(result.status, result.message);
      } else {
        alert(result.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.proModalBackdrop} onClick={onClose} role="presentation">
      <div
        style={styles.promoModalPanel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="兌換碼"
      >
        <div style={styles.promoModalTitle}>輸入兌換碼</div>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="例如 NEWSVIP30"
          style={styles.promoInput}
          autoCapitalize="characters"
          autoComplete="off"
        />
        <div style={styles.proUpgradeBtnRow}>
          <button
            type="button"
            disabled={busy || !code.trim()}
            onClick={() => void submit()}
            style={styles.proUpgradePrimaryBtn}
          >
            {busy ? "兌換中…" : "兌換"}
          </button>
          <button type="button" onClick={onClose} style={styles.proUpgradeSecondaryBtn}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

function ProPaywall({
  selectedPlan,
  onPlanChange,
  onClose,
  onUpgrade,
}: {
  selectedPlan: "monthly" | "yearly";
  onPlanChange: (v: "monthly" | "yearly") => void;
  onClose: () => void;
  onUpgrade: () => void;
}) {
  // v1：先不提供正式購買體驗；保留程式碼但不顯示 UI
  if (true) return null;

  return (
    <div style={styles.paywallBackdrop} role="presentation">
      <div style={styles.paywallWrap} role="dialog" aria-modal="true" aria-label="Pro 升級頁">
        <div style={styles.paywallTopBar}>
          <button type="button" onClick={onClose} style={styles.paywallLaterTop}>
            稍後再說
          </button>
        </div>

        <div style={styles.paywallScroll}>
          <header style={styles.paywallHero}>
            <div style={styles.paywallBrand}>AI個人新聞台 Pro</div>
            <div style={styles.paywallSlogan}>每天 5 分鐘，快速掌握世界重點</div>
          </header>

          <section style={styles.paywallFeatureGrid} aria-label="功能亮點">
            {[
              { title: "每日 30 次 AI 分析", desc: "隨時更新重點，不怕用完。" },
              { title: "3 / 5 分鐘 AI 主播稿", desc: "更完整、更像真正新聞台。" },
              { title: "AI 歷史紀錄", desc: "回放、複製、整理你的日常重點。" },
              { title: "更多收藏", desc: "更長的收藏清單（即將開放）。" },
              { title: "未來每日自動簡報", desc: "每天固定時間推播你的摘要（規劃中）。" },
            ].map((f) => (
              <div key={f.title} style={styles.paywallFeatureCard}>
                <div style={styles.paywallFeatureTitle}>{f.title}</div>
                <div style={styles.paywallFeatureDesc}>{f.desc}</div>
              </div>
            ))}
          </section>

          <section style={styles.paywallPlanSection} aria-label="方案">
            <div style={styles.paywallPlanHeader}>
              <div style={styles.paywallPlanTitle}>選擇方案</div>
              <div style={styles.paywallPlanHint}>目前為 Demo 模式，按「立即升級」會切換 Pro Demo</div>
            </div>

            <div style={styles.paywallPlanList}>
              <button
                type="button"
                onClick={() => onPlanChange("monthly")}
                style={{
                  ...styles.paywallPlanCard,
                  ...(selectedPlan === "monthly" ? styles.paywallPlanCardActive : {}),
                }}
              >
                <div style={styles.paywallPlanRow}>
                  <div style={styles.paywallPlanName}>月費</div>
                  <div style={styles.paywallPlanPrice}>{PRO_PRICING.monthly.label}</div>
                </div>
                <div style={styles.paywallPlanSub}>適合先體驗</div>
              </button>

              <button
                type="button"
                onClick={() => onPlanChange("yearly")}
                style={{
                  ...styles.paywallPlanCard,
                  ...(selectedPlan === "yearly" ? styles.paywallPlanCardActive : {}),
                }}
              >
                <div style={styles.paywallPlanPopular}>最受歡迎</div>
                <div style={styles.paywallPlanRow}>
                  <div style={styles.paywallPlanName}>年費</div>
                  <div style={styles.paywallPlanPrice}>{PRO_PRICING.yearly.label}</div>
                </div>
                <div style={styles.paywallPlanSub}>約省 15% · 長期最划算</div>
              </button>
            </div>
          </section>
        </div>

        <div style={styles.paywallBottomBar}>
          <button type="button" onClick={onUpgrade} style={styles.paywallPrimaryCta}>
            立即升級
          </button>
          <button type="button" onClick={onClose} style={styles.paywallSecondaryCta}>
            稍後再說
          </button>
        </div>
      </div>
    </div>
  );
}

function AiHistorySection({
  entries,
  activeId,
  onSelect,
  onPlay,
  onCopy,
  onDelete,
  onClearAll,
  historyHint,
  hiddenOlderCount = 0,
}: {
  entries: AiHistoryEntry[];
  activeId: string | null;
  onSelect: (entry: AiHistoryEntry) => void;
  onPlay: (entry: AiHistoryEntry) => void;
  onCopy: (entry: AiHistoryEntry) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  historyHint?: string;
  hiddenOlderCount?: number;
}) {
  return (
    <section style={styles.aiHistoryPanel}>
      <div style={styles.aiHistoryHead}>
        <div>
          <div style={styles.aiHistoryTitle}>AI 歷史</div>
          <div style={styles.aiHistorySub}>
            {historyHint ?? `最近 ${AI_HISTORY_MAX} 筆 · 點擊載入主播稿`}
          </div>
          {hiddenOlderCount > 0 ? (
            <div style={styles.aiHistoryOlderNote}>
              另有 {hiddenOlderCount} 筆較早紀錄仍保存在本機，升級 Pro 後可在此查看更長時間
            </div>
          ) : null}
        </div>
        {entries.length > 0 ? (
          <button type="button" onClick={onClearAll} style={styles.aiHistoryClearBtn}>
            清空全部
          </button>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <div style={styles.aiHistoryEmpty}>
          尚無 AI 分析紀錄。在首頁勾選新聞並完成 AI 分析後，會自動保存在此。
        </div>
      ) : (
        <div style={styles.aiHistoryList}>
          {entries.map((entry) => {
            const active = entry.id === activeId;
            const previewTitles = (entry.newsTitles ?? []).slice(0, 2);
            return (
              <article
                key={entry.id}
                style={{
                  ...styles.aiHistoryCard,
                  ...(active ? styles.aiHistoryCardActive : {}),
                }}
              >
                <button
                  type="button"
                  onClick={() => onSelect(entry)}
                  style={styles.aiHistoryCardMain}
                >
                  <div style={styles.aiHistoryMetaRow}>
                    <span style={styles.aiHistoryWhen}>
                      {formatAiHistoryWhen(entry.savedAt)}
                    </span>
                    <span style={styles.aiHistoryDurationBadge}>
                      {entry.duration} 分鐘
                    </span>
                  </div>
                  {previewTitles.length > 0 ? (
                    <ul style={styles.aiHistoryTitles}>
                      {previewTitles.map((title, i) => (
                        <li key={`${entry.id}-t-${i}`} style={styles.aiHistoryTitleItem}>
                          {title}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div style={styles.aiHistoryNoTitles}>（無新聞標題紀錄）</div>
                  )}
                </button>

                <div style={styles.aiHistoryActions}>
                  <button
                    type="button"
                    onClick={() => onPlay(entry)}
                    style={styles.aiHistoryPlayBtn}
                  >
                    播放
                  </button>
                  <button
                    type="button"
                    onClick={() => onCopy(entry)}
                    style={styles.aiHistoryCopyBtn}
                  >
                    複製
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("確定刪除此筆 AI 歷史？")) {
                        onDelete(entry.id);
                      }
                    }}
                    style={styles.aiHistoryDeleteBtn}
                    aria-label="刪除此筆"
                  >
                    刪除
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AccountSyncSection({
  isPro,
  onOpenAuthModal,
}: {
  isPro: boolean;
  onOpenAuthModal: () => void;
}) {

  return (
    <section style={styles.accountPanel}>
      <div style={styles.controlTitle}>帳號與同步</div>

      <div style={styles.accountCard}>
        <div style={styles.accountTop}>
          <div style={styles.accountAvatar} aria-hidden>
            <span style={styles.accountAvatarIcon}>👤</span>
          </div>
          <div style={styles.accountInfo}>
            <div style={styles.accountStatusRow}>
              <span style={styles.accountStatus}>尚未登入</span>
              <span
                style={{
                  ...styles.planStatusBadge,
                  ...(isPro ? styles.planStatusBadgePro : styles.planStatusBadgeFree),
                }}
              >
                {isPro ? "Pro" : "Free"}
              </span>
            </div>
            <p style={styles.accountHint}>
              登入後可同步收藏、AI 歷史、主題偏好與 Pro 狀態
            </p>
          </div>
        </div>

        <div style={styles.accountSyncRow}>
          <span style={styles.accountSyncLabel}>資料儲存</span>
          <span style={styles.accountSyncValue}>本機儲存</span>
          <span style={styles.accountSyncDot}>·</span>
          <span style={styles.accountSyncFuture}>登入後：雲端同步</span>
        </div>

        <div style={styles.accountAuthBtns}>
          <button type="button" onClick={onOpenAuthModal} style={styles.authBtnGoogle}>
            <span style={styles.authBtnIcon}>G</span>
            使用 Google 登入
          </button>
          <button type="button" onClick={onOpenAuthModal} style={styles.authBtnApple}>
            <span style={styles.authBtnIcon}></span>
            使用 Apple 登入
          </button>
          <button type="button" onClick={onOpenAuthModal} style={styles.authBtnEmail}>
            Email 登入
          </button>
        </div>
      </div>
    </section>
  );
}

function AuthComingSoonModal({ onClose }: { onClose: () => void }) {
  return (
    <div style={styles.authModalBackdrop} onClick={onClose} role="presentation">
      <div
        style={styles.authModal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="帳號同步"
      >
        <div style={styles.authModalTitle}>帳號同步功能即將開放</div>
        <div style={styles.authModalBody}>目前所有資料會安全保存在本機</div>
        <button type="button" onClick={onClose} style={styles.authModalPrimary}>
          我知道了
        </button>
      </div>
    </div>
  );
}

function OnboardingModal({
  step,
  onPrev,
  onNext,
  onSkip,
  onDone,
}: {
  step: number;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
  onDone: () => void;
}) {
  const steps = [
    {
      title: "選主題",
      body: "先挑你關心的主題，首頁就會自動整理。",
      icon: "🎯",
    },
    {
      title: "勾新聞",
      body: "勾選今天想聽的內容，快速組合清單。",
      icon: "✅",
    },
    {
      title: "AI 主播稿",
      body: "一鍵產生 1／3／5 分鐘重點與主播稿。",
      icon: "✨",
    },
    {
      title: "播放收聽",
      body: "播放、調整語速、收藏喜歡的新聞。",
      icon: "🎙️",
    },
  ] as const;

  const total = steps.length;
  const s = steps[Math.min(total - 1, Math.max(0, step))];
  const isLast = step >= total - 1;

  return (
    <div style={styles.onboardingBackdrop} role="presentation" onClick={onSkip}>
      <div
        style={styles.onboardingModal}
        role="dialog"
        aria-modal="true"
        aria-label="新手教學"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={styles.onboardingTopRow}>
          <span style={styles.onboardingBrand}>AI個人新聞台</span>
          <button type="button" onClick={onSkip} style={styles.onboardingSkipBtn}>
            略過
          </button>
        </div>

        <div style={styles.onboardingCard}>
          <div style={styles.onboardingIcon} aria-hidden>
            {s.icon}
          </div>
          <div style={styles.onboardingStepKicker}>
            STEP {step + 1} / {total}
          </div>
          <div style={styles.onboardingTitle}>{s.title}</div>
          <div style={styles.onboardingBody}>{s.body}</div>
        </div>

        <div style={styles.onboardingDots} aria-hidden>
          {steps.map((_, i) => (
            <span
              key={i}
              style={{
                ...styles.onboardingDot,
                ...(i === step ? styles.onboardingDotActive : {}),
              }}
            />
          ))}
        </div>

        <div style={styles.onboardingActions}>
          <button
            type="button"
            onClick={onPrev}
            style={{
              ...styles.onboardingSecondary,
              opacity: step === 0 ? 0.5 : 1,
            }}
            disabled={step === 0}
          >
            上一步
          </button>
          {isLast ? (
            <button type="button" onClick={onDone} style={styles.onboardingPrimary}>
              開始使用
            </button>
          ) : (
            <button type="button" onClick={onNext} style={styles.onboardingPrimary}>
              下一步
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SplashScreen() {
  return (
    <div style={styles.splashWrap} role="status" aria-label="啟動畫面">
      <div style={styles.splashCenter}>
        <div style={styles.splashLogo} aria-hidden>
          🎙️
        </div>
        <div style={styles.splashTitle}>AI個人新聞台</div>
        <div style={styles.splashSubtitle}>為你整理今日重點</div>
        <div style={styles.splashLoader} aria-hidden>
          <span className="splash-dot" />
          <span className="splash-dot" />
          <span className="splash-dot" />
        </div>
      </div>
    </div>
  );
}

function AiSummaryPanel({
  aiLoading,
  aiError,
  aiScript,
  aiHighlights,
  aiJsonFallback,
  selectedScriptDuration,
  scriptFontSize,
  onScriptFontSizeChange,
  isSpeaking,
  isPaused,
  onPlayScript,
  onStopScript,
  onCopyScript,
  onOpenAnalysis,
  selectedNewsCount,
  isPro,
  aiQuotaRemaining,
  aiDailyLimit,
  onOpenProModal,
  aiFavorited,
  onToggleAiFavorite,
}: {
  aiLoading: boolean;
  aiError: string | null;
  aiScript: string;
  aiHighlights: AiHighlight[];
  aiJsonFallback: boolean;
  selectedScriptDuration: AiDuration | null;
  scriptFontSize: ScriptFontSize;
  onScriptFontSizeChange: (v: ScriptFontSize) => void;
  isSpeaking: boolean;
  isPaused: boolean;
  onPlayScript: (script: string) => void;
  onStopScript: () => void;
  onCopyScript: () => void;
  onOpenAnalysis: () => void;
  selectedNewsCount: number;
  isPro: boolean;
  aiQuotaRemaining: number;
  aiDailyLimit: number;
  onOpenProModal: () => void;
  aiFavorited: boolean;
  onToggleAiFavorite: () => void;
}) {
  const scriptFontPx = SCRIPT_FONT_PX[scriptFontSize];
  const playbackActive = isSpeaking || isPaused;
  const hasContent = aiScript.trim().length > 0 || aiHighlights.length > 0;

  return (
    <div style={styles.aiSummaryWrap}>
      <div style={styles.aiSummaryCard}>
        <div style={styles.aiSummaryHeaderRow}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={styles.aiSummaryKicker}>AI 分析</span>
            <span style={styles.aiQuotaLine}>
              今日剩餘 {aiQuotaRemaining} / {aiDailyLimit} 次（{isPro ? "Pro" : "Free"}）
            </span>
          </div>
          {selectedScriptDuration != null && aiScript.trim() ? (
            <span style={styles.aiSummaryBadge}>
              已產生 · {selectedScriptDuration} 分鐘
            </span>
          ) : null}
        </div>

        {aiLoading ? (
          <div style={styles.aiSummaryLoading}>AI 分析中，請稍候…</div>
        ) : aiError ? (
          <div style={styles.aiSummaryError}>{aiError}</div>
        ) : hasContent ? (
          <>
            {aiJsonFallback ? (
              <div style={styles.aiJsonFallbackNote}>
                （AI 回傳非標準 JSON，以下以純文字顯示）
              </div>
            ) : null}
            {aiHighlights.length > 0 ? (
              <CollapsibleHighlightsSection highlights={aiHighlights} />
            ) : null}
            {aiScript.trim() ? (
              <div style={styles.aiScriptSectionPrimary}>
                <div style={styles.aiScriptSectionHead}>
                  <div style={styles.aiScriptTitleRow}>
                    <span style={styles.aiScriptTitle}>AI 主播稿</span>
                    <span style={styles.aiScriptPrimaryBadge}>主要內容</span>
                  </div>
                  <ScriptFontSizeControl
                    value={scriptFontSize}
                    onChange={onScriptFontSizeChange}
                  />
                </div>
                <div style={styles.aiScriptActions}>
                  <button
                    type="button"
                    onClick={() => {
                      const s = aiScript.trim();
                      if (!s) {
                        alert("尚無 AI 主播稿可播放");
                        return;
                      }
                      onPlayScript(s);
                    }}
                    style={styles.aiScriptPlayBtn}
                    disabled={playbackActive}
                  >
                    {playbackActive ? "播放中" : "▶ 播放"}
                  </button>
                  {playbackActive ? (
                    <button
                      type="button"
                      onClick={onStopScript}
                      style={styles.aiScriptStopBtn}
                    >
                      ■ 停止
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={onToggleAiFavorite}
                    style={styles.aiScriptFavBtn}
                  >
                    {aiFavorited ? "★ 已收藏" : "☆ 收藏 AI 稿"}
                  </button>
                  <button
                    type="button"
                    onClick={onCopyScript}
                    style={styles.aiScriptCopyBtn}
                  >
                    複製
                  </button>
                </div>
                <CollapsibleText
                  text={aiScript.trim()}
                  style={{ ...styles.aiSummaryBody, fontSize: `${scriptFontPx}px` }}
                />
              </div>
            ) : null}
          </>
        ) : (
          <div style={styles.aiHintMuted}>
            勾選新聞後點「AI 分析」，選擇 1／3／5 分鐘；AI 會依新聞數量與重要度自動分配篇幅（最多
            5 則）。
          </div>
        )}

        {!aiLoading && selectedNewsCount > 0 ? (
          <button
            type="button"
            onClick={onOpenAnalysis}
            style={styles.aiPanelRegenerateBtn}
          >
            重新 AI 分析
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AiDurationSheet({
  loading,
  onClose,
  onSelect,
  isPro,
  analysisMode,
  onAnalysisModeChange,
  onOpenProModal,
}: {
  loading: boolean;
  onClose: () => void;
  onSelect: (d: AiDuration) => void;
  isPro: boolean;
  analysisMode: AiAnalysisMode;
  onAnalysisModeChange: (mode: AiAnalysisMode) => void;
  onOpenProModal: (kind: UpgradeModalKind) => void;
}) {
  return (
    <div
      className="ai-sheet-backdrop"
      style={styles.aiSheetBackdrop}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="ai-sheet-panel"
        style={styles.aiSheetPanel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="選擇 AI 分析長度"
      >
        <div style={styles.aiSheetHandle} />
        <div style={styles.aiSheetTitle}>選擇分析長度</div>
        <p style={styles.aiSheetDesc}>
          將為已勾選的新聞產生重點摘要與 AI 主播稿
        </p>
        <div style={styles.aiSheetModeRow}>
          <button
            type="button"
            disabled={loading}
            onClick={() => onAnalysisModeChange("normal")}
            style={{
              ...styles.aiSheetModeBtn,
              ...(analysisMode === "normal" ? styles.aiSheetModeBtnActive : {}),
            }}
          >
            一般整理
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              if (!isPro) {
                onClose();
                onOpenProModal("deep");
                return;
              }
              onAnalysisModeChange("deep");
            }}
            style={{
              ...styles.aiSheetModeBtn,
              ...(analysisMode === "deep" ? styles.aiSheetModeBtnActive : {}),
            }}
          >
            深度解析 {!isPro ? <span style={styles.proLockTag}>Pro</span> : null}
          </button>
        </div>
        <div style={styles.aiSheetOptions}>
          {([1, 3, 5] as const).map((d) => {
            const locked = !isPro && d === 5;
            return (
              <button
                key={d}
                type="button"
                disabled={loading}
                className="ai-duration-option"
                onClick={() => {
                  if (locked) {
                    onClose();
                    onOpenProModal("five_minute");
                    return;
                  }
                  onSelect(d);
                }}
                style={{
                  ...styles.aiSheetOptionBtn,
                  ...(locked ? styles.aiSheetOptionLocked : {}),
                }}
              >
                <span style={styles.aiSheetOptionMain}>
                  {d} 分鐘{" "}
                  {locked ? <span style={styles.proLockTag}>Pro 專屬</span> : null}
                </span>
                <span style={styles.aiSheetOptionSub}>
                  {d === 1
                    ? "快報"
                    : d === 3
                      ? "平衡"
                      : "深度 · 通勤完整收聽"}
                </span>
              </button>
            );
          })}
        </div>
        <button type="button" onClick={onClose} style={styles.aiSheetCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

type BottomNavTab = Tab;

function BottomNav({
  tab,
  setTab,
}: {
  tab: BottomNavTab;
  setTab: (t: BottomNavTab) => void;
}) {
  const items: {
    id: BottomNavTab;
    label: string;
    Icon: typeof Home;
  }[] = [
    { id: "home", label: "首頁", Icon: Home },
    { id: "player", label: "播放", Icon: Headphones },
    { id: "favorites", label: "收藏", Icon: Star },
    { id: "settings", label: "設定", Icon: Settings },
  ];

  return (
    <nav style={styles.bottomNav} aria-label="主要導覽">
      {items.map(({ id, label, Icon }) => {
        const active = tab === id;
        return (
          <button
            key={id}
            type="button"
            className={`bottom-nav-item${active ? " bottom-nav-item--active" : ""}`}
            onClick={() => setTab(id)}
            style={active ? styles.navItemActive : styles.navItem}
            aria-current={active ? "page" : undefined}
          >
            <span
              className={active ? "bottom-nav-icon bottom-nav-icon--active" : "bottom-nav-icon"}
              style={active ? styles.navIconActive : styles.navIcon}
            >
              <Icon
                size={22}
                strokeWidth={active ? 2.35 : 1.85}
                color={active ? "#F8FAFC" : "#64748B"}
              />
            </span>
            <span style={active ? styles.navLabelActive : styles.navLabel}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
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

function AiFavoritesSection({
  favorites,
  onOpen,
  onPlay,
  onCopy,
  onToggle,
}: {
  favorites: AiFavoriteEntry[];
  onOpen: (fav: AiFavoriteEntry) => void;
  onPlay: (fav: AiFavoriteEntry) => void;
  onCopy: (fav: AiFavoriteEntry) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <section style={styles.aiFavPanel}>
      <div style={styles.aiFavHead}>
        <div>
          <div style={styles.aiFavTitle}>AI 新聞稿收藏</div>
          <div style={styles.aiFavSub}>可重新載入、播放與複製</div>
        </div>
      </div>

      {favorites.length === 0 ? (
        <div style={styles.aiFavEmpty}>尚未收藏 AI 新聞稿。</div>
      ) : (
        <div style={styles.aiFavList}>
          {favorites.map((fav) => {
            const previewTitles = (fav.newsTitles ?? []).slice(0, 2);
            return (
              <article key={fav.id} style={styles.aiFavCard}>
                <button type="button" onClick={() => onOpen(fav)} style={styles.aiFavMainBtn}>
                  <div style={styles.aiFavMetaRow}>
                    <span style={styles.aiFavWhen}>{formatAiHistoryWhen(fav.createdAt)}</span>
                    <span style={styles.aiFavBadge}>{fav.duration} 分鐘</span>
                  </div>
                  {previewTitles.length > 0 ? (
                    <div style={styles.aiFavPreview}>{previewTitles.join(" / ")}</div>
                  ) : (
                    <div style={styles.aiFavPreviewMuted}>（無新聞標題）</div>
                  )}
                </button>
                <div style={styles.aiFavActions}>
                  <button type="button" onClick={() => onPlay(fav)} style={styles.aiFavPlayBtn}>
                    播放
                  </button>
                  <button type="button" onClick={() => onCopy(fav)} style={styles.aiFavCopyBtn}>
                    複製
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggle(fav.id)}
                    style={styles.aiFavRemoveBtn}
                  >
                    取消收藏
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SiteFooter() {
  return (
    <footer style={styles.siteFooter}>
      <nav style={styles.siteFooterLinks} aria-label="網站資訊">
        <a href="/about" style={styles.siteFooterLink}>
          關於我們
        </a>
        <a href="/privacy" style={styles.siteFooterLink}>
          隱私權政策
        </a>
        <a href="/terms" style={styles.siteFooterLink}>
          服務條款
        </a>
        <a href="/contact" style={styles.siteFooterLink}>
          聯絡我們
        </a>
      </nav>
    </footer>
  );
}

function AdSenseSlot({
  clientId,
  slotId,
  format,
  placeholderVariant,
}: {
  clientId: string;
  slotId: string;
  format: "auto" | "horizontal" | "rectangle";
  placeholderVariant: "native" | "banner";
}) {
  useEffect(() => {
    if (!clientId) return;
    try {
      window.adsbygoogle = window.adsbygoogle || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.adsbygoogle as any[]).push({});
    } catch {
      /* ignore */
    }
  }, [clientId, slotId]);

  if (!clientId) {
    return placeholderVariant === "banner" ? (
      <div style={styles.adBanner} role="note" aria-label="Advertisement">
        <div style={styles.adTag}>Advertisement</div>
        <div style={styles.adBannerText}>贊助內容 · Banner</div>
      </div>
    ) : (
      <div style={styles.adNative} role="note" aria-label="Advertisement">
        <div style={styles.adTag}>Advertisement</div>
        <div style={styles.adTitle}>贊助內容</div>
        <div style={styles.adBody}>此位置將展示原生廣告，不影響閱讀與播放。</div>
      </div>
    );
  }

  return (
    <div
      style={placeholderVariant === "banner" ? styles.adBannerFrame : styles.adNativeFrame}
      aria-label="Advertisement"
    >
      <ins
        className="adsbygoogle"
        style={{ display: "block", width: "100%" }}
        data-ad-client={clientId}
        data-ad-slot={slotId}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
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
  isPro = false,
  homeToolbar,
  playingIndex = -1,
}: {
  title: string;
  news: NewsItem[];
  loading: boolean;
  toggleNews: (id: string) => void;
  toggleFavorite: (item: NewsItem) => void;
  emptyText?: string;
  compact?: boolean;
  denseCards?: boolean;
  isPro?: boolean;
  homeToolbar?: {
    selectAll: () => void;
    clearAll: () => void;
    lastUpdated: string;
  };
  playingIndex?: number;
}) {
  const headerMerged = !!homeToolbar;
  const selectedCount = news.filter((n) => n.selected).length;
  const allSelected = news.length > 0 && selectedCount === news.length;

  return (
    <>
      <div
        style={{
          ...styles.sectionHeader,
          ...(compact ? styles.sectionHeaderCompact : {}),
          ...(headerMerged ? styles.sectionHeaderHomeToolbar : {}),
        }}
      >
        {homeToolbar ? (
          <>
            <div style={styles.homeNewsToolbarLeft}>
              <button
                type="button"
                className={`home-select-btn${allSelected ? " home-select-btn--active" : ""}`}
                onClick={homeToolbar.selectAll}
                style={{
                  ...styles.homeSelectBtn,
                  ...(allSelected ? styles.homeSelectBtnActive : {}),
                }}
              >
                全選
              </button>
              <button
                type="button"
                className="home-clear-btn"
                onClick={homeToolbar.clearAll}
                style={styles.homeClearBtn}
              >
                取消
              </button>
            </div>
            <div style={styles.homeNewsToolbarRight}>
              <span style={styles.homeNewsCount}>{news.length} 則新聞</span>
              <span style={styles.homeNewsUpdated}>
                {homeToolbar.lastUpdated
                  ? `更新 ${homeToolbar.lastUpdated}`
                  : "尚未更新"}
              </span>
            </div>
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
        {(() => {
          const blocks: JSX.Element[] = [];
          const showNativeAd = !isPro && title === "新聞" && news.length >= 8;
          const adIndex = showNativeAd ? Math.min(4, Math.floor(news.length / 2)) : -1;

          news.forEach((item, index) => {
            if (showNativeAd && index === adIndex) {
              blocks.push(
                <AdSenseSlot
                  key="native-ad"
                  clientId={readAdSenseClientId()}
                  slotId={ADSENSE_HOME_SLOT_ID}
                  format="auto"
                  placeholderVariant="native"
                />
              );
            }
            blocks.push(
              <article
                key={item.id}
                onClick={() => toggleNews(item.id)}
                style={{
                  ...styles.newsCard,
                  ...(denseCards ? styles.newsCardDense : {}),
                  ...(item.selected ? styles.newsCardActive : {}),
                  ...(playingIndex === index ? styles.newsCardPlaying : {}),
                }}
              >
                <div style={styles.newsIndex}>{String(index + 1).padStart(2, "0")}</div>

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
            );
          });
          return blocks;
        })()}
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
    paddingBottom: "calc(84px + env(safe-area-inset-bottom, 0px))",
    transition: "padding-bottom 0.2s ease",
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
    gap: "6px",
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
    padding: "8px 12px",
    fontSize: "12px",
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
    padding: "8px 12px",
    fontSize: "12px",
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
    padding: "8px 12px",
    fontSize: "12px",
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
    padding: "8px 12px",
    fontSize: "12px",
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
  sectionHeaderHomeToolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    marginTop: "4px",
    marginBottom: "10px",
    padding: "10px 12px",
    background: "rgba(15,23,42,.55)",
    border: "1px solid rgba(255,255,255,.08)",
    borderRadius: "16px",
  },
  homeNewsToolbarLeft: {
    display: "flex",
    gap: "8px",
    flexShrink: 0,
    alignItems: "center",
  },
  homeSelectBtn: {
    minHeight: "40px",
    padding: "10px 18px",
    fontSize: "14px",
    fontWeight: 800,
    color: "#E2E8F0",
    background: "rgba(37,99,235,.28)",
    border: "1px solid rgba(96,165,250,.45)",
    borderRadius: "12px",
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
    transition: "transform 0.12s ease, background 0.15s ease, box-shadow 0.15s ease",
    boxShadow: "0 2px 10px rgba(37,99,235,.2)",
  },
  homeSelectBtnActive: {
    color: "#FFFFFF",
    background: "rgba(37,99,235,.55)",
    border: "1px solid rgba(147,197,253,.65)",
    boxShadow: "0 0 0 1px rgba(147,197,253,.25), 0 4px 14px rgba(37,99,235,.35)",
  },
  homeClearBtn: {
    minHeight: "40px",
    padding: "10px 16px",
    fontSize: "14px",
    fontWeight: 700,
    color: "#CBD5E1",
    background: "rgba(255,255,255,.08)",
    border: "1px solid rgba(255,255,255,.14)",
    borderRadius: "12px",
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
    transition: "transform 0.12s ease, background 0.15s ease",
  },
  homeNewsToolbarRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "3px",
    minWidth: 0,
    flex: "1 1 auto",
  },
  homeNewsCount: {
    fontSize: "13px",
    fontWeight: 800,
    color: "#94A3B8",
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  },
  homeNewsUpdated: {
    fontSize: "11px",
    fontWeight: 600,
    color: "#64748B",
    lineHeight: 1.2,
    whiteSpace: "nowrap",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  searchBox: {
    display: "flex",
    gap: "6px",
    marginTop: "4px",
    background: "rgba(255,255,255,.08)",
    padding: "5px",
    borderRadius: "13px",
    border: "1px solid rgba(255,255,255,.08)",
  },
  searchInput: {
    flex: 1,
    background: "transparent",
    color: "white",
    border: "none",
    outline: "none",
    fontSize: "13px",
    padding: "7px 8px",
  },
  searchButton: {
    background: "#22C55E",
    color: "white",
    border: "none",
    borderRadius: "13px",
    padding: "0 13px",
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
  sectionTitleHomeInline: { margin: 0, lineHeight: 1.2 },
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
  aiHistoryPanel: {
    marginTop: "4px",
    marginBottom: "14px",
    padding: "14px",
    borderRadius: "18px",
    background: "rgba(255,255,255,.04)",
    border: "1px solid rgba(255,255,255,.10)",
  },
  aiHistoryHead: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "12px",
    marginBottom: "12px",
  },
  aiHistoryTitle: {
    fontSize: "16px",
    fontWeight: 900,
    color: "#F8FAFC",
  },
  aiHistorySub: {
    marginTop: "4px",
    fontSize: "12px",
    color: "#64748B",
    lineHeight: 1.4,
  },
  aiHistoryOlderNote: {
    marginTop: "6px",
    fontSize: "11px",
    color: "#94A3B8",
    lineHeight: 1.4,
  },
  aiHistoryClearBtn: {
    flexShrink: 0,
    border: "1px solid rgba(248,113,113,.35)",
    background: "rgba(127,29,29,.25)",
    color: "#FCA5A5",
    borderRadius: "10px",
    padding: "6px 10px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  aiHistoryEmpty: {
    fontSize: "13px",
    lineHeight: 1.55,
    color: "#94A3B8",
    padding: "12px",
    borderRadius: "12px",
    background: "rgba(15,23,42,.45)",
    border: "1px dashed rgba(148,163,184,.25)",
  },
  aiHistoryList: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  aiHistoryCard: {
    borderRadius: "14px",
    background: "rgba(15,23,42,.55)",
    border: "1px solid rgba(255,255,255,.08)",
    overflow: "hidden",
  },
  aiHistoryCardActive: {
    borderColor: "rgba(96,165,250,.45)",
    boxShadow: "0 0 0 1px rgba(96,165,250,.18)",
  },
  aiHistoryCardMain: {
    width: "100%",
    border: "none",
    background: "transparent",
    color: "inherit",
    textAlign: "left",
    padding: "12px 12px 8px",
    cursor: "pointer",
  },
  aiHistoryMetaRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    marginBottom: "8px",
  },
  aiHistoryWhen: {
    fontSize: "13px",
    fontWeight: 800,
    color: "#E2E8F0",
  },
  aiHistoryDurationBadge: {
    fontSize: "11px",
    fontWeight: 900,
    color: "#BFDBFE",
    background: "rgba(37,99,235,.22)",
    border: "1px solid rgba(96,165,250,.28)",
    borderRadius: "999px",
    padding: "3px 8px",
    flexShrink: 0,
  },
  aiHistoryTitles: {
    margin: 0,
    paddingLeft: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  aiHistoryTitleItem: {
    fontSize: "13px",
    lineHeight: 1.45,
    color: "#CBD5E1",
  },
  aiHistoryNoTitles: {
    fontSize: "12px",
    color: "#64748B",
  },
  aiHistoryActions: {
    display: "flex",
    gap: "8px",
    padding: "0 10px 10px",
  },
  aiHistoryPlayBtn: {
    flex: 1,
    border: "none",
    borderRadius: "10px",
    padding: "8px 10px",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
    color: "#0F172A",
    background: "linear-gradient(135deg, #60A5FA, #A78BFA)",
  },
  aiHistoryCopyBtn: {
    flex: 1,
    border: "1px solid rgba(255,255,255,.12)",
    borderRadius: "10px",
    padding: "8px 10px",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
    color: "#E2E8F0",
    background: "rgba(255,255,255,.06)",
  },
  aiHistoryDeleteBtn: {
    border: "1px solid rgba(248,113,113,.28)",
    borderRadius: "10px",
    padding: "8px 12px",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
    color: "#FCA5A5",
    background: "rgba(127,29,29,.2)",
  },
  siteFooter: {
    marginTop: "14px",
    paddingTop: "12px",
    paddingBottom: "4px",
    borderTop: "1px solid rgba(255,255,255,.08)",
  },
  siteFooterLinks: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: "10px 14px",
  },
  siteFooterLink: {
    fontSize: "12px",
    fontWeight: 600,
    color: "#94A3B8",
    textDecoration: "none",
  },
  legalLinksRow: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    marginTop: "4px",
  },
  legalLink: {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    textAlign: "center",
    textDecoration: "none",
    borderRadius: "12px",
    padding: "12px 14px",
    fontSize: "14px",
    fontWeight: 800,
    color: "#E2E8F0",
    background: "rgba(255,255,255,.06)",
    border: "1px solid rgba(255,255,255,.12)",
  },
  adNative: {
    borderRadius: "16px",
    padding: "14px 14px 16px",
    background: "rgba(255,255,255,.04)",
    border: "1px solid rgba(255,255,255,.08)",
  },
  adBanner: {
    marginTop: "12px",
    borderRadius: "16px",
    padding: "12px 14px",
    background: "rgba(255,255,255,.04)",
    border: "1px solid rgba(255,255,255,.08)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
  },
  adNativeFrame: {
    borderRadius: "16px",
    padding: "10px 10px",
    background: "rgba(255,255,255,.02)",
    border: "1px solid rgba(255,255,255,.06)",
  },
  adBannerFrame: {
    marginTop: "12px",
    borderRadius: "16px",
    padding: "8px 10px",
    background: "rgba(255,255,255,.02)",
    border: "1px solid rgba(255,255,255,.06)",
  },
  adTag: {
    fontSize: "10px",
    fontWeight: 900,
    letterSpacing: "0.10em",
    textTransform: "uppercase",
    color: "rgba(148,163,184,.75)",
  },
  adTitle: { marginTop: "8px", fontSize: "14px", fontWeight: 900, color: "#F8FAFC" },
  adBody: { marginTop: "6px", fontSize: "13px", lineHeight: 1.45, color: "#94A3B8" },
  adBannerText: { fontSize: "13px", fontWeight: 800, color: "#CBD5E1" },
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
  planQuotaRow: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    marginTop: "12px",
    padding: "12px",
    borderRadius: "16px",
    background: "rgba(255,255,255,.05)",
    border: "1px solid rgba(255,255,255,.08)",
  },
  planQuotaLeft: { minWidth: 0 },
  planQuotaTitle: { fontSize: "12px", fontWeight: 900, color: "#93C5FD" },
  planQuotaValue: {
    marginTop: "4px",
    fontSize: "14px",
    fontWeight: 900,
    color: "#E2E8F0",
  },
  planQuotaRight: { flex: "1 1 180px", minWidth: 0 },
  planChipRow: {
    display: "flex",
    gap: "6px",
    justifyContent: "flex-end",
    flexWrap: "wrap",
  },
  planChip: {
    border: "1px solid rgba(255,255,255,.14)",
    background: "rgba(255,255,255,.06)",
    color: "#94A3B8",
    borderRadius: "999px",
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  planChipActive: {
    background: "rgba(45,212,191,.18)",
    border: "1px solid rgba(45,212,191,.45)",
    color: "#CCFBF1",
  },
  planQuotaNote: {
    marginTop: "6px",
    fontSize: "11px",
    color: "#64748B",
    lineHeight: 1.35,
    textAlign: "right",
  },
  accountPanel: {
    marginTop: "4px",
    marginBottom: "6px",
  },
  accountCard: {
    marginTop: "10px",
    padding: "14px",
    borderRadius: "18px",
    background: "rgba(255,255,255,.04)",
    border: "1px solid rgba(255,255,255,.10)",
  },
  accountTop: {
    display: "flex",
    gap: "14px",
    alignItems: "flex-start",
  },
  accountAvatar: {
    width: "52px",
    height: "52px",
    borderRadius: "16px",
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    background: "linear-gradient(135deg, rgba(96,165,250,.18), rgba(167,139,250,.12))",
    border: "1px solid rgba(147,197,253,.22)",
  },
  accountAvatarIcon: { fontSize: "22px", opacity: 0.85 },
  accountInfo: { flex: 1, minWidth: 0 },
  accountStatusRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  accountStatus: {
    fontSize: "16px",
    fontWeight: 900,
    color: "#F8FAFC",
  },
  planStatusBadge: {
    fontSize: "10px",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    borderRadius: "999px",
    padding: "4px 10px",
  },
  planStatusBadgeFree: {
    color: "#CBD5E1",
    background: "rgba(148,163,184,.15)",
    border: "1px solid rgba(148,163,184,.28)",
  },
  planStatusBadgePro: {
    color: "#FDE68A",
    background: "rgba(251,191,36,.12)",
    border: "1px solid rgba(251,191,36,.28)",
  },
  accountHint: {
    margin: "8px 0 0",
    fontSize: "13px",
    lineHeight: 1.5,
    color: "#94A3B8",
  },
  accountSyncRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px",
    marginTop: "12px",
    padding: "10px 12px",
    borderRadius: "12px",
    background: "rgba(15,23,42,.55)",
    border: "1px solid rgba(255,255,255,.06)",
    fontSize: "12px",
  },
  accountSyncLabel: { color: "#64748B", fontWeight: 700 },
  accountSyncValue: { color: "#E2E8F0", fontWeight: 800 },
  accountSyncDot: { color: "#475569" },
  accountSyncFuture: { color: "#64748B", fontWeight: 600 },
  accountAuthBtns: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    marginTop: "12px",
  },
  authBtnGoogle: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    width: "100%",
    padding: "12px 14px",
    borderRadius: "14px",
    border: "1px solid rgba(255,255,255,.12)",
    background: "rgba(255,255,255,.08)",
    color: "#F1F5F9",
    fontSize: "14px",
    fontWeight: 800,
    cursor: "pointer",
  },
  authBtnApple: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    width: "100%",
    padding: "12px 14px",
    borderRadius: "14px",
    border: "1px solid rgba(255,255,255,.12)",
    background: "rgba(255,255,255,.06)",
    color: "#F1F5F9",
    fontSize: "14px",
    fontWeight: 800,
    cursor: "pointer",
  },
  authBtnEmail: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: "14px",
    border: "1px solid rgba(96,165,250,.35)",
    background: "rgba(37,99,235,.18)",
    color: "#E2E8F0",
    fontSize: "14px",
    fontWeight: 800,
    cursor: "pointer",
  },
  authBtnIcon: {
    width: "22px",
    height: "22px",
    borderRadius: "8px",
    display: "grid",
    placeItems: "center",
    fontSize: "13px",
    fontWeight: 900,
    background: "rgba(255,255,255,.10)",
  },
  authModalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(2,6,23,.72)",
    backdropFilter: "blur(4px)",
    zIndex: 125,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    animation: "fadeIn 0.2s ease",
  },
  authModal: {
    width: "100%",
    maxWidth: "460px",
    borderRadius: "24px 24px 0 0",
    padding: "18px 20px 24px",
    paddingBottom: "max(24px, env(safe-area-inset-bottom, 0px))",
    background: "linear-gradient(180deg, #1E293B 0%, #0F172A 100%)",
    border: "1px solid rgba(255,255,255,.12)",
    boxShadow: "0 -16px 48px rgba(0,0,0,.5)",
    animation: "slideUp 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
  },
  authModalTitle: { fontSize: "18px", fontWeight: 900, marginBottom: "10px" },
  authModalBody: {
    fontSize: "14px",
    lineHeight: 1.55,
    color: "#CBD5E1",
    whiteSpace: "pre-line",
    marginBottom: "16px",
  },
  authModalPrimary: {
    width: "100%",
    border: "none",
    borderRadius: "14px",
    padding: "13px 14px",
    fontSize: "15px",
    fontWeight: 900,
    cursor: "pointer",
    color: "#0F172A",
    background: "linear-gradient(135deg, #60A5FA, #A78BFA)",
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
  savedKeywordChips: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "10px",
  },
  savedKeywordChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 10px",
    borderRadius: "999px",
    background: "rgba(255,255,255,.08)",
    border: "1px solid rgba(255,255,255,.12)",
    fontSize: "12px",
    color: "#E2E8F0",
  },
  savedKeywordChipRemove: {
    border: "none",
    background: "transparent",
    color: "#94A3B8",
    cursor: "pointer",
    fontSize: "14px",
    lineHeight: 1,
    padding: 0,
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
    borderRadius: "16px",
    padding: "12px 12px 14px",
    minWidth: 0,
    boxSizing: "border-box",
  },
  aiSummaryHeaderRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    marginBottom: "8px",
  },
  aiSummaryKicker: {
    fontSize: "10px",
    color: "#5EEAD4",
    fontWeight: 800,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  aiQuotaLine: {
    fontSize: "12px",
    color: "#64748B",
    fontWeight: 700,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  aiSummaryBody: {
    fontSize: "13px",
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
    whiteSpace: "pre-line",
  },
  aiSummaryLoading: {
    color: "#94A3B8",
    fontSize: "13px",
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
    marginBottom: "12px",
  },
  aiHighlightsSectionHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    marginBottom: "8px",
  },
  aiSubheadingMuted: {
    fontSize: "11px",
    fontWeight: 800,
    color: "#64748B",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  aiHighlightsCount: {
    fontSize: "11px",
    fontWeight: 700,
    color: "#64748B",
  },
  aiHighlightsPanel: {
    position: "relative",
    overflow: "hidden",
    borderRadius: "14px",
    transition: "max-height 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
  },
  aiHighlightsFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "72px",
    background: "linear-gradient(180deg, transparent, rgba(15,23,42,.95))",
    pointerEvents: "none",
  },
  aiHighlightsSectionToggle: {
    width: "100%",
    marginTop: "8px",
    padding: "10px 12px",
    border: "1px solid rgba(255,255,255,.1)",
    borderRadius: "12px",
    background: "rgba(255,255,255,.05)",
    color: "#5EEAD4",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  },
  aiScriptSectionPrimary: {
    marginTop: "2px",
    marginBottom: "4px",
    padding: "14px 14px 16px",
    borderRadius: "18px",
    background:
      "linear-gradient(165deg, rgba(30,58,138,.35) 0%, rgba(15,23,42,.75) 100%)",
    border: "1px solid rgba(96,165,250,.35)",
    boxShadow: "0 8px 28px rgba(37,99,235,.18), inset 0 1px 0 rgba(255,255,255,.08)",
  },
  aiScriptTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  aiScriptTitle: {
    fontSize: "15px",
    fontWeight: 900,
    color: "#F8FAFC",
    letterSpacing: "-0.02em",
  },
  aiScriptPrimaryBadge: {
    fontSize: "10px",
    fontWeight: 800,
    color: "#BFDBFE",
    background: "rgba(59,130,246,.3)",
    border: "1px solid rgba(147,197,253,.4)",
    borderRadius: "999px",
    padding: "3px 8px",
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
    listStyle: "none",
    margin: 0,
    padding: 0,
  },
  aiHighlightCardBtn: {
    width: "100%",
    textAlign: "left",
    background: "rgba(255,255,255,.05)",
    border: "1px solid rgba(255,255,255,.08)",
    borderRadius: "14px",
    padding: "10px 12px",
    color: "inherit",
    WebkitTapHighlightColor: "transparent",
    transition: "background 0.15s ease, border-color 0.15s ease",
  },
  aiHighlightExpandHint: {
    display: "block",
    marginTop: "8px",
    fontSize: "12px",
    fontWeight: 700,
    color: "#5EEAD4",
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
  aiScriptSectionHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    marginBottom: "10px",
  },
  scriptFontRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexShrink: 0,
  },
  scriptFontLabel: {
    fontSize: "11px",
    color: "#64748B",
    fontWeight: 700,
  },
  scriptFontChips: {
    display: "flex",
    gap: "4px",
  },
  scriptFontChip: {
    border: "1px solid rgba(255,255,255,.12)",
    background: "rgba(255,255,255,.06)",
    color: "#94A3B8",
    borderRadius: "8px",
    padding: "4px 8px",
    fontSize: "11px",
    fontWeight: 700,
    cursor: "pointer",
  },
  scriptFontChipActive: {
    background: "rgba(45,212,191,.18)",
    border: "1px solid rgba(45,212,191,.45)",
    color: "#CCFBF1",
  },
  aiScriptStopBtn: {
    background: "rgba(220,38,38,.88)",
    color: "white",
    border: "none",
    borderRadius: "12px",
    padding: "9px 14px",
    fontWeight: 800,
    fontSize: "12px",
    cursor: "pointer",
  },
  aiScriptActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: 0,
    marginBottom: "12px",
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
  aiScriptFavBtn: {
    background: "rgba(255,255,255,.08)",
    color: "#E2E8F0",
    border: "1px solid rgba(255,255,255,.14)",
    borderRadius: "12px",
    padding: "9px 14px",
    fontWeight: 800,
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
  aiFavPanel: {
    background: "rgba(255,255,255,.06)",
    border: "1px solid rgba(255,255,255,.10)",
    borderRadius: "18px",
    padding: "14px",
    marginTop: "14px",
    marginBottom: "14px",
  },
  aiFavHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
    marginBottom: "10px",
  },
  aiFavTitle: { fontSize: "16px", fontWeight: 900, color: "#E2E8F0" },
  aiFavSub: { fontSize: "12px", color: "#94A3B8", marginTop: "2px" },
  aiFavEmpty: { fontSize: "13px", color: "#94A3B8", padding: "6px 2px" },
  aiFavList: { display: "grid", gap: "10px" },
  aiFavCard: {
    background: "rgba(2,6,23,.45)",
    border: "1px solid rgba(255,255,255,.10)",
    borderRadius: "16px",
    overflow: "hidden",
  },
  aiFavMainBtn: {
    width: "100%",
    textAlign: "left",
    background: "transparent",
    border: "none",
    padding: "12px",
    cursor: "pointer",
    color: "inherit",
  },
  aiFavMetaRow: { display: "flex", justifyContent: "space-between", gap: "10px" },
  aiFavWhen: { fontSize: "12px", color: "#94A3B8", fontWeight: 700 },
  aiFavBadge: {
    fontSize: "12px",
    color: "#CCFBF1",
    fontWeight: 900,
    background: "rgba(45,212,191,.14)",
    border: "1px solid rgba(45,212,191,.32)",
    borderRadius: "999px",
    padding: "2px 8px",
    whiteSpace: "nowrap",
  },
  aiFavPreview: { marginTop: "8px", fontSize: "14px", color: "#E2E8F0", fontWeight: 800 },
  aiFavPreviewMuted: { marginTop: "8px", fontSize: "13px", color: "#94A3B8", fontWeight: 700 },
  aiFavActions: {
    display: "flex",
    gap: "8px",
    padding: "10px 12px 12px",
    borderTop: "1px solid rgba(255,255,255,.08)",
    flexWrap: "wrap",
  },
  aiFavPlayBtn: {
    background: "linear-gradient(135deg, #2563EB, #4F46E5)",
    color: "white",
    border: "none",
    borderRadius: "12px",
    padding: "8px 12px",
    fontWeight: 900,
    fontSize: "12px",
    cursor: "pointer",
  },
  aiFavCopyBtn: {
    background: "rgba(255,255,255,.10)",
    color: "#E2E8F0",
    border: "1px solid rgba(255,255,255,.14)",
    borderRadius: "12px",
    padding: "8px 12px",
    fontWeight: 800,
    fontSize: "12px",
    cursor: "pointer",
  },
  aiFavRemoveBtn: {
    background: "rgba(220,38,38,.10)",
    color: "#FCA5A5",
    border: "1px solid rgba(220,38,38,.28)",
    borderRadius: "12px",
    padding: "8px 12px",
    fontWeight: 900,
    fontSize: "12px",
    cursor: "pointer",
  },
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
  newsListDense: { display: "flex", flexDirection: "column", gap: "6px" },
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
    padding: "8px 10px",
    borderRadius: "13px",
  },
  newsCardActive: {
    background: "rgba(37,99,235,.26)",
    border: "1px solid rgba(147,197,253,.45)",
  },
  newsCardPlaying: {
    background: "rgba(124,58,237,.22)",
    border: "1px solid rgba(167,139,250,.55)",
    boxShadow: "0 0 0 1px rgba(167,139,250,.2), 0 6px 20px rgba(124,58,237,.2)",
  },
  playerDeck: {
    marginTop: "4px",
    marginBottom: "12px",
    padding: "16px",
    borderRadius: "22px",
    background: "linear-gradient(165deg, rgba(30,41,59,.95) 0%, rgba(15,23,42,.92) 100%)",
    border: "1px solid rgba(255,255,255,.1)",
    boxShadow: "0 12px 40px rgba(0,0,0,.35)",
  },
  playerDeckTop: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    marginBottom: "12px",
  },
  playerDeckMeta: { flex: 1, minWidth: 0 },
  playerStatus: {
    fontSize: "16px",
    fontWeight: 900,
    color: "#F8FAFC",
    lineHeight: 1.25,
  },
  playerSubMeta: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "6px",
    alignItems: "center",
  },
  playerSpeedTag: {
    fontSize: "12px",
    fontWeight: 800,
    color: "#A5B4FC",
    background: "rgba(99,102,241,.2)",
    padding: "3px 8px",
    borderRadius: "999px",
  },
  playerRemaining: {
    fontSize: "12px",
    color: "#94A3B8",
    fontWeight: 600,
  },
  playerChunkMeta: {
    fontSize: "11px",
    color: "#64748B",
    fontWeight: 700,
  },
  waveform: {
    display: "flex",
    alignItems: "flex-end",
    gap: "3px",
    height: "36px",
    flexShrink: 0,
  },
  playerProgressTrack: {
    height: "5px",
    borderRadius: "999px",
    background: "rgba(255,255,255,.1)",
    overflow: "hidden",
    marginBottom: "14px",
  },
  playerProgressFill: {
    height: "100%",
    borderRadius: "999px",
    background: "linear-gradient(90deg, #6366F1, #22D3EE)",
    transition: "width 0.2s ease",
  },
  playerControlRow: {
    display: "flex",
    gap: "8px",
    marginBottom: "12px",
    flexWrap: "wrap",
  },
  playerPlayBtn: {
    flex: "1 1 120px",
    background: "linear-gradient(135deg, #2563EB, #4F46E5)",
    color: "white",
    border: "none",
    borderRadius: "14px",
    padding: "12px 16px",
    fontWeight: 900,
    fontSize: "14px",
    cursor: "pointer",
  },
  playerStopBtn: {
    flex: "0 0 auto",
    background: "rgba(220,38,38,.9)",
    color: "white",
    border: "none",
    borderRadius: "14px",
    padding: "12px 18px",
    fontWeight: 800,
    fontSize: "14px",
    cursor: "pointer",
  },
  playerAltPlayBtn: {
    flex: "0 0 auto",
    background: "rgba(255,255,255,.1)",
    color: "#E2E8F0",
    border: "1px solid rgba(255,255,255,.14)",
    borderRadius: "14px",
    padding: "12px 14px",
    fontWeight: 700,
    fontSize: "13px",
    cursor: "pointer",
  },
  floatingPlayer: {
    position: "fixed",
    left: "50%",
    transform: "translateX(-50%)",
    bottom: "calc(78px + env(safe-area-inset-bottom, 0px))",
    width: "min(440px, calc(100% - 20px))",
    zIndex: 45,
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "8px 10px",
    borderRadius: "18px",
    background: "rgba(15,23,42,.94)",
    border: "1px solid rgba(255,255,255,.12)",
    backdropFilter: "blur(20px)",
    boxShadow: "0 8px 32px rgba(0,0,0,.45)",
  },
  floatingPlayerMain: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: "10px",
    background: "transparent",
    border: "none",
    color: "white",
    cursor: "pointer",
    padding: "4px 6px",
    textAlign: "left",
    position: "relative",
  },
  floatingPlayerText: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  floatingPlayerTitle: {
    fontSize: "13px",
    fontWeight: 800,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  floatingPlayerSub: {
    fontSize: "11px",
    color: "#94A3B8",
    fontWeight: 600,
  },
  floatingProgressTrack: {
    position: "absolute",
    left: 6,
    right: 6,
    bottom: 0,
    height: "2px",
    background: "rgba(255,255,255,.1)",
    borderRadius: "999px",
    overflow: "hidden",
  },
  floatingProgressFill: {
    height: "100%",
    background: "linear-gradient(90deg, #6366F1, #22D3EE)",
    transition: "width 0.2s ease",
  },
  floatingIconBtn: {
    width: "40px",
    height: "40px",
    borderRadius: "12px",
    border: "none",
    background: "rgba(99,102,241,.35)",
    color: "white",
    fontSize: "14px",
    fontWeight: 900,
    cursor: "pointer",
    flexShrink: 0,
  },
  floatingIconBtnStop: {
    width: "40px",
    height: "40px",
    borderRadius: "12px",
    border: "none",
    background: "rgba(220,38,38,.85)",
    color: "white",
    fontSize: "12px",
    fontWeight: 900,
    cursor: "pointer",
    flexShrink: 0,
  },
  newsIndex: {
    width: "32px",
    height: "32px",
    borderRadius: "11px",
    background: "rgba(255,255,255,.1)",
    display: "grid",
    placeItems: "center",
    color: "#93C5FD",
    fontWeight: 900,
    fontSize: "11px",
    flexShrink: 0,
  },
  newsTitle: { fontSize: "14px", fontWeight: 800, lineHeight: 1.4 },
  newsMeta: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    color: "#94A3B8",
    marginTop: "6px",
    fontSize: "11px",
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
    left: "50%",
    transform: "translateX(-50%)",
    bottom: "max(8px, env(safe-area-inset-bottom, 0px))",
    width: "min(460px, calc(100% - 20px))",
    maxWidth: "calc(100% - 20px)",
    minHeight: "64px",
    height: "auto",
    margin: 0,
    background: "rgba(15,23,42,.82)",
    border: "1px solid rgba(255,255,255,.1)",
    borderRadius: "22px",
    padding: "6px 10px",
    display: "flex",
    justifyContent: "space-around",
    alignItems: "center",
    backdropFilter: "blur(24px) saturate(1.2)",
    WebkitBackdropFilter: "blur(24px) saturate(1.2)",
    boxShadow:
      "0 4px 24px rgba(0,0,0,.35), 0 0 1px rgba(255,255,255,.12) inset",
    zIndex: 50,
  },
  navItem: {
    background: "transparent",
    border: "none",
    color: "#64748B",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "2px",
    flex: "1 1 0",
    minWidth: 0,
    minHeight: "52px",
    padding: "6px 4px",
    borderRadius: "14px",
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
    transition: "transform 0.12s ease, color 0.15s ease",
  },
  navItemActive: {
    background: "rgba(255,255,255,.06)",
    border: "none",
    color: "#F8FAFC",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "2px",
    flex: "1 1 0",
    minWidth: 0,
    minHeight: "52px",
    padding: "6px 4px",
    borderRadius: "14px",
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
    transition: "transform 0.12s ease, color 0.15s ease",
  },
  navIcon: {
    display: "grid",
    placeItems: "center",
    width: "28px",
    height: "28px",
    borderRadius: "10px",
    transition: "box-shadow 0.2s ease, background 0.2s ease",
  },
  navIconActive: {
    display: "grid",
    placeItems: "center",
    width: "28px",
    height: "28px",
    borderRadius: "10px",
    background: "rgba(96,165,250,.14)",
    boxShadow: "0 0 14px rgba(96,165,250,.35)",
    transition: "box-shadow 0.2s ease, background 0.2s ease",
  },
  navLabel: {
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "0.01em",
    lineHeight: 1.15,
    color: "#64748B",
  },
  navLabelActive: {
    fontSize: "10px",
    fontWeight: 700,
    color: "#F1F5F9",
    letterSpacing: "0.01em",
    lineHeight: 1.15,
  },
  aiExpandToggle: {
    marginTop: "8px",
    background: "transparent",
    border: "none",
    color: "#5EEAD4",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
    padding: "4px 0",
    width: "100%",
    textAlign: "left",
  },
  aiPanelRegenerateBtn: {
    width: "100%",
    marginTop: "14px",
    background: "rgba(255,255,255,.08)",
    color: "#CBD5E1",
    border: "1px solid rgba(255,255,255,.12)",
    borderRadius: "12px",
    padding: "10px",
    fontWeight: 700,
    fontSize: "13px",
    cursor: "pointer",
  },
  aiSheetBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(2,6,23,.72)",
    backdropFilter: "blur(4px)",
    zIndex: 100,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    animation: "fadeIn 0.2s ease",
  },
  aiSheetPanel: {
    width: "100%",
    maxWidth: "460px",
    background: "linear-gradient(180deg, #1E293B 0%, #0F172A 100%)",
    border: "1px solid rgba(255,255,255,.12)",
    borderRadius: "24px 24px 0 0",
    padding: "12px 20px 28px",
    paddingBottom: "max(28px, env(safe-area-inset-bottom, 0px))",
    boxShadow: "0 -16px 48px rgba(0,0,0,.5)",
    animation: "slideUp 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
  },
  aiSheetHandle: {
    width: "40px",
    height: "4px",
    borderRadius: "999px",
    background: "rgba(255,255,255,.2)",
    margin: "0 auto 14px",
  },
  aiSheetTitle: {
    fontSize: "18px",
    fontWeight: 900,
    marginBottom: "6px",
  },
  aiSheetDesc: {
    margin: "0 0 16px",
    color: "#94A3B8",
    fontSize: "13px",
    lineHeight: 1.45,
  },
  aiSheetModeRow: {
    display: "flex",
    gap: "8px",
    marginBottom: "14px",
  },
  aiSheetModeBtn: {
    flex: 1,
    padding: "10px 8px",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,.12)",
    background: "rgba(255,255,255,.06)",
    color: "#CBD5E1",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
  },
  aiSheetModeBtnActive: {
    border: "1px solid rgba(45,212,191,.45)",
    background: "rgba(16,185,129,.15)",
    color: "#F8FAFC",
  },
  aiSheetOptions: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    marginBottom: "12px",
  },
  aiSheetOptionBtn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "2px",
    width: "100%",
    padding: "14px 16px",
    borderRadius: "16px",
    border: "1px solid rgba(45,212,191,.35)",
    background: "rgba(16,185,129,.12)",
    color: "white",
    cursor: "pointer",
    textAlign: "left",
  },
  aiSheetOptionLocked: {
    border: "1px solid rgba(255,255,255,.12)",
    background: "rgba(255,255,255,.06)",
    color: "#CBD5E1",
  },
  aiSheetOptionMain: {
    fontSize: "16px",
    fontWeight: 900,
  },
  proLockTag: {
    display: "inline-block",
    marginLeft: "8px",
    fontSize: "12px",
    fontWeight: 900,
    color: "#FDE68A",
    background: "rgba(251,191,36,.12)",
    border: "1px solid rgba(251,191,36,.25)",
    padding: "2px 8px",
    borderRadius: "999px",
    verticalAlign: "middle",
  },
  aiSheetOptionSub: {
    fontSize: "12px",
    color: "#94A3B8",
    fontWeight: 600,
  },
  aiSheetCancel: {
    width: "100%",
    marginTop: "4px",
    padding: "12px",
    borderRadius: "14px",
    border: "none",
    background: "rgba(255,255,255,.08)",
    color: "#CBD5E1",
    fontWeight: 700,
    fontSize: "14px",
    cursor: "pointer",
  },
  proBanner: {
    marginTop: "10px",
    borderRadius: "16px",
    padding: "12px 12px",
    minHeight: "78px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    background:
      "linear-gradient(135deg, rgba(124,58,237,.16) 0%, rgba(15,23,42,.88) 58%, rgba(96,165,250,.10) 100%)",
    border: "1px solid rgba(255,255,255,.10)",
  },
  proBannerPro: {
    marginTop: "10px",
    borderRadius: "16px",
    padding: "12px 12px",
    minHeight: "74px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    background: "rgba(16,185,129,.07)",
    border: "1px solid rgba(52,211,153,.18)",
  },
  proBannerLeft: { minWidth: 0 },
  proBannerTitle: {
    fontSize: "14px",
    fontWeight: 900,
    color: "#F8FAFC",
    lineHeight: 1.2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  proBannerSub: {
    marginTop: "6px",
    fontSize: "12px",
    color: "#94A3B8",
    fontWeight: 700,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  proBannerBtn: {
    flexShrink: 0,
    border: "1px solid rgba(255,255,255,.14)",
    background: "rgba(255,255,255,.06)",
    color: "#E2E8F0",
    borderRadius: "999px",
    padding: "10px 14px",
    fontWeight: 900,
    fontSize: "13px",
    cursor: "pointer",
  },
  proBadgeOk: {
    flexShrink: 0,
    fontSize: "10px",
    fontWeight: 900,
    letterSpacing: "0.14em",
    color: "#A7F3D0",
    background: "rgba(16,185,129,.14)",
    border: "1px solid rgba(52,211,153,.22)",
    borderRadius: "999px",
    padding: "4px 10px",
  },
  proUpgradeCardCompact: {
    marginTop: "8px",
    marginBottom: "6px",
    padding: "12px 14px",
    borderRadius: "14px",
    background:
      "linear-gradient(135deg, rgba(124,58,237,.14) 0%, rgba(15,23,42,.9) 100%)",
    border: "1px solid rgba(167,139,250,.25)",
  },
  proUpgradeCardSettings: {
    marginBottom: "14px",
    padding: "14px",
    borderRadius: "16px",
    background: "rgba(15,23,42,.88)",
    border: "1px solid rgba(255,255,255,.1)",
  },
  proUpgradeTitle: {
    fontSize: "15px",
    fontWeight: 900,
    color: "#F8FAFC",
    lineHeight: 1.35,
    marginBottom: "8px",
  },
  proUpgradeSubtitle: {
    margin: "0 0 8px",
    fontSize: "13px",
    color: "#94A3B8",
    lineHeight: 1.45,
  },
  proUpgradeList: {
    margin: "0 0 10px",
    paddingLeft: "18px",
    fontSize: "13px",
    color: "#CBD5E1",
    lineHeight: 1.5,
  },
  proUpgradeCompactSub: {
    margin: "0 0 8px",
    fontSize: "12px",
    color: "#94A3B8",
    lineHeight: 1.4,
  },
  proUpgradePriceRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    fontSize: "12px",
    fontWeight: 800,
    color: "#A7F3D0",
    marginBottom: "10px",
  },
  proUpgradePriceDot: { color: "#64748B" },
  proUpgradeBtnRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
  proUpgradePrimaryBtn: {
    flex: "1 1 120px",
    border: "none",
    borderRadius: "12px",
    padding: "10px 14px",
    fontSize: "13px",
    fontWeight: 900,
    color: "white",
    background: "linear-gradient(135deg, #7C3AED, #4F46E5)",
    cursor: "pointer",
  },
  proUpgradeSecondaryBtn: {
    flex: "1 1 100px",
    borderRadius: "12px",
    padding: "10px 14px",
    fontSize: "13px",
    fontWeight: 800,
    color: "#E2E8F0",
    background: "rgba(255,255,255,.08)",
    border: "1px solid rgba(255,255,255,.14)",
    cursor: "pointer",
  },
  proUpgradeFootnote: {
    margin: "8px 0 0",
    fontSize: "11px",
    color: "#64748B",
    lineHeight: 1.35,
  },
  proStatusLine: {
    fontSize: "14px",
    color: "#CBD5E1",
    lineHeight: 1.55,
    marginBottom: "6px",
  },
  proDebugToolsBox: {
    marginTop: "14px",
    paddingTop: "12px",
    borderTop: "1px dashed rgba(251,191,36,.35)",
  },
  proDebugToolsLabel: {
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    color: "#FCD34D",
    marginBottom: "8px",
    textTransform: "uppercase",
  },
  proDebugResetBtnProminent: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid rgba(251,191,36,.45)",
    background: "rgba(251,191,36,.12)",
    color: "#FDE68A",
    borderRadius: "12px",
    padding: "10px 14px",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
  },
  proDebugHint: {
    marginTop: "12px",
    marginBottom: 0,
    fontSize: "12px",
    lineHeight: 1.5,
    color: "#64748B",
  },
  proModalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(2,6,23,.72)",
    zIndex: 200,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    padding: "12px",
    paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))",
  },
  proModalPanel: {
    width: "min(460px, 100%)",
    maxHeight: "min(88dvh, 720px)",
    overflowY: "auto",
    borderRadius: "20px",
    padding: "14px",
    background: "#0F172A",
    border: "1px solid rgba(255,255,255,.12)",
  },
  proModalFocusBox: {
    marginBottom: "12px",
    padding: "12px",
    borderRadius: "12px",
    background: "rgba(124,58,237,.15)",
    border: "1px solid rgba(167,139,250,.3)",
  },
  proModalFocusTitle: {
    fontSize: "16px",
    fontWeight: 900,
    color: "#F8FAFC",
    marginBottom: "6px",
  },
  proModalFocusBody: {
    margin: 0,
    fontSize: "13px",
    color: "#CBD5E1",
    lineHeight: 1.45,
  },
  proModalCloseBtn: {
    width: "100%",
    marginTop: "10px",
    padding: "12px",
    borderRadius: "12px",
    border: "none",
    background: "rgba(255,255,255,.08)",
    color: "#CBD5E1",
    fontWeight: 700,
    fontSize: "14px",
    cursor: "pointer",
  },
  promoModalPanel: {
    width: "min(400px, 100%)",
    borderRadius: "18px",
    padding: "16px",
    background: "#0F172A",
    border: "1px solid rgba(255,255,255,.12)",
  },
  promoModalTitle: {
    fontSize: "16px",
    fontWeight: 900,
    marginBottom: "12px",
    color: "#F8FAFC",
  },
  promoInput: {
    width: "100%",
    boxSizing: "border-box",
    marginBottom: "12px",
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1px solid rgba(255,255,255,.14)",
    background: "rgba(255,255,255,.06)",
    color: "white",
    fontSize: "14px",
    outline: "none",
  },
  paywallBackdrop: {
    position: "fixed",
    inset: 0,
    background: "linear-gradient(180deg, rgba(2,6,23,.92), rgba(2,6,23,.85))",
    zIndex: 180,
    display: "flex",
    justifyContent: "center",
  },
  paywallWrap: {
    width: "min(520px, 100%)",
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    background:
      "radial-gradient(circle at 20% 0%, rgba(99,102,241,.25), transparent 45%), radial-gradient(circle at 80% 10%, rgba(34,211,238,.18), transparent 40%), linear-gradient(180deg, #020617 0%, #0B1223 55%, #020617 100%)",
    borderLeft: "1px solid rgba(255,255,255,.08)",
    borderRight: "1px solid rgba(255,255,255,.08)",
  },
  paywallTopBar: {
    padding: "max(14px, env(safe-area-inset-top, 0px)) 16px 10px",
    display: "flex",
    justifyContent: "flex-end",
  },
  paywallLaterTop: {
    border: "1px solid rgba(255,255,255,.14)",
    background: "rgba(255,255,255,.06)",
    color: "#E2E8F0",
    borderRadius: "999px",
    padding: "8px 12px",
    fontSize: "12px",
    fontWeight: 900,
    cursor: "pointer",
  },
  paywallScroll: {
    flex: 1,
    overflowY: "auto",
    padding: "0 16px 16px",
  },
  paywallHero: {
    padding: "8px 6px 14px",
    marginBottom: "10px",
  },
  paywallBrand: {
    fontSize: "22px",
    fontWeight: 1000,
    letterSpacing: "-0.02em",
    color: "#F8FAFC",
  },
  paywallSlogan: {
    marginTop: "8px",
    fontSize: "14px",
    lineHeight: 1.45,
    color: "#CBD5E1",
  },
  paywallFeatureGrid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: "10px",
    marginBottom: "14px",
  },
  paywallFeatureCard: {
    padding: "14px",
    borderRadius: "16px",
    background: "rgba(255,255,255,.05)",
    border: "1px solid rgba(255,255,255,.10)",
  },
  paywallFeatureTitle: {
    fontSize: "14px",
    fontWeight: 950,
    color: "#F8FAFC",
    marginBottom: "6px",
  },
  paywallFeatureDesc: {
    fontSize: "13px",
    lineHeight: 1.5,
    color: "#94A3B8",
  },
  paywallPlanSection: {
    padding: "14px",
    borderRadius: "18px",
    background: "rgba(15,23,42,.55)",
    border: "1px solid rgba(255,255,255,.10)",
  },
  paywallPlanHeader: {
    marginBottom: "10px",
  },
  paywallPlanTitle: {
    fontSize: "15px",
    fontWeight: 950,
    color: "#F8FAFC",
  },
  paywallPlanHint: {
    marginTop: "6px",
    fontSize: "12px",
    lineHeight: 1.45,
    color: "#64748B",
  },
  paywallPlanList: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  paywallPlanCard: {
    position: "relative",
    width: "100%",
    textAlign: "left",
    borderRadius: "16px",
    padding: "12px 12px",
    background: "rgba(255,255,255,.06)",
    border: "1px solid rgba(255,255,255,.12)",
    color: "inherit",
    cursor: "pointer",
  },
  paywallPlanCardActive: {
    borderColor: "rgba(96,165,250,.55)",
    boxShadow: "0 0 0 1px rgba(96,165,250,.18)",
    background: "rgba(37,99,235,.14)",
  },
  paywallPlanPopular: {
    position: "absolute",
    top: "-10px",
    right: "10px",
    fontSize: "10px",
    fontWeight: 950,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#0B1223",
    background: "linear-gradient(135deg, #FDE68A, #FDBA74)",
    borderRadius: "999px",
    padding: "5px 10px",
  },
  paywallPlanRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "12px",
  },
  paywallPlanName: {
    fontSize: "14px",
    fontWeight: 950,
    color: "#F8FAFC",
  },
  paywallPlanPrice: {
    fontSize: "14px",
    fontWeight: 950,
    color: "#E2E8F0",
  },
  paywallPlanSub: {
    marginTop: "6px",
    fontSize: "12px",
    color: "#94A3B8",
    fontWeight: 700,
  },
  paywallBottomBar: {
    padding: "12px 16px max(16px, env(safe-area-inset-bottom, 0px))",
    borderTop: "1px solid rgba(255,255,255,.08)",
    background: "rgba(2,6,23,.72)",
    backdropFilter: "blur(14px)",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  paywallPrimaryCta: {
    width: "100%",
    border: "none",
    borderRadius: "16px",
    padding: "14px 14px",
    fontSize: "15px",
    fontWeight: 1000,
    cursor: "pointer",
    color: "#0F172A",
    background: "linear-gradient(135deg, #60A5FA, #A78BFA)",
    boxShadow: "0 10px 30px rgba(99,102,241,.18)",
  },
  paywallSecondaryCta: {
    width: "100%",
    borderRadius: "16px",
    padding: "13px 14px",
    fontSize: "14px",
    fontWeight: 950,
    cursor: "pointer",
    color: "#E2E8F0",
    background: "rgba(255,255,255,.06)",
    border: "1px solid rgba(255,255,255,.14)",
  },
  onboardingBackdrop: {
    position: "fixed",
    inset: 0,
    background:
      "radial-gradient(circle at 20% 0%, rgba(99,102,241,.25), transparent 45%), radial-gradient(circle at 80% 10%, rgba(34,211,238,.16), transparent 40%), rgba(2,6,23,.92)",
    backdropFilter: "blur(10px)",
    zIndex: 140,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    animation: "fadeIn 0.2s ease",
  },
  onboardingModal: {
    width: "min(520px, 100%)",
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    padding:
      "max(18px, env(safe-area-inset-top, 0px)) 18px max(18px, env(safe-area-inset-bottom, 0px))",
    background:
      "linear-gradient(180deg, rgba(2,6,23,.96) 0%, rgba(11,18,35,.96) 55%, rgba(2,6,23,.96) 100%)",
  },
  onboardingTopRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    marginBottom: "14px",
  },
  onboardingBrand: {
    fontSize: "13px",
    fontWeight: 950,
    letterSpacing: "-0.01em",
    color: "#E2E8F0",
  },
  onboardingSkipBtn: {
    border: "none",
    background: "transparent",
    color: "#CBD5E1",
    borderRadius: "999px",
    padding: "8px 10px",
    fontWeight: 850,
    fontSize: "12px",
    cursor: "pointer",
  },
  onboardingCard: {
    flex: 1,
    borderRadius: "24px",
    padding: "34px 22px",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "center",
    background:
      "radial-gradient(circle at 12% 10%, rgba(99,102,241,.34) 0%, transparent 52%), radial-gradient(circle at 88% 22%, rgba(34,211,238,.18) 0%, transparent 58%)",
  },
  onboardingIcon: {
    width: "92px",
    height: "92px",
    display: "grid",
    placeItems: "center",
    fontSize: "44px",
    marginBottom: "18px",
  },
  onboardingStepKicker: {
    fontSize: "12px",
    fontWeight: 950,
    letterSpacing: "0.16em",
    color: "rgba(148,163,184,.72)",
  },
  onboardingTitle: {
    marginTop: "10px",
    fontSize: "32px",
    fontWeight: 1000,
    letterSpacing: "-0.02em",
  },
  onboardingBody: {
    marginTop: "14px",
    fontSize: "18px",
    lineHeight: 1.65,
    color: "#CBD5E1",
    maxWidth: "30ch",
  },
  onboardingDots: {
    display: "flex",
    justifyContent: "center",
    gap: "8px",
    marginTop: "14px",
    marginBottom: "14px",
  },
  onboardingDot: {
    width: "7px",
    height: "7px",
    borderRadius: "999px",
    background: "rgba(148,163,184,.35)",
  },
  onboardingDotActive: {
    width: "18px",
    background: "linear-gradient(90deg, #60A5FA, #A78BFA)",
  },
  onboardingActions: {
    display: "flex",
    gap: "10px",
  },
  onboardingPrimary: {
    flex: 1,
    border: "none",
    borderRadius: "999px",
    height: "54px",
    padding: "0 14px",
    fontSize: "15px",
    fontWeight: 950,
    cursor: "pointer",
    color: "#0F172A",
    background: "linear-gradient(135deg, #60A5FA, #A78BFA)",
    boxShadow: "0 12px 28px rgba(99,102,241,.22)",
  },
  onboardingSecondary: {
    flex: 1,
    border: "none",
    borderRadius: "999px",
    height: "54px",
    padding: "0 14px",
    fontSize: "15px",
    fontWeight: 850,
    cursor: "pointer",
    color: "#CBD5E1",
    background: "rgba(255,255,255,.05)",
  },
  splashWrap: {
    position: "fixed",
    inset: 0,
    zIndex: 200,
    background:
      "radial-gradient(circle at 22% 12%, rgba(99,102,241,.32) 0%, transparent 42%), radial-gradient(circle at 78% 24%, rgba(34,211,238,.18) 0%, transparent 46%), linear-gradient(180deg, #020617 0%, #0B1220 100%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "max(24px, env(safe-area-inset-top, 0px)) 24px max(24px, env(safe-area-inset-bottom, 0px))",
  },
  splashCenter: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
  },
  splashLogo: {
    width: "64px",
    height: "64px",
    borderRadius: "20px",
    display: "grid",
    placeItems: "center",
    fontSize: "30px",
    background: "rgba(255,255,255,.06)",
    border: "1px solid rgba(255,255,255,.10)",
  },
  splashTitle: { fontSize: "18px", fontWeight: 900, letterSpacing: "-0.02em" },
  splashSubtitle: { fontSize: "13px", color: "#94A3B8", fontWeight: 700 },
  splashLoader: {
    marginTop: "2px",
    display: "flex",
    justifyContent: "center",
    gap: "5px",
    height: "10px",
  },
};
