import { DAILY_SCRIPT_TIMEZONE, hourInTimezone, todayYmdInTimezone } from "./dateLocal";
import type { DailyRadioGenerationSource } from "./dailyRadio";
import { readDailyRadioState, readUserDisplayName } from "./dailyRadio";
import type { RadioSlot } from "./radioSlot";
import { EVENING_RADIO_TIME, MORNING_RADIO_TIME } from "./radioSlot";
import { appendRadioClosing } from "./radioClosing";
import {
  DEFAULT_AI_ANCHOR_SETTINGS,
  getAnchorById,
  readAnchorId,
  readAnchorPlaybackRate,
  readAnchorStyleId,
} from "./aiAnchorSettings";
import { normalizeAutoRadioDuration } from "./aiDuration";
import { isInternalAccessActive } from "./hiddenDevUnlock";
import { getProStatus, isProActive } from "./pro";
import {
  GUARDED_PREFERENCE_FIELDS,
  buildPushTokenUpdatePayload,
  preferenceFieldsUnchanged,
} from "../shared/pushPreferenceIsolation.mjs";
import {
  logPrefSync,
  recordPreferenceSyncResult,
  recordPushTokenSyncDiagnostics,
  setLastSyncedTimezone,
} from "./prefSyncTrace";
import { readStoredSelectedTopics } from "./TopicOnboardingScreen";
import type { PushEnvironment } from "./plugins/pushEnvironment";
import {
  ensureSupabaseUser,
  getLocalTimezone,
  getSupabase,
  isSupabaseConfigured,
  type DailyRadioScriptRow,
} from "./supabaseClient";
import { logPushNavTrace, userIdPrefix } from "./pushNavTrace";

const CUSTOM_KEYWORDS_STORAGE_KEY = "pns_custom_keywords_v1";

function readStoredCustomKeywords(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEYWORDS_STORAGE_KEY);
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

/** 登入後僅在「尚無偏好列」時寫入預設；不可覆寫既有 Pro / 主播 / 時長。 */
export async function ensureUserNewsPreferencesRow(): Promise<boolean> {
  if (!isSupabaseConfigured()) return true;

  const userId = await ensureSupabaseUser();
  if (!userId) return false;

  const supabase = getSupabase();
  if (!supabase) return false;

  const { data: existing, error: readError } = await supabase
    .from("news_user_preferences")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) {
    console.warn("[DailyRadio] ensure preferences row read failed", readError.message);
    return false;
  }

  if (existing) return true;

  const topics = readStoredSelectedTopics();
  const customKeywords = readStoredCustomKeywords();

  return syncUserNewsPreferences({
    topics,
    customKeywords,
    dailyRadioEnabled: true,
    morningRadioEnabled: true,
    eveningRadioEnabled: false,
    morningDurationMinutes: 3,
    eveningDurationMinutes: 3,
    trigger: "ensure_row",
  });
}

/** @deprecated 使用 ensureUserNewsPreferencesRow */
export async function bootstrapServerPreferencesFromLocal(): Promise<boolean> {
  return ensureUserNewsPreferencesRow();
}

