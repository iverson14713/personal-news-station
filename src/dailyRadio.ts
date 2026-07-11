/**
 * 每日專屬 AI 電台 — 本機狀態 + Supabase 後端同步
 *
 * generation_source:
 * - server：Supabase Cron + Edge Function 於排程時間背景生成
 * - app：使用者打開 App 後本機 fallback 生成
 */
import {
  DAILY_AUTO_DURATION,
  normalizeAutoRadioDuration,
  type AiDuration,
} from "./aiDuration";
import {
  DAILY_SCRIPT_TIMEZONE,
  getTaipeiDateKey,
  todayYmdInTimezone,
  todayYmdLocal,
  ymdFromTimestamp,
} from "./dateLocal";
import {
  isActiveDisplayReady,
  resolveDisplayRadioSlot,
  type ActiveDailyRadioDisplay,
} from "./activeDailyRadioDisplay";
import {
  type RadioSlot,
  radioSlotCompletedTitle,
  radioSlotLabel,
  MORNING_RADIO_TIME,
  EVENING_RADIO_TIME,
} from "./radioSlot";

export type DailyRadioGenerationSource = "server" | "app" | null;

export type NewsFetchStatus =
  | "idle"
  | "loading"
  | "success"
  | "empty"
  | "error"
  | "timeout";

export type ServerSyncStatus =
  | "idle"
  | "loading"
  | "ready"
  | "not_found"
  | "no_user"
  | "unconfigured";

export const NEWS_FETCH_TIMEOUT_MS = 10_000;

/** 早報「今日」以 Asia/Taipei 對齊後端 Cron */
export function todayDailyScriptYmd(): string {
  return getTaipeiDateKey();
}

export const DAILY_RADIO_STORAGE_KEY = "pns_daily_radio_v1";
export const USER_DISPLAY_NAME_KEY = "pns_user_display_name_v1";
export const AUTOPLAY_DAILY_FLAG_KEY = "pns_autoplay_daily_v1";
export const AUTOPLAY_ANCHOR_AUDIO_FLAG_KEY = "pns_autoplay_anchor_audio_v1";

export type DailyRadioStatus = "idle" | "pending" | "generating" | "ready" | "failed";

export type DailyRadioState = {
  /** 早報時間（向後相容 scheduledTime） */
  scheduledTime: string;
  eveningTime: string;
  morningDuration: AiDuration;
  eveningDuration: AiDuration;
  lastGeneratedDate: string | null;
  lastGeneratedAt: number | null;
  lastEntryId: string | null;
  lastRadioSlot: RadioSlot | null;
  status: DailyRadioStatus;
  lastError: string | null;
  notificationSentDate: string | null;
  lastDuration: AiDuration;
  generationSource: DailyRadioGenerationSource;
};

const DEFAULT_STATE: DailyRadioState = {
  scheduledTime: MORNING_RADIO_TIME,
  eveningTime: EVENING_RADIO_TIME,
  morningDuration: DAILY_AUTO_DURATION,
  eveningDuration: DAILY_AUTO_DURATION,
  lastGeneratedDate: null,
  lastGeneratedAt: null,
  lastEntryId: null,
  lastRadioSlot: null,
  status: "idle",
  lastError: null,
  notificationSentDate: null,
  lastDuration: DAILY_AUTO_DURATION,
  generationSource: null,
};

