import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { CSSProperties } from "react";
import { Headphones, Home, Settings, Star } from "lucide-react";
import {
  canAddCustomKeyword,
  canAddFavorite,
  canAddTopic,
  canUseDailyInsight,
  canUseDeepMode,
  canUseProDuration,
  clampTrackingToPlan,
  filterHistoryByPlan,
  formatProExpiresAt,
  getAiDailyLimit,
  getPlanLimits,
  getProStatus,
  getTotalTrackingCount,
  isProActive,
  proSourceLabel,
  sanitizeNonIapProUnlocks,
  type ProStatus,
} from "./pro";
import {
  AI_DURATIONS,
  DAILY_AUTO_DURATION,
  FREE_DURATION,
  durationOptionSubtitle,
  isProDuration,
  normalizeAiDuration,
  type AiDuration,
} from "./aiDuration";
import {
  consumeAutoplayDailyFlag,
  clearAutoplayDailyFlag,
  clearAutoplayAnchorAudioFlag,
  consumeAutoplayAnchorAudioFlag,
  setAutoplayAnchorAudioFlag,
  dailyRadioHeroDisplay,
  dailyRadioHeroStatus,
  findTodayDailyHistoryEntry,
  logDailyRadioScheduler,
  markDailyGenerationComplete,
  markDailyGenerationFailed,
  markDailyGenerationStarted,
  NEWS_FETCH_TIMEOUT_MS,
  readDailyRadioState,
  readUserDisplayName,
  setAutoplayDailyFlag,
  writeUserDisplayName,
  todayDailyScriptYmd,
  writeDailyRadioState,
  type DailyRadioState,
  type NewsFetchStatus,
  type ServerSyncStatus,
} from "./dailyRadio";
import { initDailyNotificationsOnce, maybeRescheduleDailyRadioReminder } from "./dailyNotifications";
import { initRemotePush, dailyRadioPushPayloadToOpenInfo, type DailyRadioPushOpenInfo } from "./remotePush";
import { audioUrlPrefix, logPushOpenReceived, playErrorFields } from "./pushOpenDebug";
import { ensureSupabaseUser, getSupabaseAuthUserId, initSupabaseAuth, isSupabaseConfigured } from "./supabaseClient";
import {
  fetchServerDailyScript,
  saveAppGeneratedDailyScript,
  syncUserNewsPreferences,
  triggerServerDailyRadioGeneration,
  type DailyScriptQueryDebug,
  type FetchScriptOptions,
  type ServerDailyScript,
} from "./dailyRadioApi";
import { AiAnchorAudioProvider, useAiAnchorPlayer, useAiAnchorPlayerActions } from "./AiAnchorAudioProvider";
import { MORNING_RADIO_TIME, EVENING_RADIO_TIME, radioSlotCompletedTitle, type RadioSlot } from "./radioSlot";
import { appendRadioClosing } from "./radioClosing";
import {
  DEFAULT_AI_ANCHOR_SETTINGS,
  formatAnchorPlaybackRate,
  getAnchorById,
  getScriptAudioStaleReason,
  isTodayScriptAudioReady,
  getStyleById,
  readAnchorId,
  readAnchorPlaybackRate,
  readAnchorStyleId,
  readAnchorVolumeGain,
  writeAnchorId,
  writeAnchorPlaybackRate,
  writeAnchorStyleId,
  writeAnchorVolumeGain,
  type AiAnchorPlaybackRate,
  type AiAnchorStyle,
  type AiAnchorVoice,
  type AiAnchorVolumeGain,
  type ScriptAudioStaleReason,
} from "./aiAnchorSettings";
import {
  AiAnchorBroadcastPanel,
  AiAnchorProLockCard,
  AiAnchorSettingsFields,
  AiAnchorSettingsIntro,
} from "./AiAnchorBroadcastPanel";
import { generateScriptAudio, isScriptUuid, pingVercelApi } from "./scriptAudioApi";
import {
  buildManualScriptFingerprint,
  buildServerScriptFingerprint,
  isScriptAudioBound,
  type DisplayScriptSource,
} from "./scriptAudioBinding";
import { isInternalAccessActive } from "./hiddenDevUnlock";
import { hourInTimezone, DAILY_SCRIPT_TIMEZONE, todayYmdLocal } from "./dateLocal";
import { buildPlaybackIntro, prependPlaybackIntro } from "./playbackIntro";
import {
  formatRemainingTime,
  isPlaybackActiveState,
  playbackPageTitle,
  canStopPlayback,
  canStartPlayback,
  canRestartPlayback,
  isPlayPrimaryDisabled,
  type PlaybackMode,
  type PlaybackState,
} from "./playbackController";
import { usePlaybackController } from "./usePlaybackController";
import { parseAiSummaryContent, warnScriptQuality } from "./aiSummaryParse";
import { TOKENS, shortVoiceLabel } from "./theme";
import type { AiDailyInsight } from "./AiDailyInsightCard";
import {
  AiDailyInsightCard,
  findClosestNewsByTitle,
  normalizeDailyInsight,
} from "./AiDailyInsightCard";
import { HiddenDevPanel } from "./HiddenDevPanel";
import { DisplayNameField } from "./DisplayNameField";
import { SettingsToastHost, showSettingsToast } from "./SettingsToast";
import { InternalPromotionBanner } from "./InternalPromotionBanner";
import { apiUrl } from "./apiBase";
import {
  chineseVoiceOptionLabel,
  filterChineseVoices,
  pickDefaultChineseVoice,
} from "./voiceSelection";
import { restorePurchases, purchaseProSubscription, syncPurchasesOnLaunch } from "./iapRestore";
import {
  getProUpgradeButtonLabel,
  PRO_PRICING,
  type ProPlanTier,
} from "./proPricing";
import {
  buildActiveNewsFeedSources,
  buildSelectedTopicSummary,
  mergeTopicNewsFeeds,
  normalizeNewsKey,
  parseNewsPubDate,
  parseNewsRssXml,
  type NewsFeedSource,
  type NewsItem,
  type TopicNewsSection,
} from "./newsFeed";
import {
  getTopicSectionDomId,
  TopicQuickNavBar,
} from "./TopicQuickNavBar";
import { logScrollDebug } from "./scrollDebug";
import {
  ONBOARDING_TOPIC_PICK_COUNT,
  readOnboardingCompleted,
  readStoredSelectedTopics,
  SELECTED_TOPICS_STORAGE_KEY,
  shouldShowTopicOnboarding,
  TopicOnboardingScreen,
  writeOnboardingCompleted,
} from "./TopicOnboardingScreen";

type Tab = "home" | "player" | "video" | "favorites" | "settings";

/**
 * 設為 `true` 可再次顯示底部「影音」Tab 與影音分頁。
 * `loadVideos`、`/api/videos` 與相關 state 均保留，僅隱藏 UI。
 * 目前因影音 fallback 品質不穩，先關閉以維持產品專業感。
 */
const ENABLE_VIDEO_NEWS_UI = false;

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
  isDailyAuto?: boolean;
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

function normalizeKey(title: string) {
  return normalizeNewsKey(title);
}

/** 傳入 summary API 的新聞欄位（含摘要，避免 AI 模糊改寫人名） */
function buildSummaryApiItems(
  items: NewsItem[],
  context: { keyword?: string; topics?: string[] }
) {
  const topicHint =
    context.keyword?.trim() ||
    (context.topics && context.topics.length > 0
      ? context.topics.slice(0, 5).join("、")
      : "");

  return items.map((n) => {
    const row: Record<string, string> = {
      id: n.id,
      title: n.title,
      source: n.source,
    };
    const summary = (n.description || "").trim();
    if (summary) row.summary = summary.slice(0, 800);
    if (n.link) row.url = n.link;
    if (n.pubDate) row.publishedAt = n.pubDate;
    if (n.fetchedAt) row.fetchedAt = n.fetchedAt;
    const itemTopic =
      n.matchedTopics.length > 0 ? n.matchedTopics.join("、") : n.topic || topicHint;
    if (itemTopic) row.topic = itemTopic;
    return row;
  });
}

/** AI 精華：相同選取結果快取時間 */
const AI_SUMMARY_CACHE_KEY = "pns_ai_summary_v1";
const AI_SUMMARY_CACHE_MS = 30 * 60 * 1000;
const NEWS_REFRESH_STALE_MS = 15 * 60 * 1000;
const NEWS_REFRESH_DEDUPE_MS = 5 * 60 * 1000;
const NEWS_REFRESH_CHECK_MS = 15 * 60 * 1000;

type NewsRefreshOptions = {
  forceRefresh?: boolean;
  reason?: "initial" | "manual" | "topic_change" | "foreground" | "timer" | "manual_generate_prepare" | "daily_auto_prepare";
};

function newsPublishedTime(item: NewsItem): number {
  return parseNewsPubDate(item.pubDate)?.getTime() ?? 0;
}

function newsFetchedTime(item: NewsItem): number {
  return Date.parse(item.fetchedAt || "") || 0;
}

function newsFreshSortTime(item: NewsItem): number {
  return newsPublishedTime(item) || newsFetchedTime(item);
}

function newsIsoFromTime(ms: number): string | null {
  return ms > 0 ? new Date(ms).toISOString() : null;
}

function selectedFreshnessStats(items: NewsItem[]) {
  const publishedTimes = items
    .map(newsPublishedTime)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const fetchedTimes = items
    .map(newsFetchedTime)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const sortTimes = items
    .map(newsFreshSortTime)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);

  return {
    newestSelectedPublishedAt: newsIsoFromTime(publishedTimes[publishedTimes.length - 1] ?? 0),
    oldestSelectedPublishedAt: newsIsoFromTime(publishedTimes[0] ?? 0),
    newestSelectedFetchedAt: newsIsoFromTime(fetchedTimes[fetchedTimes.length - 1] ?? 0),
    oldestSelectedAt: newsIsoFromTime(sortTimes[0] ?? 0),
  };
}
const AI_HISTORY_KEY = "pns_ai_history_v1";
const AI_HISTORY_MAX = 20;
const AI_HISTORY_EXPANDED_KEY = "pns_settings_ai_history_expanded_v1";
const AI_FAVORITES_KEY = "pns_ai_favorites_v1";
const PLAYBACK_SPEED_KEY = "pns_playback_speed_v1";
const SPEED_MIN = 0.8;
const SPEED_MAX = 1.2;
const SPEED_STEP = 0.05;
const SPEED_DEFAULT = 1;
const SCRIPT_FONT_KEY = "pns_script_font_v1";
const AI_DAILY_QUOTA_KEY = "pns_ai_daily_quota_v1";

type ScriptFontSize = "sm" | "md" | "lg" | "xl";
const ONBOARDING_SEEN_KEY = "pns_onboarding_seen_v1";
const SPLASH_SEEN_SESSION_KEY = "pns_splash_seen_session_v1";
const SPLASH_DURATION_MS = 1500;

const SELECTED_TOPICS_KEY = SELECTED_TOPICS_STORAGE_KEY;
const CUSTOM_KEYWORD_KEY = "pns_custom_keyword_v1";
const CUSTOM_KEYWORDS_LIST_KEY = "pns_custom_keywords_v1";

type AiAnalysisMode = "normal" | "deep";

type UpgradeModalKind =
  | "general"
  | "pro_duration"
  | "quota"
  | "topic"
  | "favorite"
  | "keyword"
  | "deep";

const FREE_DEFAULT_TOPICS = ["NBA", "MLB", "BTC"];
const PRO_DEFAULT_TOPICS = ["NBA", "MLB", "大谷翔平", "Curry", "BTC"];

function writeSelectedTopics(topics: string[]) {
  try {
    if (topics.length === 0) {
      localStorage.removeItem(SELECTED_TOPICS_KEY);
      return;
    }
    localStorage.setItem(SELECTED_TOPICS_KEY, JSON.stringify(topics));
  } catch {
    /* ignore */
  }
}

function logTopicBootstrapState(args: {
  loadedTopics: string[];
  loadedKeywords: string[];
  fallbackToOnboarding: boolean;
  activeTopicLabels: string[];
}) {
  if (!import.meta.env.DEV) return;
  console.log("[Topics] onboarding_completed", readOnboardingCompleted());
  console.log("[Topics] loaded selectedTopics", args.loadedTopics);
  console.log("[Topics] loaded customKeywords", args.loadedKeywords);
  console.log("[Topics] final activeTopics", args.activeTopicLabels);
  console.log("[Topics] fallback to onboarding", args.fallbackToOnboarding);
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

const AI_INSIGHT_CACHE_KEY = "pns_ai_daily_insight_v2";
const AI_INSIGHT_CACHE_KEY_LEGACY = "pns_ai_daily_insight_v1";

function buildDailyInsightFingerprint(items: NewsItem[]): string {
  const base = [...items]
    .slice(0, 20)
    .map((n) => `${normalizeKey(n.title)}|${n.source.trim()}|${normalizeKey(n.description || "")}`)
    .sort()
    .join("\0");
  return base;
}

function extractKeywordsFromTitles(titles: string[]): string[] {
  const text = titles.join(" ");
  const words = text
    .split(/[\s、，,。.!?！？：:「」\-\(\)\[\]]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && w.length <= 12);
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);
}

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


function aiSummaryCacheFingerprint(
  items: NewsItem[],
  duration: AiDuration,
  deepMode = false
): string {
  const base = [...items]
    .slice(0, 5)
    .map(
      (n) =>
        `${normalizeKey(n.title)}|${n.source.trim()}|${normalizeKey(n.description || "")}`
    )
    .sort()
    .join("\0");
  return `${duration}\0${deepMode ? "deep" : "normal"}\0${base}`;
}

type SummaryApiPayload = {
  ok?: boolean;
  kind?: string;
  script?: string;
  highlights?: AiHighlight[];
  jsonFallback?: boolean;
  duration?: number;
  error?: string;
  code?: string;
  insight?: AiDailyInsight;
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
      .map((entry) => ({
        ...entry,
        duration: normalizeAiDuration(entry.duration),
      }))
      .slice(0, AI_HISTORY_MAX);
  } catch {
    return [];
  }
}

