import { appendRadioClosing } from "./radioClosing.ts";
import { generateRadioScript } from "./ai.ts";
import {
  collectNewsForUser,
  morningHeadlinesFromSourceNews,
  newsKeysFromSourceNews,
  type NewsItem,
} from "./news.ts";
import {
  sendDailyRadioCompletedPush,
  type PushSendResult,
  type RadioSlot,
} from "./push.ts";
import { resolveFeedQueries } from "./topics.ts";
import {
  isProUser,
  isVoiceFeatureEnabled,
  resolveAnchorSettings,
} from "./aiAnchor.ts";

export { isProUser } from "./aiAnchor.ts";

const USER_PREFS_SELECT =
  "user_id, topics, custom_keywords, daily_radio_enabled, daily_radio_time, morning_radio_enabled, evening_radio_enabled, morning_radio_time, evening_radio_time, morning_duration_minutes, evening_duration_minutes, timezone, push_token, push_platform, push_environment, display_name, ai_anchor_id, ai_anchor_voice, ai_anchor_style, ai_playback_rate, voice_feature_enabled";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function reloadUserPrefsForJob(
  supabase: any,
  userId: string
): Promise<UserPrefs | null> {
  const { data, error } = await supabase
    .from("news_user_preferences")
    .select(USER_PREFS_SELECT)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as UserPrefs;
}
import { generateAudioForScript, isScriptAudioReady } from "./generateAudio.ts";
import { getTaipeiDateKey, shouldGenerateNow } from "./timezone.ts";

export type UserPrefs = {
  user_id: string;
  topics: string[];
  custom_keywords: string[];
  daily_radio_enabled: boolean;
  daily_radio_time: string;
  morning_radio_enabled: boolean;
  evening_radio_enabled: boolean;
  morning_radio_time: string;
  evening_radio_time: string;
  morning_duration_minutes: number;
  evening_duration_minutes: number;
  timezone: string;
  push_token: string | null;
  push_platform: string | null;
  push_environment: "sandbox" | "production" | null;
  display_name: string | null;
  ai_anchor_id: string | null;
  ai_anchor_voice: string | null;
  ai_anchor_style: string | null;
  ai_playback_rate: number | null;
  voice_feature_enabled: boolean | null;
};

export type SlotConfig = {
  slot: RadioSlot;
  enabled: boolean;
  time: string;
  duration: number;
  requestedDuration: number;
  requestedFallbackReason: string | null;
};

export type ProcessResult = {
  user_id: string;
  radio_slot?: RadioSlot;
  status:
    | "skipped"
    | "completed"
    | "failed"
    | "test_push_sent_existing_script"
    | "no_push_token";
  reason?: string;
  script_id?: string;
  push_status?: "sent" | "failed" | "no_token";
  push_error?: string;
};

export type CronPayload = {
  triggered_at?: string;
  app?: string;
  test?: boolean;
  force?: boolean;
  send_test_push?: boolean;
  target_user_id?: string;
  radio_slot?: RadioSlot;
  triggerSource?: string;
  trigger_source?: string;
};

export type ProcessOptions = {
  /** Worker 路徑：略過 not_in_time_window，由 dispatcher 已判定 */
  fromQueue?: boolean;
  force: boolean;
  sendTestPush: boolean;
  targetRadioSlot?: RadioSlot;
  pushDedup: PushDedupState;
  pushTokenIndex: Map<string, number>;
  finalPushCount: { value: number };
  pushFailureCount: { value: number };
};

type PushDedupState = {
  sentDeviceKeys: Set<string>;
};

type DailyRadioPushAttemptLog = {
  event: "daily_radio_push_attempt";
  user_id: string;
  display_name: string;
  user_plan: "free" | "pro";
  radio_slot: RadioSlot;
  script_date: string;
  script_id: string | null;
  trigger_path: string;
  push_sent_at_before: string | null;
  claim_success: boolean | null;
  skipped_reason: string | null;
  device_token_prefix: string | null;
  token_count_before_dedupe: number;
  token_count_after_dedupe: number;
  final_push_count: number;
};

function logDailyRadioPushAttempt(log: DailyRadioPushAttemptLog): void {
  console.log(JSON.stringify(log));
}

export function buildPushTokenIndex(users: UserPrefs[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const user of users) {
    const token = user.push_token?.trim();
    if (!token) continue;
    index.set(token, (index.get(token) ?? 0) + 1);
  }
  return index;
}

export function userPlanLabel(user: UserPrefs): "free" | "pro" {
  return isVoiceFeatureEnabled(user) ? "pro" : "free";
}

function tokenPrefix(token: string): string {
  return token.slice(0, 8);
}

type ScriptRow = {
  id: string;
  status: string;
  updated_at: string;
  push_sent_at: string | null;
  generation_source: "server" | "app";
  radio_slot: RadioSlot;
  source_news?: unknown;
  script_date?: string;
  script_text?: string;
  audio_url?: string | null;
  audio_voice?: string | null;
  audio_style?: string | null;
  audio_expires_at?: string | null;
};

const GENERATION_STALE_MS = 20 * 60 * 1000;
const SERVER_SOURCE = "server";
const MORNING_PUSH_WINDOW_MINUTES = 30;
const MORNING_CATCHUP_HOURS = 14;
const PUSH_CLAIM_TTL_MS = 10 * 60 * 1000;
const UPSERT_CONFLICT =
  "user_id,script_date,duration_minutes,generation_source,radio_slot";

type AutoDurationRule = {
  targetMin: number;
  targetMax: number;
  min: number;
  maxPerTopic: number;
};

const AUTO_DURATION_RULES: Record<3 | 5 | 10, AutoDurationRule> = {
  3: { targetMin: 5, targetMax: 8, min: 3, maxPerTopic: 3 },
  5: { targetMin: 7, targetMax: 10, min: 5, maxPerTopic: 4 },
  10: { targetMin: 10, targetMax: 15, min: 8, maxPerTopic: 5 },
};

function durationFallbackChain(requested: 3 | 5 | 10): Array<3 | 5 | 10> {
  if (requested === 10) return [10, 5, 3];
  if (requested === 5) return [5, 3];
  return [3];
}

function normalizeRequestedAutoDuration(duration: number): 3 | 5 | 10 {
  return duration === 5 || duration === 10 ? duration : 3;
}

function resolveAllowedAutoDuration(
  requestedDuration: number,
  user: UserPrefs
): { duration: 3 | 5 | 10; fallbackReason: string | null } {
  const requested = normalizeRequestedAutoDuration(requestedDuration);
  if (!isVoiceFeatureEnabled(user) && requested !== 3) {
    return { duration: 3, fallbackReason: "free_plan_auto_duration_limited_to_3" };
  }
  if (requestedDuration === 15) {
    return { duration: 3, fallbackReason: "15_min_auto_not_allowed" };
  }
  if (requestedDuration !== requested) {
    return { duration: requested, fallbackReason: "invalid_auto_duration_normalized" };
  }
  return { duration: requested, fallbackReason: null };
}