export async function syncAnchorPreferencesFromLocalStorage(options?: {
  trigger?: string;
}): Promise<boolean> {
  if (!isSupabaseConfigured()) return true;

  const trigger = options?.trigger ?? "local_storage";
  const userId = await ensureSupabaseUser();
  const pro = getProStatus();
  const isProNow = isProActive(pro);
  const voiceOn = isProNow || isInternalAccessActive();
  const radio = readDailyRadioState();
  const anchorId = readAnchorId();
  const anchorStyleId = readAnchorStyleId();
  const morningDur = normalizeAutoRadioDuration(radio.morningDuration, isProNow);
  const eveningDur = normalizeAutoRadioDuration(radio.eveningDuration, isProNow);

  logPrefSync("preference_sync_start", {
    trigger,
    userId,
    proStatus: pro,
    anchor: `${anchorId}/${getAnchorById(anchorId).voice}/${anchorStyleId}`,
    morningDuration: morningDur,
    eveningEnabled: isProNow,
    eveningDuration: eveningDur,
  });

  await ensureUserNewsPreferencesRow();

  const ok = await syncUserNewsPreferences({
    topics: readStoredSelectedTopics(),
    customKeywords: readStoredCustomKeywords(),
    displayName: readUserDisplayName(),
    dailyRadioEnabled: true,
    morningRadioEnabled: true,
    eveningRadioEnabled: isProNow,
    morningRadioTime: radio.scheduledTime || MORNING_RADIO_TIME,
    eveningRadioTime: radio.eveningTime || EVENING_RADIO_TIME,
    morningDurationMinutes: morningDur,
    eveningDurationMinutes: eveningDur,
    isPro: isProNow,
    anchorId,
    anchorVoice: getAnchorById(anchorId).voice,
    anchorStyle: anchorStyleId,
    playbackRate: readAnchorPlaybackRate(),
    voiceFeatureEnabled: voiceOn,
    trigger,
  });

  if (ok) {
    setLastSyncedTimezone(getLocalTimezone());
    recordPreferenceSyncResult(true);
    logPrefSync("preference_sync_success", {
      trigger,
      userId,
      proStatus: pro,
      anchor: `${anchorId}/${getAnchorById(anchorId).voice}/${anchorStyleId}`,
      morningDuration: morningDur,
      eveningEnabled: isProNow,
      eveningDuration: eveningDur,
    });
  } else {
    recordPreferenceSyncResult(false, "sync failed");
    logPrefSync("preference_sync_error", {
      trigger,
      userId,
      proStatus: pro,
      error: "syncUserNewsPreferences returned false",
    });
  }

  return ok;
}

export type ServerDailyScript = {
  id: string;
  scriptDate: string;
  scriptText: string;
  title: string | null;
  status: DailyRadioScriptRow["status"];
  generationSource: DailyRadioGenerationSource;
  radioSlot: RadioSlot;
  durationMinutes: number;
  sourceNews: unknown;
  errorMessage: string | null;
  audioUrl: string | null;
  audioVoice: string | null;
  audioStyle: string | null;
  audioGeneratedAt: string | null;
  audioExpiresAt: string | null;
};

export type DailyScriptQueryDebug = {
  userId: string;
  scriptDate: string;
  durationMinutes: number;
  rowCount: number;
  status: string | null;
  generationSource: string | null;
  scriptId: string | null;
  radioSlot: RadioSlot | null;
};

export type FetchTodayScriptResult =
  | { kind: "unconfigured" }
  | { kind: "no_user"; debug?: DailyScriptQueryDebug }
  | { kind: "not_found"; debug: DailyScriptQueryDebug }
  | { kind: "pending"; status: DailyRadioScriptRow["status"]; debug: DailyScriptQueryDebug }
  | { kind: "ready"; script: ServerDailyScript; debug: DailyScriptQueryDebug };

export type FetchScriptOptions = {
  scriptId?: string;
  radioSlot?: RadioSlot;
};

export function getDailyScriptDate(): string {
  return todayYmdInTimezone(DAILY_SCRIPT_TIMEZONE);
}

function mapRow(row: DailyRadioScriptRow): ServerDailyScript {
  return {
    id: row.id,
    scriptDate: row.script_date,
    scriptText: row.script_text,
    title: row.title,
    status: row.status,
    generationSource: row.generation_source,
    radioSlot: row.radio_slot ?? "morning",
    durationMinutes: row.duration_minutes ?? 3,
    sourceNews: row.source_news,
    errorMessage: row.error_message,
    audioUrl: row.audio_url ?? null,
    audioVoice: row.audio_voice ?? null,
    audioStyle: row.audio_style ?? null,
    audioGeneratedAt: row.audio_generated_at ?? null,
    audioExpiresAt: row.audio_expires_at ?? null,
  };
}