function readSettingsAiHistoryExpanded(): boolean {
  try {
    return localStorage.getItem(AI_HISTORY_EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSettingsAiHistoryExpanded(expanded: boolean) {
  try {
    localStorage.setItem(AI_HISTORY_EXPANDED_KEY, expanded ? "1" : "0");
  } catch {
    /* ignore */
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
  const anchorPlayer = useAiAnchorPlayer();
  const anchorActions = useAiAnchorPlayerActions();
  const initialStoredTopics = readStoredSelectedTopics();
  const initialStoredKeywords = readSavedCustomKeywords();
  const initialTopicOnboardingOpen = shouldShowTopicOnboarding(initialStoredTopics);

  const [tab, setTab] = useState<Tab>("home");
  const [selectedTopics, setSelectedTopics] = useState<string[]>(() => initialStoredTopics);
  const [customKeyword, setCustomKeyword] = useState(readCustomKeyword);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [topicNewsSections, setTopicNewsSections] = useState<TopicNewsSection[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [favoriteLinks, setFavoriteLinks] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [newsFetchStatus, setNewsFetchStatus] = useState<NewsFetchStatus>("idle");
  const [videoBanner, setVideoBanner] = useState<string | null>(null);
  const [videoBadge, setVideoBadge] = useState<string | null>(null);
  const [videoContentFlags, setVideoContentFlags] = useState<string[]>([]);
  const [lastUpdated, setLastUpdated] = useState("");
  const [speed, setSpeed] = useState(readPlaybackSpeed);
  const [aiDurationSheetOpen, setAiDurationSheetOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState("");
  const [aiScript, setAiScript] = useState("");
  const [aiHighlights, setAiHighlights] = useState<AiHighlight[]>([]);
  const [aiJsonFallback, setAiJsonFallback] = useState(false);
  const [aiLastSavedAt, setAiLastSavedAt] = useState<number | null>(null);
  const [aiLastDuration, setAiLastDuration] = useState<AiDuration | null>(null);
  const [aiLastNewsTitles, setAiLastNewsTitles] = useState<string[]>([]);
  const [aiLastFp, setAiLastFp] = useState<string | null>(null);
  const [aiDuration, setAiDuration] = useState<AiDuration>(FREE_DURATION);
  const [selectedScriptDuration, setSelectedScriptDuration] = useState<
    AiDuration | null
  >(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [brokenVideoThumbIds, setBrokenVideoThumbIds] = useState<Record<string, true>>({});
  const [scriptFontSize, setScriptFontSize] = useState<ScriptFontSize>(readScriptFontSize);
  // v1 商業模式：免登入 + 廣告 + AI 次數限制（先固定 Free）
  const [proStatus, setProStatus] = useState<ProStatus>(() => getProStatus());
  const [hiddenDevPanelOpen, setHiddenDevPanelOpen] = useState(false);
  const titleTapRef = useRef({ count: 0, lastAt: 0 });
  const [upgradeModal, setUpgradeModal] = useState<UpgradeModalKind | null>(null);
  const [aiAnalysisMode, setAiAnalysisMode] = useState<AiAnalysisMode>("normal");
  const [savedCustomKeywords, setSavedCustomKeywords] = useState<string[]>(() =>
    readSavedCustomKeywords()
  );
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [topicOnboardingOpen, setTopicOnboardingOpen] = useState(
    () => initialTopicOnboardingOpen
  );
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [dailyInsight, setDailyInsight] = useState<AiDailyInsight | null>(null);
  const [dailyInsightLoading, setDailyInsightLoading] = useState(false);
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

  const [dailyRadioState, setDailyRadioState] = useState<DailyRadioState>(() =>
    readDailyRadioState()
  );
  const [serverSyncState, setServerSyncState] = useState<ServerSyncStatus>(() =>
    isSupabaseConfigured() ? "idle" : "unconfigured"
  );
  const [supabaseUserId, setSupabaseUserId] = useState<string | null>(null);
  const [scriptQueryDebug, setScriptQueryDebug] = useState<DailyScriptQueryDebug | null>(
    null
  );
  const [userDisplayName, setUserDisplayName] = useState(() => readUserDisplayName());
  const [activeScriptAudioUrl, setActiveScriptAudioUrl] = useState<string | null>(null);
  const [cachedScriptAudioVoice, setCachedScriptAudioVoice] = useState<string | null>(null);
  const [cachedScriptAudioStyle, setCachedScriptAudioStyle] = useState<string | null>(null);
  const [scriptAudioLoading, setScriptAudioLoading] = useState(false);
  const [scriptAudioError, setScriptAudioError] = useState<string | null>(null);
  const [displayScriptSource, setDisplayScriptSource] = useState<DisplayScriptSource>("server");
  const [audioBoundFingerprint, setAudioBoundFingerprint] = useState<string | null>(null);
  const [anchorId, setAnchorId] = useState(readAnchorId);
  const [anchorStyleId, setAnchorStyleId] = useState(readAnchorStyleId);
  const [anchorPlaybackRate, setAnchorPlaybackRate] = useState<AiAnchorPlaybackRate>(
    readAnchorPlaybackRate
  );
  const [anchorVolumeGain, setAnchorVolumeGain] = useState<AiAnchorVolumeGain>(readAnchorVolumeGain);
  const dailyGenRunningRef = useRef(false);
  const serverScriptReadyRef = useRef(false);
  const lastNewsFetchAtRef = useRef<number | null>(null);
  const newsFetchInFlightRef = useRef<Promise<void> | null>(null);
  const fetchNewsRef = useRef<(options?: NewsRefreshOptions) => Promise<void>>(
    async () => {}
  );
  const topicSelectionKeyRef = useRef<string | null>(null);
  const newsRef = useRef<NewsItem[]>([]);
  const selectedNewsRef = useRef<NewsItem[]>([]);
  const fetchAiSummaryRef = useRef<
    (
      durationOverride?: AiDuration,
      options?: { skipQuota?: boolean; isDailyAuto?: boolean }
    ) => Promise<void>
  >(async () => {});
  const startPlaybackRef = useRef<
    (scriptOverride?: string, options?: { withIntro?: boolean; autoplay?: boolean }) => void
  >(() => {});
  const stopPlaybackRef = useRef<() => void>(() => {});
  const autoplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushAutoplayScheduledRef = useRef(false);
  const pushAnchorAutoplayPendingRef = useRef(false);
  const handleOpenFromDailyNotificationRef = useRef<
    (source: "local_reminder" | "server_completed" | DailyRadioPushOpenInfo) => void
  >(() => {});
  const pendingAnchorAutoplayRef = useRef(false);
  const pendingHomeAnchorPlayRef = useRef(false);
  const autoAudioEnsuredRef = useRef<string | null>(null);
  const pageScrollRef = useRef<HTMLDivElement>(null);
  const [pushManualPlayVisible, setPushManualPlayVisible] = useState(false);

  const {
    playbackState,
    playbackProgress,
    remainingMs,
    playbackMode,
    currentChunkIndex,
    totalChunks,
    play,
    stop,
    togglePlayPause: togglePlayback,
    changeSpeed: changePlaybackSpeed,
    clearAutoplay: clearPlayerAutoplay,
  } = usePlaybackController({ speed, voiceName, voices });
  const chineseVoices = useMemo(() => filterChineseVoices(voices), [voices]);

  const playbackActive = isPlaybackActiveState(playbackState);

  const selectedNews = news.filter((n) => n.selected);
  const favoriteNews = news.filter((n) => n.favorite);
  const totalNewsCount = news.length;

  const globalNewsBanner = useMemo(() => {
    if (loading || totalNewsCount > 0) return null;
    switch (newsFetchStatus) {
      case "empty":
        return "目前沒有抓到符合主題的新聞，可重新整理或修改主題。";
      case "timeout":
        return "新聞讀取失敗，請稍後再試。";
      case "error":
        return "新聞讀取失敗，請點重新整理。";
      default:
        return null;
    }
  }, [loading, totalNewsCount, newsFetchStatus]);

  useEffect(() => {
    newsRef.current = news;
    selectedNewsRef.current = selectedNews;
  }, [news, selectedNews]);

  const isPro = isProActive(proStatus);
  const voiceFeatureEnabled = isPro || isInternalAccessActive();
  const selectedAnchor = useMemo(() => getAnchorById(anchorId), [anchorId]);
  const selectedAnchorStyle = useMemo(() => getStyleById(anchorStyleId), [anchorStyleId]);

  const currentScriptFingerprint = useMemo(() => {
    if (
      displayScriptSource === "server" &&
      isScriptUuid(dailyRadioState.lastEntryId ?? "")
    ) {
      return buildServerScriptFingerprint(dailyRadioState.lastEntryId!);
    }
    if (aiLastFp && typeof aiLastSavedAt === "number") {
      return buildManualScriptFingerprint(aiLastSavedAt, aiLastFp);
    }
    return null;
  }, [
    displayScriptSource,
    dailyRadioState.lastEntryId,
    aiLastFp,
    aiLastSavedAt,
  ]);

  const scriptAudioStaleReason = useMemo(
    () =>
      getScriptAudioStaleReason(
        activeScriptAudioUrl,
        cachedScriptAudioVoice,
        cachedScriptAudioStyle,
        selectedAnchor.voice,
        anchorStyleId
      ),
    [
      activeScriptAudioUrl,
      cachedScriptAudioVoice,
      cachedScriptAudioStyle,
      selectedAnchor.voice,
      anchorStyleId,
    ]
  );
  const anchorAudioReady = isScriptAudioBound(
    audioBoundFingerprint,
    currentScriptFingerprint,
    activeScriptAudioUrl,
    scriptAudioStaleReason
  );

  const clearScriptAudioBinding = useCallback(() => {
    setActiveScriptAudioUrl(null);
    setCachedScriptAudioVoice(null);
    setCachedScriptAudioStyle(null);
    setAudioBoundFingerprint(null);
    setScriptAudioError(null);
    autoAudioEnsuredRef.current = null;
    anchorActions.stop();
    anchorActions.setAudioUrl(null);
  }, [anchorActions]);

  const bindScriptAudio = useCallback(
    (
      audioUrl: string,
      fingerprint: string,
      meta?: { voice?: string; style?: string }
    ) => {
      setActiveScriptAudioUrl(audioUrl);
      setCachedScriptAudioVoice(meta?.voice ?? null);
      setCachedScriptAudioStyle(meta?.style ?? null);
      setAudioBoundFingerprint(fingerprint);
      setScriptAudioError(null);
    },
    []
  );
  const syncAnchorPrefsToCloud = useCallback(() => {
    if (!isSupabaseConfigured()) return;
    void syncUserNewsPreferences({
      topics: selectedTopics,
      customKeywords: savedCustomKeywords,
      displayName: readUserDisplayName(),
      dailyRadioEnabled: true,
      morningRadioEnabled: true,
      eveningRadioEnabled: isPro,
      morningRadioTime: dailyRadioState.scheduledTime || MORNING_RADIO_TIME,
      eveningRadioTime: dailyRadioState.eveningTime || EVENING_RADIO_TIME,
      morningDurationMinutes: 3,
      eveningDurationMinutes: 3,
      isPro,
      anchorId,
      anchorVoice: getAnchorById(anchorId).voice,
      anchorStyle: anchorStyleId,
      playbackRate: anchorPlaybackRate,
      voiceFeatureEnabled,
    });
  }, [
    anchorId,
    anchorPlaybackRate,
    anchorStyleId,
    dailyRadioState.eveningTime,
    dailyRadioState.scheduledTime,
    isPro,
    savedCustomKeywords,
    selectedTopics,
    voiceFeatureEnabled,
  ]);
  const handleAnchorIdChange = useCallback(
    (id: string) => {
      setAnchorId(id);
      writeAnchorId(id);
      queueMicrotask(() => syncAnchorPrefsToCloud());
    },
    [syncAnchorPrefsToCloud]
  );
  const handleAnchorStyleChange = useCallback(
    (id: string) => {
      setAnchorStyleId(id);
      writeAnchorStyleId(id);
      queueMicrotask(() => syncAnchorPrefsToCloud());
    },
    [syncAnchorPrefsToCloud]
  );
  const handleAnchorPlaybackRateChange = useCallback(
    (rate: AiAnchorPlaybackRate) => {
      setAnchorPlaybackRate(rate);
      writeAnchorPlaybackRate(rate);
      queueMicrotask(() => syncAnchorPrefsToCloud());
    },
    [syncAnchorPrefsToCloud]
  );
  const handleAnchorVolumeGainChange = useCallback((gain: AiAnchorVolumeGain) => {
    setAnchorVolumeGain(gain);
    writeAnchorVolumeGain(gain);
  }, []);
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

  const handleRestorePurchases = useCallback(async () => {
    const result = await restorePurchases();
    if (result.ok) {
      setProStatus(result.status);
    }
    alert(result.message);
  }, []);

  const openProUpgrade = useCallback(() => {
    setUpgradeModal("general");
  }, []);

  const handleHomeBrandTap = useCallback(() => {
    const now = Date.now();
    if (now - titleTapRef.current.lastAt > 2500) {
      titleTapRef.current.count = 0;
    }
    titleTapRef.current.lastAt = now;
    titleTapRef.current.count += 1;
    if (titleTapRef.current.count >= 7) {
      titleTapRef.current.count = 0;
      setHiddenDevPanelOpen(true);
    }
  }, []);

  const handleHiddenDevStatusChanged = useCallback(() => {
    setProStatus(getProStatus());
  }, []);

  const handleUpgradePro = useCallback(async (plan: ProPlanTier) => {
    const result = await purchaseProSubscription(plan);
    if (result.ok) {
      setProStatus(result.status);
      setUpgradeModal(null);
    }
    alert(result.message);
  }, []);

  const setAiQuotaExhaustedMessage = useCallback(() => {
    if (isProActive(proStatus)) {
      setAiError("今日 AI 次數已用完，明天會自動重置");
    } else {
      setUpgradeModal("quota");
    }
  }, [proStatus]);

  const buildDailyInsightFallback = useCallback((): AiDailyInsight => {
    const picked = news.slice(0, 20);
    const titles = picked.map((n) => n.title);
    const keywords = extractKeywordsFromTitles(titles);
    const attentionLevel: AiDailyInsight["attentionLevel"] =
      picked.length >= 12 ? "高" : picked.length >= 6 ? "中" : "低";
    const sentiment: AiDailyInsight["sentiment"] = "中立";
    const lead = picked[0]?.title?.trim();
    const hotReason = (
      lead
        ? `${lead.slice(0, 18)}等議題牽動今日版面，市場與輿論分歧加劇。`
        : "多則重要事件同日交織，今日資訊密度偏高。"
    ).slice(0, 60);
    const fallbackReasons = ["影響範圍最大", "今日爭議度高", "值得優先掌握"];
    return {
      attentionLevel,
      sentiment,
      hotReason,
      keywords: keywords.slice(0, 5),
      controversies: [],
      recommendedNews: picked.slice(0, 3).map((n, i) => ({
        title: n.title,
        reason: fallbackReasons[i] ?? "值得優先關注",
      })),
    };
  }, [news]);

  const handleRequestDailyInsight = useCallback(async () => {
    if (!canUseDailyInsight(proStatus)) return;
    if (dailyInsightLoading || dailyInsight) return;
    const picked = news.slice(0, 20);
    if (picked.length === 0) return;

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

    const fp = buildDailyInsightFingerprint(picked);
    try {
      const raw = localStorage.getItem(AI_INSIGHT_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as {
          date?: string;
          fp?: string;
          insight?: AiDailyInsight;
        };
        if (cached.date === today && cached.fp === fp && cached.insight) {
          const cachedInsight = normalizeDailyInsight(cached.insight);
          if (cachedInsight) {
            setDailyInsight(cachedInsight);
            return;
          }
        }
      }
    } catch {
      /* ignore */
    }

    setDailyInsightLoading(true);
    try {
      const res = await fetch(apiUrl("summary"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "dailyInsight",
          items: buildSummaryApiItems(picked, {
            keyword: customKeyword,
            topics: selectedTopics,
          }),
        }),
      });
      const { data, error: parseError } = await readSummaryApiPayload(res);
      if (parseError || !data) {
        setDailyInsight(buildDailyInsightFallback());
        return;
      }
      if (!data.ok) {
        setDailyInsight(buildDailyInsightFallback());
        return;
      }
      const normalizedInsight = normalizeDailyInsight(data.insight);
      if (!normalizedInsight) {
        setDailyInsight(buildDailyInsightFallback());
        return;
      }
      setDailyInsight(normalizedInsight);

      try {
        localStorage.setItem(
          AI_INSIGHT_CACHE_KEY,
          JSON.stringify({ date: today, fp, insight: normalizedInsight })
        );
        localStorage.removeItem(AI_INSIGHT_CACHE_KEY_LEGACY);
      } catch {
        /* ignore */
      }

      setAiQuota((prev) => {
        const base = prev.date === today ? prev : { date: today, used: 0 };
        const next = { date: today, used: base.used + 1 };
        writeAiDailyQuota(next);
        return next;
      });
    } catch {
      setDailyInsight(buildDailyInsightFallback());
    } finally {
      setDailyInsightLoading(false);
    }
  }, [
    buildDailyInsightFallback,
    customKeyword,
    dailyInsight,
    dailyInsightLoading,
    getAiDailyLimit,
    news,
    proStatus,
    selectedTopics,
    setAiQuota,
    setAiQuotaExhaustedMessage,
  ]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    void getSupabaseAuthUserId().then((id) => {
      if (id) {
        console.log("[Supabase] app launch auth user_id", id);
        setSupabaseUserId(id);
      }
    });
  }, []);

  useEffect(() => {
    sanitizeNonIapProUnlocks();
    refreshProStatus();
  }, [refreshProStatus]);

  useEffect(() => {
    logTopicBootstrapState({
      loadedTopics: initialStoredTopics,
      loadedKeywords: initialStoredKeywords,
      fallbackToOnboarding: initialTopicOnboardingOpen,
      activeTopicLabels: buildActiveNewsFeedSources(
        topics
          .filter((t) => initialStoredTopics.includes(t.label))
          .map((t) => ({ label: t.label, query: t.query, icon: t.icon })),
        initialStoredKeywords
      ).map((s) => s.label),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await syncPurchasesOnLaunch();
      if (cancelled || !result.status) return;
      setProStatus(result.status);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (topicOnboardingOpen) return;
    const clamped = clampTrackingToPlan(selectedTopics, savedCustomKeywords, proStatus);
    const topicsChanged = clamped.topics.join("\0") !== selectedTopics.join("\0");
    const keywordsChanged = clamped.keywords.join("\0") !== savedCustomKeywords.join("\0");
    if (!topicsChanged && !keywordsChanged) return;
    if (topicsChanged) {
      setSelectedTopics(clamped.topics);
      writeSelectedTopics(clamped.topics);
    }
    if (keywordsChanged) {
      setSavedCustomKeywords(clamped.keywords);
      writeSavedCustomKeywords(clamped.keywords);
    }
    // 僅在方案切換或初次載入時校正追蹤上限
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proStatus]);

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
      if (playbackPollTimerRef.current != null) {
        clearInterval(playbackPollTimerRef.current);
      }
      if (playbackFallbackTimerRef.current != null) {
        clearTimeout(playbackFallbackTimerRef.current);
      }
      window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    if (isSupabaseConfigured()) return;
    const latest = findTodayDailyHistoryEntry(readAiHistory());
    if (latest?.script?.trim()) {
      setAiScript(parseAiSummaryContent(latest.script, latest.highlights).script);
      setAiHighlights(latest.highlights ?? []);
      setAiJsonFallback(Boolean(latest.jsonFallback));
      setSelectedScriptDuration(latest.duration);
      setAiDuration(latest.duration);
      setActiveAiHistoryId(latest.id);
      setDailyRadioState(
        markDailyGenerationComplete(latest.id, latest.duration, "app")
      );
    }
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

      const chineseVoices = filterChineseVoices(allVoices);
      if (chineseVoices.length > 0) {
        const preferredVoice = pickDefaultChineseVoice(allVoices);
        setVoiceName((current) => {
          const currentVoice = allVoices.find((v) => v.name === current);
          if (currentVoice?.lang?.toLowerCase().startsWith("zh")) return current;
          return preferredVoice?.name ?? current;
        });
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    setTimeout(loadVoices, 1000);
  }, []);

  const fetchNews = async (options: NewsRefreshOptions = {}) => {
    if (newsFetchInFlightRef.current) {
      await newsFetchInFlightRef.current;
      if (!options.forceRefresh) return;
    }

    const startedAt = Date.now();
    const forceRefresh = options.forceRefresh === true;
    const lastNewsFetchAt = lastNewsFetchAtRef.current;
    if (
      !forceRefresh &&
      lastNewsFetchAt != null &&
      startedAt - lastNewsFetchAt < NEWS_REFRESH_DEDUPE_MS
    ) {
      const currentNews = newsRef.current;
      const publishedTimes = currentNews.map(newsPublishedTime).filter((v) => v > 0);
      const fetchedTimes = currentNews.map(newsFetchedTime).filter((v) => v > 0);
      console.log(
        JSON.stringify({
          event: "home_news_refresh",
          topics: selectedTopicObjects.map((t) => t.label),
          forceRefresh,
          lastNewsFetchAt: new Date(lastNewsFetchAt).toISOString(),
          fetchedAt: null,
          fetchedCount: currentNews.length,
          updatedCount: 0,
          newestPublishedAt: newsIsoFromTime(Math.max(0, ...publishedTimes)),
          newestFetchedAt: newsIsoFromTime(Math.max(0, ...fetchedTimes)),
          usedCache: true,
          reason: options.reason ?? "timer",
        })
      );
      return;
    }

    const custom = customKeyword.trim();
    const topicObjs = selectedTopicObjects;
    const feedSources = buildActiveNewsFeedSources(
      topicObjs.map((t) => ({ label: t.label, query: t.query, icon: t.icon })),
      savedCustomKeywords,
      { extraSearch: custom || undefined }
    );

    if (feedSources.length === 0) {
      setTopicOnboardingOpen(true);
      setLoading(false);
      setNewsFetchStatus("idle");
      return;
    }

    setLoading(true);
    setNewsFetchStatus("loading");
    console.log("[News] news fetch started", {
      topics: feedSources.map((s) => s.label),
      forceRefresh,
      lastNewsFetchAt: lastNewsFetchAt ? new Date(lastNewsFetchAt).toISOString() : null,
      reason: options.reason ?? null,
    });

    const runFetch = async () => {
      const nowMs = Date.now();
      const prevNews = newsRef.current;
      const prevKeys = new Set(prevNews.map((n) => `${n.link || normalizeNewsKey(n.title)}`));
      const responseTexts = await Promise.all(
        feedSources.map(async (source) => {
          const res = await fetch(
            apiUrl(
              `news?q=${encodeURIComponent(source.query)}&fresh=${forceRefresh ? "1" : "0"}&_=${nowMs}`
            ),
            { cache: "no-store" }
          );
          if (!res.ok) {
            throw new Error(`news fetch failed: ${res.status}`);
          }
          return res.text();
        })
      );

      const feeds = feedSources.map((source, index) => ({
        source,
        rows: parseNewsRssXml(
          responseTexts[index] ?? "",
          source.label,
          nowMs,
          favoriteLinks
        ),
      }));

      const merged = mergeTopicNewsFeeds(feeds, prevNews);
      const mergedNews = merged.news;
      setTopicNewsSections(merged.sections);
      newsRef.current = mergedNews;
      selectedNewsRef.current = mergedNews.filter((n) => n.selected);
      setNews(mergedNews);

      if (!serverScriptReadyRef.current) {
        const todayEntry = findTodayDailyHistoryEntry(readAiHistory());
        if (!todayEntry) {
          setAiScript("");
          stopPlaybackRef.current();
          setAiHighlights([]);
          setAiJsonFallback(false);
          setSelectedScriptDuration(null);
        }
      }
      setAiError(null);
      setLastUpdated(
        new Date().toLocaleTimeString("zh-TW", {
          hour: "2-digit",
          minute: "2-digit",
        })
      );

      if (mergedNews.length === 0) {
        setNewsFetchStatus("empty");
        console.log("[News] news fetch succeeded", { news_count: 0 });
      } else {
        setNewsFetchStatus("success");
        console.log("[News] news fetch succeeded", { news_count: mergedNews.length });
      }

      lastNewsFetchAtRef.current = nowMs;
      const publishedTimes = mergedNews.map(newsPublishedTime).filter((v) => v > 0);
      const fetchedTimes = mergedNews.map(newsFetchedTime).filter((v) => v > 0);
      const updatedCount = mergedNews.filter(
        (n) => !prevKeys.has(n.link || normalizeNewsKey(n.title))
      ).length;
      console.log(
        JSON.stringify({
          event: "home_news_refresh",
          topics: feedSources.map((s) => s.label),
          forceRefresh,
          lastNewsFetchAt: lastNewsFetchAt ? new Date(lastNewsFetchAt).toISOString() : null,
          fetchedAt: new Date(nowMs).toISOString(),
          fetchedCount: mergedNews.length,
          updatedCount,
          newestPublishedAt: newsIsoFromTime(Math.max(0, ...publishedTimes)),
          newestFetchedAt: newsIsoFromTime(Math.max(0, ...fetchedTimes)),
          usedCache: false,
          reason: options.reason ?? null,
        })
      );
    };

    try {
      const task = Promise.race([
        runFetch(),
        new Promise<never>((_, reject) => {
          window.setTimeout(
            () => reject(new Error("news_fetch_timeout")),
            NEWS_FETCH_TIMEOUT_MS
          );
        }),
      ]);
      newsFetchInFlightRef.current = task.then(() => undefined);
      await task;
    } catch (error) {
      const isTimeout =
        error instanceof Error && error.message === "news_fetch_timeout";
      setNews([]);
      setTopicNewsSections([]);
      setLastUpdated("");
      if (isTimeout) {
        setNewsFetchStatus("timeout");
        console.warn("[News] news fetch timeout");
      } else {
        setNewsFetchStatus("error");
        console.warn("[News] news fetch failed", error);
      }
    }

    newsFetchInFlightRef.current = null;
    setLoading(false);
  };

  fetchNewsRef.current = fetchNews;

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
          apiUrl(`videos?pack=1&topics=${topicsParam}&custom=${customParam}`)
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
    if (topicOnboardingOpen) return;
    if (
      selectedTopics.length === 0 &&
      savedCustomKeywords.length === 0 &&
      !customKeyword.trim()
    ) {
      setTopicOnboardingOpen(true);
      return;
    }
    void (async () => {
      await refreshServerDailyScript();
      await fetchNews({ forceRefresh: true, reason: "initial" });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (topicOnboardingOpen) return;

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
      void fetchNews({ forceRefresh: true, reason: "topic_change" });
    }, 450);

    return () => window.clearTimeout(timer);
  }, [selectedTopics, topicOnboardingOpen]);

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
    void fetchNews({ forceRefresh: true, reason: "manual" });
  };

  useEffect(() => {
    if (topicOnboardingOpen || tab !== "home") return;
    const timer = window.setInterval(() => {
      const last = lastNewsFetchAtRef.current;
      if (last != null && Date.now() - last < NEWS_REFRESH_STALE_MS) return;
      void fetchNews({ forceRefresh: true, reason: "timer" });
    }, NEWS_REFRESH_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [tab, topicOnboardingOpen]);

  useEffect(() => {
    if (topicOnboardingOpen) return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const last = lastNewsFetchAtRef.current;
      if (last != null && Date.now() - last < NEWS_REFRESH_STALE_MS) return;
      void fetchNews({ forceRefresh: true, reason: "foreground" });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [topicOnboardingOpen]);

  const handleTopicOnboardingComplete = (topics: string[]) => {
    const key = [...topics].sort().join("\0");
    topicSelectionKeyRef.current = key;
    setSelectedTopics(topics);
    writeSelectedTopics(topics);
    writeOnboardingCompleted(true);
    writeOnboardingSeen(true);
    setTopicOnboardingOpen(false);
    setTab("home");
    void fetchNews({ forceRefresh: true, reason: "topic_change" });
  };

  const resetTopicOnboarding = () => {
    writeOnboardingCompleted(false);
    writeOnboardingSeen(false);
    setSelectedTopics([]);
    writeSelectedTopics([]);
    topicSelectionKeyRef.current = null;
    setTopicOnboardingOpen(true);
    setTab("home");
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
      if (!canAddTopic(prev.length, proStatus, savedCustomKeywords.length)) {
        if (isProActive(proStatus)) {
          alert("已達 Pro 追蹤上限");
        } else {
          setUpgradeModal("topic");
        }
        return prev;
      }
      return [...prev, label];
    });
  };

  const selectAllTopics = () => {
    const limits = getPlanLimits(proStatus);
    const maxByTotal = limits.totalTrackingLimit - savedCustomKeywords.length;
    const cap = Math.min(limits.topicLimit, maxByTotal);
    setSelectedTopics(topics.map((t) => t.label).slice(0, Math.max(0, cap)));
  };

  const clearTopics = () => {
    setSelectedTopics([]);
  };

  const resetDefaultTopics = () => {
    const limits = getPlanLimits(proStatus);
    const defaults = isProActive(proStatus) ? PRO_DEFAULT_TOPICS : FREE_DEFAULT_TOPICS;
    const maxByTotal = limits.totalTrackingLimit - savedCustomKeywords.length;
    setSelectedTopics(defaults.slice(0, Math.min(limits.topicLimit, Math.max(0, maxByTotal))));
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
    if (!canAddCustomKeyword(savedCustomKeywords.length, proStatus, selectedTopics.length)) {
      if (isProActive(proStatus)) {
        alert("已達 Pro 自訂關鍵字或總追蹤上限");
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

  const buildPlayRequest = useCallback(
    (
      scriptOverride?: string,
      options?: { withIntro?: boolean; autoplay?: boolean }
    ) => {
      const scriptText = (scriptOverride ?? aiScript).trim();
      const hasAi = scriptText.length > 0;
      if (!hasAi && selectedNews.length === 0) return null;

      let textToSpeak = hasAi
        ? scriptText
        : selectedNews.map((n, i) => `第 ${i + 1} 則新聞，${n.title}`).join("。");

      if (hasAi && options?.withIntro !== false) {
        const intro = buildPlaybackIntro({
          newsCount: Math.max(selectedNews.length, aiLastNewsTitles.length, 1),
          duration: selectedScriptDuration ?? aiDuration ?? DAILY_AUTO_DURATION,
          topics: selectedTopics,
        });
        textToSpeak = prependPlaybackIntro(textToSpeak, intro);
      }

      return {
        text: textToSpeak,
        mode: (hasAi ? "ai" : "news") as PlaybackMode,
        autoplay: options?.autoplay,
      };
    },
    [
      aiScript,
      aiDuration,
      aiLastNewsTitles.length,
      selectedNews,
      selectedScriptDuration,
      selectedTopics,
    ]
  );

  const cancelScheduledAutoplay = useCallback(() => {
    if (autoplayTimerRef.current != null) {
      clearTimeout(autoplayTimerRef.current);
      autoplayTimerRef.current = null;
    }
    pushAutoplayScheduledRef.current = false;
    clearAutoplayDailyFlag();
  }, []);

  const schedulePushAutoplay = useCallback(() => {
    if (autoplayTimerRef.current != null) {
      clearTimeout(autoplayTimerRef.current);
      autoplayTimerRef.current = null;
    }
    console.log("[Player] autoplay scheduled 800ms");
    autoplayTimerRef.current = window.setTimeout(() => {
      autoplayTimerRef.current = null;
      const request = buildPlayRequest(undefined, { autoplay: true });
      if (!request) {
        clearPlayerAutoplay();
        return;
      }
      void play(request);
    }, 800);
  }, [buildPlayRequest, clearPlayerAutoplay, play]);

  const startPlayback = useCallback(
    (
      scriptOverride?: string,
      options?: { withIntro?: boolean; autoplay?: boolean }
    ) => {
      anchorActions.pause();
      const request = buildPlayRequest(scriptOverride, options);
      if (!request) {
        alert("請先選擇要播放的新聞，或等待今日專屬新聞稿準備完成");
        return;
      }
      setTab("player");
      void play(request);
    },
    [anchorActions, buildPlayRequest, play]
  );

  const playScriptDraft = useCallback(
    (script?: string) => {
      anchorActions.pause();
      const scriptText = (script ?? aiScript).trim();
      if (!scriptText) {
        alert("尚無 AI 主播稿可播放");
        return;
      }
      const request = buildPlayRequest(scriptText, { withIntro: false });
      if (!request) return;
      void play(request);
    },
    [anchorActions, aiScript, buildPlayRequest, play]
  );

  const stopPlayback = useCallback(() => {
    cancelScheduledAutoplay();
    void stop();
  }, [cancelScheduledAutoplay, stop]);

  const togglePlayPause = useCallback(() => {
    if (!playbackActive) {
      anchorActions.pause();
    }
    togglePlayback(buildPlayRequest());
  }, [playbackActive, anchorActions, buildPlayRequest, togglePlayback]);

  const changeSpeed = (newSpeed: number) => {
    const next = persistPlaybackSpeed(newSpeed);
    changePlaybackSpeed(next);
  };

  useEffect(() => {
    stopPlaybackRef.current = stopPlayback;
  }, [stopPlayback]);

  useEffect(() => {
    if (aiLoading) {
      stopPlayback();
    }
  }, [aiLoading, stopPlayback]);

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
    const parsed = parseAiSummaryContent(entry.script, entry.highlights);
    setDisplayScriptSource("manual");
    clearScriptAudioBinding();
    setAiScript(parsed.script);
    setAiHighlights(
      parsed.highlights.length > 0 ? parsed.highlights : entry.highlights ?? []
    );
    setAiJsonFallback(false);
    setSelectedScriptDuration(entry.duration);
    setAiDuration(entry.duration);
    setAiError(null);
    setActiveAiHistoryId(entry.id);
    setTab("player");
  }, [clearScriptAudioBinding]);

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
      const parsed = parseAiSummaryContent(entry.script, entry.highlights);
      setDisplayScriptSource("manual");
      clearScriptAudioBinding();
      setAiScript(parsed.script);
      setAiHighlights(
        parsed.highlights.length > 0 ? parsed.highlights : entry.highlights ?? []
      );
      setAiJsonFallback(false);
      setSelectedScriptDuration(entry.duration);
      setAiDuration(entry.duration);
      setAiError(null);
      setActiveAiHistoryId(entry.id);
      setTab("player");
      startPlayback(parsed.script);
    },
    [startPlayback, clearScriptAudioBinding]
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
    if (isProDuration(duration) && !canUseProDuration(proStatus)) {
      setAiDurationSheetOpen(false);
      setUpgradeModal("pro_duration");
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
      .map((item, index) => {
        const lines = [
          `新聞 ${index + 1}：`,
          `標題：${item.title}`,
          `來源：${item.source}`,
        ];
        if (item.description) lines.push(`摘要：${item.description}`);
        if (item.link) lines.push(`連結：${item.link}`);
        return lines.join("\n");
      })
      .join("\n\n");

    return `
請幫我把以下新聞整理成「AI個人新聞台」精華版：

要求：
1. 用繁體中文
2. 先列出今日最重要的 5 個重點
3. 依重要程度動態調整每則篇幅（🔥多講、ℹ️簡短）
4. 幫我判斷重要程度：🔥重大 / ⚠️注意 / ℹ️一般
5. 最後給我一段適合語音朗讀的 3 分鐘新聞稿
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

  const fetchAiSummary = async (
    durationOverride?: AiDuration,
    options?: { skipQuota?: boolean; isDailyAuto?: boolean; radioSlot?: RadioSlot }
  ) => {
    const duration = durationOverride ?? aiDuration;
    const pickLimit = duration >= 10 ? 8 : 5;

    const beforeFetchAt = lastNewsFetchAtRef.current;
    const newsTooOld =
      beforeFetchAt == null || Date.now() - beforeFetchAt > NEWS_REFRESH_STALE_MS;
    if (newsTooOld) {
      await fetchNews({
        forceRefresh: true,
        reason: options?.isDailyAuto ? "daily_auto_prepare" : "manual_generate_prepare",
      });
    }

    const picked = selectedNewsRef.current.slice(0, pickLimit);
    const freshness = selectedFreshnessStats(picked);
    const afterFetchAt = lastNewsFetchAtRef.current;
    const usedFreshNews =
      afterFetchAt != null && Date.now() - afterFetchAt <= NEWS_REFRESH_STALE_MS;
    console.log(
      JSON.stringify({
        event: "manual_script_generate_prepare",
        forceRefresh: newsTooOld,
        lastNewsFetchAt: beforeFetchAt ? new Date(beforeFetchAt).toISOString() : null,
        selectedNewsCount: picked.length,
        newestSelectedPublishedAt: freshness.newestSelectedPublishedAt,
        newestSelectedFetchedAt: freshness.newestSelectedFetchedAt,
        oldestSelectedPublishedAt: freshness.oldestSelectedPublishedAt,
        usedFreshNews,
      })
    );

    if (picked.length === 0) {
      if (!options?.isDailyAuto) alert("請先選擇新聞");
      return;
    }


    if (isProDuration(duration) && !canUseProDuration(proStatus)) {
      if (!options?.isDailyAuto) setUpgradeModal("pro_duration");
      return;
    }
    if (
      aiAnalysisMode === "deep" &&
      !canUseDeepMode(proStatus) &&
      !options?.isDailyAuto
    ) {
      setUpgradeModal("deep");
      return;
    }

    if (!options?.skipQuota) {
      const q = readAiDailyQuota();
      const today = todayYmdLocal();
      const normalized = q.date === today ? q : { date: today, used: 0 };
      if (q.date !== normalized.date || q.used !== normalized.used) {
        writeAiDailyQuota(normalized);
      }
      setAiQuota(normalized);
      const remaining = Math.max(0, getAiDailyLimit(proStatus) - normalized.used);
      if (remaining <= 0) {
        if (!options?.isDailyAuto) setAiQuotaExhaustedMessage();
        return;
      }
    }
    setAiError(null);
    const deepMode =
      !options?.isDailyAuto &&
      aiAnalysisMode === "deep" &&
      canUseDeepMode(proStatus);
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
          const cached = parseAiSummaryContent(o.script, o.highlights);
          if (!cached.script) {
            /* 快取損壞，改走 API */
          } else {
          setDisplayScriptSource("manual");
          clearScriptAudioBinding();
          setAiError(null);
          setAiScript(cached.script);
          setAiHighlights(cached.highlights);
          setAiJsonFallback(false);
          setSelectedScriptDuration(normalizeAiDuration(o.duration));
          setAiLastSavedAt(o.savedAt);
          setAiLastDuration(normalizeAiDuration(o.duration ?? duration));
          setAiLastNewsTitles(
            Array.isArray(o.newsTitles) && o.newsTitles.every((t) => typeof t === "string")
              ? (o.newsTitles as string[])
              : picked.map((n) => n.title)
          );
          setAiLastFp(fp);
          return;
          }
        }
      }
    } catch {
      /* ignore */
    }

    if (!options?.isDailyAuto) {
      setAiLoading(true);
      stopPlayback();
      setAiScript("");
      setAiHighlights([]);
      setAiJsonFallback(false);
      clearScriptAudioBinding();
    } else {
      setAiLoading(true);
      clearScriptAudioBinding();
    }
    try {
      const res = await fetch(apiUrl("summary"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          duration,
          deepMode,
          displayName: readUserDisplayName(),
          anchorName: selectedAnchor.name,
          items: buildSummaryApiItems(picked, {
            keyword: customKeyword,
            topics: selectedTopics,
          }),
        }),
      });
      const { data, error: parseError } = await readSummaryApiPayload(res);
      if (parseError || !data) {
        const msg = parseError || "AI 精華產生失敗";
        if (options?.isDailyAuto) setDailyRadioState(markDailyGenerationFailed(msg));
        setAiError(msg);
        if (!options?.isDailyAuto) await runGptFallbackClipboard();
        return;
      }

      if (!data.ok) {
        const msg =
          data.code === "NO_KEY"
            ? "尚未設定 AI API Key"
            : data.code === "TIMEOUT"
              ? "AI 產生逾時，請改選較短時長或一般整理模式後再試"
              : data.error || "AI 精華產生失敗";
        if (options?.isDailyAuto) setDailyRadioState(markDailyGenerationFailed(msg));
        setAiError(msg);
        if (!options?.isDailyAuto && data.code !== "NO_KEY") {
          await runGptFallbackClipboard();
        }
        return;
      }

      const parsed = parseAiSummaryContent(data.script, data.highlights);
      if (!parsed.script) {
        const msg = "AI 未回傳有效內容";
        if (options?.isDailyAuto) setDailyRadioState(markDailyGenerationFailed(msg));
        setAiError(msg);
        if (!options?.isDailyAuto) await runGptFallbackClipboard();
        return;
      }

      const closingSlot =
        options?.radioSlot ?? (options?.isDailyAuto ? "morning" : undefined);
      const finalScript = closingSlot
        ? appendRadioClosing(parsed.script, closingSlot)
        : parsed.script;

      setAiScript(finalScript);
      setAiHighlights(parsed.highlights);
      setAiJsonFallback(false);
      warnScriptQuality(finalScript, picked);
      setSelectedScriptDuration(normalizeAiDuration(data.duration ?? duration));

      const savedAt = Date.now();
      try {
        localStorage.setItem(
          AI_SUMMARY_CACHE_KEY,
          JSON.stringify({
            fp,
            savedAt,
            duration,
            highlights: parsed.highlights,
            script: finalScript,
            jsonFallback: false,
            newsTitles: picked.map((n) => n.title),
          })
        );
      } catch {
        /* ignore */
      }

      const historyEntry: AiHistoryEntry = {
        id: `${savedAt}-${fp.slice(0, 48)}`,
        savedAt,
        duration: normalizeAiDuration(data.duration ?? duration),
        script: finalScript,
        highlights: parsed.highlights,
        jsonFallback: false,
        newsTitles: picked.map((n) => n.title),
        isDailyAuto: options?.isDailyAuto === true,
      };
      appendAiHistoryEntry(historyEntry);
      setAiLastSavedAt(savedAt);
      setAiLastDuration(historyEntry.duration);
      setAiLastNewsTitles(historyEntry.newsTitles);
      setAiLastFp(fp);

      if (options?.isDailyAuto) {
        const serverId = await saveAppGeneratedDailyScript({
          scriptText: finalScript,
          title: "今日 AI 早報",
          radioSlot: closingSlot ?? "morning",
          sourceNews: picked.map((n) => ({
            title: n.title,
            source: n.source,
            topic: n.topic,
            url: n.link,
            publishedAt: n.pubDate,
            fetchedAt: n.fetchedAt,
          })),
        });
        setActiveScriptAudioUrl(null);
        setCachedScriptAudioVoice(null);
        setCachedScriptAudioStyle(null);
        setAudioBoundFingerprint(null);
        setScriptAudioError(null);
        setDailyRadioState(
          markDailyGenerationComplete(
            serverId ?? historyEntry.id,
            historyEntry.duration,
            "app"
          )
        );
        if (serverId) {
          setDisplayScriptSource("server");
        }
      } else {
        setDisplayScriptSource("manual");
        clearScriptAudioBinding();
        setAiQuota((prev) => {
          const today = todayYmdLocal();
          const base = prev.date === today ? prev : { date: today, used: 0 };
          const next = { date: today, used: base.used + 1 };
          writeAiDailyQuota(next);
          return next;
        });
      }
    } catch (e) {
      if (options?.isDailyAuto) {
        setDailyRadioState(
          markDailyGenerationFailed(
            e instanceof Error ? e.message : "今日早報生成失敗"
          )
        );
      }
      setAiError(e instanceof Error ? e.message : "網路或伺服器錯誤");
      if (!options?.isDailyAuto) await runGptFallbackClipboard();
    } finally {
      setAiLoading(false);
      if (options?.isDailyAuto) {
        dailyGenRunningRef.current = false;
      }
    }
  };

  const refreshServerDailyScript = useCallback(async (options: FetchScriptOptions = {}): Promise<ServerDailyScript | null> => {
    if (!isSupabaseConfigured()) {
      setServerSyncState("unconfigured");
      serverScriptReadyRef.current = false;
      setScriptQueryDebug(null);
      return null;
    }

    setServerSyncState("loading");
    const result = await fetchServerDailyScript(options);

    if (result.debug) {
      setScriptQueryDebug(result.debug);
      if (result.debug.userId) setSupabaseUserId(result.debug.userId);
    }

    if (result.kind === "unconfigured") {
      setServerSyncState("unconfigured");
      serverScriptReadyRef.current = false;
      return null;
    }

    if (result.kind === "no_user") {
      setServerSyncState("no_user");
      serverScriptReadyRef.current = false;
      return null;
    }

    if (result.kind === "ready") {
      const s = result.script;
      setDisplayScriptSource("server");
      setAiScript(s.scriptText);
      setAiHighlights([]);
      setAiJsonFallback(false);
      setSelectedScriptDuration(DAILY_AUTO_DURATION);
      setAiDuration(DAILY_AUTO_DURATION);
      setAiError(null);
      const serverFingerprint = buildServerScriptFingerprint(s.id);
      if (
        s.audioUrl &&
        isTodayScriptAudioReady(
          s.scriptDate,
          todayDailyScriptYmd(),
          s.audioUrl,
          s.audioExpiresAt,
          s.audioVoice ?? null,
          s.audioStyle ?? null,
          selectedAnchor.voice,
          anchorStyleId
        )
      ) {
        bindScriptAudio(s.audioUrl, serverFingerprint, {
          voice: s.audioVoice ?? undefined,
          style: s.audioStyle ?? undefined,
        });
      } else {
        clearScriptAudioBinding();
      }
      setDailyRadioState(
        markDailyGenerationComplete(
          s.id,
          DAILY_AUTO_DURATION,
          s.generationSource ?? "server",
          s.radioSlot
        )
      );
      setServerSyncState("ready");
      serverScriptReadyRef.current = true;
      return s;
    }

    serverScriptReadyRef.current = false;

    const today = todayDailyScriptYmd();
    const state = readDailyRadioState();
    if (state.lastGeneratedDate === today && state.status === "ready") {
      console.warn("[DailyRadio] clearing stale local ready state (server has no script for this user)");
      setDailyRadioState(
        writeDailyRadioState({
          status: "idle",
          generationSource: null,
          lastGeneratedDate: null,
          lastEntryId: null,
        })
      );
      setAiScript("");
      setAiHighlights([]);
      setSelectedScriptDuration(null);
    }

    if (result.kind === "not_found") {
      clearAutoplayDailyFlag();
      clearAutoplayAnchorAudioFlag();
      setServerSyncState("not_found");
    } else {
      setServerSyncState("idle");
    }
    return null;
  }, [bindScriptAudio, clearScriptAudioBinding, selectedAnchor.voice, anchorStyleId]);

  const currentAiFavoriteId = useMemo(() => {
    if (!aiLastFp) return null;
    const createdAt = typeof aiLastSavedAt === "number" ? aiLastSavedAt : null;
    if (!createdAt) return null;
    return `${createdAt}-${aiLastFp.slice(0, 48)}`;
  }, [aiLastFp, aiLastSavedAt]);

  useEffect(() => {
    anchorActions.registerStopTts(() => {
      stopPlaybackRef.current();
    });
    return () => anchorActions.registerStopTts(null);
  }, [anchorActions]);

  useEffect(() => {
    anchorActions.setPlaybackRate(anchorPlaybackRate);
  }, [anchorActions, anchorPlaybackRate]);

  useEffect(() => {
    if (!voiceFeatureEnabled) return;
    if (anchorAudioReady && activeScriptAudioUrl) {
      anchorActions.setAudioUrl(activeScriptAudioUrl);
    } else {
      anchorActions.setAudioUrl(null);
    }
  }, [voiceFeatureEnabled, anchorAudioReady, activeScriptAudioUrl, anchorActions]);

  const currentAiIsFavorited = useMemo(() => {
    if (!currentAiFavoriteId) return false;
    return aiFavorites.some((f) => f.id === currentAiFavoriteId);
  }, [aiFavorites, currentAiFavoriteId]);

  const handleGenerateScriptAudio = useCallback(async (override?: {
    scriptId?: string;
    scriptText?: string;
  }): Promise<boolean> => {
    const script = (override?.scriptText ?? aiScript).trim();
    if (!script) {
      alert("尚無 AI 主播稿可轉語音");
      return false;
    }
    if (!voiceFeatureEnabled) {
      openProUpgrade();
      return false;
    }

    const voice = selectedAnchor.voice;
    const style = anchorStyleId;
    console.log("[RealVoice] handleGenerateScriptAudio start", {
      scriptTextLength: script.length,
      voice,
      style,
      anchorId,
      isFavorited: currentAiIsFavorited,
      isPro: voiceFeatureEnabled,
      lastEntryId: dailyRadioState.lastEntryId,
    });

    setScriptAudioError(null);
    setScriptAudioLoading(true);

    try {
      let scriptId = override?.scriptId ?? null;

      if (!scriptId) {
        if (
          displayScriptSource === "server" &&
          isScriptUuid(dailyRadioState.lastEntryId ?? "")
        ) {
          scriptId = dailyRadioState.lastEntryId;
        } else {
          console.log("[RealVoice] saving manual script before audio generation");
          const savedId = await saveAppGeneratedDailyScript({
            scriptText: script,
            title: "手動生成 AI 主播稿",
            sourceNews: selectedNews.map((n) => ({
              title: n.title,
              source: n.source,
              topic: n.topic,
            })),
          });
          if (savedId) {
            scriptId = savedId;
          }
        }
      }

      if (!scriptId) {
        const msg = "稿件尚未同步至雲端，請稍後再試";
        console.warn("[RealVoice] missing scriptId after save attempt");
        setScriptAudioError(msg);
        return false;
      }

      console.log("[RealVoice] calling /api/generate-audio", {
        scriptId,
        voice,
        style,
        isFavorited: currentAiIsFavorited,
        scriptTextLength: script.length,
      });

      const ping = await pingVercelApi();
      if (!ping.ok) {
        const msg = ping.error
          ? `無法連線 Vercel API（ping 失敗）：${ping.error}`
          : `無法連線 Vercel API（ping HTTP ${ping.status ?? "?"}）`;
        console.warn("[RealVoice] ping failed before generate-audio", ping);
        setScriptAudioError(msg);
        return false;
      }

      const result = await generateScriptAudio({
        scriptId,
        scriptText: script,
        voice,
        style,
        isPro: voiceFeatureEnabled,
        isFavorited: currentAiIsFavorited,
      });

      console.log("[RealVoice] API finished", {
        ok: result.ok,
        status: result.status,
        audioUrl: result.ok ? result.audioUrl : null,
        error: result.ok ? null : result.error,
        code: result.ok ? null : result.code,
        responseBody: result.ok ? null : result.responseBody,
      });

      if (result.ok) {
        const fingerprint =
          displayScriptSource === "server" && isScriptUuid(scriptId)
            ? buildServerScriptFingerprint(scriptId)
            : typeof aiLastSavedAt === "number" && aiLastFp
              ? buildManualScriptFingerprint(aiLastSavedAt, aiLastFp)
              : `adhoc:${scriptId}`;
        bindScriptAudio(result.audioUrl, fingerprint, {
          voice: result.voice ?? voice,
          style: result.style ?? style,
        });
        if (pendingAnchorAutoplayRef.current || pendingHomeAnchorPlayRef.current) {
          pendingAnchorAutoplayRef.current = false;
          pendingHomeAnchorPlayRef.current = false;
          logPushOpenReceived({
            phase: "anchor_play_call_after_generate",
            anchorPlayer_play_called: true,
            audio_url_exists: true,
            audio_url_prefix: audioUrlPrefix(result.audioUrl),
          });
          void anchorActions.play(result.audioUrl).then(
            () => {
              logPushOpenReceived({
                phase: "anchor_play_result_after_generate",
                anchorPlayer_play_called: true,
                play_promise_resolved: true,
                play_promise_rejected: false,
                fallback_button_shown: false,
              });
              setPushManualPlayVisible(false);
            },
            (err) => {
              logPushOpenReceived({
                phase: "anchor_play_result_after_generate",
                anchorPlayer_play_called: true,
                play_promise_resolved: false,
                play_promise_rejected: true,
                fallback_button_shown: true,
                ...playErrorFields(err),
              });
              setPushManualPlayVisible(true);
            }
          );
        }
        return true;
      }

      if (result.code === "PRO_REQUIRED") {
        openProUpgrade();
      }
      setScriptAudioError(result.error);
      return false;
    } finally {
      setScriptAudioLoading(false);
    }
  }, [
    aiScript,
    aiDuration,
    aiLastFp,
    aiLastSavedAt,
    anchorId,
    anchorStyleId,
    bindScriptAudio,
    displayScriptSource,
    dailyRadioState.lastEntryId,
    openProUpgrade,
    selectedNews,
    selectedScriptDuration,
    voiceFeatureEnabled,
    currentAiIsFavorited,
    selectedAnchor.voice,
    anchorActions,
    setPushManualPlayVisible,
  ]);

  const ensureDailyAnchorAudio = useCallback(
    async (serverScript?: ServerDailyScript | null) => {
      if (!voiceFeatureEnabled) return;
      if (displayScriptSource !== "server") return;
      if (serverScript) {
        if (
          isTodayScriptAudioReady(
            serverScript.scriptDate,
            todayDailyScriptYmd(),
            serverScript.audioUrl,
            serverScript.audioExpiresAt,
            serverScript.audioVoice,
            serverScript.audioStyle,
            selectedAnchor.voice,
            anchorStyleId
          )
        ) {
          return;
        }
      } else if (anchorAudioReady) {
        return;
      }
      await handleGenerateScriptAudio();
    },
    [
      voiceFeatureEnabled,
      displayScriptSource,
      selectedAnchor.voice,
      anchorStyleId,
      anchorAudioReady,
      handleGenerateScriptAudio,
    ]
  );

  const maybeRunDailyRadioGeneration = useCallback(
    async (trigger: "cron" | "manual" | "push_open") => {
      if (dailyGenRunningRef.current) return;
      if (topicOnboardingOpen) return;

      console.log("[DailyRadio] manual generate started", { trigger });

      const serverScript = await refreshServerDailyScript();
      if (serverScript) {
        logDailyRadioScheduler(trigger, "server script already ready");
        console.log("[DailyRadio] manual generate succeeded", { source: "server" });
        await ensureDailyAnchorAudio(serverScript);
        return;
      }

      const lastNewsFetchAt = lastNewsFetchAtRef.current;
      if (
        newsRef.current.length === 0 ||
        lastNewsFetchAt == null ||
        Date.now() - lastNewsFetchAt > NEWS_REFRESH_STALE_MS
      ) {
        console.log("[DailyRadio] manual generate: refetching news", {
          lastNewsFetchAt: lastNewsFetchAt ? new Date(lastNewsFetchAt).toISOString() : null,
        });
        await fetchNewsRef.current({
          forceRefresh: true,
          reason: "daily_auto_prepare",
        });
      }

      if (newsRef.current.length === 0) {
        const msg =
          newsFetchStatus === "empty"
            ? "目前沒有抓到符合主題的新聞，請重新整理或修改主題。"
            : "無法取得新聞，請先按「更新新聞」或確認網路連線。";
        alert(msg);
        console.warn("[DailyRadio] manual generate failed", { reason: "no_news" });
        return;
      }

      if (selectedNewsRef.current.length === 0 && newsRef.current.length > 0) {
        const allSelected = newsRef.current.map((n) => ({ ...n, selected: true }));
        newsRef.current = allSelected;
        selectedNewsRef.current = allSelected;
        setNews(allSelected);
      }

      const existing = !isSupabaseConfigured()
        ? findTodayDailyHistoryEntry(readAiHistory())
        : null;
      if (existing?.script?.trim()) {
        setAiScript(parseAiSummaryContent(existing.script, existing.highlights).script);
        setAiHighlights(existing.highlights ?? []);
        setDailyRadioState(
          markDailyGenerationComplete(existing.id, existing.duration, "app")
        );
        console.log("[DailyRadio] manual generate succeeded", { source: "local_history" });
        await ensureDailyAnchorAudio();
        return;
      }

      dailyGenRunningRef.current = true;
      logDailyRadioScheduler(trigger, "app fallback daily briefing generation");
      setDailyRadioState(markDailyGenerationStarted());
      try {
        await fetchAiSummary(DAILY_AUTO_DURATION, {
          skipQuota: true,
          isDailyAuto: true,
        });
        if (readDailyRadioState().status === "ready") {
          console.log("[DailyRadio] manual generate succeeded", { source: "app" });
          await ensureDailyAnchorAudio();
        } else {
          console.warn("[DailyRadio] manual generate failed", {
            reason: readDailyRadioState().lastError ?? "unknown",
          });
        }
      } catch (e) {
        console.warn("[DailyRadio] manual generate failed", {
          reason: e instanceof Error ? e.message : "unknown",
        });
      }
    },
    [
      topicOnboardingOpen,
      refreshServerDailyScript,
      newsFetchStatus,
      ensureDailyAnchorAudio,
    ]
  );

  const handleHomePlayNow = useCallback(() => {
    if (voiceFeatureEnabled) {
      stopPlayback();
      if (anchorActions.getIsPlaying()) {
        anchorActions.pause();
        return;
      }
      if (anchorAudioReady && activeScriptAudioUrl) {
        void anchorActions.play(activeScriptAudioUrl);
        return;
      }
      pendingHomeAnchorPlayRef.current = true;
      if (!scriptAudioLoading) {
        void handleGenerateScriptAudio();
      }
      return;
    }
    startPlayback();
    setTab("player");
  }, [
    voiceFeatureEnabled,
    anchorAudioReady,
    activeScriptAudioUrl,
    scriptAudioLoading,
    handleGenerateScriptAudio,
    stopPlayback,
    startPlayback,
    anchorActions,
  ]);

  const handlePushOpenAnchorPlay = useCallback(
    async (script: ServerDailyScript, audioReadyFromPush?: boolean) => {
      const playbackVoice = voiceFeatureEnabled
        ? selectedAnchor.voice
        : DEFAULT_AI_ANCHOR_SETTINGS.voice;
      const playbackStyle = voiceFeatureEnabled
        ? anchorStyleId
        : DEFAULT_AI_ANCHOR_SETTINGS.style;

      const audioUrlReady = isTodayScriptAudioReady(
        script.scriptDate,
        todayDailyScriptYmd(),
        script.audioUrl,
        script.audioExpiresAt,
        script.audioVoice,
        script.audioStyle,
        playbackVoice,
        playbackStyle
      );

      const hasPlayableUrl = Boolean(script.audioUrl?.trim());
      const shouldTryMp3 =
        hasPlayableUrl && (audioUrlReady || audioReadyFromPush === true);

      logPushOpenReceived({
        phase: "anchor_play_prepare",
        scriptId: script.id,
        script_date: script.scriptDate,
        audioReady: audioReadyFromPush ?? false,
        audio_url_exists: hasPlayableUrl,
        audio_url_prefix: audioUrlPrefix(script.audioUrl),
        shouldTryMp3,
        anchorPlayer_play_called: false,
        play_promise_resolved: false,
        play_promise_rejected: false,
        fallback_button_shown: false,
      });

      pushAutoplayScheduledRef.current = true;
      pushAnchorAutoplayPendingRef.current = false;
      setPushManualPlayVisible(false);

      if (shouldTryMp3 && script.audioUrl) {
        stopPlayback();
        setDisplayScriptSource("server");
        bindScriptAudio(script.audioUrl, buildServerScriptFingerprint(script.id), {
          voice: script.audioVoice ?? playbackVoice,
          style: script.audioStyle ?? playbackStyle,
        });
        anchorActions.setAudioUrl(script.audioUrl);

        logPushOpenReceived({
          phase: "anchor_play_call",
          scriptId: script.id,
          audio_url_exists: true,
          audio_url_prefix: audioUrlPrefix(script.audioUrl),
          anchorPlayer_play_called: true,
        });

        try {
          await anchorActions.play(script.audioUrl);
          logPushOpenReceived({
            phase: "anchor_play_result",
            scriptId: script.id,
            audio_url_exists: true,
            audio_url_prefix: audioUrlPrefix(script.audioUrl),
            anchorPlayer_play_called: true,
            play_promise_resolved: true,
            play_promise_rejected: false,
            fallback_button_shown: false,
          });
          setPushManualPlayVisible(false);
          return;
        } catch (err) {
          const errFields = playErrorFields(err);
          logPushOpenReceived({
            phase: "anchor_play_result",
            scriptId: script.id,
            audio_url_exists: true,
            audio_url_prefix: audioUrlPrefix(script.audioUrl),
            anchorPlayer_play_called: true,
            play_promise_resolved: false,
            play_promise_rejected: true,
            fallback_button_shown: true,
            ...errFields,
          });
          setPushManualPlayVisible(true);
          return;
        }
      }

      if (voiceFeatureEnabled) {
        pendingAnchorAutoplayRef.current = true;
        stopPlayback();

        const generated = await handleGenerateScriptAudio({
          scriptId: script.id,
          scriptText: script.scriptText,
        });

        if (generated) {
          logPushOpenReceived({
            phase: "anchor_play_mp3_generated",
            scriptId: script.id,
            audio_url_exists: true,
            anchorPlayer_play_called: true,
            play_promise_resolved: true,
            fallback_button_shown: false,
          });
          return;
        }

        pendingAnchorAutoplayRef.current = false;
        logPushOpenReceived({
          phase: "anchor_play_mp3_failed",
          scriptId: script.id,
          audio_url_exists: hasPlayableUrl,
          audio_url_prefix: audioUrlPrefix(script.audioUrl),
          anchorPlayer_play_called: false,
          fallback_button_shown: true,
        });
        setPushManualPlayVisible(true);
        return;
      }

      logPushOpenReceived({
        phase: "anchor_play_no_mp3",
        scriptId: script.id,
        audio_url_exists: hasPlayableUrl,
        anchorPlayer_play_called: false,
        fallback_button_shown: true,
      });
      setPushManualPlayVisible(true);
    },
    [
      selectedAnchor.voice,
      anchorStyleId,
      voiceFeatureEnabled,
      bindScriptAudio,
      stopPlayback,
      anchorActions,
      handleGenerateScriptAudio,
    ]
  );

  const handleStartDailyBriefing = useCallback(() => {
    void maybeRunDailyRadioGeneration("manual");
  }, [maybeRunDailyRadioGeneration]);

  const handleOpenFromDailyNotification = useCallback(
    (source: "local_reminder" | "server_completed" | DailyRadioPushOpenInfo) => {
      void (async () => {
        if (typeof source === "object") {
          const preferAnchorAudio =
            source.openTarget === "ai_anchor_audio" ||
            source.autoPlay === true ||
            source.audioReady === true;

          logPushOpenReceived({
            phase: "handler_start",
            normalized_openInfo: source,
            openTarget: source.openTarget ?? null,
            radio_slot: source.radioSlot ?? null,
            scriptId: source.scriptId ?? null,
            autoPlay: source.autoPlay ?? false,
            audioReady: source.audioReady ?? false,
            navigate_to_play_page: false,
          });

          cancelScheduledAutoplay();
          stopPlayback();
          setPushManualPlayVisible(false);

          if (preferAnchorAudio) {
            pushAnchorAutoplayPendingRef.current = true;
            setAutoplayAnchorAudioFlag();
            clearAutoplayDailyFlag();
          } else {
            pushAnchorAutoplayPendingRef.current = false;
            clearAutoplayDailyFlag();
            clearAutoplayAnchorAudioFlag();
          }

          const ready = await refreshServerDailyScript({
            scriptId: source.scriptId,
            radioSlot: source.radioSlot,
          });

          if (!ready) {
            pushAnchorAutoplayPendingRef.current = false;
            clearAutoplayAnchorAudioFlag();
            logPushOpenReceived({
              phase: "handler_script_load_failed",
              normalized_openInfo: source,
              scriptId: source.scriptId ?? null,
              navigate_to_play_page: false,
            });
            return;
          }

          setTab("player");
          logPushOpenReceived({
            phase: "handler_navigate_player",
            normalized_openInfo: source,
            openTarget: source.openTarget ?? null,
            scriptId: ready.id,
            autoPlay: source.autoPlay ?? false,
            audioReady: source.audioReady ?? false,
            navigate_to_play_page: true,
          });

          if (preferAnchorAudio) {
            await handlePushOpenAnchorPlay(ready, source.audioReady);
          }
          return;
        }
        if (source === "server_completed") {
          cancelScheduledAutoplay();
          stopPlayback();
          setPushManualPlayVisible(false);
          const ready = await refreshServerDailyScript();
          if (!ready) {
            logPushOpenReceived({
              phase: "handler_legacy_script_load_failed",
              type: "daily_radio_completed",
              navigate_to_play_page: false,
            });
            return;
          }
          setTab("player");
          logPushOpenReceived({
            phase: "handler_navigate_player",
            type: "daily_radio_completed",
            navigate_to_play_page: true,
            audioReady: true,
          });
          await handlePushOpenAnchorPlay(ready, true);
          return;
        }
        logPushOpenReceived({
          phase: "handler_local_reminder",
          navigate_to_play_page: false,
        });
        void refreshServerDailyScript();
      })();
    },
    [
      cancelScheduledAutoplay,
      stopPlayback,
      refreshServerDailyScript,
      handlePushOpenAnchorPlay,
    ]
  );

  handleOpenFromDailyNotificationRef.current = handleOpenFromDailyNotification;

  const handleTriggerServerDailyRadio = useCallback(async () => {
    const radioSlot: RadioSlot =
      hourInTimezone(DAILY_SCRIPT_TIMEZONE) >= 17 ? "evening" : "morning";
    const result = await triggerServerDailyRadioGeneration({ radioSlot });
    if (!result.ok) {
      alert(`Server 生成失敗：${result.error}`);
      return;
    }
    await refreshServerDailyScript({ radioSlot });
    alert("已觸發 server 生成，請查看播放頁");
  }, [refreshServerDailyScript]);

  const handleSimulateAiAnchorPushClick = useCallback(async () => {
    let scriptId = scriptQueryDebug?.scriptId ?? null;
    let radioSlot = scriptQueryDebug?.radioSlot ?? null;

    const hasServerScript =
      serverSyncState === "ready" &&
      scriptQueryDebug?.generationSource === "server" &&
      Boolean(scriptId);

    if (!hasServerScript) {
      const script = await refreshServerDailyScript();
      if (!script || script.generationSource !== "server") {
        alert("今日尚無 server script，請先觸發 server 生成");
        return;
      }
      scriptId = script.id;
      radioSlot = script.radioSlot;
    }

    const openInfo = dailyRadioPushPayloadToOpenInfo({
      type: "daily_radio",
      openTarget: "ai_anchor_audio",
      autoPlay: true,
      audioReady: true,
      scriptId,
      script_id: scriptId,
      radio_slot: radioSlot ?? undefined,
    });

    if (!openInfo) {
      alert("推播 payload 無效");
      return;
    }

    handleOpenFromDailyNotification(openInfo);
  }, [
    scriptQueryDebug,
    serverSyncState,
    refreshServerDailyScript,
    handleOpenFromDailyNotification,
  ]);

  useEffect(() => {
    fetchAiSummaryRef.current = fetchAiSummary;
    startPlaybackRef.current = startPlayback;
  });

  useEffect(() => {
    void (async () => {
      if (!isSupabaseConfigured()) return;
      await initSupabaseAuth();
      await initRemotePush((info) => {
        handleOpenFromDailyNotificationRef.current(info);
      });
    })();
  }, []);

  useEffect(() => {
    void initDailyNotificationsOnce((source) => {
      handleOpenFromDailyNotificationRef.current(source);
    });
  }, []);

  useEffect(() => {
    void maybeRescheduleDailyRadioReminder(
      dailyRadioState.scheduledTime || MORNING_RADIO_TIME
    );
  }, [dailyRadioState.scheduledTime]);

  useEffect(() => {
    if (topicOnboardingOpen) return;
    if (!isSupabaseConfigured()) return;
    void (async () => {
      const userId = await ensureSupabaseUser();
      if (!userId) return;
      await refreshServerDailyScript();
    })();
  }, [topicOnboardingOpen, refreshServerDailyScript]);

  useEffect(() => {
    if (topicOnboardingOpen) return;
    if (!isSupabaseConfigured()) return;
    void (async () => {
      const userId = await ensureSupabaseUser();
      if (!userId) return;
      await syncUserNewsPreferences({
        topics: selectedTopics,
        customKeywords: savedCustomKeywords,
        displayName: readUserDisplayName(),
        dailyRadioEnabled: true,
        morningRadioEnabled: true,
        eveningRadioEnabled: isPro,
        morningRadioTime: dailyRadioState.scheduledTime || MORNING_RADIO_TIME,
        eveningRadioTime: dailyRadioState.eveningTime || EVENING_RADIO_TIME,
        morningDurationMinutes: 3,
        eveningDurationMinutes: 3,
        isPro,
        anchorId,
        anchorVoice: selectedAnchor.voice,
        anchorStyle: anchorStyleId,
        playbackRate: anchorPlaybackRate,
        voiceFeatureEnabled,
      });
    })();
  }, [
    topicOnboardingOpen,
    selectedTopics,
    savedCustomKeywords,
    dailyRadioState.scheduledTime,
    dailyRadioState.eveningTime,
    isPro,
    anchorId,
    anchorStyleId,
    anchorPlaybackRate,
    selectedAnchor.voice,
    voiceFeatureEnabled,
  ]);

  useEffect(() => {
    if (!voiceFeatureEnabled) return;
    if (pushAnchorAutoplayPendingRef.current) return;
    if (pushAutoplayScheduledRef.current) return;
    if (displayScriptSource !== "server") return;
    if (dailyRadioState.status !== "ready") return;
    if (!aiScript.trim()) return;
    if (anchorAudioReady || scriptAudioLoading) return;
    const key = `${dailyRadioState.lastEntryId ?? "local"}-${todayDailyScriptYmd()}`;
    if (autoAudioEnsuredRef.current === key) return;
    autoAudioEnsuredRef.current = key;
    void ensureDailyAnchorAudio();
  }, [
    voiceFeatureEnabled,
    dailyRadioState.status,
    dailyRadioState.lastEntryId,
    aiScript,
    anchorAudioReady,
    scriptAudioLoading,
    ensureDailyAnchorAudio,
    displayScriptSource,
  ]);

  useEffect(() => {
    if (!pendingHomeAnchorPlayRef.current) return;
    if (scriptAudioLoading) return;
    if (!anchorAudioReady || !activeScriptAudioUrl) return;
    pendingHomeAnchorPlayRef.current = false;
    stopPlayback();
    void anchorActions.play(activeScriptAudioUrl);
  }, [anchorAudioReady, activeScriptAudioUrl, scriptAudioLoading, stopPlayback, anchorActions]);

  useEffect(() => {
    if (!aiScript.trim()) return;
    if (dailyRadioState.status !== "ready") return;
    if (pushAutoplayScheduledRef.current) return;
    if (pushAnchorAutoplayPendingRef.current) return;

    if (consumeAutoplayAnchorAudioFlag()) {
      pushAutoplayScheduledRef.current = true;
      return;
    }

    if (!consumeAutoplayDailyFlag()) return;

    if (serverSyncState !== "ready") {
      console.log("[PushOpen] skip speechSynthesis: no server script for today");
      return;
    }

    if (voiceFeatureEnabled) {
      console.log("[PushOpen] skip speechSynthesis for Pro on text-only daily flag");
      return;
    }

    pushAutoplayScheduledRef.current = true;
    setTab("player");
    schedulePushAutoplay();
  }, [
    aiScript,
    dailyRadioState.status,
    serverSyncState,
    voiceFeatureEnabled,
    schedulePushAutoplay,
  ]);

  const copyAiScript = async () => {
    await copyAiScriptText(aiScript);
  };

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
              duration: aiLastDuration ?? (selectedScriptDuration ?? FREE_DURATION),
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
      const parsed = parseAiSummaryContent(fav.script, fav.highlights);
      setDisplayScriptSource("manual");
      clearScriptAudioBinding();
      setAiScript(parsed.script);
      setAiHighlights(
        parsed.highlights.length > 0 ? parsed.highlights : fav.highlights ?? []
      );
      setAiJsonFallback(false);
      setSelectedScriptDuration(fav.duration);
      setAiDuration(fav.duration);
      setAiError(null);
      setAiLastSavedAt(fav.createdAt);
      setAiLastDuration(fav.duration);
      setAiLastNewsTitles(Array.isArray(fav.newsTitles) ? fav.newsTitles : []);
      setAiLastFp(fav.id.split("-").slice(1).join("-") || fav.id);
      setTab("player");
      if (autoplay) startPlayback(parsed.script);
    },
    [startPlayback, clearScriptAudioBinding]
  );

  const handleSaveDisplayName = useCallback(
    async (name: string): Promise<boolean> => {
      writeUserDisplayName(name);
      setUserDisplayName(name);
      if (!isSupabaseConfigured()) return true;
      return syncUserNewsPreferences({
        topics: selectedTopics,
        customKeywords: savedCustomKeywords,
        displayName: name,
        dailyRadioEnabled: true,
        morningRadioEnabled: true,
        eveningRadioEnabled: isPro,
        morningRadioTime: dailyRadioState.scheduledTime || MORNING_RADIO_TIME,
        eveningRadioTime: dailyRadioState.eveningTime || EVENING_RADIO_TIME,
        morningDurationMinutes: 3,
        eveningDurationMinutes: 3,
        isPro,
        anchorId,
        anchorVoice: selectedAnchor.voice,
        anchorStyle: anchorStyleId,
        playbackRate: anchorPlaybackRate,
        voiceFeatureEnabled,
      });
    },
    [
      selectedTopics,
      savedCustomKeywords,
      isPro,
      dailyRadioState.scheduledTime,
      dailyRadioState.eveningTime,
      anchorId,
      selectedAnchor.voice,
      anchorStyleId,
      anchorPlaybackRate,
      voiceFeatureEnabled,
    ]
  );

  const pageTitle =
    tab === "home"
      ? "首頁"
      : tab === "player"
        ? playbackPageTitle(playbackState)
        : tab === "video"
          ? ENABLE_VIDEO_NEWS_UI
            ? "影音新聞"
            : "首頁"
          : tab === "favorites"
            ? "收藏新聞"
            : "個人設定";

  useEffect(() => {
    if (tab !== "home") return;
    const run = () => {
      logScrollDebug("home mount", pageScrollRef.current, null);
    };
    run();
    const t = window.setTimeout(run, 800);
    return () => window.clearTimeout(t);
  }, [tab, news.length, loading]);

  const showFloatingPlayer = playbackActive && tab !== "player";

  return (
    <div ref={pageScrollRef} style={styles.page}>
      <SettingsToastHost />
      <div
        style={{
          ...styles.phone,
          paddingBottom: showFloatingPlayer
            ? "calc(132px + env(safe-area-inset-bottom, 0px))"
            : tab === "home"
              ? "calc(120px + env(safe-area-inset-bottom, 0px))"
              : styles.phone.paddingBottom,
        }}
      >
        {tab === "home" ? (
          <header style={styles.homeHeader}>
            <div style={{ minWidth: 0 }}>
              <h1
                style={styles.homeBrand}
                aria-label="今日 AI 新聞台"
                onClick={handleHomeBrandTap}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") handleHomeBrandTap();
                }}
                role="button"
                tabIndex={0}
              >
                今日 AI 新聞台
              </h1>
              <p style={styles.homeStats}>
                追蹤 <span style={styles.homeStatNum}>{selectedTopics.length}</span> 個主題｜
                <span style={styles.homeStatNum}>{news.length}</span> 則新聞
                {lastUpdated ? "已更新" : ""}
              </p>
            </div>
            {playbackState === "playing" ? (
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

            {globalNewsBanner ? (
              <div style={styles.videoInfoBanner} role="status">
                {globalNewsBanner}
              </div>
            ) : null}

            <HomeStationHero
              newsCount={totalNewsCount}
              selectedCount={selectedNews.length}
              scriptDuration={selectedScriptDuration}
              radioStatus={dailyRadioHeroStatus({
                hasScript: aiScript.trim().length > 0,
                aiLoading,
                localState: dailyRadioState,
                serverSyncState,
                generationSource: dailyRadioState.generationSource,
              })}
              generationSource={dailyRadioState.generationSource}
              radioSlot={dailyRadioState.lastRadioSlot}
              serverConfigured={isSupabaseConfigured()}
              serverSyncState={serverSyncState}
              newsFetchStatus={newsFetchStatus}
              supabaseUserId={supabaseUserId}
              scriptQueryDebug={scriptQueryDebug}
              aiQuotaRemaining={aiQuotaRemaining}
              aiDailyLimit={aiDailyLimit}
              isPro={isPro}
              voiceFeatureEnabled={voiceFeatureEnabled}
              anchorName={selectedAnchor.name}
              anchorPlaybackRate={anchorPlaybackRate}
              anchorAudioReady={anchorAudioReady}
              scriptAudioLoading={scriptAudioLoading}
              scriptAudioStaleReason={scriptAudioStaleReason}
              displayScriptSource={displayScriptSource}
              homeAnchorPlaying={anchorPlayer.isPlaying}
              hasScript={aiScript.trim().length > 0}
              aiLoading={aiLoading}
              onPlayNow={handleHomePlayNow}
              onStartDaily={handleStartDailyBriefing}
              onRegenerate={openAiAnalysis}
              onRegenerateAnchor={() => void handleGenerateScriptAudio()}
              onRefresh={updateMyNews}
              onSettingsTopics={() => setTab("settings")}
              loadingNews={loading}
            />

            <AiSummaryPanel
              variant="home"
              aiLoading={aiLoading}
              aiError={aiError}
              aiScript={aiScript}
              aiHighlights={aiHighlights}
              aiJsonFallback={aiJsonFallback}
              selectedScriptDuration={selectedScriptDuration}
              scriptFontSize={scriptFontSize}
              onScriptFontSizeChange={setScriptFontSize}
              isSpeaking={playbackActive}
              isPaused={playbackState === "paused"}
              onPlayScript={playScriptDraft}
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
              voiceFeatureEnabled={voiceFeatureEnabled}
              anchor={selectedAnchor}
              anchorStyle={selectedAnchorStyle}
              anchorPlaybackRate={anchorPlaybackRate}
              onAnchorPlaybackRateChange={handleAnchorPlaybackRateChange}
              anchorVolumeGain={anchorVolumeGain}
              onAnchorVolumeGainChange={handleAnchorVolumeGainChange}
              scriptAudioUrl={anchorAudioReady ? activeScriptAudioUrl : null}
              scriptAudioLoading={scriptAudioLoading}
              scriptAudioError={scriptAudioError}
              scriptAudioStaleReason={scriptAudioStaleReason}
              onGenerateScriptAudio={() => void handleGenerateScriptAudio()}
              anchorAudioReady={anchorAudioReady}
              displayScriptSource={displayScriptSource}
              radioSlot={dailyRadioState.lastRadioSlot}
              onRegenerateAnchor={() => void handleGenerateScriptAudio()}
            />

            <AiDailyInsightCard
              isPro={isPro}
              news={news}
              insight={dailyInsight}
              loadingInsight={dailyInsightLoading}
              onRequestInsight={handleRequestDailyInsight}
              onOpenProModal={openProUpgrade}
              onOpenRecommendedNews={(title, matchedNewsId) => {
                let item =
                  matchedNewsId != null
                    ? news.find((n) => n.id === matchedNewsId) ?? null
                    : null;
                if (!item) item = findClosestNewsByTitle(news, title);
                if (!item) return;
                if (!item.selected) {
                  setNews((prev) =>
                    prev.map((n) =>
                      n.id === item.id ? { ...n, selected: true } : n
                    )
                  );
                }
                window.open(item.link, "_blank", "noopener,noreferrer");
              }}
            />

            <InternalPromotionBanner isPro={isPro} variant="home" />

            <NewsList
              title="今日新聞"
              compact
              denseCards
              isPro={isPro}
              topicSections={topicNewsSections}
              scrollRootRef={pageScrollRef}
              homeToolbar={{
                selectAll,
                clearAll,
                lastUpdated,
              }}
              news={news}
              totalNewsCount={totalNewsCount}
              loading={loading}
              newsFetchStatus={newsFetchStatus}
              toggleNews={toggleNews}
              toggleFavorite={toggleFavorite}
              onRefreshNews={updateMyNews}
              onSettingsTopics={() => setTab("settings")}
            />

            <SiteFooter />
          </>
        )}

        {tab === "player" && (
          <>
            {voiceFeatureEnabled ? (
              aiScript.trim() ? (
                <div style={styles.playerVoicePrimary}>
                  <AiAnchorBroadcastPanel
                    anchor={selectedAnchor}
                    style={selectedAnchorStyle}
                    playbackRate={anchorPlaybackRate}
                    onPlaybackRateChange={handleAnchorPlaybackRateChange}
                    volumeGain={anchorVolumeGain}
                    onVolumeGainChange={handleAnchorVolumeGainChange}
                    audioUrl={anchorAudioReady ? activeScriptAudioUrl : null}
                    loading={scriptAudioLoading}
                    error={scriptAudioError}
                    staleReason={scriptAudioStaleReason}
                    onGenerate={() => void handleGenerateScriptAudio()}
                    forceManualPlayPrompt={pushManualPlayVisible}
                    displayScriptSource={displayScriptSource}
                    radioSlot={dailyRadioState.lastRadioSlot}
                  />
                  {scriptAudioError && !scriptAudioLoading ? (
                    <div style={styles.anchorFallbackHint}>
                      AI 主播暫時無法播放，可先使用文字朗讀
                    </div>
                  ) : null}
                </div>
              ) : null
            ) : anchorAudioReady && activeScriptAudioUrl ? (
              <div style={styles.playerVoicePrimary}>
                <AiAnchorBroadcastPanel
                  anchor={getAnchorById(DEFAULT_AI_ANCHOR_SETTINGS.anchorId)}
                  style={getStyleById(DEFAULT_AI_ANCHOR_SETTINGS.style)}
                  playbackRate={anchorPlaybackRate}
                  onPlaybackRateChange={() => {}}
                  volumeGain={1.0}
                  onVolumeGainChange={() => {}}
                  audioUrl={activeScriptAudioUrl}
                  loading={scriptAudioLoading}
                  error={scriptAudioError}
                  staleReason={scriptAudioStaleReason}
                  onGenerate={() => {}}
                  forceManualPlayPrompt={pushManualPlayVisible}
                  displayScriptSource="server"
                  radioSlot={dailyRadioState.lastRadioSlot}
                />
              </div>
            ) : (
              <div style={styles.playerVoicePrimary}>
                <AiAnchorProLockCard onUpgrade={openProUpgrade} />
              </div>
            )}

            {!voiceFeatureEnabled ? (
              <PlayerDeck
                playbackState={playbackState}
                radioSlot={dailyRadioState.lastRadioSlot}
                dailyRadioReady={dailyRadioState.status === "ready"}
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
            ) : aiScript.trim() || selectedNews.length > 0 ? (
              <BackupTextToSpeechSection
                defaultOpen={Boolean(scriptAudioError && !scriptAudioLoading)}
                playbackState={playbackState}
                playbackProgress={playbackProgress}
                remainingMs={remainingMs}
                speed={speed}
                aiScript={aiScript}
                selectedNewsCount={selectedNews.length}
                voiceName={voiceName}
                voices={voices}
                onVoiceChange={setVoiceName}
                onSpeedChange={changeSpeed}
                onTogglePlayPause={togglePlayPause}
                onStop={stopPlayback}
                onStart={startPlayback}
              />
            ) : null}

            <InternalPromotionBanner isPro={isPro} variant="player" />

            <AiSummaryPanel
              variant="player"
              aiLoading={aiLoading}
              aiError={aiError}
              aiScript={aiScript}
              aiHighlights={aiHighlights}
              aiJsonFallback={aiJsonFallback}
              selectedScriptDuration={selectedScriptDuration}
              scriptFontSize={scriptFontSize}
              onScriptFontSizeChange={setScriptFontSize}
              isSpeaking={playbackActive}
              isPaused={playbackState === "paused"}
              onPlayScript={playScriptDraft}
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
              voiceFeatureEnabled={voiceFeatureEnabled}
              anchor={selectedAnchor}
              anchorStyle={selectedAnchorStyle}
              anchorPlaybackRate={anchorPlaybackRate}
              onAnchorPlaybackRateChange={handleAnchorPlaybackRateChange}
              anchorVolumeGain={anchorVolumeGain}
              onAnchorVolumeGainChange={handleAnchorVolumeGainChange}
              scriptAudioUrl={anchorAudioReady ? activeScriptAudioUrl : null}
              scriptAudioLoading={scriptAudioLoading}
              scriptAudioError={scriptAudioError}
              scriptAudioStaleReason={scriptAudioStaleReason}
              onGenerateScriptAudio={() => void handleGenerateScriptAudio()}
              anchorAudioReady={anchorAudioReady}
              displayScriptSource={displayScriptSource}
              radioSlot={dailyRadioState.lastRadioSlot}
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
          <FavoritesTabView
            aiFavorites={aiFavorites}
            favoriteNews={favoriteNews}
            onLoadAiFavorite={(fav) => loadAiFavorite(fav, true)}
            onCopyAiFavorite={(fav) => void copyAiScriptText(fav.script)}
            onRemoveAiFavorite={(id) => {
              setAiFavorites((prev) => {
                const next = prev.filter((x) => x.id !== id);
                writeAiFavorites(next);
                return next;
              });
            }}
            toggleNews={toggleNews}
            toggleFavorite={toggleFavorite}
          />
        )}

        {tab === "settings" && (
          <>
            <SettingsSummaryGrid
              isPro={isPro}
              aiQuotaRemaining={aiQuotaRemaining}
              aiDailyLimit={aiDailyLimit}
              topicCount={selectedTopics.length}
              topicLimit={planLimits.topicLimit}
              keywordCount={savedCustomKeywords.length}
              keywordLimit={planLimits.customKeywordLimit}
              totalTrackingCount={getTotalTrackingCount(
                selectedTopics.length,
                savedCustomKeywords.length
              )}
              totalTrackingLimit={planLimits.totalTrackingLimit}
              historyDays={planLimits.historyDays}
              voiceLabel={shortVoiceLabel(voiceName)}
              speed={speed}
            />

            <SettingsCollapsible
              title="專屬 AI 電台"
              subtitle={isPro ? "早晚固定開播" : "每天早上為你準備"}
              defaultOpen
            >
              {isPro ? (
                <div style={styles.settingHint}>
                  每天早晚自動整理你最關心的新聞，
                  <br />
                  重要資訊不用自己找，打開 App 就能立即收聽。
                </div>
              ) : (
                <div style={styles.settingHint}>
                  每天早上自動整理你最關心的新聞，3 分鐘快速掌握今天的重要資訊。
                </div>
              )}
              {isPro ? (
                <div style={styles.proStatusLine}>
                  <strong>📻 專屬 AI 電台</strong>
                  <div style={styles.settingHintMuted}>每天早晚固定開播，就像收聽自己的 Podcast。</div>
                  <div>• 每日 {MORNING_RADIO_TIME} AI 早報</div>
                  <div>• 每日 {EVENING_RADIO_TIME} AI 晚報</div>
                  <div>• 推播提醒</div>
                  <div>• 一鍵立即播放</div>
                </div>
              ) : (
                <div style={styles.proStatusLine}>
                  <strong>📻 每日早報</strong>
                  <div style={styles.settingHintMuted}>每天早上固定開播，為你整理今日重點。</div>
                  <div>• 每日 {MORNING_RADIO_TIME}</div>
                  <div>• 3 分鐘快速掌握重點</div>
                </div>
              )}
            </SettingsCollapsible>

            <SettingsCollapsible
              title="AI 主播設定"
              subtitle={
                voiceFeatureEnabled
                  ? `${selectedAnchor.name} · ${selectedAnchorStyle.name} · ${formatAnchorPlaybackRate(anchorPlaybackRate)}`
                  : "Pro 專屬功能"
              }
            >
              <AiAnchorSettingsIntro />
              <DisplayNameField
                savedValue={userDisplayName}
                onSave={handleSaveDisplayName}
                onToast={showSettingsToast}
                anchorName={selectedAnchor.name}
                styleName={selectedAnchorStyle.name}
                playbackRate={anchorPlaybackRate}
              />
              {voiceFeatureEnabled ? (
                <AiAnchorSettingsFields
                  anchorId={anchorId}
                  styleId={anchorStyleId}
                  playbackRate={anchorPlaybackRate}
                  onAnchorChange={handleAnchorIdChange}
                  onStyleChange={handleAnchorStyleChange}
                  onPlaybackRateChange={handleAnchorPlaybackRateChange}
                />
              ) : (
                <AiAnchorProLockCard onUpgrade={openProUpgrade} />
              )}
            </SettingsCollapsible>

            <SettingsCollapsible title="Pro 方案詳情" subtitle={isPro ? "Pro 已啟用" : "升級解鎖完整功能"}>
              <ProStatusCard
                proStatus={proStatus}
                onRestore={handleRestorePurchases}
              />
              {!isPro ? (
                <ProUpgradeCard
                  variant="settings"
                  proStatus={proStatus}
                  onUpgrade={handleUpgradePro}
                  onRestore={handleRestorePurchases}
                />
              ) : null}
            </SettingsCollapsible>

            <SettingsCollapsible title="帳號" subtitle="登入功能即將開放">
              <div style={styles.settingHint}>
                登入功能即將開放，目前你的資料會安全保存在這台裝置上。
              </div>
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                style={styles.fullButton}
              >
                了解更多
              </button>
            </SettingsCollapsible>

            <SettingsCollapsible
              title="我的追蹤主題"
              subtitle={`已選 ${selectedTopics.length} / ${planLimits.topicLimit} · 總追蹤 ${getTotalTrackingCount(selectedTopics.length, savedCustomKeywords.length)} / ${planLimits.totalTrackingLimit}`}
              defaultOpen
            >
              <div style={styles.settingHint}>
                首頁會依照這些主題整理新聞；搜尋單一事件請用首頁搜尋框。
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
            </SettingsCollapsible>

            <SettingsCollapsible
              title="自訂關鍵字"
              subtitle={`已儲存 ${savedCustomKeywords.length} / ${planLimits.customKeywordLimit} · 總追蹤 ${getTotalTrackingCount(selectedTopics.length, savedCustomKeywords.length)} / ${planLimits.totalTrackingLimit}`}
            >
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
            </SettingsCollapsible>

            <SettingsCollapsibleAiHistorySection
              entries={visibleAiHistory}
              activeId={activeAiHistoryId}
              historyDays={planLimits.historyDays}
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

            <SettingsCollapsible
              title="AI 使用額度"
              subtitle={`今日剩餘 ${aiQuotaRemaining} / ${aiDailyLimit} 次`}
            >
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
            </SettingsCollapsible>

            <SettingsCollapsible
              title="語音設定"
              subtitle={`${shortVoiceLabel(voiceName)} · ${speed.toFixed(2)}x`}
            >
              {/* 目前 AI 主播稿只支援中文內容，speechSynthesis 選單必須限制為中文語音。
                  不可直接顯示 speechSynthesis.getVoices() 全部語音，否則中文稿會被非中文語音唸成異常聲音。 */}
              <select
                value={voiceName}
                onChange={(e) => {
                  isManualStopRef.current = true;
                  setVoiceName(e.target.value);
                }}
                style={styles.select}
              >
                {chineseVoices.map((voice) => (
                  <option key={voice.name} value={voice.name}>
                    {chineseVoiceOptionLabel(voice)}
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
            </SettingsCollapsible>

            <SettingsCollapsible
              title="收藏管理"
              subtitle={`${favoriteNews.length} 則收藏新聞`}
            >
              <button onClick={clearFavorites} style={styles.dangerFullButton}>
                清除全部收藏
              </button>
            </SettingsCollapsible>

            <SettingsCollapsible title="幫助 / 關於" subtitle="新手教學與說明">
              <button
                type="button"
                onClick={() => {
                  writeOnboardingSeen(false);
                  setOnboardingStep(0);
                  setOnboardingOpen(true);
                }}
                style={{ ...styles.toolbarBtnNeutral, width: "100%" }}
              >
                重新觀看新手教學
              </button>
            </SettingsCollapsible>

            <SettingsCollapsible title="法律與隱私" subtitle="隱私權與服務條款">
              <div style={styles.legalLinksRow}>
                <a href="/privacy" style={styles.legalLink}>
                  隱私權政策
                </a>
                <a href="/terms" style={styles.legalLink}>
                  服務條款
                </a>
              </div>
            </SettingsCollapsible>
          </>
        )}

        <BottomNav tab={tab} setTab={setTab} hidden={topicOnboardingOpen} />

        {showFloatingPlayer ? (
          <FloatingPlayerBar
            playbackState={playbackState}
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
            onUpgrade={handleUpgradePro}
            onRestore={handleRestorePurchases}
          />
        ) : null}

        <HiddenDevPanel
          open={hiddenDevPanelOpen}
          onClose={() => setHiddenDevPanelOpen(false)}
          onStatusChanged={handleHiddenDevStatusChanged}
          supabaseUserId={supabaseUserId}
          todayServerScriptId={
            serverSyncState === "ready" && scriptQueryDebug?.generationSource === "server"
              ? scriptQueryDebug.scriptId
              : null
          }
          onTriggerServerDailyRadio={handleTriggerServerDailyRadio}
          onSimulateAiAnchorPushClick={handleSimulateAiAnchorPushClick}
        />

        {splashOpen ? <SplashScreen /> : null}

        {authModalOpen ? (
          <AuthComingSoonModal onClose={() => setAuthModalOpen(false)} />
        ) : null}

        {onboardingOpen && !splashOpen && !topicOnboardingOpen ? (
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

        {topicOnboardingOpen && !splashOpen ? (
          <TopicOnboardingScreen
            topics={topics.map((t) => ({ label: t.label, icon: t.icon }))}
            requiredCount={ONBOARDING_TOPIC_PICK_COUNT}
            onComplete={handleTopicOnboardingComplete}
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

function BackupTextToSpeechSection({
  defaultOpen,
  playbackState,
  playbackProgress,
  remainingMs,
  speed,
  aiScript,
  selectedNewsCount,
  voiceName,
  voices,
  onVoiceChange,
  onSpeedChange,
  onTogglePlayPause,
  onStop,
  onStart,
}: {
  defaultOpen: boolean;
  playbackState: PlaybackState;
  playbackProgress: number;
  remainingMs: number;
  speed: number;
  aiScript: string;
  selectedNewsCount: number;
  voiceName: string;
  voices: SpeechSynthesisVoice[];
  onVoiceChange: (name: string) => void;
  onSpeedChange: (rate: number) => void;
  onTogglePlayPause: () => void;
  onStop: () => void;
  onStart: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const active = isPlaybackActiveState(playbackState);
  const canPlay = aiScript.trim().length > 0 || selectedNewsCount > 0;
  const stopDisabled = !canStopPlayback(playbackState);
  const showAltPlay = canRestartPlayback(playbackState) && canPlay;
  const chineseVoices = filterChineseVoices(voices);

  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  const primaryLabel =
    playbackState === "loading"
      ? "準備中…"
      : playbackState === "paused"
        ? "▶ 繼續"
        : playbackState === "playing"
          ? "⏸ 暫停"
          : "▶ 播放";

  return (
    <section style={styles.backupTtsSection}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={styles.backupTtsToggle}
      >
        <span>備用文字朗讀 · {speed.toFixed(2)}x</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <div style={styles.backupTtsBody}>
          {active ? (
            <div style={styles.playerProgressTrackLarge}>
              <div
                style={{
                  ...styles.playerProgressFill,
                  width: `${Math.round(playbackProgress * 100)}%`,
                }}
              />
            </div>
          ) : null}
          <div style={styles.playerControlRow}>
            <button
              type="button"
              onClick={onTogglePlayPause}
              disabled={playbackState === "loading" || (!canPlay && !active)}
              style={{
                ...styles.playerPlayBtn,
                opacity:
                  playbackState === "loading" || (!canPlay && !active) ? 0.45 : 1,
                cursor:
                  playbackState === "loading" || (!canPlay && !active)
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {primaryLabel}
            </button>
            <button
              type="button"
              onClick={onStop}
              disabled={stopDisabled}
              style={{
                ...styles.playerStopBtn,
                opacity: stopDisabled ? 0.45 : 1,
                cursor: stopDisabled ? "not-allowed" : "pointer",
              }}
            >
              ■ 停止
            </button>
            {showAltPlay ? (
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
          {/* 目前 AI 主播稿只支援中文內容，speechSynthesis 選單必須限制為中文語音。
              不可直接顯示 speechSynthesis.getVoices() 全部語音，否則中文稿會被非中文語音唸成異常聲音。 */}
          <select
            value={voiceName}
            onChange={(e) => onVoiceChange(e.target.value)}
            style={styles.select}
          >
            {chineseVoices.map((voice) => (
              <option key={voice.name} value={voice.name}>
                {chineseVoiceOptionLabel(voice)}
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
        </div>
      ) : null}
    </section>
  );
}

function PlayerDeck({
  playbackState,
  radioSlot,
  dailyRadioReady,
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
  playbackState: PlaybackState;
  radioSlot: RadioSlot | null;
  dailyRadioReady: boolean;
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
  const [voiceOpen, setVoiceOpen] = useState(false);
  const active = isPlaybackActiveState(playbackState);
  const canPlay = aiScript.trim().length > 0 || selectedNewsCount > 0;
  const slot = radioSlot ?? "morning";
  const readyIdle =
    dailyRadioReady &&
    canPlay &&
    (playbackState === "idle" ||
      playbackState === "stopped" ||
      playbackState === "completed" ||
      playbackState === "error");
  const statusLabel = readyIdle
    ? radioSlotCompletedTitle(slot)
    : playbackState === "idle"
      ? "待播放"
      : playbackPageTitle(playbackState);
  const stopDisabled = !canStopPlayback(playbackState);
  const showAltPlay = canRestartPlayback(playbackState) && canPlay;
  const chineseVoices = filterChineseVoices(voices);

  const primaryLabel =
    playbackState === "loading"
      ? "準備中…"
      : playbackState === "paused"
        ? "▶ 繼續"
        : playbackState === "playing"
          ? "⏸ 暫停"
          : "▶ 播放";

  return (
    <section style={styles.playerDeck}>
      <div style={styles.playerDeckTop}>
        <WaveformBars active={playbackState === "playing"} />
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

      <div style={styles.playerProgressTrackLarge}>
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
          disabled={playbackState === "loading" || (!canPlay && !active)}
          style={{
            ...styles.playerPlayBtn,
            opacity:
              playbackState === "loading" || (!canPlay && !active) ? 0.45 : 1,
            cursor:
              playbackState === "loading" || (!canPlay && !active)
                ? "not-allowed"
                : "pointer",
          }}
        >
          {primaryLabel}
        </button>
        <button
          type="button"
          onClick={onStop}
          disabled={stopDisabled}
          style={{
            ...styles.playerStopBtn,
            opacity: stopDisabled ? 0.45 : 1,
            cursor: stopDisabled ? "not-allowed" : "pointer",
          }}
        >
          ■ 停止
        </button>
        {showAltPlay ? (
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

      <button
        type="button"
        onClick={() => setVoiceOpen((v) => !v)}
        style={styles.playerVoiceToggle}
      >
        <span>語音與語速 · {speed.toFixed(2)}x</span>
        <span>{voiceOpen ? "▲" : "▼"}</span>
      </button>
      {voiceOpen ? (
        <>
          {/* 目前 AI 主播稿只支援中文內容，speechSynthesis 選單必須限制為中文語音。
              不可直接顯示 speechSynthesis.getVoices() 全部語音，否則中文稿會被非中文語音唸成異常聲音。 */}
          <select
            value={voiceName}
            onChange={(e) => onVoiceChange(e.target.value)}
            style={styles.select}
          >
            {chineseVoices.map((voice) => (
              <option key={voice.name} value={voice.name}>
                {chineseVoiceOptionLabel(voice)}
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
        </>
      ) : null}
    </section>
  );
}

function FloatingPlayerBar({
  playbackState,
  playbackProgress,
  remainingMs,
  speed,
  playbackMode,
  onTogglePlayPause,
  onStop,
  onOpenPlayer,
}: {
  playbackState: PlaybackState;
  playbackProgress: number;
  remainingMs: number;
  speed: number;
  playbackMode: PlaybackMode;
  onTogglePlayPause: () => void;
  onStop: () => void;
  onOpenPlayer: () => void;
}) {
  const playDisabled = isPlayPrimaryDisabled(playbackState);
  const stopDisabled = !canStopPlayback(playbackState);

  return (
    <div style={styles.floatingPlayer} role="region" aria-label="迷你播放器">
      <button type="button" onClick={onOpenPlayer} style={styles.floatingPlayerMain}>
        <WaveformBars active={playbackState === "playing"} />
        <div style={styles.floatingPlayerText}>
          <span style={styles.floatingPlayerTitle}>
            {playbackPageTitle(playbackState)}
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
      <button
        type="button"
        onClick={onTogglePlayPause}
        disabled={playDisabled && playbackState !== "playing" && playbackState !== "paused"}
        style={{
          ...styles.floatingIconBtn,
          opacity:
            playDisabled && playbackState !== "playing" && playbackState !== "paused"
              ? 0.45
              : 1,
        }}
      >
        {playbackState === "paused" ? "▶" : playbackState === "playing" ? "⏸" : "▶"}
      </button>
      <button
        type="button"
        onClick={onStop}
        disabled={stopDisabled}
        style={{
          ...styles.floatingIconBtnStop,
          opacity: stopDisabled ? 0.45 : 1,
        }}
      >
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
  "解鎖 5 / 10 / 15 分鐘專屬 AI 電台",
  "每日 10 次 AI 產生額度（手動重新生成）",
  "最多 10 個追蹤主題（含自訂關鍵字）",
  "AI 今日洞察",
  "無廣告閱讀體驗",
  "移除推薦 App 與廣告版位",
  "收藏與 AI 歷史保留更久",
  "後續：自訂每日生成時間",
] as const;

function RestorePurchasesButton({
  label,
  onRestore,
  variant = "link",
}: {
  label: string;
  onRestore: () => void | Promise<void>;
  variant?: "link" | "secondary";
}) {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await onRestore();
        } finally {
          setBusy(false);
        }
      }}
      style={variant === "link" ? styles.proRestoreLinkBtn : styles.proRestoreSecondaryBtn}
    >
      {busy ? "恢復中…" : label}
    </button>
  );
}

function ProPlanPicker({
  selectedPlan,
  onSelectPlan,
}: {
  selectedPlan: ProPlanTier;
  onSelectPlan: (plan: ProPlanTier) => void;
}) {
  const plans: ProPlanTier[] = ["monthly", "yearly"];

  return (
    <div style={styles.proPlanPicker} role="radiogroup" aria-label="Pro 方案">
      {plans.map((plan) => {
        const active = selectedPlan === plan;
        const pricing = PRO_PRICING[plan];
        return (
          <button
            key={plan}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelectPlan(plan)}
            style={{
              ...styles.proPlanCard,
              ...(active ? styles.proPlanCardActive : {}),
            }}
          >
            {plan === "yearly" ? (
              <span style={styles.proPlanBadge}>推薦</span>
            ) : null}
            <div style={styles.proPlanTitle}>{pricing.shortTitle}</div>
            <div style={styles.proPlanPrice}>{pricing.label}</div>
            {plan === "yearly" && pricing.subtitle ? (
              <div style={styles.proPlanSubtitle}>{pricing.subtitle}</div>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function ProUpgradeCard({
  variant,
  proStatus,
  onUpgrade,
  onRestore,
}: {
  variant: "compact" | "settings";
  proStatus: ProStatus;
  onUpgrade: (plan: ProPlanTier) => void | Promise<void>;
  onRestore: () => void | Promise<void>;
}) {
  const [selectedPlan, setSelectedPlan] = useState<ProPlanTier>("yearly");

  if (isProActive(proStatus)) return null;

  const compact = variant === "compact";
  return (
    <div
      style={compact ? styles.proUpgradeCardCompact : styles.proUpgradeCardSettings}
      role="note"
      aria-label="升級 Pro"
    >
      <div style={styles.proUpgradeTitle}>升級 Pro，打造你的個人 AI 情報台</div>
      {!compact ? (
        <>
          <p style={styles.proUpgradeSubtitle}>
            解鎖 5 / 10 / 15 分鐘專屬 AI 電台、10 個追蹤主題、AI 今日洞察與無廣告閱讀體驗。
          </p>
          <ul style={styles.proUpgradeList}>
            {PRO_SELL_POINTS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </>
      ) : (
        <p style={styles.proUpgradeCompactSub}>
          解鎖 5 / 10 / 15 分鐘專屬 AI 電台、10 個追蹤主題、AI 今日洞察與無廣告閱讀體驗
        </p>
      )}
      <ProPlanPicker selectedPlan={selectedPlan} onSelectPlan={setSelectedPlan} />
      <div style={styles.proUpgradeBtnRow}>
        <button
          type="button"
          onClick={() => onUpgrade(selectedPlan)}
          style={styles.proUpgradePrimaryBtn}
        >
          {getProUpgradeButtonLabel(selectedPlan)}
        </button>
      </div>
      <RestorePurchasesButton label="已購買？恢復購買" onRestore={onRestore} variant="link" />
    </div>
  );
}

function ProStatusCard({
  proStatus,
  onRestore,
}: {
  proStatus: ProStatus;
  onRestore: () => void | Promise<void>;
}) {
  const active = isProActive(proStatus);
  const source = proSourceLabel(proStatus.proSource);
  const limits = getPlanLimits(proStatus);

  return (
    <section style={styles.controlPanel}>
      <div style={styles.controlTitle}>Pro 方案</div>
      <div style={styles.proStatusLine}>
        <strong>月費：</strong>
        {PRO_PRICING.monthly.label}
      </div>
      <div style={styles.proStatusLine}>
        <strong>年費：</strong>
        {PRO_PRICING.yearly.label}
      </div>
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
            <strong>總追蹤上限：</strong>
            {limits.totalTrackingLimit} 個
          </div>
          <div style={styles.proStatusLine}>
            <strong>AI 今日洞察：</strong>
            已開放
          </div>
          <div style={styles.proStatusLine}>
            <strong>收藏上限：</strong>
            {limits.favoriteLimit} 則
          </div>
          <div style={styles.proStatusLine}>
            <strong>AI 歷史：</strong>最近 {limits.historyDays} 天
          </div>
          <div style={styles.proStatusLine}>
            <strong>推薦 App / 廣告：</strong>已移除
          </div>
          <div style={styles.proStatusLine}>
            <strong>閱讀體驗：</strong>無廣告
          </div>
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
            <strong>總追蹤上限：</strong>
            {limits.totalTrackingLimit} 個
          </div>
          <div style={styles.proStatusLine}>
            <strong>AI 今日洞察：</strong>
            Pro 專屬
          </div>
          <div style={styles.proStatusLine}>
            <strong>收藏上限：</strong>
            {limits.favoriteLimit} 則
          </div>
          <div style={styles.proStatusLine}>
            <strong>AI 歷史：</strong>最近 {limits.historyDays} 天
          </div>
          <div style={styles.proStatusLine}>
            <strong>推薦 App / 廣告：</strong>顯示中
          </div>
          <div style={styles.settingHint}>
            升級 Pro，打造你的個人 AI 情報台：解鎖 5 / 10 / 15 分鐘專屬 AI 電台、10 個追蹤主題、AI 今日洞察與無廣告閱讀體驗
          </div>
        </>
      )}

      <div style={styles.proRestoreRow}>
        <RestorePurchasesButton label="恢復購買" onRestore={onRestore} variant="secondary" />
      </div>
    </section>
  );
}

function UpgradeModal({
  kind,
  onClose,
  onUpgrade,
  onRestore,
}: {
  kind: UpgradeModalKind;
  onClose: () => void;
  onUpgrade: (plan: ProPlanTier) => void | Promise<void>;
  onRestore: () => void | Promise<void>;
}) {
  const renderLimitBody = () => {
    switch (kind) {
      case "topic":
        return (
          <>
            <div style={styles.proModalFocusTitle}>
              免費版最多追蹤 {getPlanLimits().topicLimit} 個主題（總追蹤上限{" "}
              {getPlanLimits().totalTrackingLimit} 個）
            </div>
            <p style={styles.proModalFocusBody}>
              升級 Pro 可追蹤最多 10 個主題與自訂關鍵字，並解鎖 AI 今日洞察
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
              免費版最多新增 {getPlanLimits().customKeywordLimit} 個自訂關鍵字（總追蹤上限{" "}
              {getPlanLimits().totalTrackingLimit} 個）
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
              升級 Pro 可獲得每日 10 次 AI 額度、5 / 10 / 15 分鐘版本與 AI 今日洞察
            </p>
          </>
        );
      case "pro_duration":
        return (
          <>
            <div style={styles.proModalFocusTitle}>5 / 10 / 15 分鐘新聞稿為 Pro 專屬</div>
            <p style={styles.proModalFocusBody}>
              升級 Pro 可解鎖更完整、更深入的專屬 AI 電台體驗。
            </p>
            <p style={styles.proModalFocusBody}>
              升級 Pro 可解鎖 5 / 10 / 15 分鐘版本、每日 10 次 AI 額度、10 個追蹤主題與 AI 今日洞察。
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
    kind === "pro_duration";

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
            onRestore={onRestore}
          />
        ) : (
          <div style={styles.proUpgradeBtnRow}>
            <button
              type="button"
              onClick={() => onUpgrade("yearly")}
              style={styles.proUpgradePrimaryBtn}
            >
              {getProUpgradeButtonLabel("yearly")}
            </button>
            <button type="button" onClick={onClose} style={styles.proUpgradeSecondaryBtn}>
              {kind === "quota" ? "明天再用" : "稍後再說"}
            </button>
          </div>
        )}
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
              { title: "每日 10 次 AI 分析", desc: "隨時更新重點，不怕用完。" },
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
                <div style={styles.paywallPlanSub}>{PRO_PRICING.yearly.subtitle}</div>
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

function SettingsCollapsibleAiHistorySection({
  entries,
  activeId,
  historyDays,
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
  historyDays: number;
  onSelect: (entry: AiHistoryEntry) => void;
  onPlay: (entry: AiHistoryEntry) => void;
  onCopy: (entry: AiHistoryEntry) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  historyHint?: string;
  hiddenOlderCount?: number;
}) {
  const [expanded, setExpanded] = useState(readSettingsAiHistoryExpanded);
  const rangeLabel = `最近 ${historyDays} 天`;
  const countSuffix = entries.length > 0 ? ` · ${entries.length} 筆` : "";

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      writeSettingsAiHistoryExpanded(next);
      return next;
    });
  };

  return (
    <section
      style={{
        ...styles.aiHistoryPanel,
        ...(expanded ? {} : styles.aiHistoryPanelCollapsed),
      }}
    >
      <button
        type="button"
        onClick={toggleExpanded}
        style={styles.aiHistoryCollapseToggle}
        aria-expanded={expanded}
        aria-controls="settings-ai-history-body"
      >
        <div style={styles.aiHistoryCollapseToggleText}>
          <div style={styles.aiHistoryTitle}>AI 歷史</div>
          <div style={styles.aiHistoryCollapseSub}>
            {rangeLabel}
            {countSuffix}
          </div>
        </div>
        <span style={styles.aiHistoryCollapseAction}>
          {expanded ? "收合 ▲" : "展開 ▼"}
        </span>
      </button>

      {expanded ? (
        <div id="settings-ai-history-body" style={styles.aiHistoryExpandedBody}>
          <div style={styles.aiHistoryHead}>
            <div>
              <div style={styles.aiHistorySub}>
                {historyHint ?? `${rangeLabel} · 點擊載入主播稿`}
              </div>
              {hiddenOlderCount > 0 ? (
                <div style={styles.aiHistoryOlderNote}>
                  另有 {hiddenOlderCount} 筆較早紀錄，升級 Pro 後可保留更長時間
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
        </div>
      ) : null}
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
        <div style={styles.authModalTitle}>登入功能即將開放</div>
        <div style={styles.authModalBody}>目前所有資料會安全保存在你的裝置上</div>
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
      body: "打開 App 一鍵生成 3 分鐘專屬早報，也可手動選更長版本。",
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
        <div style={styles.splashSubtitle}>打開 App，你的專屬 AI 電台即刻準備</div>
        <div style={styles.splashLoader} aria-hidden>
          <span className="splash-dot" />
          <span className="splash-dot" />
          <span className="splash-dot" />
        </div>
      </div>
    </div>
  );
}

function HomeStationHero({
  newsCount,
  selectedCount,
  scriptDuration,
  radioStatus,
  generationSource,
  serverConfigured,
  serverSyncState,
  newsFetchStatus,
  supabaseUserId,
  scriptQueryDebug,
  aiQuotaRemaining,
  aiDailyLimit,
  isPro,
  voiceFeatureEnabled,
  anchorName,
  anchorPlaybackRate,
  anchorAudioReady,
  scriptAudioLoading,
  scriptAudioStaleReason,
  displayScriptSource,
  homeAnchorPlaying,
  hasScript,
  aiLoading,
  radioSlot,
  onPlayNow,
  onStartDaily,
  onRegenerate,
  onRegenerateAnchor,
  onRefresh,
  onSettingsTopics,
  loadingNews,
}: {
  newsCount: number;
  selectedCount: number;
  scriptDuration: AiDuration | null;
  radioStatus: ReturnType<typeof dailyRadioHeroStatus>;
  generationSource: import("./dailyRadio").DailyRadioGenerationSource;
  serverConfigured: boolean;
  serverSyncState: import("./dailyRadio").ServerSyncStatus;
  newsFetchStatus: import("./dailyRadio").NewsFetchStatus;
  supabaseUserId: string | null;
  scriptQueryDebug: import("./dailyRadioApi").DailyScriptQueryDebug | null;
  aiQuotaRemaining: number;
  aiDailyLimit: number;
  isPro: boolean;
  voiceFeatureEnabled: boolean;
  anchorName: string;
  anchorPlaybackRate: AiAnchorPlaybackRate;
  anchorAudioReady: boolean;
  scriptAudioLoading: boolean;
  scriptAudioStaleReason: import("./aiAnchorSettings").ScriptAudioStaleReason;
  displayScriptSource: import("./scriptAudioBinding").DisplayScriptSource;
  homeAnchorPlaying: boolean;
  hasScript: boolean;
  aiLoading: boolean;
  radioSlot: import("./radioSlot").RadioSlot | null;
  onPlayNow: () => void;
  onStartDaily: () => void;
  onRegenerate: () => void;
  onRegenerateAnchor: () => void;
  onRefresh: () => void;
  onSettingsTopics: () => void;
  loadingNews: boolean;
}) {
  const ready = radioStatus === "ready" && hasScript;
  const generating =
    radioStatus === "generating" || aiLoading || (voiceFeatureEnabled && scriptAudioLoading);
  const proAudioPreparing =
    voiceFeatureEnabled && ready && !anchorAudioReady && scriptAudioLoading;
  const { title, body, showRefresh } = dailyRadioHeroDisplay({
    ready,
    generating,
    failed: radioStatus === "failed",
    serverSyncState,
    newsFetchStatus,
    serverConfigured,
    generationSource,
    scriptDuration: scriptDuration ?? DAILY_AUTO_DURATION,
    newsCount,
    selectedCount,
    radioSlot,
    voiceFeatureEnabled,
    anchorName,
    anchorAudioReady,
    anchorAudioLoading: scriptAudioLoading,
  });

  const slotLabel = radioSlot === "evening" ? "晚報" : "早報";
  const duration = scriptDuration ?? DAILY_AUTO_DURATION;
  const anchorSpeedLabel = formatAnchorPlaybackRate(anchorPlaybackRate);

  const primaryCtaLabel = generating
    ? voiceFeatureEnabled && hasScript && scriptAudioLoading
      ? "AI 真人語音生成中…"
      : "準備中…"
    : ready
      ? voiceFeatureEnabled
        ? homeAnchorPlaying
          ? "🎙 播放中…"
          : anchorAudioReady
            ? displayScriptSource === "server" && radioSlot === "evening"
              ? "▶ 播放晚報 AI 真人語音"
              : displayScriptSource === "server"
                ? "▶ 播放早報 AI 真人語音"
                : "▶ 播放 AI 真人語音"
            : proAudioPreparing
              ? "AI 真人語音生成中…"
              : displayScriptSource === "manual"
                ? "🎙️ 生成這篇 AI 真人語音"
                : "🎙️ 生成 AI 真人語音"
        : "▶ 立即播放"
      : "立即生成";

  const playDisabled =
    generating ||
    (voiceFeatureEnabled && ready && !anchorAudioReady && scriptAudioLoading);

  const shortUserId = supabaseUserId
    ? `${supabaseUserId.slice(0, 8)}…`
    : "—";
  const debugLine = scriptQueryDebug
    ? `查詢 ${scriptQueryDebug.scriptDate} · ${scriptQueryDebug.rowCount} 筆 · ${scriptQueryDebug.status ?? "無"} · ${scriptQueryDebug.generationSource ?? "—"} · ${scriptQueryDebug.radioSlot ?? "—"}`
    : serverSyncState === "loading"
      ? "同步中…"
      : "尚未查詢";

  if (import.meta.env.DEV && serverConfigured) {
    console.log("[Hero Debug]", {
      userId: supabaseUserId,
      serverSyncState,
      debugLine,
    });
  }

  return (
    <section style={styles.stationHero}>
      <div style={styles.stationHeroGlow} aria-hidden />
      <div style={styles.stationHeroKicker}>你的專屬 AI 電台</div>
      <h2 style={styles.stationHeroTitle}>{title}</h2>
      <p style={styles.stationHeroBody}>{body}</p>
      <div style={styles.stationHeroMeta}>
        {generationSource === "server"
          ? "伺服器已生成"
          : generationSource === "app"
            ? "本機已生成"
            : serverConfigured
              ? serverSyncState === "loading"
                ? "同步稿件中"
                : serverSyncState === "not_found"
                  ? "此裝置尚無今日稿件"
                  : serverSyncState === "no_user"
                    ? "未登入 Supabase"
                    : "等待伺服器或手動生成"
              : "本機 fallback"}{" "}
        · {slotLabel} · 手動重新生成剩餘 {aiQuotaRemaining} / {aiDailyLimit} 次 · {isPro ? "Pro" : "Free"}
      </div>
      {import.meta.env.DEV && serverConfigured ? (
        <div style={styles.stationHeroDebug} aria-label="Supabase 除錯資訊">
          Debug · user {shortUserId} · sync {serverSyncState} · {debugLine}
        </div>
      ) : null}
      <button
        type="button"
        onClick={ready ? onPlayNow : onStartDaily}
        disabled={playDisabled}
        style={{
          ...styles.stationHeroCta,
          opacity: playDisabled ? 0.6 : 1,
          cursor: playDisabled ? "not-allowed" : "pointer",
        }}
      >
        {primaryCtaLabel}
      </button>
      {ready && voiceFeatureEnabled && anchorAudioReady ? (
        <div style={styles.stationHeroPlaySubtitle}>
          {displayScriptSource === "server" && radioSlot === "evening"
            ? `🎧 晚報 AI 音訊已就緒 · ${anchorName} · ${duration} 分鐘 · ${anchorSpeedLabel}`
            : displayScriptSource === "server"
              ? `🎧 早報 AI 音訊已就緒 · ${anchorName} · ${duration} 分鐘 · ${anchorSpeedLabel}`
              : `🎧 這篇 AI 音訊已就緒 · ${anchorName} · ${duration} 分鐘 · ${anchorSpeedLabel}`}
          <br />
          語速可到播放頁或設定頁調整
        </div>
      ) : ready && voiceFeatureEnabled && !anchorAudioReady && !scriptAudioLoading && displayScriptSource === "manual" ? (
        <div style={styles.stationHeroPlaySubtitle}>
          新稿尚未生成 AI 真人語音，點上方按鈕開始生成
        </div>
      ) : null}
      {ready && voiceFeatureEnabled && scriptAudioStaleReason ? (
        <button
          type="button"
          onClick={onRegenerateAnchor}
          disabled={generating || scriptAudioLoading}
          style={styles.stationHeroSecondaryCta}
        >
          重新生成 AI 主播
        </button>
      ) : ready ? (
        <button
          type="button"
          onClick={onRegenerate}
          disabled={generating || selectedCount === 0}
          style={styles.stationHeroSecondaryCta}
        >
          {isPro ? "重新生成 / 更長版本" : "重新生成（消耗 AI 次數）"}
        </button>
      ) : showRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          disabled={loadingNews}
          style={styles.stationHeroSecondaryCta}
        >
          {loadingNews ? "重新整理中…" : "重新整理"}
        </button>
      ) : null}
      <div style={styles.stationHeroActions}>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loadingNews}
          style={styles.stationHeroGhostBtn}
        >
          {loadingNews ? "更新中…" : "更新新聞"}
        </button>
        <button type="button" onClick={onSettingsTopics} style={styles.stationHeroGhostBtn}>
          設定主題
        </button>
      </div>
    </section>
  );
}

function SettingsSummaryGrid({
  isPro,
  aiQuotaRemaining,
  aiDailyLimit,
  topicCount,
  topicLimit,
  keywordCount,
  keywordLimit,
  totalTrackingCount,
  totalTrackingLimit,
  historyDays,
  voiceLabel,
  speed,
}: {
  isPro: boolean;
  aiQuotaRemaining: number;
  aiDailyLimit: number;
  topicCount: number;
  topicLimit: number;
  keywordCount: number;
  keywordLimit: number;
  totalTrackingCount: number;
  totalTrackingLimit: number;
  historyDays: number;
  voiceLabel: string;
  speed: number;
}) {
  const cards = [
    {
      title: "Pro 方案",
      lines: [
        isPro ? "目前 Pro" : "Free 方案",
        `今日剩餘 ${aiQuotaRemaining} / ${aiDailyLimit} 次`,
        isPro ? "無廣告閱讀體驗" : "顯示推薦 App / 廣告",
      ],
    },
    {
      title: "追蹤主題",
      lines: [
        `主題 ${topicCount} / ${topicLimit}`,
        `自訂關鍵字 ${keywordCount} / ${keywordLimit}`,
        `總追蹤 ${totalTrackingCount} / ${totalTrackingLimit}`,
      ],
    },
    {
      title: "AI 歷史",
      lines: [`最近 ${historyDays} 天`, "設定頁可展開查看"],
    },
    {
      title: "播放設定",
      lines: [`語音：${voiceLabel}`, `語速：${speed.toFixed(2)}x`],
    },
  ];
  return (
    <div style={styles.settingsSummaryGrid}>
      {cards.map((c) => (
        <div key={c.title} style={styles.settingsSummaryCard}>
          <div style={styles.settingsSummaryCardTitle}>{c.title}</div>
          {c.lines.map((line) => (
            <div key={line} style={styles.settingsSummaryCardLine}>
              {line}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function SettingsCollapsible({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section style={styles.settingsCollapseSection}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={styles.settingsCollapseHead}
        aria-expanded={open}
      >
        <div style={{ minWidth: 0, textAlign: "left" }}>
          <div style={styles.settingsCollapseTitle}>{title}</div>
          {subtitle ? <div style={styles.settingsCollapseSub}>{subtitle}</div> : null}
        </div>
        <span style={styles.settingsCollapseChevron}>{open ? "▲" : "▼"}</span>
      </button>
      {open ? <div style={styles.settingsCollapseBody}>{children}</div> : null}
    </section>
  );
}

function FavoritesTabView({
  aiFavorites,
  favoriteNews,
  onLoadAiFavorite,
  onCopyAiFavorite,
  onRemoveAiFavorite,
  toggleNews,
  toggleFavorite,
}: {
  aiFavorites: AiFavoriteEntry[];
  favoriteNews: NewsItem[];
  onLoadAiFavorite: (fav: AiFavoriteEntry) => void;
  onCopyAiFavorite: (fav: AiFavoriteEntry) => void;
  onRemoveAiFavorite: (id: string) => void;
  toggleNews: (id: string) => void;
  toggleFavorite: (item: NewsItem) => void;
}) {
  const [segment, setSegment] = useState<"ai" | "news">("ai");
  return (
    <>
      <div style={styles.favSegmented} role="tablist" aria-label="收藏類型">
        <button
          type="button"
          role="tab"
          aria-selected={segment === "ai"}
          onClick={() => setSegment("ai")}
          style={{
            ...styles.favSegmentBtn,
            ...(segment === "ai" ? styles.favSegmentBtnActive : {}),
          }}
        >
          AI 新聞稿
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={segment === "news"}
          onClick={() => setSegment("news")}
          style={{
            ...styles.favSegmentBtn,
            ...(segment === "news" ? styles.favSegmentBtnActive : {}),
          }}
        >
          收藏新聞
        </button>
      </div>
      {segment === "ai" ? (
        <AiFavoritesSection
          favorites={aiFavorites}
          onOpen={onLoadAiFavorite}
          onPlay={onLoadAiFavorite}
          onCopy={onCopyAiFavorite}
          onToggle={onRemoveAiFavorite}
        />
      ) : (
        <NewsList
          title="收藏新聞"
          news={favoriteNews}
          loading={false}
          toggleNews={toggleNews}
          toggleFavorite={toggleFavorite}
          emptyText="目前沒有收藏新聞"
          emptyHint="看到重要新聞時，點星星即可收藏"
        />
      )}
    </>
  );
}

function AiSummaryPanel({
  variant = "full",
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
  voiceFeatureEnabled = false,
  anchor,
  anchorStyle,
  anchorPlaybackRate = 1.0,
  onAnchorPlaybackRateChange,
  anchorVolumeGain = 1.5,
  onAnchorVolumeGainChange,
  scriptAudioUrl = null,
  scriptAudioLoading = false,
  scriptAudioError = null,
  scriptAudioStaleReason = null,
  onGenerateScriptAudio,
  anchorAudioReady = false,
  onRegenerateAnchor,
  displayScriptSource = "manual",
  radioSlot = null,
}: {
  variant?: "home" | "player" | "full";
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
  voiceFeatureEnabled?: boolean;
  anchor?: AiAnchorVoice;
  anchorStyle?: AiAnchorStyle;
  anchorPlaybackRate?: AiAnchorPlaybackRate;
  onAnchorPlaybackRateChange?: (rate: AiAnchorPlaybackRate) => void;
  anchorVolumeGain?: AiAnchorVolumeGain;
  onAnchorVolumeGainChange?: (gain: AiAnchorVolumeGain) => void;
  scriptAudioUrl?: string | null;
  scriptAudioLoading?: boolean;
  scriptAudioError?: string | null;
  scriptAudioStaleReason?: ScriptAudioStaleReason;
  onGenerateScriptAudio?: () => void;
  anchorAudioReady?: boolean;
  onRegenerateAnchor?: () => void;
  displayScriptSource?: import("./scriptAudioBinding").DisplayScriptSource;
  radioSlot?: import("./radioSlot").RadioSlot | null;
}) {
  const scriptFontPx = SCRIPT_FONT_PX[scriptFontSize];
  const playbackActive = isSpeaking || isPaused;
  const hasContent = aiScript.trim().length > 0 || aiHighlights.length > 0;
  const isHome = variant === "home";
  const isPlayer = variant === "player";
  const [playerScriptOpen, setPlayerScriptOpen] = useState(true);
  const audioReadyLabel =
    displayScriptSource === "server" && radioSlot === "evening"
      ? "🎧 晚報 AI 音訊已就緒"
      : displayScriptSource === "server"
        ? "🎧 早報 AI 音訊已就緒"
        : "🎧 這篇 AI 音訊已就緒";
  const audioReadyLabelWithRate = `${audioReadyLabel} · ${formatAnchorPlaybackRate(anchorPlaybackRate)}`;
  const audioGenerateLabel = "🎙️ 生成這篇 AI 真人語音";
  const audioLoadingLabel = "AI 真人語音生成中…";

  if (isHome && !aiLoading && !aiError && !hasContent) {
    return null;
  }
  if (isPlayer && !aiLoading && !aiError && !hasContent) {
    return null;
  }

  const kickerLabel = isHome || isPlayer ? "今日新聞台" : "AI 分析";

  const inner = (
    <>
        <div style={styles.aiSummaryHeaderRow}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={styles.aiSummaryKicker}>{kickerLabel}</span>
            {!isPlayer ? (
            <span style={styles.aiQuotaLine}>
              今日剩餘 {aiQuotaRemaining} / {aiDailyLimit} 次（{isPro ? "Pro" : "Free"}）
            </span>
            ) : null}
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
            {aiHighlights.length > 0 && !isPlayer ? (
              <CollapsibleHighlightsSection highlights={aiHighlights} />
            ) : null}
            {aiScript.trim() ? (
              <div style={styles.aiScriptSectionPrimary}>
                <div style={styles.aiScriptSectionHead}>
                  <div style={styles.aiScriptTitleRow}>
                    <span style={styles.aiScriptTitle}>AI 主播稿</span>
                    {!isPlayer ? (
                      <span style={styles.aiScriptPrimaryBadge}>主要內容</span>
                    ) : null}
                  </div>
                  {!isPlayer ? (
                  <ScriptFontSizeControl
                    value={scriptFontSize}
                    onChange={onScriptFontSizeChange}
                  />
                  ) : null}
                </div>
                <div style={styles.aiScriptActions}>
                  {!isPlayer && hasContent ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (playbackActive) {
                          onStopScript();
                          return;
                        }
                        const s = aiScript.trim();
                        if (!s) {
                          alert("尚無 AI 主播稿可播放");
                          return;
                        }
                        onPlayScript(s);
                      }}
                      style={styles.aiScriptPlayBtn}
                    >
                      {playbackActive ? "停止播放" : "▶ 播放稿件"}
                    </button>
                  ) : null}
                  {isHome && voiceFeatureEnabled && scriptAudioStaleReason ? (
                    <button
                      type="button"
                      onClick={() => onRegenerateAnchor?.()}
                      disabled={scriptAudioLoading}
                      style={styles.aiScriptPlayBtn}
                    >
                      {scriptAudioLoading ? "準備中…" : "重新生成 AI 主播"}
                    </button>
                  ) : null}
                  {isHome && voiceFeatureEnabled && anchorAudioReady ? (
                    <span style={styles.aiAnchorReadyHint}>{audioReadyLabelWithRate}</span>
                  ) : null}
                  {isHome && voiceFeatureEnabled && scriptAudioLoading && !anchorAudioReady ? (
                    <span style={styles.aiAnchorReadyHint}>{audioLoadingLabel}</span>
                  ) : null}
                  {isHome && voiceFeatureEnabled && !anchorAudioReady && !scriptAudioLoading && hasContent && onGenerateScriptAudio ? (
                    <button
                      type="button"
                      onClick={() => onGenerateScriptAudio()}
                      style={styles.aiScriptPlayBtn}
                    >
                      {audioGenerateLabel}
                    </button>
                  ) : null}
                  {isHome && voiceFeatureEnabled && scriptAudioError && !scriptAudioLoading ? (
                    <span style={styles.aiSummaryError}>{scriptAudioError}</span>
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
        ) : isHome ? null : (
          <div style={styles.aiHintMuted}>
            勾選新聞後可手動重新生成，選擇 3／5／10／15 分鐘。
          </div>
        )}

        {!aiLoading && selectedNewsCount > 0 && !isPlayer ? (
          <button
            type="button"
            onClick={onOpenAnalysis}
            style={styles.aiPanelRegenerateBtn}
          >
            重新產生
          </button>
        ) : null}
    </>
  );

  if (isPlayer) {
    return (
      <div style={styles.aiSummaryWrapPlayer}>
        <button
          type="button"
          onClick={() => setPlayerScriptOpen((v) => !v)}
          style={styles.playerScriptToggle}
        >
          <span>主播稿與操作</span>
          <span>{playerScriptOpen ? "收合 ▲" : "展開 ▼"}</span>
        </button>
        {playerScriptOpen ? (
          <div style={styles.aiSummaryCard}>{inner}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div style={styles.aiSummaryWrap}>
      <div style={styles.aiSummaryCard}>{inner}</div>
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
        <div style={styles.aiSheetTitle}>選擇新聞稿長度</div>
        <p style={styles.aiSheetDesc}>
          打開 App 生成 3 分鐘早報；手動重新生成可選更長版本（消耗 AI 次數）
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
          {AI_DURATIONS.map((d) => {
            const locked = isProDuration(d) && !isPro;
            const badge = d === 5 ? "推薦" : d >= 10 ? "Pro" : null;
            return (
              <button
                key={d}
                type="button"
                disabled={loading}
                className="ai-duration-option"
                onClick={() => {
                  if (locked) {
                    onClose();
                    onOpenProModal("pro_duration");
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
                  {badge ? (
                    <span style={styles.proLockTag}>{locked ? "Pro 專屬" : badge}</span>
                  ) : null}
                </span>
                <span style={styles.aiSheetOptionSub}>{durationOptionSubtitle(d)}</span>
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
  hidden = false,
}: {
  tab: BottomNavTab;
  setTab: (t: BottomNavTab) => void;
  hidden?: boolean;
}) {
  if (hidden) return null;

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
        <div style={styles.emptyStateBox}>
          <div>尚未收藏 AI 新聞稿</div>
          <div style={styles.emptyStateHint}>產生新聞稿後可點「收藏 AI 稿」保存</div>
        </div>
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

function NewsList({
  title,
  news,
  totalNewsCount,
  loading,
  newsFetchStatus,
  toggleNews,
  toggleFavorite,
  emptyText = "沒有新聞",
  compact = false,
  denseCards = false,
  isPro = false,
  topicSections,
  homeToolbar,
  playingIndex = -1,
  emptyHint,
  onRefreshNews,
  onSettingsTopics,
  scrollRootRef,
}: {
  title: string;
  news: NewsItem[];
  totalNewsCount?: number;
  loading: boolean;
  newsFetchStatus?: import("./dailyRadio").NewsFetchStatus;
  toggleNews: (id: string) => void;
  toggleFavorite: (item: NewsItem) => void;
  emptyText?: string;
  compact?: boolean;
  denseCards?: boolean;
  isPro?: boolean;
  topicSections?: TopicNewsSection[];
  homeToolbar?: {
    selectAll: () => void;
    clearAll: () => void;
    lastUpdated: string;
  };
  playingIndex?: number;
  emptyHint?: string;
  onRefreshNews?: () => void;
  onSettingsTopics?: () => void;
  scrollRootRef?: RefObject<HTMLElement | null>;
}) {
  const resolvedTotalNewsCount = totalNewsCount ?? news.length;
  const globalEmptyText =
    newsFetchStatus === "empty"
      ? "目前沒有抓到符合主題的新聞"
      : newsFetchStatus === "timeout"
        ? "新聞讀取失敗，請稍後再試"
        : newsFetchStatus === "error"
          ? "新聞讀取失敗，請點重新整理"
          : emptyText;
  const selectedCount = news.filter((n) => n.selected).length;
  const allSelected = news.length > 0 && selectedCount === news.length;
  const newsById = useMemo(() => new Map(news.map((n) => [n.id, n])), [news]);
  const selectedBreakdown =
    topicSections && topicSections.length > 0
      ? buildSelectedTopicSummary(topicSections, news)
      : "";
  const groupedMode = topicSections != null && topicSections.length > 0;
  const topicNavItems = useMemo(() => {
    if (!topicSections || topicSections.length === 0) return [];
    return topicSections.map((section) => ({
      label: section.label,
      count: section.itemIds.filter((id) => newsById.has(id)).length,
    }));
  }, [topicSections, newsById]);

  const renderNewsCard = (item: NewsItem, index: number) => (
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

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.newsTopicBadgeRow}>
          {!groupedMode
            ? item.matchedTopics.slice(0, 3).map((tag) => (
                <span key={`${item.id}-${tag}`} style={styles.newsTopicBadge}>
                  {tag}
                </span>
              ))
            : null}
        </div>
        <div
          style={{
            ...styles.newsTitle,
            ...(denseCards ? styles.newsTitleClamp : {}),
          }}
        >
          {item.title}
        </div>

        <div style={styles.newsMeta}>
          <span style={styles.newsSource}>{item.source}</span>

          <div style={styles.newsMetaActions}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFavorite(item);
              }}
              style={styles.favoriteButton}
              aria-label={item.favorite ? "取消收藏" : "收藏"}
            >
              {item.favorite ? "★" : "☆"}
            </button>

            <a
              href={item.link}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={styles.newsLinkSubtle}
            >
              原文
            </a>
          </div>
        </div>
      </div>
    </article>
  );

  return (
    <>
      {homeToolbar ? (
        <div style={styles.homeNewsMiniToolbar}>
          <div className="hide-scrollbar" style={styles.homeNewsMiniStatsScroll}>
            <span style={styles.homeNewsMiniStatsText}>
              已選 {selectedCount} 則
              {selectedBreakdown ? `｜${selectedBreakdown}` : ""}
            </span>
          </div>
          <div style={styles.homeNewsMiniActions}>
            <button
              type="button"
              onClick={homeToolbar.selectAll}
              style={{
                ...styles.homeNewsMiniTextBtn,
                ...(allSelected ? styles.homeNewsMiniTextBtnActive : {}),
              }}
            >
              全選
            </button>
            <button
              type="button"
              onClick={homeToolbar.clearAll}
              style={styles.homeNewsMiniTextBtn}
            >
              清除
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            ...styles.sectionHeader,
            ...(compact ? styles.sectionHeaderCompact : {}),
          }}
        >
          <h2
            style={{
              ...styles.sectionTitle,
              ...(compact ? styles.sectionTitleCompact : {}),
            }}
          >
            {title}
          </h2>
          <span style={styles.countText}>{news.length} 則</span>
        </div>
      )}

      {!loading && groupedMode && topicNavItems.length > 0 ? (
        <TopicQuickNavBar items={topicNavItems} scrollRootRef={scrollRootRef} />
      ) : null}

      {loading && (
        <div style={homeToolbar ? styles.loadingSlim : styles.loading}>
          {newsFetchStatus === "loading" ? "正在讀取新聞…" : "新聞讀取中…"}
        </div>
      )}

      {!loading && resolvedTotalNewsCount === 0 && (
        <div style={styles.emptyStateBox}>
          <div>{globalEmptyText}</div>
          {emptyHint ? <div style={styles.emptyStateHint}>{emptyHint}</div> : null}
          {newsFetchStatus === "empty" ||
          newsFetchStatus === "error" ||
          newsFetchStatus === "timeout" ? (
            <div style={styles.emptyStateActions}>
              {onRefreshNews ? (
                <button type="button" onClick={onRefreshNews} style={styles.emptyStateBtn}>
                  重新整理
                </button>
              ) : null}
              {onSettingsTopics ? (
                <button type="button" onClick={onSettingsTopics} style={styles.emptyStateBtn}>
                  修改主題
                </button>
              ) : null}
            </div>
          ) : null}
          {newsFetchStatus === "empty" ? (
            <div style={styles.emptyStateHint}>也可在上方搜尋框手動輸入關鍵字後按「更新」</div>
          ) : null}
        </div>
      )}

      {!loading && resolvedTotalNewsCount > 0 && groupedMode ? (
        <div style={homeToolbar ? styles.topicNewsGroupsHome : styles.topicNewsGroups}>
          {topicSections!.map((section) => {
            const sectionItems = section.itemIds
              .map((id) => newsById.get(id))
              .filter((item): item is NewsItem => item != null);
            return (
              <section
                key={section.label}
                id={getTopicSectionDomId(section.label)}
                data-topic-label={section.label}
                style={{
                  ...styles.topicNewsGroup,
                  scrollMarginTop: "var(--pns-topic-scroll-margin, 96px)",
                }}
              >
                <div style={styles.topicNewsGroupHeader}>
                  <span style={styles.topicNewsGroupTitle}>
                    {section.icon ? `${section.icon} ` : ""}
                    {section.label}
                  </span>
                  <span style={styles.topicNewsGroupCount}>{sectionItems.length} 則</span>
                </div>
                {sectionItems.length === 0 ? (
                  <div style={styles.topicNewsGroupEmpty}>此分類目前沒有新聞</div>
                ) : (
                  <div style={denseCards ? styles.newsListDense : styles.newsList}>
                    {sectionItems.map((item) => {
                      const globalIndex = news.findIndex((n) => n.id === item.id);
                      return renderNewsCard(item, globalIndex >= 0 ? globalIndex : 0);
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : !loading && resolvedTotalNewsCount > 0 ? (
        <div style={denseCards ? styles.newsListDense : styles.newsList}>
          {news.map((item, index) => renderNewsCard(item, index))}
        </div>
      ) : null}
    </>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: "100%",
    height: "100%",
    minHeight: "100%",
    margin: 0,
    padding: 0,
    overflowX: "hidden",
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    background: TOKENS.bgPage,
    color: TOKENS.textPrimary,
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
  stationHero: {
    position: "relative",
    marginTop: "10px",
    marginBottom: "14px",
    padding: "18px 16px",
    borderRadius: TOKENS.radiusLg,
    background: TOKENS.cardBg,
    border: `1px solid ${TOKENS.cardBorder}`,
    boxShadow: "0 12px 36px rgba(0,0,0,.28)",
    overflow: "hidden",
  },
  stationHeroGlow: {
    position: "absolute",
    top: -40,
    right: -30,
    width: 140,
    height: 140,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(99,102,241,.2) 0%, transparent 70%)",
    pointerEvents: "none",
  },
  stationHeroKicker: {
    fontSize: "12px",
    fontWeight: 800,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "#818CF8",
    marginBottom: "6px",
  },
  stationHeroTitle: {
    margin: 0,
    fontSize: "18px",
    fontWeight: 900,
    color: TOKENS.textPrimary,
    lineHeight: 1.25,
  },
  stationHeroBody: {
    margin: "10px 0 0",
    fontSize: "14px",
    color: "#CBD5E1",
    lineHeight: 1.45,
  },
  stationHeroMeta: {
    marginTop: "10px",
    fontSize: "12px",
    fontWeight: 700,
    color: TOKENS.textMuted,
  },
  stationHeroDebug: {
    marginTop: "8px",
    padding: "8px 10px",
    borderRadius: "8px",
    background: "rgba(15,23,42,.55)",
    border: `1px dashed ${TOKENS.cardBorder}`,
    fontSize: "11px",
    fontWeight: 600,
    color: "#94A3B8",
    lineHeight: 1.45,
    wordBreak: "break-all" as const,
  },
  stationHeroCta: {
    display: "block",
    width: "100%",
    marginTop: "14px",
    padding: "14px 16px",
    border: "none",
    borderRadius: TOKENS.radiusMd,
    background: TOKENS.ctaGreen,
    color: "#022C22",
    fontSize: "16px",
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 8px 24px rgba(16,185,129,.28)",
  },
  stationHeroPlaySubtitle: {
    marginTop: "8px",
    fontSize: "13px",
    fontWeight: 700,
    color: "#99F6E4",
    textAlign: "center",
    lineHeight: 1.45,
  },
  stationHeroSecondaryCta: {
    display: "block",
    width: "100%",
    marginTop: "10px",
    padding: "12px 16px",
    border: "1px solid rgba(129,140,248,.45)",
    borderRadius: TOKENS.radiusMd,
    background: "rgba(99,102,241,.2)",
    color: "#E0E7FF",
    fontSize: "14px",
    fontWeight: 800,
    cursor: "pointer",
  },
  stationHeroHint: {
    margin: "10px 0 0",
    fontSize: "12px",
    color: TOKENS.textMuted,
    textAlign: "center",
  },
  stationHeroActions: {
    display: "flex",
    gap: "8px",
    marginTop: "12px",
  },
  stationHeroGhostBtn: {
    flex: 1,
    padding: "10px 12px",
    borderRadius: TOKENS.radiusMd,
    border: `1px solid ${TOKENS.cardBorder}`,
    background: "rgba(255,255,255,.06)",
    color: TOKENS.textSecondary,
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
  },
  settingsSummaryGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "10px",
    marginBottom: "12px",
  },
  settingsSummaryCard: {
    padding: "12px",
    borderRadius: TOKENS.radiusMd,
    background: TOKENS.cardBg,
    border: `1px solid ${TOKENS.cardBorder}`,
    minHeight: 88,
  },
  settingsSummaryCardTitle: {
    fontSize: "13px",
    fontWeight: 900,
    color: "#A5B4FC",
    marginBottom: "8px",
  },
  settingsSummaryCardLine: {
    fontSize: "11px",
    color: TOKENS.textSecondary,
    lineHeight: 1.4,
    fontWeight: 600,
  },
  settingsCollapseSection: {
    marginBottom: "10px",
    borderRadius: TOKENS.radiusMd,
    background: "rgba(15,23,42,.55)",
    border: `1px solid ${TOKENS.cardBorder}`,
    overflow: "hidden",
  },
  settingsCollapseHead: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    padding: "14px 14px",
    border: "none",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
  },
  settingsCollapseTitle: {
    fontSize: "15px",
    fontWeight: 800,
    color: TOKENS.textPrimary,
  },
  settingsCollapseSub: {
    marginTop: "4px",
    fontSize: "12px",
    color: TOKENS.textMuted,
    fontWeight: 600,
  },
  settingsCollapseChevron: {
    fontSize: "12px",
    color: TOKENS.textSecondary,
    flexShrink: 0,
  },
  settingsCollapseBody: {
    padding: "0 14px 14px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  favSegmented: {
    display: "flex",
    gap: "8px",
    marginBottom: "12px",
    padding: "4px",
    borderRadius: TOKENS.radiusMd,
    background: "rgba(15,23,42,.6)",
    border: `1px solid ${TOKENS.cardBorder}`,
  },
  favSegmentBtn: {
    flex: 1,
    padding: "10px 12px",
    border: "none",
    borderRadius: "10px",
    background: "transparent",
    color: TOKENS.textSecondary,
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
  },
  favSegmentBtnActive: {
    background: "rgba(99,102,241,.28)",
    color: "#E0E7FF",
    fontWeight: 800,
  },
  emptyStateBox: {
    padding: "20px 16px",
    textAlign: "center",
    color: TOKENS.textSecondary,
    fontSize: "14px",
    fontWeight: 700,
    lineHeight: 1.5,
    borderRadius: TOKENS.radiusMd,
    background: "rgba(255,255,255,.04)",
    border: `1px dashed ${TOKENS.cardBorder}`,
  },
  emptyStateHint: {
    marginTop: "8px",
    fontSize: "12px",
    color: TOKENS.textMuted,
    fontWeight: 600,
  },
  emptyStateActions: {
    display: "flex",
    flexWrap: "wrap" as const,
    justifyContent: "center",
    gap: "8px",
    marginTop: "12px",
  },
  emptyStateBtn: {
    padding: "8px 14px",
    borderRadius: "10px",
    border: `1px solid ${TOKENS.cardBorder}`,
    background: "rgba(99,102,241,.18)",
    color: "#E0E7FF",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
  },
  homeNewsSelected: {
    fontSize: "12px",
    fontWeight: 800,
    color: "#A7F3D0",
  },
  homeNewsSelectedBreakdown: {
    fontSize: "11px",
    fontWeight: 600,
    color: "#94A3B8",
    lineHeight: 1.35,
    textAlign: "right",
    maxWidth: "100%",
    wordBreak: "break-word",
  },
  topicNewsGroups: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    marginTop: "4px",
  },
  topicNewsGroupsHome: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    marginTop: "4px",
    paddingBottom: "calc(96px + env(safe-area-inset-bottom, 0px))",
  },
  homeScriptSlotWrap: {
    marginTop: "8px",
    marginBottom: "10px",
  },
  topicNewsGroup: {
    borderRadius: "14px",
    padding: "10px 10px 8px",
    background: "rgba(15,23,42,.35)",
    border: "1px solid rgba(148,163,184,.14)",
  },
  topicNewsGroupHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    marginBottom: "8px",
    padding: "0 2px",
  },
  topicNewsGroupTitle: {
    fontSize: "13px",
    fontWeight: 800,
    color: "#E2E8F0",
  },
  topicNewsGroupCount: {
    fontSize: "11px",
    fontWeight: 700,
    color: "#64748B",
    flexShrink: 0,
  },
  topicNewsGroupEmpty: {
    fontSize: "12px",
    lineHeight: 1.45,
    color: "#64748B",
    padding: "10px 8px",
    borderRadius: "10px",
    background: "rgba(255,255,255,.03)",
    border: "1px dashed rgba(148,163,184,.18)",
  },
  newsTopicBadgeRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px",
    marginBottom: "4px",
  },
  newsTopicBadge: {
    fontSize: "10px",
    fontWeight: 800,
    color: "#BFDBFE",
    background: "rgba(59,130,246,.16)",
    border: "1px solid rgba(96,165,250,.28)",
    borderRadius: "999px",
    padding: "2px 7px",
    lineHeight: 1.3,
  },
  aiSummaryWrapPlayer: {
    marginTop: "8px",
    marginBottom: "8px",
    minWidth: 0,
  },
  playerScriptToggle: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
    marginBottom: "6px",
    borderRadius: TOKENS.radiusMd,
    border: `1px solid ${TOKENS.cardBorder}`,
    background: "rgba(255,255,255,.05)",
    color: TOKENS.textSecondary,
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  playerVoiceToggle: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "10px",
    padding: "10px 12px",
    borderRadius: TOKENS.radiusMd,
    border: `1px solid ${TOKENS.cardBorder}`,
    background: "rgba(255,255,255,.05)",
    color: TOKENS.textSecondary,
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  playerProgressTrackLarge: {
    height: "8px",
    borderRadius: "999px",
    background: "rgba(255,255,255,.12)",
    overflow: "hidden",
    marginBottom: "14px",
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
  homeNewsMiniToolbar: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginTop: "4px",
    marginBottom: "8px",
    padding: "0 10px",
    minHeight: "44px",
    maxHeight: "56px",
    height: "48px",
    boxSizing: "border-box",
    background: "rgba(15,23,42,.42)",
    border: "1px solid rgba(148,163,184,.16)",
    borderRadius: "10px",
  },
  homeNewsMiniStatsScroll: {
    flex: "1 1 auto",
    minWidth: 0,
    overflowX: "auto",
    overflowY: "hidden",
    WebkitOverflowScrolling: "touch",
    display: "flex",
    alignItems: "center",
  },
  homeNewsMiniStatsText: {
    fontSize: "12px",
    fontWeight: 700,
    color: "#CBD5E1",
    whiteSpace: "nowrap",
    lineHeight: 1.2,
  },
  homeNewsMiniActions: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    gap: "10px",
    paddingLeft: "8px",
    borderLeft: "1px solid rgba(148,163,184,.14)",
  },
  homeNewsMiniTextBtn: {
    border: "none",
    background: "transparent",
    padding: "4px 2px",
    fontSize: "12px",
    fontWeight: 700,
    color: "#94A3B8",
    cursor: "pointer",
    whiteSpace: "nowrap",
    WebkitTapHighlightColor: "transparent",
  },
  homeNewsMiniTextBtnActive: {
    color: "#E2E8F0",
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
  aiHistoryPanelCollapsed: {
    padding: "10px 12px",
    marginBottom: "10px",
  },
  aiHistoryCollapseToggle: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    width: "100%",
    minHeight: "52px",
    maxHeight: "72px",
    padding: 0,
    margin: 0,
    border: "none",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    textAlign: "left",
  },
  aiHistoryCollapseToggleText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
    flex: 1,
  },
  aiHistoryCollapseSub: {
    fontSize: "12px",
    color: "#64748B",
    lineHeight: 1.35,
  },
  aiHistoryCollapseAction: {
    flexShrink: 0,
    fontSize: "12px",
    fontWeight: 800,
    color: "#94A3B8",
  },
  aiHistoryExpandedBody: {
    marginTop: "12px",
    paddingTop: "12px",
    borderTop: "1px solid rgba(255,255,255,.08)",
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
  settingHintMuted: {
    color: "#94A3B8",
    fontSize: "12px",
    lineHeight: 1.45,
    marginTop: "4px",
    marginBottom: "8px",
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
  settingLabel: {
    display: "block",
    marginTop: "12px",
    fontSize: "13px",
    fontWeight: 700,
    color: "#CBD5E1",
  },
  settingInput: {
    width: "100%",
    boxSizing: "border-box",
    background: "rgba(255,255,255,.08)",
    color: "white",
    border: "1px solid rgba(255,255,255,.12)",
    outline: "none",
    fontSize: "16px",
    lineHeight: 1.35,
    padding: "12px",
    borderRadius: "14px",
    marginTop: "8px",
    WebkitTextSizeAdjust: "100%",
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
  aiAnchorReadyHint: {
    fontSize: "12px",
    fontWeight: 700,
    color: "#5EEAD4",
    padding: "9px 4px",
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
  scriptAudioSection: {
    marginBottom: "12px",
    padding: "12px",
    borderRadius: "14px",
    background: "rgba(255,255,255,.04)",
    border: "1px solid rgba(255,255,255,.08)",
  },
  scriptAudioTitle: {
    fontSize: "13px",
    fontWeight: 800,
    color: "#E2E8F0",
    marginBottom: "4px",
  },
  scriptAudioHint: {
    fontSize: "11px",
    color: "#94A3B8",
    lineHeight: 1.4,
    marginBottom: "8px",
  },
  scriptAudioBtn: {
    background: "linear-gradient(135deg, #0D9488, #0891B2)",
    color: "white",
    border: "none",
    borderRadius: "12px",
    padding: "9px 14px",
    fontWeight: 800,
    fontSize: "12px",
    cursor: "pointer",
  },
  scriptAudioLoading: {
    fontSize: "13px",
    color: "#94A3B8",
    lineHeight: 1.5,
  },
  scriptAudioError: {
    marginTop: "8px",
    fontSize: "12px",
    color: "#FCA5A5",
    lineHeight: 1.45,
  },
  scriptAudioPlayer: {
    width: "100%",
    marginTop: "4px",
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
  newsList: { display: "flex", flexDirection: "column", gap: "12px" },
  newsListDense: { display: "flex", flexDirection: "column", gap: "10px" },
  newsCard: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    background: TOKENS.cardBg,
    border: `1px solid ${TOKENS.cardBorder}`,
    borderRadius: TOKENS.radiusLg,
    padding: "14px",
    cursor: "pointer",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
  },
  newsCardDense: {
    padding: "12px",
    borderRadius: TOKENS.radiusMd,
  },
  newsCardActive: {
    background: "rgba(37,99,235,.22)",
    border: `1px solid ${TOKENS.cardBorderActive}`,
    boxShadow: TOKENS.glowSelected,
  },
  newsTitleClamp: {
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  newsSource: {
    fontSize: "11px",
    color: TOKENS.textMuted,
    fontWeight: 600,
  },
  newsMetaActions: {
    display: "flex",
    gap: 8,
    alignItems: "center",
  },
  newsLinkSubtle: {
    fontSize: "11px",
    color: "#64748B",
    textDecoration: "none",
    padding: "2px 8px",
    borderRadius: "6px",
    border: "1px solid rgba(255,255,255,.08)",
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
  playerVoicePrimary: {
    marginTop: "4px",
    marginBottom: "12px",
  },
  anchorFallbackHint: {
    marginTop: "8px",
    padding: "10px 12px",
    borderRadius: "12px",
    background: "rgba(251,191,36,.1)",
    border: "1px solid rgba(251,191,36,.25)",
    fontSize: "13px",
    fontWeight: 700,
    color: "#FCD34D",
    lineHeight: 1.45,
  },
  backupTtsSection: {
    marginBottom: "12px",
    padding: "12px 14px",
    borderRadius: "16px",
    background: "rgba(30,41,59,.55)",
    border: "1px solid rgba(255,255,255,.08)",
  },
  backupTtsToggle: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    background: "transparent",
    border: "none",
    color: "#CBD5E1",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
    padding: "2px 0",
  },
  backupTtsBody: {
    marginTop: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
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
    width: "26px",
    height: "26px",
    borderRadius: "8px",
    background: "rgba(255,255,255,.06)",
    display: "grid",
    placeItems: "center",
    color: "#64748B",
    fontWeight: 700,
    fontSize: "10px",
    flexShrink: 0,
  },
  newsTitle: {
    fontSize: "15px",
    fontWeight: 800,
    lineHeight: 1.35,
    color: TOKENS.textPrimary,
  },
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
  proPlanPicker: {
    display: "flex",
    gap: "8px",
    marginBottom: "12px",
  },
  proPlanCard: {
    position: "relative",
    flex: "1 1 0",
    minWidth: 0,
    textAlign: "left",
    border: "1px solid rgba(148,163,184,.2)",
    borderRadius: "12px",
    padding: "10px 10px 9px",
    background: "rgba(255,255,255,.04)",
    cursor: "pointer",
    transition: "border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease",
  },
  proPlanCardActive: {
    border: "1px solid rgba(129,140,248,.55)",
    background: "linear-gradient(135deg, rgba(37,99,235,.18), rgba(99,102,241,.14))",
    boxShadow: "0 0 0 1px rgba(99,102,241,.2)",
  },
  proPlanBadge: {
    position: "absolute",
    top: "-8px",
    right: "8px",
    fontSize: "10px",
    fontWeight: 800,
    color: "#FDE68A",
    background: "rgba(251,191,36,.16)",
    border: "1px solid rgba(251,191,36,.4)",
    borderRadius: "999px",
    padding: "2px 7px",
    lineHeight: 1.2,
  },
  proPlanTitle: {
    fontSize: "11px",
    fontWeight: 800,
    color: "#94A3B8",
    marginBottom: "4px",
  },
  proPlanPrice: {
    fontSize: "14px",
    fontWeight: 900,
    color: "#F8FAFC",
    lineHeight: 1.25,
  },
  proPlanSubtitle: {
    marginTop: "4px",
    fontSize: "10px",
    fontWeight: 600,
    color: "#86EFAC",
    lineHeight: 1.3,
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
  proRestoreRow: {
    marginTop: "12px",
  },
  proRestoreLinkBtn: {
    margin: "10px 0 0",
    padding: "8px 0",
    width: "100%",
    border: "none",
    background: "transparent",
    color: "#94A3B8",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
    textDecoration: "underline",
    textUnderlineOffset: "3px",
  },
  proRestoreSecondaryBtn: {
    width: "100%",
    borderRadius: "12px",
    padding: "10px 14px",
    fontSize: "13px",
    fontWeight: 800,
    color: "#CBD5E1",
    background: "rgba(255,255,255,.06)",
    border: "1px solid rgba(255,255,255,.12)",
    cursor: "pointer",
  },
  proStatusLine: {
    fontSize: "14px",
    color: "#CBD5E1",
    lineHeight: 1.55,
    marginBottom: "6px",
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