function resolveFinalDurationForNews(
  requestedDuration: 3 | 5 | 10,
  selectedNewsCount: number
): { duration: 3 | 5 | 10; fallbackReason: string | null } {
  if (requestedDuration === 10 && selectedNewsCount < AUTO_DURATION_RULES[10].min) {
    return { duration: 5, fallbackReason: "insufficient_news_for_10_min_fallback_to_5" };
  }
  if (requestedDuration === 5 && selectedNewsCount < AUTO_DURATION_RULES[5].min) {
    return { duration: 3, fallbackReason: "insufficient_news_for_5_min_fallback_to_3" };
  }
  return { duration: requestedDuration, fallbackReason: null };
}

function sourceNewsCount(sourceNews: unknown): number | undefined {
  if (!Array.isArray(sourceNews)) return undefined;
  return sourceNews.length;
}

function parseNewsTime(value: string | null | undefined): number {
  if (!value?.trim()) return 0;
  const ts = Date.parse(value.trim());
  return Number.isFinite(ts) ? ts : 0;
}

function newsSelectedTime(item: NewsItem): number {
  return parseNewsTime(item.publishedAt) || parseNewsTime(item.fetchedAt);
}

function logDailyRadioNewsSelection(args: {
  scriptId: string | null;
  radioSlot: RadioSlot;
  news: NewsItem[];
}) {
  console.log(
    JSON.stringify({
      event: "daily_radio_script_news_selection",
      script_id: args.scriptId,
      radio_slot: args.radioSlot,
      selected_news_titles: args.news.map((n) => n.title),
      selected_news_sources: args.news.map((n) => n.source),
      selected_news_published_at: args.news.map((n) => n.publishedAt || null),
      selected_news_fetched_at: args.news.map((n) => n.fetchedAt || null),
    })
  );
}

function logNewsFreshnessWarning(args: {
  radioSlot: RadioSlot;
  news: NewsItem[];
  freshnessWindowHours: number;
}) {
  if (args.news.length === 0) return;
  const selectedTimes = args.news.map(newsSelectedTime).filter((v) => v > 0);
  if (selectedTimes.length === 0) return;
  const oldestSelectedAt = Math.min(...selectedTimes);
  const maxAgeMs = args.freshnessWindowHours * 60 * 60 * 1000;
  if (Date.now() - oldestSelectedAt <= maxAgeMs) return;
  const publishedTimes = args.news.map((n) => parseNewsTime(n.publishedAt)).filter((v) => v > 0);
  const fetchedTimes = args.news.map((n) => parseNewsTime(n.fetchedAt)).filter((v) => v > 0);
  console.log(
    JSON.stringify({
      event: "news_freshness_warning",
      topic: [...new Set(args.news.map((n) => n.topic).filter(Boolean))].join(","),
      radio_slot: args.radioSlot,
      newest_published_at: publishedTimes.length
        ? new Date(Math.max(...publishedTimes)).toISOString()
        : null,
      newest_fetched_at: fetchedTimes.length
        ? new Date(Math.max(...fetchedTimes)).toISOString()
        : null,
      oldest_selected_at: new Date(oldestSelectedAt).toISOString(),
      selected_news_count: args.news.length,
      freshness_window_hours: args.freshnessWindowHours,
    })
  );
}

const FULL_SCRIPT_SELECT =
  "id, status, updated_at, push_sent_at, generation_source, radio_slot, script_date, script_text, audio_url, audio_voice, audio_style, audio_expires_at";

export function getUserSlots(user: UserPrefs, options: ProcessOptions): SlotConfig[] {
  const morningResolved = resolveAllowedAutoDuration(
    user.morning_duration_minutes ?? 3,
    user
  );
  const eveningResolved = resolveAllowedAutoDuration(
    user.evening_duration_minutes ?? 3,
    user
  );
  const morning: SlotConfig = {
    slot: "morning",
    enabled: user.morning_radio_enabled !== false,
    time: user.morning_radio_time || user.daily_radio_time || "07:00",
    duration: morningResolved.duration,
    requestedDuration: user.morning_duration_minutes ?? 3,
    requestedFallbackReason: morningResolved.fallbackReason,
  };
  const evening: SlotConfig = {
    slot: "evening",
    enabled: user.evening_radio_enabled === true,
    time: user.evening_radio_time || "17:00",
    duration: eveningResolved.duration,
    requestedDuration: user.evening_duration_minutes ?? 3,
    requestedFallbackReason: eveningResolved.fallbackReason,
  };

  let slots = [morning, evening].filter((s) => s.enabled);
  if (options.targetRadioSlot) {
    slots = slots.filter((s) => s.slot === options.targetRadioSlot);
  }
  return slots;
}

function slotScriptTitle(slot: RadioSlot): string {
  return slot === "evening" ? "今日 AI 晚報" : "今日 AI 早報";
}

function hourMinuteInTimezone(timezone: string): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  return {
    hour: Number(parts.find((p) => p.type === "hour")?.value ?? 0),
    minute: Number(parts.find((p) => p.type === "minute")?.value ?? 0),
  };
}

/** 早報排程後 N 小時內允許補推播／補音檔（即使已離開 30 分鐘生成窗） */
function isMorningCatchUpEligible(timezone: string, scheduledTime: string): boolean {
  const [th, tm] = scheduledTime.split(":").map((x) => Number(x));
  if (!Number.isFinite(th) || !Number.isFinite(tm)) return false;
  const { hour, minute } = hourMinuteInTimezone(timezone);
  const nowMins = hour * 60 + minute;
  const targetMins = th * 60 + tm;
  const diff = nowMins - targetMins;
  return diff >= 0 && diff < MORNING_CATCHUP_HOURS * 60;
}