function pickDisplayScript(rows: DailyRadioScriptRow[]): DailyRadioScriptRow | null {
  const completed = rows.filter((r) => r.status === "completed" && r.script_text.trim());
  if (completed.length === 0) return null;

  const serverRows = completed.filter((r) => r.generation_source === "server");
  const appRows = completed.filter((r) => r.generation_source === "app");
  const eveningServer = serverRows.find((r) => r.radio_slot === "evening");
  const morningServer = serverRows.find((r) => r.radio_slot === "morning");
  const eveningApp = appRows.find((r) => r.radio_slot === "evening");
  const morningApp = appRows.find((r) => r.radio_slot === "morning");

  const hour = hourInTimezone(DAILY_SCRIPT_TIMEZONE);
  if (hour >= 17) {
    return eveningServer ?? eveningApp ?? morningServer ?? morningApp ?? completed[0];
  }
  return morningServer ?? morningApp ?? eveningServer ?? eveningApp ?? completed[0];
}

/** 依 primary key 載入 completed script；驗證 user_id 與 status。 */
export async function getDailyRadioScriptById(
  scriptId: string
): Promise<FetchTodayScriptResult> {
  return fetchServerDailyScript({ scriptId });
}

export async function fetchServerDailyScript(
  options: FetchScriptOptions = {}
): Promise<FetchTodayScriptResult> {
  if (!isSupabaseConfigured()) return { kind: "unconfigured" };

  const userId = await ensureSupabaseUser();
  const scriptDate = getDailyScriptDate();

  if (!userId) {
    console.warn("[DailyRadio] fetch skipped: no auth user");
    return {
      kind: "no_user",
      debug: {
        userId: "",
        scriptDate,
        durationMinutes: 3,
        rowCount: 0,
        status: null,
        generationSource: null,
        scriptId: null,
        radioSlot: null,
      },
    };
  }

  const supabase = getSupabase();
  if (!supabase) return { kind: "unconfigured" };

  if (options.scriptId) {
    logPushNavTrace({
      phase: "fetch_by_script_id_start",
      scriptId: options.scriptId,
      requestedRadioSlot: options.radioSlot ?? null,
      authUserId: userId,
      caller: "fetchServerDailyScript",
      extra: {
        query: "news_daily_radio_scripts",
        filters: { user_id: userIdPrefix(userId), id: options.scriptId.slice(0, 8) },
      },
    });

    const { data, error } = await supabase
      .from("news_daily_radio_scripts")
      .select("*")
      .eq("user_id", userId)
      .eq("id", options.scriptId)
      .maybeSingle();

    const row = data as DailyRadioScriptRow | null;
    if (error || !row || row.status !== "completed" || !row.script_text.trim()) {
      logPushNavTrace({
        phase: "fetch_by_script_id_result",
        scriptId: options.scriptId,
        queryKind: "not_found",
        rowCount: row ? 1 : 0,
        errorCode: error?.code ?? null,
        errorMessage: error?.message ?? (row ? `status=${row.status}` : "no_row"),
        status: row?.status ?? null,
        requestedRadioSlot: row?.radio_slot ?? options.radioSlot ?? null,
        hasAudioUrl: Boolean(row?.audio_url?.trim()),
        caller: "fetchServerDailyScript",
      });
      if (options.scriptId) {
        logPushNavTrace({
          phase: "script_id_query_failed",
          scriptId: options.scriptId,
          errorMessage: error?.message ?? "script_not_ready_or_missing",
          caller: "fetchServerDailyScript",
        });
      }
      return {
        kind: "not_found",
        debug: {
          userId,
          scriptDate,
          durationMinutes: row?.duration_minutes ?? 3,
          rowCount: row ? 1 : 0,
          status: row?.status ?? null,
          generationSource: row?.generation_source ?? null,
          scriptId: options.scriptId,
          radioSlot: row?.radio_slot ?? options.radioSlot ?? null,
        },
      };
    }

    logPushNavTrace({
      phase: "fetch_by_script_id_result",
      scriptId: row.id,
      queryKind: "ready",
      rowCount: 1,
      status: row.status,
      requestedRadioSlot: row.radio_slot,
      hasAudioUrl: Boolean(row.audio_url?.trim()),
      caller: "fetchServerDailyScript",
    });

    return {
      kind: "ready",
      script: mapRow(row),
      debug: {
        userId,
        scriptDate: row.script_date,
        durationMinutes: row.duration_minutes,
        rowCount: 1,
        status: row.status,
        generationSource: row.generation_source,
        scriptId: row.id,
        radioSlot: row.radio_slot ?? "morning",
      },
    };
  }

  let query = supabase
    .from("news_daily_radio_scripts")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .eq("script_date", scriptDate)
    .eq("status", "completed");

  if (options.radioSlot) {
    logPushNavTrace({
      phase: "fallback_by_slot_start",
      requestedRadioSlot: options.radioSlot,
      authUserId: userId,
      caller: "fetchServerDailyScript",
      extra: { script_date: scriptDate },
    });
    query = query.eq("radio_slot", options.radioSlot);
  }

  const { data, error, count } = await query;
  const rows = (data ?? []) as DailyRadioScriptRow[];
  const rowCount = count ?? rows.length;

  console.log("[DailyRadio] fetching today script", {
    user_id: userId,
    script_date: scriptDate,
    row_count: rowCount,
    radio_slot_filter: options.radioSlot ?? null,
    timezone: DAILY_SCRIPT_TIMEZONE,
  });

  const selected = options.radioSlot
    ? rows.find((r) => r.generation_source === "server" && r.script_text.trim()) ??
      rows.find((r) => r.generation_source === "app" && r.script_text.trim()) ??
      null
    : pickDisplayScript(rows);

  const debug: DailyScriptQueryDebug = {
    userId,
    scriptDate,
    durationMinutes: selected?.duration_minutes ?? 3,
    rowCount,
    status: selected?.status ?? rows[0]?.status ?? null,
    generationSource: selected?.generation_source ?? null,
    scriptId: selected?.id ?? null,
    radioSlot: selected?.radio_slot ?? options.radioSlot ?? null,
  };

  if (error) {
    console.warn("[DailyRadio] daily radio server script fetch failed", error.message);
    return { kind: "not_found", debug };
  }

  if (selected) {
    if (options.radioSlot) {
      logPushNavTrace({
        phase: "fallback_by_slot_result",
        scriptId: selected.id,
        requestedRadioSlot: options.radioSlot,
        rowCount,
        status: selected.status,
        hasAudioUrl: Boolean(selected.audio_url?.trim()),
        caller: "fetchServerDailyScript",
        extra: { queryKind: "ready" },
      });
    }
    console.log("[DailyRadio] daily radio script loaded", {
      id: selected.id,
      generation_source: selected.generation_source,
      radio_slot: selected.radio_slot,
      user_id: userId,
      script_date: scriptDate,
    });
    return { kind: "ready", script: mapRow(selected), debug };
  }

  let pendingQuery = supabase
    .from("news_daily_radio_scripts")
    .select("id, status, generation_source, radio_slot, duration_minutes")
    .eq("user_id", userId)
    .eq("script_date", scriptDate)
    .eq("generation_source", "server")
    .in("status", ["generating", "pending", "failed"]);

  if (options.radioSlot) {
    pendingQuery = pendingQuery.eq("radio_slot", options.radioSlot);
  }

  const { data: pendingRows } = await pendingQuery;
  const pending = ((pendingRows ?? []) as Pick<
    DailyRadioScriptRow,
    "id" | "status" | "generation_source" | "radio_slot" | "duration_minutes"
  >[])[0];

  if (pending) {
    return {
      kind: "pending",
      status: pending.status,
      debug: {
        ...debug,
        status: pending.status,
        generationSource: pending.generation_source,
        scriptId: pending.id,
        radioSlot: pending.radio_slot ?? "morning",
        durationMinutes: pending.duration_minutes,
        rowCount: 1,
      },
    };
  }

  if (options.radioSlot) {
    logPushNavTrace({
      phase: "fallback_by_slot_result",
      requestedRadioSlot: options.radioSlot,
      rowCount,
      queryKind: "not_found",
      caller: "fetchServerDailyScript",
    });
  }

  console.log("[DailyRadio] daily radio server script not found for this user/device");
  return { kind: "not_found", debug };
}