export function readDailyRadioState(): DailyRadioState {
  try {
    const raw = localStorage.getItem(DAILY_RADIO_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const o = JSON.parse(raw) as Partial<DailyRadioState>;
    return {
      scheduledTime:
        typeof o.scheduledTime === "string" && /^\d{1,2}:\d{2}$/.test(o.scheduledTime)
          ? o.scheduledTime
          : DEFAULT_STATE.scheduledTime,
      eveningTime:
        typeof o.eveningTime === "string" && /^\d{1,2}:\d{2}$/.test(o.eveningTime)
          ? o.eveningTime
          : DEFAULT_STATE.eveningTime,
      morningDuration: normalizeAutoRadioDuration(o.morningDuration, true),
      eveningDuration: normalizeAutoRadioDuration(o.eveningDuration, true),
      lastGeneratedDate:
        typeof o.lastGeneratedDate === "string" ? o.lastGeneratedDate : null,
      lastGeneratedAt:
        typeof o.lastGeneratedAt === "number" ? o.lastGeneratedAt : null,
      lastEntryId: typeof o.lastEntryId === "string" ? o.lastEntryId : null,
      lastRadioSlot:
        o.lastRadioSlot === "morning" || o.lastRadioSlot === "evening"
          ? o.lastRadioSlot
          : null,
      status:
        o.status === "pending" ||
        o.status === "generating" ||
        o.status === "ready" ||
        o.status === "failed" ||
        o.status === "idle"
          ? o.status
          : "idle",
      lastError: typeof o.lastError === "string" ? o.lastError : null,
      notificationSentDate:
        typeof o.notificationSentDate === "string" ? o.notificationSentDate : null,
      lastDuration: normalizeAutoRadioDuration(o.lastDuration, true),
      generationSource:
        o.generationSource === "server" || o.generationSource === "app"
          ? o.generationSource
          : null,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function writeDailyRadioState(patch: Partial<DailyRadioState>): DailyRadioState {
  const next = { ...readDailyRadioState(), ...patch };
  try {
    localStorage.setItem(DAILY_RADIO_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function readUserDisplayName(): string {
  try {
    const raw = localStorage.getItem(USER_DISPLAY_NAME_KEY);
    const name = typeof raw === "string" ? raw.trim() : "";
    return name || "朋友";
  } catch {
    return "朋友";
  }
}

export function writeUserDisplayName(name: string): void {
  try {
    const trimmed = name.trim().slice(0, 24);
    if (trimmed) localStorage.setItem(USER_DISPLAY_NAME_KEY, trimmed);
    else localStorage.removeItem(USER_DISPLAY_NAME_KEY);
  } catch {
    /* ignore */
  }
}

export function setAutoplayDailyFlag(): void {
  try {
    sessionStorage.setItem(AUTOPLAY_DAILY_FLAG_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function clearAutoplayDailyFlag(): void {
  try {
    sessionStorage.removeItem(AUTOPLAY_DAILY_FLAG_KEY);
  } catch {
    /* ignore */
  }
}

export function consumeAutoplayDailyFlag(): boolean {
  try {
    const v = sessionStorage.getItem(AUTOPLAY_DAILY_FLAG_KEY);
    sessionStorage.removeItem(AUTOPLAY_DAILY_FLAG_KEY);
    return v === "1";
  } catch {
    return false;
  }
}

export function setAutoplayAnchorAudioFlag(): void {
  try {
    sessionStorage.setItem(AUTOPLAY_ANCHOR_AUDIO_FLAG_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function clearAutoplayAnchorAudioFlag(): void {
  try {
    sessionStorage.removeItem(AUTOPLAY_ANCHOR_AUDIO_FLAG_KEY);
  } catch {
    /* ignore */
  }
}

export function consumeAutoplayAnchorAudioFlag(): boolean {
  try {
    const v = sessionStorage.getItem(AUTOPLAY_ANCHOR_AUDIO_FLAG_KEY);
    sessionStorage.removeItem(AUTOPLAY_ANCHOR_AUDIO_FLAG_KEY);
    return v === "1";
  } catch {
    return false;
  }
}

/** 今日早報是否已在本機 App 內生成完成 */
export function isTodayDailyGenerated(state = readDailyRadioState()): boolean {
  return state.lastGeneratedDate === todayDailyScriptYmd() && state.status === "ready";
}

/** @deprecated 僅供舊流程；手動生成不再檢查排程時間 */
export function shouldRunDailyGeneration(
  state = readDailyRadioState(),
  today = todayDailyScriptYmd()
): boolean {
  if (state.lastGeneratedDate === today && state.status === "ready") return false;
  if (state.status === "generating") return false;
  return true;
}

export function dailyRadioHeroStatus(params: {
  hasScript: boolean;
  aiLoading: boolean;
  localState: DailyRadioState;
  serverSyncState: ServerSyncStatus;
  generationSource: DailyRadioGenerationSource;
  activeDisplay?: ActiveDailyRadioDisplay | null;
}): DailyRadioStatus {
  const { hasScript, aiLoading, localState, serverSyncState, generationSource, activeDisplay } =
    params;

  if (isActiveDisplayReady(activeDisplay)) {
    return "ready";
  }

  const today = todayDailyScriptYmd();

  if (aiLoading || localState.status === "generating") return "generating";
  if (serverSyncState === "loading") return "idle";

  const ready =
    hasScript &&
    localState.lastGeneratedDate === today &&
    localState.status === "ready" &&
    (generationSource === "server" || generationSource === "app");

  if (ready) return "ready";
  if (localState.status === "failed") return "failed";
  return "idle";
}

export type DailyRadioHeroDisplay = {
  title: string;
  body: string;
  showRefresh: boolean;
};

export function dailyRadioHeroDisplay(params: {
  ready: boolean;
  generating: boolean;
  failed: boolean;
  serverSyncState: ServerSyncStatus;
  newsFetchStatus: NewsFetchStatus;
  serverConfigured: boolean;
  generationSource: DailyRadioGenerationSource;
  scriptDuration: AiDuration;
  newsCount: number;
  selectedCount: number;
  radioSlot?: RadioSlot | null;
  activeDisplay?: ActiveDailyRadioDisplay | null;
  voiceFeatureEnabled?: boolean;
  anchorName?: string;
  anchorAudioReady?: boolean;
  anchorAudioLoading?: boolean;
}): DailyRadioHeroDisplay {
  const {
    ready,
    generating,
    failed,
    serverSyncState,
    newsFetchStatus,
    serverConfigured,
    generationSource,
    scriptDuration,
    newsCount,
    selectedCount,
    radioSlot,
    activeDisplay,
    voiceFeatureEnabled = false,
    anchorName = "Emily",
    anchorAudioReady = false,
    anchorAudioLoading = false,
  } = params;

  const slot =
    resolveDisplayRadioSlot(activeDisplay, radioSlot, {
      allowMorningDefault: !ready && !isActiveDisplayReady(activeDisplay),
    }) ?? "morning";
  const slotName = radioSlotLabel(slot);

  if (ready) {
    if (voiceFeatureEnabled) {
      if (anchorAudioReady) {
        return {
          title: slot === "evening" ? "🎙 今天 AI 晚報已完成" : "🎙 今天 AI 早報已完成",
          body: `${anchorName} 已準備好今天 ${scriptDuration} 分鐘新聞`,
          showRefresh: false,
        };
      }
      if (anchorAudioLoading) {
        return {
          title: `正在準備 AI 主播語音`,
          body: `${anchorName} 正在為你錄製今天 ${scriptDuration} 分鐘新聞…`,
          showRefresh: false,
        };
      }
    }
    return {
      title: radioSlotCompletedTitle(slot),
      body: dailyRadioReadyMessage(
        generationSource,
        scriptDuration,
        Math.max(newsCount, selectedCount),
        slot
      ),
      showRefresh: false,
    };
  }

  if (generating) {
    const proAudioStep =
      voiceFeatureEnabled && anchorAudioLoading && !anchorAudioReady;
    return {
      title: proAudioStep
        ? "正在準備 AI 主播語音"
        : `正在為你準備今日 AI ${slotName}`,
      body: proAudioStep
        ? `${anchorName} 正在為你錄製今天 ${scriptDuration} 分鐘新聞…`
        : generationSource === "server"
          ? `伺服器正在整理今日${slotName}重點…`
          : `AI 正在整理今日${slotName}重點，完成後會自動儲存至歷史。`,
      showRefresh: false,
    };
  }

  if (failed) {
    return {
      title: `今日 AI ${slotName}尚未完成`,
      body: `今日${slotName}生成失敗，請稍後再試一次。`,
      showRefresh: newsFetchStatus === "error" || newsFetchStatus === "timeout",
    };
  }

  const statusLines: string[] = [];

  if (serverSyncState === "loading") {
    statusLines.push(`正在同步今日${slotName}…`);
  } else if (serverSyncState === "not_found") {
    statusLines.push(`伺服器尚未為此裝置產生今日${slotName}。`);
  } else if (serverSyncState === "no_user") {
    statusLines.push("無法取得 Supabase 使用者，請重新開啟 App。");
  } else if (serverConfigured && serverSyncState === "idle") {
    statusLines.push(`今日伺服器尚未產生${slotName}。`);
  }

  if (newsFetchStatus === "loading") {
    statusLines.push("正在讀取新聞…");
  } else if (newsFetchStatus === "timeout") {
    statusLines.push("新聞讀取失敗，請稍後再試。");
  } else if (newsFetchStatus === "error") {
    statusLines.push("新聞讀取失敗，請點重新整理。");
  } else if (newsFetchStatus === "empty" && newsCount === 0) {
    statusLines.push("目前沒有抓到符合主題的新聞。");
  }

  if (statusLines.length === 0) {
    statusLines.push("今日尚未生成。");
  }

  if (serverConfigured && serverSyncState !== "loading") {
    statusLines.push(`若伺服器尚未完成，你可以手動生成今日${slotName}。`);
  } else if (!serverConfigured) {
    statusLines.push(`點擊下方按鈕立即生成今日${slotName}。`);
  }

  return {
    title: `今日 AI ${slotName}尚未完成`,
    body: statusLines.join(" "),
    showRefresh: newsFetchStatus === "error" || newsFetchStatus === "timeout",
  };
}

export function dailyRadioIdleMessage(
  _scheduledTime: string,
  serverConfigured: boolean,
  slot: RadioSlot = "morning"
): string {
  const slotName = radioSlotLabel(slot);
  if (serverConfigured) {
    return `若伺服器尚未完成，你可以手動生成今日${slotName}。`;
  }
  return `點擊下方按鈕立即生成今日${slotName}。`;
}

export function dailyRadioReadyMessage(
  generationSource: DailyRadioGenerationSource,
  scriptDuration: AiDuration,
  newsCount: number,
  slot: RadioSlot = "morning"
): string {
  const slotName = radioSlotLabel(slot);
  const src =
    generationSource === "server"
      ? "伺服器已為你準備好"
      : "已在本機為你準備好";
  return `${src}專屬 ${scriptDuration} 分鐘 AI ${slotName}，共整理 ${newsCount} 則你關心的新聞。`;
}

export function markDailyGenerationStarted(): DailyRadioState {
  return writeDailyRadioState({
    status: "generating",
    lastError: null,
  });
}

export function markDailyGenerationComplete(
  entryId: string,
  duration: AiDuration,
  generationSource: DailyRadioGenerationSource = "app",
  radioSlot: RadioSlot = "morning"
): DailyRadioState {
  const today = todayDailyScriptYmd();
  return writeDailyRadioState({
    status: "ready",
    lastGeneratedDate: today,
    lastGeneratedAt: Date.now(),
    lastEntryId: entryId,
    lastRadioSlot: radioSlot,
    lastError: null,
    lastDuration: duration,
    generationSource,
  });
}

export function markDailyGenerationFailed(error: string): DailyRadioState {
  return writeDailyRadioState({
    status: "failed",
    lastError: error.slice(0, 200),
  });
}

export function markDailyNotificationSent(): DailyRadioState {
  return writeDailyRadioState({
    notificationSentDate: todayYmdLocal(),
  });
}

export function isDailyAutoHistoryEntry(entry: {
  isDailyAuto?: boolean;
  savedAt: number;
}): boolean {
  if (entry.isDailyAuto) return true;
  const state = readDailyRadioState();
  if (!state.lastEntryId) return false;
  return false;
}

export function findTodayDailyHistoryEntry<
  T extends { id: string; savedAt: number; isDailyAuto?: boolean },
>(entries: T[], today = todayYmdLocal()): T | null {
  const state = readDailyRadioState();
  if (state.lastEntryId) {
    const byId = entries.find((e) => e.id === state.lastEntryId);
    if (byId && ymdFromTimestamp(byId.savedAt) === today) return byId;
  }
  return (
    entries.find(
      (e) => e.isDailyAuto && ymdFromTimestamp(e.savedAt) === today
    ) ?? null
  );
}

/** 供後端 Cron / Worker 使用的觸發介面 */
export type DailyRadioSchedulerTrigger =
  | "app_launch"
  | "app_foreground"
  | "cron"
  | "manual"
  | "push_open";

export function logDailyRadioScheduler(trigger: DailyRadioSchedulerTrigger, detail: string): void {
  console.log(`[DailyRadio] ${trigger}: ${detail}`);
}