function resolveSlotCatchUp(
  user: UserPrefs,
  serverRow: ScriptRow | null
): { needed: boolean; reason: string | null } {
  if (!serverRow) return { needed: false, reason: null };

  if (serverRow.status === "completed" && !serverRow.push_sent_at) {
    return { needed: true, reason: "completed_without_push" };
  }

  if (serverRow.status === "completed" && isVoiceFeatureEnabled(user)) {
    const anchorPrefs = resolveAnchorSettings(user);
    if (!isScriptAudioReady(serverRow, anchorPrefs.voice, anchorPrefs.style)) {
      return { needed: true, reason: "completed_without_audio" };
    }
  }

  if (serverRow.status === "generating") {
    const updatedAt = new Date(serverRow.updated_at).getTime();
    if (Date.now() - updatedAt >= GENERATION_STALE_MS) {
      return { needed: true, reason: "stale_generating" };
    }
    return { needed: true, reason: "generating_in_progress" };
  }

  return { needed: false, reason: null };
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchScriptBySource(
  supabase: any,
  userId: string,
  scriptDate: string,
  duration: number,
  generationSource: "server" | "app",
  radioSlot: RadioSlot
): Promise<ScriptRow | null> {
  const { data } = await supabase
    .from("news_daily_radio_scripts")
    .select(FULL_SCRIPT_SELECT)
    .eq("user_id", userId)
    .eq("script_date", scriptDate)
    .eq("duration_minutes", duration)
    .eq("generation_source", generationSource)
    .eq("radio_slot", radioSlot)
    .maybeSingle();
  return (data as ScriptRow | null) ?? null;
}

type AnchorAudioPrepareResult = {
  hasAnchorAudio: boolean;
  audioReady: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureAnchorAudioBeforePush(
  supabase: any,
  openaiKey: string,
  user: UserPrefs,
  scriptRow: ScriptRow,
  scriptDate: string,
  duration: number,
  radioSlot: RadioSlot
): Promise<AnchorAudioPrepareResult> {
  const anchorPrefs = resolveAnchorSettings(user);
  const isPro = isVoiceFeatureEnabled(user);

  const scriptText = scriptRow.script_text?.trim();
  if (!scriptText) {
    console.log("[DailyRadioCron] audio failed, fallback push", {
      user_id: user.user_id,
      script_id: scriptRow.id,
      reason: "empty_script",
      user_plan: userPlanLabel(user),
    });
    return { hasAnchorAudio: false, audioReady: false };
  }

  if (isScriptAudioReady(scriptRow, anchorPrefs.voice, anchorPrefs.style)) {
    console.log("[DailyRadioCron] audio generated", {
      user_id: user.user_id,
      script_id: scriptRow.id,
      script_date: scriptDate,
      cached: true,
      user_plan: userPlanLabel(user),
      anchor_name: anchorPrefs.anchorName,
    });
    return { hasAnchorAudio: true, audioReady: true };
  }

  console.log("[DailyRadioCron] generating audio before push", {
    user_id: user.user_id,
    script_id: scriptRow.id,
    script_date: scriptDate,
    voice: anchorPrefs.voice,
    style: anchorPrefs.style,
    anchor_id: anchorPrefs.anchorId,
    user_plan: userPlanLabel(user),
    trigger_path: "ensure_audio_and_push",
  });

  const audioResult = await generateAudioForScript({
    supabase,
    openaiKey,
    scriptId: scriptRow.id,
    userId: user.user_id,
    scriptText,
    voice: anchorPrefs.voice,
    style: anchorPrefs.style,
    isPro: true,
    isFavorited: false,
    skipQuotaCheck: true,
    radioSlot,
    durationMinutes: duration,
  });

  if (!audioResult.ok) {
    console.log("[DailyRadioCron] audio failed, fallback push", {
      user_id: user.user_id,
      script_id: scriptRow.id,
      code: audioResult.code,
      error: audioResult.error,
    });
    return { hasAnchorAudio: false, audioReady: false };
  }

  const verified = await fetchScriptBySource(
    supabase,
    user.user_id,
    scriptDate,
    duration,
    SERVER_SOURCE,
    radioSlot
  );

  const audioReady =
    verified != null &&
    isScriptAudioReady(verified, anchorPrefs.voice, anchorPrefs.style);

  if (audioReady) {
    console.log("[DailyRadioCron] audio generated", {
      user_id: user.user_id,
      script_id: scriptRow.id,
      script_date: scriptDate,
      audio_url: verified?.audio_url ?? audioResult.audioUrl,
    });
    return { hasAnchorAudio: true, audioReady: true };
  }

  console.log("[DailyRadioCron] audio failed, fallback push", {
    user_id: user.user_id,
    script_id: scriptRow.id,
    reason: "db_verify_failed",
  });
  return { hasAnchorAudio: false, audioReady: false };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resetStaleGeneratingForSlot(
  supabase: any,
  userId: string,
  scriptDate: string,
  duration: number,
  radioSlot: RadioSlot
): Promise<void> {
  const { data } = await supabase
    .from("news_daily_radio_scripts")
    .select("id, updated_at")
    .eq("user_id", userId)
    .eq("script_date", scriptDate)
    .eq("duration_minutes", duration)
    .eq("generation_source", SERVER_SOURCE)
    .eq("radio_slot", radioSlot)
    .eq("status", "generating")
    .maybeSingle();

  if (!data) return;

  const updatedAt = new Date(data.updated_at).getTime();
  if (Date.now() - updatedAt < GENERATION_STALE_MS) return;

  const { error } = await supabase
    .from("news_daily_radio_scripts")
    .update({
      status: "failed",
      error_message: "stale_generating_reset",
      updated_at: new Date().toISOString(),
    })
    .eq("id", data.id);

  if (error) {
    console.warn("stale_generating_reset_failed", {
      user_id: userId,
      radio_slot: radioSlot,
      script_date: scriptDate,
      error: error.message,
    });
    return;
  }

  console.log("stale_generating_reset", {
    user_id: userId,
    radio_slot: radioSlot,
    script_date: scriptDate,
    script_id: data.id,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchMorningSourceNews(
  supabase: any,
  userId: string,
  scriptDate: string,
  duration: number
): Promise<{ source_news: unknown; id: string } | null> {
  const { data } = await supabase
    .from("news_daily_radio_scripts")
    .select("id, source_news")
    .eq("user_id", userId)
    .eq("script_date", scriptDate)
    .eq("duration_minutes", duration)
    .eq("generation_source", SERVER_SOURCE)
    .eq("radio_slot", "morning")
    .eq("status", "completed")
    .maybeSingle();
  return (data as { source_news: unknown; id: string } | null) ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function processSingleDailyRadioJob(
  supabase: any,
  user: UserPrefs,
  slotConfig: SlotConfig,
  openaiKey: string,
  options: ProcessOptions
): Promise<ProcessResult> {
  let effectiveUser = user;
  if (options.fromQueue || slotConfig.slot === "evening") {
    const fresh = await reloadUserPrefsForJob(supabase, user.user_id);
    if (fresh) effectiveUser = fresh;
  }

  const radioSlot = slotConfig.slot;
  if (radioSlot === "evening" && !isProUser(effectiveUser)) {
    console.log(
      JSON.stringify({
        event: "daily_radio_free_evening_blocked",
        user_id: effectiveUser.user_id,
        radio_slot: radioSlot,
        reason: "free_evening_not_allowed",
        from_queue: options.fromQueue === true,
      })
    );
    return {
      user_id: effectiveUser.user_id,
      radio_slot: radioSlot,
      status: "skipped",
      reason: "free_evening_not_allowed",
    };
  }

  user = effectiveUser;
  const tz = user.timezone || "Asia/Taipei";
  const scriptDate = getTaipeiDateKey();
  let duration = slotConfig.duration;
  const windowMinutes =
    slotConfig.slot === "morning" ? MORNING_PUSH_WINDOW_MINUTES : 15;
  const inTimeWindow = shouldGenerateNow(tz, slotConfig.time, windowMinutes);

  await resetStaleGeneratingForSlot(
    supabase,
    user.user_id,
    scriptDate,
    duration,
    radioSlot
  );

  const serverRow = await fetchScriptBySource(
    supabase,
    user.user_id,
    scriptDate,
    duration,
    SERVER_SOURCE,
    radioSlot
  );
  const catchUp = resolveSlotCatchUp(user, serverRow);
  const morningCatchUpEligible =
    radioSlot === "morning" && isMorningCatchUpEligible(tz, slotConfig.time);
  const allowCatchUp =
    catchUp.needed &&
    (morningCatchUpEligible || radioSlot === "evening" || options.force);

  console.log(
    JSON.stringify({
      event: "daily_radio_slot_eval",
      user_id: user.user_id,
      radio_slot: radioSlot,
      script_date: scriptDate,
      timezone: tz,
      scheduled_time: slotConfig.time,
      duration_minutes: duration,
      should_generate_now: inTimeWindow,
      catch_up_needed: catchUp.needed,
      catch_up_reason: catchUp.reason,
      morning_catch_up_eligible: morningCatchUpEligible,
      allow_catch_up: allowCatchUp,
      force: options.force,
      server_status: serverRow?.status ?? null,
      push_sent_at: serverRow?.push_sent_at ?? null,
    })
  );

  if (!options.force && !options.fromQueue && !inTimeWindow) {
    if (allowCatchUp && serverRow?.status === "completed") {
      console.log(
        JSON.stringify({
          event: "daily_radio_catch_up",
          user_id: user.user_id,
          radio_slot: radioSlot,
          reason: catchUp.reason,
          script_id: serverRow.id,
        })
      );
      return await ensureTodayAudioAndPush(
        supabase,
        user,
        scriptDate,
        duration,
        radioSlot,
        serverRow,
        openaiKey,
        options
      );
    }

    if (catchUp.reason === "generating_in_progress") {
      console.log("slot skipped", {
        user_id: user.user_id,
        radio_slot: radioSlot,
        reason: "in_progress",
      });
      return {
        user_id: user.user_id,
        radio_slot: radioSlot,
        status: "skipped",
        reason: "in_progress",
      };
    }

    console.log("slot skipped", {
      user_id: user.user_id,
      radio_slot: radioSlot,
      reason: "not_in_time_window",
    });
    return {
      user_id: user.user_id,
      radio_slot: radioSlot,
      status: "skipped",
      reason: "not_in_time_window",
    };
  }

  if (options.force) {
    console.log("force mode: skipping time window check", {
      user_id: user.user_id,
      radio_slot: radioSlot,
    });
  }

  const requestedDuration = slotConfig.requestedDuration;

  const appRow = await fetchScriptBySource(
    supabase,
    user.user_id,
    scriptDate,
    duration,
    "app",
    radioSlot
  );

  if (serverRow?.status === "completed") {
    if (options.sendTestPush) {
      return await sendTestPushForExistingScript(
        supabase,
        user,
        scriptDate,
        duration,
        radioSlot,
        serverRow,
        openaiKey,
        options
      );
    }

    return await ensureTodayAudioAndPush(
      supabase,
      user,
      scriptDate,
      duration,
      radioSlot,
      serverRow,
      openaiKey,
      options
    );
  }

  if (appRow?.status === "completed") {
    console.log("app completed exists but server missing, generate anyway", {
      user_id: user.user_id,
      radio_slot: radioSlot,
      reason: "app_completed_exists_but_server_missing_generate_anyway",
      app_script_id: appRow.id,
    });
  }

  if (serverRow?.status === "generating") {
    const updatedAt = new Date(serverRow.updated_at).getTime();
    if (Date.now() - updatedAt < GENERATION_STALE_MS) {
      console.log("slot skipped", {
        user_id: user.user_id,
        radio_slot: radioSlot,
        reason: "in_progress",
      });
      return {
        user_id: user.user_id,
        radio_slot: radioSlot,
        status: "skipped",
        reason: "in_progress",
      };
    }
  }

  const topics = user.topics ?? [];
  const customKeywords = user.custom_keywords ?? [];
  const feeds = resolveFeedQueries(topics, customKeywords);
  if (feeds.length === 0) {
    console.error("slot failed", {
      user_id: user.user_id,
      radio_slot: radioSlot,
      error: "no_topics",
    });
    await upsertFailed(supabase, user.user_id, scriptDate, duration, radioSlot, "未設定追蹤主題");
    return {
      user_id: user.user_id,
      radio_slot: radioSlot,
      status: "failed",
      reason: "no_topics",
    };
  }

  let scriptId: string | null = null;

  try {
    let excludeKeys = new Set<string>();
    let morningHeadlines: string[] = [];

    if (radioSlot === "evening") {
      const morningRow = await fetchMorningSourceNews(
        supabase,
        user.user_id,
        scriptDate,
        duration
      );
      if (morningRow?.source_news) {
        excludeKeys = newsKeysFromSourceNews(morningRow.source_news);
        morningHeadlines = morningHeadlinesFromSourceNews(morningRow.source_news);
        console.log("evening generation: excluding morning source_news", {
          user_id: user.user_id,
          radio_slot: radioSlot,
          morning_script_id: morningRow.id,
          exclude_count: excludeKeys.size,
        });
      } else {
        console.log("evening generation: no morning source_news found", {
          user_id: user.user_id,
          radio_slot: radioSlot,
        });
      }
    }

    console.log("fetching fresh news for slot", {
      user_id: user.user_id,
      radio_slot: radioSlot,
      feeds: feeds.length,
      no_cache: true,
      no_frontend_source: true,
    });

    const collectForDuration = async (dur: 3 | 5 | 10) => {
      const rule = AUTO_DURATION_RULES[dur];
      return collectNewsForUser(feeds, 2, 5, {
        radioSlot,
        userId: user.user_id,
        excludeKeys,
        maxPerTopic: rule.maxPerTopic,
        maxTotal: rule.targetMax,
        durationMinutes: dur,
      });
    };

    const requestedRadioDuration = duration as 3 | 5 | 10;
    const durationChain = durationFallbackChain(requestedRadioDuration);
    let collection = await collectForDuration(durationChain[0]!);
    let news: NewsItem[] = collection.items;
    let collectedAtDuration = durationChain[0]!;
    let durationDowngradeReason: string | null = null;

    for (let i = 0; i < durationChain.length; i++) {
      const tryDuration = durationChain[i]!;
      if (i > 0) {
        collection = await collectForDuration(tryDuration);
        news = collection.items;
        collectedAtDuration = tryDuration;
      }
      const rule = AUTO_DURATION_RULES[tryDuration];
      if (news.length >= rule.min) break;
      if (i < durationChain.length - 1) {
        const next = durationChain[i + 1]!;
        durationDowngradeReason = `insufficient_news_for_${tryDuration}_min_fallback_to_${next}`;
      }
    }

    const finalDuration = resolveFinalDurationForNews(collectedAtDuration, news.length);
    let fallbackReason =
      finalDuration.fallbackReason ??
      durationDowngradeReason ??
      slotConfig.requestedFallbackReason;
    duration = finalDuration.duration;
    const finalRule = AUTO_DURATION_RULES[duration as 3 | 5 | 10];

    console.log(
      JSON.stringify({
        event: "daily_radio_final_selection",
        radio_slot: radioSlot,
        user_id: user.user_id,
        raw_candidate_count: collection.rawCandidateCount,
        selected_news_count: news.length,
        requested_duration: requestedDuration,
        final_duration: duration,
        quality_threshold_used: collection.qualityThresholdUsed,
        fallback_level: collection.fallbackLevel,
        used_emergency_fallback: collection.usedEmergencyFallback,
        selected_titles: news.map((n) => n.title),
        used_quality_fallback: collection.usedRelaxedFallback,
        hard_rejected_count: collection.hardRejectedCount,
        per_topic_stats: collection.perTopicStats,
      })
    );

    if (duration !== slotConfig.duration) {
      const existingFinalRow = await fetchScriptBySource(
        supabase,
        user.user_id,
        scriptDate,
        duration,
        SERVER_SOURCE,
        radioSlot
      );
      if (existingFinalRow?.status === "completed") {
        console.log("duration fallback: existing final script ready", {
          user_id: user.user_id,
          radio_slot: radioSlot,
          requested_duration: requestedDuration,
          final_duration: duration,
          fallback_reason: fallbackReason,
          script_id: existingFinalRow.id,
        });
        return await ensureTodayAudioAndPush(
          supabase,
          user,
          scriptDate,
          duration,
          radioSlot,
          existingFinalRow,
          openaiKey,
          options
        );
      }
      if (existingFinalRow?.status === "generating") {
        console.log("slot skipped", {
          user_id: user.user_id,
          radio_slot: radioSlot,
          reason: "final_duration_in_progress",
          requested_duration: requestedDuration,
          final_duration: duration,
        });
        return {
          user_id: user.user_id,
          radio_slot: radioSlot,
          status: "skipped",
          reason: "final_duration_in_progress",
        };
      }
    }

    console.log(
      JSON.stringify({
        event: "daily_radio_auto_duration_selection",
        radio_slot: radioSlot,
        user_id: user.user_id,
        user_plan: userPlanLabel(user),
        requested_duration: requestedDuration,
        final_duration: duration,
        target_news_count: `${finalRule.targetMin}-${finalRule.targetMax}`,
        selected_news_count: news.length,
        fetched_news_count: news.length,
        expanded_topics_count: feeds.length,
        fallback_reason: fallbackReason,
        selected_news_titles: news.map((n) => n.title),
        selected_news_sources: news.map((n) => n.source),
      })
    );

    if (news.length === 0) {
      const rejectionSamples = collection.perTopicStats.flatMap((s) =>
        s.selectedCount === 0 && s.rawCount > 0 ? [{ topic: s.topic, raw_count: s.rawCount }] : []
      );
      console.log(
        JSON.stringify({
          event: "daily_radio_no_usable_news",
          radio_slot: radioSlot,
          user_id: user.user_id,
          raw_candidate_count: collection.rawCandidateCount,
          hard_rejected_count: collection.hardRejectedCount,
          requested_duration: requestedDuration,
          final_duration: duration,
          rejection_reasons: collection.perTopicStats.map((s) => ({
            topic: s.topic,
            raw_count: s.rawCount,
            hard_rejected_count: s.hardRejectedCount,
            fallback_level: s.fallbackLevel,
          })),
          sample_titles: [],
          topics_with_zero_selection: rejectionSamples,
        })
      );
      throw new Error(
        radioSlot === "evening"
          ? collection.rawCandidateCount === 0
            ? "無法取得晚報新新聞（RSS 來源暫無資料）"
            : "無法取得晚報新新聞（所有候選均為無關或垃圾內容）"
          : collection.rawCandidateCount === 0
            ? "無法取得新聞（RSS 來源暫無資料）"
            : "無法取得新聞（所有候選均為無關或垃圾內容）"
      );
    }

    const claim = await supabase
      .from("news_daily_radio_scripts")
      .upsert(
        {
          user_id: user.user_id,
          script_date: scriptDate,
          duration_minutes: duration,
          radio_slot: radioSlot,
          status: "generating",
          generation_source: SERVER_SOURCE,
          is_daily_auto: true,
          error_message: null,
          source_news: [],
          updated_at: new Date().toISOString(),
        },
        { onConflict: UPSERT_CONFLICT }
      )
      .select("id")
      .single();

    if (claim.error) {
      throw new Error(claim.error.message);
    }

    scriptId = (claim.data as { id: string } | null)?.id ?? null;

    console.log("generating script", {
      user_id: user.user_id,
      radio_slot: radioSlot,
      topics,
      custom_keywords: customKeywords,
      fetched_news_count: news.length,
      fresh_rss: true,
      requested_duration: requestedDuration,
      final_duration: duration,
      fallback_reason: fallbackReason,
    });

    logDailyRadioNewsSelection({
      scriptId,
      radioSlot,
      news,
    });
    logNewsFreshnessWarning({
      radioSlot,
      news,
      freshnessWindowHours: radioSlot === "evening" ? 24 : 36,
    });

    const anchorPrefs = resolveAnchorSettings(user);
    const { script, title } = await generateRadioScript(openaiKey, news, {
      radioSlot,
      displayName: user.display_name,
      anchorName: anchorPrefs.anchorName,
      morningHeadlines: radioSlot === "evening" ? morningHeadlines : undefined,
      durationMinutes: duration,
      limitedNews:
        duration === 10
          ? news.length < finalRule.min
          : duration === 5
            ? news.length < AUTO_DURATION_RULES[5].min
            : news.length < AUTO_DURATION_RULES[3].min,
      enrichedCoverage:
        duration === 10 &&
        news.length >= finalRule.min &&
        news.length < finalRule.targetMin,
    });

    const finalScript = appendRadioClosing(script, radioSlot);

    console.log("AI generation succeeded", {
      user_id: user.user_id,
      radio_slot: radioSlot,
      script_length: finalScript.length,
      duration_minutes: duration,
      closing_applied: finalScript.length !== script.trim().length,
    });

    const { error: saveError } = await supabase
      .from("news_daily_radio_scripts")
      .update({
        title: title || slotScriptTitle(radioSlot),
        script_text: finalScript,
        source_news: news,
        status: "completed",
        error_message: null,
        generation_source: SERVER_SOURCE,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.user_id)
      .eq("script_date", scriptDate)
      .eq("duration_minutes", duration)
      .eq("generation_source", SERVER_SOURCE)
      .eq("radio_slot", radioSlot);

    if (saveError) throw new Error(saveError.message);

    console.log("[DailyRadioCron] script generated", {
      user_id: user.user_id,
      script_id: scriptId,
      script_date: scriptDate,
      radio_slot: radioSlot,
      generation_source: SERVER_SOURCE,
      source_news_count: news.length,
    });

    const savedRow =
      (await fetchScriptBySource(
        supabase,
        user.user_id,
        scriptDate,
        duration,
        SERVER_SOURCE,
        radioSlot
      )) ?? ({
        id: scriptId ?? "",
        status: "completed",
        updated_at: new Date().toISOString(),
        push_sent_at: null,
        generation_source: SERVER_SOURCE,
        radio_slot: radioSlot,
        script_date: scriptDate,
        script_text: finalScript,
      } as ScriptRow);

    const { audioReady } = await ensureAnchorAudioBeforePush(
      supabase,
      openaiKey,
      user,
      savedRow,
      scriptDate,
      duration,
      radioSlot
    );

    const pushResult = await sendDailyRadioPush(
      supabase,
      user,
      scriptDate,
      duration,
      radioSlot,
      serverRow,
      scriptId,
      options,
      {
        anchorName: anchorPrefs.anchorName,
        hasAnchorAudio: audioReady,
        audioReady,
        durationMinutes: duration,
        newsCount: news.length,
        triggerPath: "generate_daily_radio",
      }
    );

    if (pushResult.push_status === "sent") {
      if (audioReady) {
        console.log("[DailyRadioCron] push sent after audio ready", {
          user_id: user.user_id,
          script_id: scriptId,
          script_date: scriptDate,
          radio_slot: radioSlot,
        });
      } else {
        console.log("[DailyRadioCron] fallback push sent (no anchor audio)", {
          user_id: user.user_id,
          script_id: scriptId,
          script_date: scriptDate,
          radio_slot: radioSlot,
        });
      }
    }

    const result: ProcessResult = {
      user_id: user.user_id,
      radio_slot: radioSlot,
      status: "completed",
      script_id: scriptId ?? undefined,
      reason:
        pushResult.push_status === "failed"
          ? "partial_success_push_failed"
          : pushResult.push_status === "no_token"
            ? "partial_success_no_push_token"
            : undefined,
    };
    if (pushResult.push_status === "failed" || pushResult.push_status === "no_token") {
      result.push_status = pushResult.push_status;
      if (pushResult.push_error) result.push_error = pushResult.push_error;
    }
    if (options.sendTestPush) {
      result.push_status = pushResult.push_status;
      if (pushResult.push_error) result.push_error = pushResult.push_error;
    }
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "generation failed";
    console.error("slot failed", {
      user_id: user.user_id,
      radio_slot: radioSlot,
      error: msg,
    });
    await upsertFailed(supabase, user.user_id, scriptDate, duration, radioSlot, msg);
    return {
      user_id: user.user_id,
      radio_slot: radioSlot,
      status: "failed",
      reason: msg,
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureTodayAudioAndPush(
  supabase: any,
  user: UserPrefs,
  scriptDate: string,
  duration: number,
  radioSlot: RadioSlot,
  serverRow: ScriptRow,
  openaiKey: string,
  options: ProcessOptions
): Promise<ProcessResult> {
  const fullRow =
    serverRow.script_text !== undefined
      ? serverRow
      : ((await fetchScriptBySource(
          supabase,
          user.user_id,
          scriptDate,
          duration,
          SERVER_SOURCE,
          radioSlot
        )) ?? serverRow);

  if (fullRow.script_date && fullRow.script_date !== scriptDate) {
    console.warn("ensureTodayAudioAndPush skipped: script_date mismatch", {
      user_id: user.user_id,
      expected_script_date: scriptDate,
      actual_script_date: fullRow.script_date,
      script_id: fullRow.id,
    });
    return {
      user_id: user.user_id,
      radio_slot: radioSlot,
      status: "skipped",
      reason: "script_date_mismatch",
      script_id: fullRow.id,
    };
  }

  console.log("ensure today server script audio and push", {
    user_id: user.user_id,
    script_id: fullRow.id,
    script_date: scriptDate,
    radio_slot: radioSlot,
    push_sent_at: fullRow.push_sent_at,
  });

  const anchorPrefs = resolveAnchorSettings(user);
  const { audioReady } = await ensureAnchorAudioBeforePush(
    supabase,
    openaiKey,
    user,
    fullRow,
    scriptDate,
    duration,
    radioSlot
  );

  const pushResult = await sendDailyRadioPush(
    supabase,
    user,
    scriptDate,
    duration,
    radioSlot,
    fullRow,
    fullRow.id,
    options,
    {
      anchorName: anchorPrefs.anchorName,
      hasAnchorAudio: audioReady,
      audioReady,
      durationMinutes: duration,
      newsCount: sourceNewsCount(fullRow.source_news),
      triggerPath: "ensure_audio_and_push",
    }
  );

  if (pushResult.push_status === "sent") {
    if (audioReady) {
      console.log("[DailyRadioCron] push sent after audio ready", {
        user_id: user.user_id,
        script_id: fullRow.id,
        script_date: scriptDate,
        radio_slot: radioSlot,
      });
    } else {
      console.log("[DailyRadioCron] fallback push sent (no anchor audio)", {
        user_id: user.user_id,
        script_id: fullRow.id,
        script_date: scriptDate,
        radio_slot: radioSlot,
      });
    }
  }

  const result: ProcessResult = {
    user_id: user.user_id,
    radio_slot: radioSlot,
    status: "completed",
    reason:
      pushResult.push_status === "failed"
        ? "partial_success_push_failed"
        : pushResult.push_status === "no_token"
          ? "partial_success_no_push_token"
          : "today_audio_and_push_ensured",
    script_id: fullRow.id,
  };
  if (pushResult.push_status === "failed" || pushResult.push_status === "no_token") {
    result.push_status = pushResult.push_status;
    if (pushResult.push_error) result.push_error = pushResult.push_error;
  }
  if (options.sendTestPush) {
    result.push_status = pushResult.push_status;
    if (pushResult.push_error) result.push_error = pushResult.push_error;
  }
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendTestPushForExistingScript(
  supabase: any,
  user: UserPrefs,
  scriptDate: string,
  duration: number,
  radioSlot: RadioSlot,
  serverRow: ScriptRow,
  openaiKey: string,
  options: ProcessOptions
): Promise<ProcessResult> {
  console.log("send_test_push: existing server completed script found", {
    user_id: user.user_id,
    script_id: serverRow.id,
    script_date: scriptDate,
    radio_slot: radioSlot,
  });

  const fullRow =
    serverRow.script_text !== undefined
      ? serverRow
      : ((await fetchScriptBySource(
          supabase,
          user.user_id,
          scriptDate,
          duration,
          SERVER_SOURCE,
          radioSlot
        )) ?? serverRow);

  const anchorPrefs = resolveAnchorSettings(user);
  const { audioReady } = await ensureAnchorAudioBeforePush(
    supabase,
    openaiKey,
    user,
    fullRow,
    scriptDate,
    duration,
    radioSlot
  );

  const pushResult = await sendDailyRadioPush(
    supabase,
    user,
    scriptDate,
    duration,
    radioSlot,
    fullRow,
    fullRow.id,
    { ...options, force: true, sendTestPush: true },
    {
      anchorName: anchorPrefs.anchorName,
      hasAnchorAudio: audioReady,
      audioReady,
      durationMinutes: duration,
      newsCount: sourceNewsCount(fullRow.source_news),
      triggerPath: "test_push",
    }
  );

  if (pushResult.push_status === "no_token") {
    return {
      user_id: user.user_id,
      radio_slot: radioSlot,
      status: "no_push_token",
      script_id: serverRow.id,
      reason: "no_push_token",
      push_status: pushResult.push_status,
      push_error: pushResult.push_error,
    };
  }

  if (pushResult.push_status === "failed") {
    console.log("push failed", {
      user_id: user.user_id,
      radio_slot: radioSlot,
      test: true,
      existing_script: true,
      push_error: pushResult.push_error,
    });
    return {
      user_id: user.user_id,
      radio_slot: radioSlot,
      status: "test_push_sent_existing_script",
      script_id: serverRow.id,
      reason: "push_failed",
      push_status: pushResult.push_status,
      push_error: pushResult.push_error,
    };
  }

  console.log("test push sent for existing server script", {
    user_id: user.user_id,
    script_id: serverRow.id,
    radio_slot: radioSlot,
    type: "daily_radio_completed",
    push_status: pushResult.push_status,
  });

  return {
    user_id: user.user_id,
    radio_slot: radioSlot,
    status: "test_push_sent_existing_script",
    script_id: serverRow.id,
    push_status: pushResult.push_status,
  };
}

type SendDailyRadioPushResult = PushSendResult & {
  claim_skipped?: boolean;
};

function logPushDelivery(stage: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event: stage, ...fields }));
}

function sanitizePushError(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/bearer\s+\S+/gi, "bearer [redacted]")
    .slice(0, 500);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function claimPushDelivery(
  supabase: any,
  userId: string,
  scriptDate: string,
  duration: number,
  radioSlot: RadioSlot
): Promise<{
  claimed: boolean;
  pushSentAtBefore: string | null;
  pushClaimedAtBefore: string | null;
  scriptId: string | null;
  reclaimExpired: boolean;
  skipReason: "already_sent" | "claim_active" | "claim_failed" | null;
}> {
  const { data: beforeRow } = await supabase
    .from("news_daily_radio_scripts")
    .select("id, push_sent_at, push_claimed_at")
    .eq("user_id", userId)
    .eq("script_date", scriptDate)
    .eq("duration_minutes", duration)
    .eq("generation_source", SERVER_SOURCE)
    .eq("radio_slot", radioSlot)
    .maybeSingle();

  const row = beforeRow as {
    id?: string;
    push_sent_at?: string | null;
    push_claimed_at?: string | null;
  } | null;

  const pushSentAtBefore = row?.push_sent_at ?? null;
  const pushClaimedAtBefore = row?.push_claimed_at ?? null;
  const scriptId = row?.id ?? null;

  if (pushSentAtBefore) {
    return {
      claimed: false,
      pushSentAtBefore,
      pushClaimedAtBefore,
      scriptId,
      reclaimExpired: false,
      skipReason: "already_sent",
    };
  }

  const now = new Date().toISOString();
  const claimExpiresBefore = new Date(Date.now() - PUSH_CLAIM_TTL_MS).toISOString();
  const reclaimExpired =
    Boolean(pushClaimedAtBefore) && pushClaimedAtBefore! < claimExpiresBefore;

  const { data: claimedRow, error } = await supabase
    .from("news_daily_radio_scripts")
    .update({
      push_claimed_at: now,
      push_last_attempt_at: now,
      updated_at: now,
    })
    .eq("user_id", userId)
    .eq("script_date", scriptDate)
    .eq("duration_minutes", duration)
    .eq("generation_source", SERVER_SOURCE)
    .eq("radio_slot", radioSlot)
    .is("push_sent_at", null)
    .or(`push_claimed_at.is.null,push_claimed_at.lt.${claimExpiresBefore}`)
    .select("id, push_sent_at, push_claimed_at")
    .maybeSingle();

  if (error) {
    logPushDelivery("push_claim_skipped", {
      user_id: userId,
      radio_slot: radioSlot,
      reason: "claim_update_error",
      error_message: error.message,
    });
    return {
      claimed: false,
      pushSentAtBefore,
      pushClaimedAtBefore,
      scriptId,
      reclaimExpired: false,
      skipReason: "claim_failed",
    };
  }

  if (!claimedRow) {
    const skipReason =
      pushClaimedAtBefore && pushClaimedAtBefore >= claimExpiresBefore
        ? "claim_active"
        : "claim_failed";
    logPushDelivery("push_claim_skipped", {
      user_id: userId,
      radio_slot: radioSlot,
      reason: skipReason,
      push_claimed_at_before: pushClaimedAtBefore,
      claim_expires_before: claimExpiresBefore,
    });
    return {
      claimed: false,
      pushSentAtBefore,
      pushClaimedAtBefore,
      scriptId,
      reclaimExpired: false,
      skipReason,
    };
  }

  if (reclaimExpired) {
    logPushDelivery("push_claim_expired_reclaimed", {
      user_id: userId,
      radio_slot: radioSlot,
      script_id: (claimedRow as { id: string }).id,
      push_claimed_at_before: pushClaimedAtBefore,
      claim_expires_before: claimExpiresBefore,
    });
  } else {
    logPushDelivery("push_claim_acquired", {
      user_id: userId,
      radio_slot: radioSlot,
      script_id: (claimedRow as { id: string }).id,
    });
  }

  return {
    claimed: true,
    pushSentAtBefore,
    pushClaimedAtBefore,
    scriptId: (claimedRow as { id: string }).id ?? scriptId,
    reclaimExpired,
    skipReason: null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function markPushApnsSuccess(
  supabase: any,
  userId: string,
  scriptDate: string,
  duration: number,
  radioSlot: RadioSlot
): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from("news_daily_radio_scripts")
    .update({
      push_sent_at: now,
      push_claimed_at: null,
      push_last_error: null,
      push_last_attempt_at: now,
      updated_at: now,
    })
    .eq("user_id", userId)
    .eq("script_date", scriptDate)
    .eq("duration_minutes", duration)
    .eq("generation_source", SERVER_SOURCE)
    .eq("radio_slot", radioSlot)
    .is("push_sent_at", null);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function releasePushClaimOnFailure(
  supabase: any,
  userId: string,
  scriptDate: string,
  duration: number,
  radioSlot: RadioSlot,
  errorMessage: string
): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from("news_daily_radio_scripts")
    .update({
      push_claimed_at: null,
      push_last_error: sanitizePushError(errorMessage),
      push_last_attempt_at: now,
      updated_at: now,
    })
    .eq("user_id", userId)
    .eq("script_date", scriptDate)
    .eq("duration_minutes", duration)
    .eq("generation_source", SERVER_SOURCE)
    .eq("radio_slot", radioSlot);
  logPushDelivery("push_claim_released", {
    user_id: userId,
    radio_slot: radioSlot,
    reason: "apns_failed",
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendDailyRadioPush(
  supabase: any,
  user: UserPrefs,
  scriptDate: string,
  duration: number,
  radioSlot: RadioSlot,
  serverRow: ScriptRow | null,
  scriptId: string | null,
  options: ProcessOptions,
  pushMeta?: {
    anchorName?: string;
    hasAnchorAudio?: boolean;
    audioReady?: boolean;
    durationMinutes?: number;
    newsCount?: number;
    triggerPath?: string;
  }
): Promise<SendDailyRadioPushResult> {
  const forceTestPush = options.sendTestPush;
  const userPlan = userPlanLabel(user);
  const triggerPath = pushMeta?.triggerPath ?? "generate_daily_radio";
  const resolvedScriptId = scriptId ?? serverRow?.id ?? null;
  const pushToken = user.push_token?.trim() ?? "";
  const deviceKey = pushToken
    ? `${scriptDate}:${radioSlot}:${pushToken}`
    : `${scriptDate}:${radioSlot}:no_token:${user.user_id}`;
  const tokenCountBeforeDedupe = pushToken
    ? (options.pushTokenIndex.get(pushToken) ?? 1)
    : 0;
  const tokenAlreadySentInRun = pushToken
    ? options.pushDedup.sentDeviceKeys.has(deviceKey)
    : false;
  const tokenCountAfterDedupe =
    pushToken && !tokenAlreadySentInRun && !forceTestPush ? 1 : pushToken ? 0 : 0;

  const baseAttempt = {
    user_id: user.user_id,
    display_name: user.display_name?.trim() || "朋友",
    user_plan: userPlan,
    radio_slot: radioSlot,
    script_date: scriptDate,
    script_id: resolvedScriptId,
    trigger_path: triggerPath,
    push_sent_at_before: serverRow?.push_sent_at ?? null,
    device_token_prefix: pushToken ? tokenPrefix(pushToken) : null,
    token_count_before_dedupe: tokenCountBeforeDedupe,
    token_count_after_dedupe: tokenCountAfterDedupe,
  };

  const logAttempt = (
    fields: Partial<DailyRadioPushAttemptLog>
  ) => {
    logDailyRadioPushAttempt({
      event: "daily_radio_push_attempt",
      claim_success: null,
      skipped_reason: null,
      final_push_count: 0,
      ...baseAttempt,
      ...fields,
    });
  };

  if (!forceTestPush && radioSlot === "evening" && !isProUser(user)) {
    logAttempt({
      claim_success: false,
      skipped_reason: "free_evening_push_not_allowed",
      final_push_count: 0,
      token_count_after_dedupe: 0,
    });
    return {
      push_status: "no_token",
      push_error: "free_evening_push_not_allowed",
      claim_skipped: true,
    };
  }

  if (!forceTestPush && serverRow?.push_sent_at) {
    logAttempt({
      claim_success: false,
      skipped_reason: "push_already_sent",
      final_push_count: 0,
      push_sent_at_before: serverRow.push_sent_at,
      token_count_after_dedupe: 0,
    });
    return { push_status: "sent" };
  }

  if (!forceTestPush && options.pushDedup.sentDeviceKeys.has(deviceKey)) {
    logAttempt({
      claim_success: false,
      skipped_reason: "duplicate_device_token",
      final_push_count: 0,
      token_count_after_dedupe: 0,
    });
    return { push_status: "sent" };
  }

  let claimed = forceTestPush;
  let pushSentAtBefore = serverRow?.push_sent_at ?? null;

  if (!forceTestPush) {
    const claim = await claimPushDelivery(
      supabase,
      user.user_id,
      scriptDate,
      duration,
      radioSlot
    );
    pushSentAtBefore = claim.pushSentAtBefore;
    claimed = claim.claimed;

    if (!claimed) {
      const skippedReason =
        claim.skipReason === "already_sent"
          ? "push_already_sent"
          : claim.skipReason === "claim_active"
            ? "push_claim_active"
            : "push_claim_failed";
      logAttempt({
        push_sent_at_before: pushSentAtBefore,
        token_count_after_dedupe: 0,
        claim_success: false,
        skipped_reason: skippedReason,
        final_push_count: 0,
      });
      if (claim.skipReason === "already_sent") {
        return { push_status: "sent" };
      }
      return { push_status: "no_token", push_error: skippedReason, claim_skipped: true };
    }
  }

  const pushResult = await sendDailyRadioCompletedPush(
    pushToken || null,
    user.display_name,
    user.push_platform,
    {
      radioSlot,
      scriptId: resolvedScriptId ?? undefined,
      anchorName: pushMeta?.anchorName,
      hasAnchorAudio: pushMeta?.audioReady === true,
      audioReady: pushMeta?.audioReady === true,
      durationMinutes: pushMeta?.durationMinutes ?? duration,
      newsCount: pushMeta?.newsCount,
      pushEnvironment: user.push_environment,
    }
  );

  if (pushResult.push_status === "sent") {
    if (!forceTestPush) {
      await markPushApnsSuccess(
        supabase,
        user.user_id,
        scriptDate,
        duration,
        radioSlot
      );
      options.pushDedup.sentDeviceKeys.add(deviceKey);
    }
    options.finalPushCount.value += 1;
    logPushDelivery("push_apns_success", {
      user_id: user.user_id,
      radio_slot: radioSlot,
      script_id: resolvedScriptId,
      force_test_push: forceTestPush,
    });
    logAttempt({
      push_sent_at_before: pushSentAtBefore,
      claim_success: forceTestPush ? null : true,
      skipped_reason: null,
      final_push_count: 1,
      token_count_after_dedupe: pushToken ? 1 : 0,
    });
  } else {
    if (!forceTestPush && claimed) {
      await releasePushClaimOnFailure(
        supabase,
        user.user_id,
        scriptDate,
        duration,
        radioSlot,
        pushResult.push_error ?? pushResult.push_status
      );
      options.pushFailureCount.value += 1;
    }
    logPushDelivery("push_apns_failed", {
      user_id: user.user_id,
      radio_slot: radioSlot,
      script_id: resolvedScriptId,
      push_status: pushResult.push_status,
      push_error: sanitizePushError(pushResult.push_error ?? pushResult.push_status),
    });
    logAttempt({
      push_sent_at_before: pushSentAtBefore,
      claim_success: forceTestPush ? null : claimed,
      skipped_reason: pushToken ? "push_send_failed" : "no_push_token",
      final_push_count: 0,
      token_count_after_dedupe: 0,
    });
  }

  return pushResult;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertFailed(
  supabase: any,
  userId: string,
  scriptDate: string,
  duration: number,
  radioSlot: RadioSlot,
  errorMessage: string
) {
  await supabase.from("news_daily_radio_scripts").upsert(
    {
      user_id: userId,
      script_date: scriptDate,
      duration_minutes: duration,
      radio_slot: radioSlot,
      status: "failed",
      error_message: errorMessage.slice(0, 500),
      generation_source: SERVER_SOURCE,
      updated_at: new Date().toISOString(),
    },
    { onConflict: UPSERT_CONFLICT }
  );
}