/** @deprecated 使用 fetchServerDailyScript */
export async function fetchTodayServerScript(): Promise<FetchTodayScriptResult> {
  return fetchServerDailyScript();
}

export async function syncUserNewsPreferences(input: {
  topics: string[];
  customKeywords: string[];
  displayName?: string;
  pushToken?: string | null;
  pushPlatform?: "ios" | "android" | null;
  dailyRadioEnabled?: boolean;
  morningRadioEnabled?: boolean;
  eveningRadioEnabled?: boolean;
  morningRadioTime?: string;
  eveningRadioTime?: string;
  morningDurationMinutes?: number;
  eveningDurationMinutes?: number;
  isPro?: boolean;
  anchorId?: string;
  anchorVoice?: string;
  anchorStyle?: string;
  playbackRate?: number;
  voiceFeatureEnabled?: boolean;
  trigger?: string;
}): Promise<boolean> {
  if (!isSupabaseConfigured()) return true;

  const userId = await ensureSupabaseUser();
  if (!userId) return false;

  const supabase = getSupabase();
  if (!supabase) return false;

  const morningTime = input.morningRadioTime ?? "07:00";
  const eveningTime = input.eveningRadioTime ?? "17:00";
  const isPro = input.isPro === true;
  const voiceFeatureEnabled = input.voiceFeatureEnabled === true;
  const morningDuration = normalizeAutoRadioDuration(
    input.morningDurationMinutes,
    isPro
  );
  const eveningDuration = normalizeAutoRadioDuration(
    input.eveningDurationMinutes,
    isPro
  );

  const row: Record<string, unknown> = {
    user_id: userId,
    topics: input.topics,
    custom_keywords: input.customKeywords,
    display_name: input.displayName?.trim() || null,
    daily_radio_enabled: input.dailyRadioEnabled ?? true,
    daily_radio_time: morningTime,
    morning_radio_enabled: input.morningRadioEnabled ?? true,
    evening_radio_enabled: isPro ? (input.eveningRadioEnabled ?? true) : false,
    morning_radio_time: morningTime,
    evening_radio_time: eveningTime,
    morning_duration_minutes: morningDuration,
    evening_duration_minutes: eveningDuration,
    timezone: getLocalTimezone(),
    ai_anchor_id: input.anchorId ?? DEFAULT_AI_ANCHOR_SETTINGS.anchorId,
    ai_anchor_voice:
      input.anchorVoice ??
      getAnchorById(input.anchorId ?? DEFAULT_AI_ANCHOR_SETTINGS.anchorId).voice,
    ai_anchor_style: input.anchorStyle ?? DEFAULT_AI_ANCHOR_SETTINGS.style,
    ai_playback_rate: input.playbackRate ?? DEFAULT_AI_ANCHOR_SETTINGS.playbackRate,
    voice_feature_enabled: voiceFeatureEnabled,
    updated_at: new Date().toISOString(),
  };

  if (input.pushToken !== undefined) row.push_token = input.pushToken;
  if (input.pushPlatform !== undefined) row.push_platform = input.pushPlatform;

  const { error } = await supabase.from("news_user_preferences").upsert(row, {
    onConflict: "user_id",
  });

  if (error) {
    console.warn("[DailyRadio] sync preferences failed", error.message);
    return false;
  }
  return true;
}

export type PushTokenSyncResult = {
  ok: boolean;
  error?: string;
};

export async function syncPushTokenToSupabase(
  pushToken: string,
  pushPlatform: "ios" | "android",
  pushEnvironment?: PushEnvironment | null
): Promise<boolean> {
  const result = await syncPushTokenToSupabaseDetailed(
    pushToken,
    pushPlatform,
    pushEnvironment
  );
  return result.ok;
}

export async function syncPushTokenToSupabaseDetailed(
  pushToken: string,
  pushPlatform: "ios" | "android",
  pushEnvironment?: PushEnvironment | null,
  options?: { trigger?: string }
): Promise<PushTokenSyncResult> {
  const trigger = options?.trigger ?? "push_token_sync";
  if (!isSupabaseConfigured()) {
    const error = "supabase not configured";
    console.warn("[Push] token save failed", error);
    return { ok: false, error };
  }

  const userId = await ensureSupabaseUser();
  if (!userId) {
    const error = "no auth user";
    console.warn("[Push] token save failed", error);
    return { ok: false, error };
  }

  const supabase = getSupabase();
  if (!supabase) {
    const error = "no supabase client";
    console.warn("[Push] token save failed", error);
    return { ok: false, error };
  }

  const trimmed = pushToken.trim();
  if (!trimmed) {
    const error = "empty token";
    console.warn("[Push] token save failed", error);
    return { ok: false, error };
  }

  const pro = getProStatus();
  logPrefSync("push_token_sync_start", {
    trigger,
    userId,
    proStatus: pro,
    pushToken: trimmed,
    pushEnvironment: pushEnvironment ?? null,
  });

  console.log("[Push] token save started", {
    user_prefix: userPrefix(userId),
    token_prefix: trimmed.slice(0, 12),
    push_platform: pushPlatform,
    push_environment: pushEnvironment ?? null,
  });

  const ensured = await ensureUserNewsPreferencesRow();
  if (!ensured) {
    const error = "ensure preferences row failed";
    console.warn("[Push] token save failed", error);
    return { ok: false, error };
  }

  const preferenceSelect = GUARDED_PREFERENCE_FIELDS.join(", ");
  const { data: beforeRow, error: beforeError } = await supabase
    .from("news_user_preferences")
    .select(preferenceSelect)
    .eq("user_id", userId)
    .maybeSingle();

  if (beforeError) {
    console.warn("[Push] token save read-before failed", beforeError.message);
  }

  const patch = buildPushTokenUpdatePayload({
    pushToken: trimmed,
    pushPlatform,
    pushEnvironment: pushEnvironment ?? null,
    updatedAt: new Date().toISOString(),
  });

  const { error } = await supabase
    .from("news_user_preferences")
    .update(patch)
    .eq("user_id", userId);

  if (error) {
    console.warn("[Push] token save failed", error.message);
    logPrefSync("preference_sync_error", {
      trigger,
      userId,
      proStatus: pro,
      pushToken: trimmed,
      pushEnvironment: pushEnvironment ?? null,
      error: error.message,
    });
    return { ok: false, error: error.message };
  }

  const { data: afterRow, error: afterError } = await supabase
    .from("news_user_preferences")
    .select(preferenceSelect)
    .eq("user_id", userId)
    .maybeSingle();

  if (afterError) {
    console.warn("[Push] token save read-after failed", afterError.message);
  }

  const prefsUnchanged =
    beforeRow && afterRow
      ? preferenceFieldsUnchanged(beforeRow, afterRow)
      : true;

  recordPushTokenSyncDiagnostics({
    lastTokenPrefix: trimmed.slice(0, 12),
    lastPreferenceFieldsChanged: prefsUnchanged ? false : true,
  });

  if (prefsUnchanged) {
    logPrefSync("push_token_sync_verified_no_preference_change", {
      trigger,
      userId,
      proStatus: pro,
      pushToken: trimmed,
      pushEnvironment: pushEnvironment ?? null,
      preferenceFieldsChanged: false,
    });
  } else {
    console.warn("[Push] token save modified guarded preference fields", {
      user_prefix: userPrefix(userId),
      before: beforeRow,
      after: afterRow,
    });
  }

  logPrefSync("push_token_sync_success", {
    trigger,
    userId,
    proStatus: pro,
    pushToken: trimmed,
    pushEnvironment: pushEnvironment ?? null,
    preferenceFieldsChanged: prefsUnchanged ? false : true,
  });

  console.log("[Push] token save succeeded", {
    user_prefix: userPrefix(userId),
    token_prefix: trimmed.slice(0, 12),
    push_environment: pushEnvironment ?? null,
    preference_fields_unchanged: prefsUnchanged,
  });
  return { ok: true };
}

export type PushDiagnosticsRow = {
  push_token: string | null;
  push_platform: string | null;
  push_environment: PushEnvironment | null;
  updated_at: string | null;
  voice_feature_enabled: boolean | null;
  ai_anchor_id: string | null;
  ai_anchor_voice: string | null;
  ai_anchor_style: string | null;
  morning_duration_minutes: number | null;
  evening_duration_minutes: number | null;
  evening_radio_enabled: boolean | null;
};

export async function fetchPushDiagnosticsFromSupabase(): Promise<PushDiagnosticsRow | null> {
  if (!isSupabaseConfigured()) return null;
  const userId = await ensureSupabaseUser();
  if (!userId) return null;
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("news_user_preferences")
    .select(
      "push_token, push_platform, push_environment, updated_at, voice_feature_enabled, ai_anchor_id, ai_anchor_voice, ai_anchor_style, morning_duration_minutes, evening_duration_minutes, evening_radio_enabled"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("[Push] diagnostics fetch failed", error.message);
    return null;
  }
  return (data as PushDiagnosticsRow | null) ?? null;
}

export type RetryDailyRadioPushResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export async function retryDailyRadioPush(scriptId: string): Promise<RetryDailyRadioPushResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "supabase not configured" };
  }

  const userId = await ensureSupabaseUser();
  if (!userId) {
    return { ok: false, error: "no auth user" };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "supabase client unavailable" };
  }

  const { data, error } = await supabase.functions.invoke("retry-daily-radio-push", {
    body: {
      script_id: scriptId,
      target_user_id: userId,
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, data };
}

function userPrefix(userId: string): string {
  return userId.slice(0, 8);
}

export async function saveAppGeneratedDailyScript(input: {
  scriptText: string;
  title?: string;
  sourceNews?: unknown;
  radioSlot?: RadioSlot;
}): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  const userId = await ensureSupabaseUser();
  if (!userId) return null;

  const supabase = getSupabase();
  if (!supabase) return null;

  const scriptDate = getDailyScriptDate();
  const radioSlot = input.radioSlot ?? "morning";
  const scriptText =
    input.radioSlot != null
      ? appendRadioClosing(input.scriptText, input.radioSlot)
      : input.scriptText;
  const { data, error } = await supabase
    .from("news_daily_radio_scripts")
    .upsert(
      {
        user_id: userId,
        script_date: scriptDate,
        duration_minutes: 3,
        radio_slot: radioSlot,
        title: input.title ?? (radioSlot === "evening" ? "今日 AI 晚報" : "今日 AI 早報"),
        script_text: scriptText,
        source_news: input.sourceNews ?? [],
        status: "completed",
        generation_source: "app",
        is_daily_auto: true,
        error_message: null,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "user_id,script_date,duration_minutes,generation_source,radio_slot",
      }
    )
    .select("id")
    .single();

  if (error) {
    console.warn("[DailyRadio] save app script failed", error.message);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

export type TriggerServerDailyRadioResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

/**
 * 手動觸發 Edge Function 為目前 user 立即生成今日 server 稿 + MP3。
 * 需已登入；body.force + target_user_id 須與 JWT 一致。
 */
export async function triggerServerDailyRadioGeneration(options?: {
  radioSlot?: RadioSlot;
  sendTestPush?: boolean;
}): Promise<TriggerServerDailyRadioResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "supabase not configured" };
  }

  const userId = await ensureSupabaseUser();
  if (!userId) {
    return { ok: false, error: "no auth user" };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "supabase client unavailable" };
  }

  const radioSlot = options?.radioSlot;
  console.log("[DailyRadio] trigger server generation", {
    user_id: userId.slice(0, 8),
    radio_slot: radioSlot ?? "all_enabled",
    send_test_push: options?.sendTestPush === true,
  });

  const { data, error } = await supabase.functions.invoke("generate-daily-radio", {
    body: {
      force: true,
      target_user_id: userId,
      radio_slot: radioSlot,
      send_test_push: options?.sendTestPush === true,
      triggerSource: "manual",
      app: "ai-news-station-debug",
    },
  });

  if (error) {
    console.warn("[DailyRadio] trigger server generation failed", error.message);
    return { ok: false, error: error.message };
  }

  console.log("[DailyRadio] trigger server generation response", data);
  return { ok: true, data };
}
