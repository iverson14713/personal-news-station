import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { appendRadioClosing } from "../_shared/radioClosing.ts";
import { generateRadioScript } from "../_shared/ai.ts";
import {
  collectNewsForUser,
  morningHeadlinesFromSourceNews,
  newsKeysFromSourceNews,
  type NewsItem,
} from "../_shared/news.ts";
import {
  sendDailyRadioCompletedPush,
  type PushSendResult,
  type RadioSlot,
} from "../_shared/push.ts";
import { resolveFeedQueries } from "../_shared/topics.ts";
import {
  isVoiceFeatureEnabled,
  resolveAnchorSettings,
} from "../_shared/aiAnchor.ts";
import { generateAudioForScript, isScriptAudioReady } from "../_shared/generateAudio.ts";
import { shouldGenerateNow, todayInTimezone } from "../_shared/timezone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type UserPrefs = {
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
  display_name: string | null;
  ai_anchor_id: string | null;
  ai_anchor_voice: string | null;
  ai_anchor_style: string | null;
  ai_playback_rate: number | null;
  voice_feature_enabled: boolean | null;
};

type SlotConfig = {
  slot: RadioSlot;
  enabled: boolean;
  time: string;
  duration: number;
  requestedDuration: number;
  requestedFallbackReason: string | null;
};

type ProcessResult = {
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

type CronPayload = {
  triggered_at?: string;
  app?: string;
  test?: boolean;
  force?: boolean;
  send_test_push?: boolean;
  target_user_id?: string;
  radio_slot?: RadioSlot;
};

type ProcessOptions = {
  force: boolean;
  sendTestPush: boolean;
  targetRadioSlot?: RadioSlot;
  pushDedup: PushDedupState;
  pushTokenIndex: Map<string, number>;
  finalPushCount: { value: number };
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

function buildPushTokenIndex(users: UserPrefs[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const user of users) {
    const token = user.push_token?.trim();
    if (!token) continue;
    index.set(token, (index.get(token) ?? 0) + 1);
  }
  return index;
}

function userPlanLabel(user: UserPrefs): "free" | "pro" {
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
const UPSERT_CONFLICT =
  "user_id,script_date,duration_minutes,generation_source,radio_slot";

type AutoDurationRule = {
  targetMin: number;
  targetMax: number;
  min: number;
  maxPerTopic: number;
};

const AUTO_DURATION_RULES: Record<3 | 5 | 10, AutoDurationRule> = {
  3: { targetMin: 5, targetMax: 8, min: 5, maxPerTopic: 3 },
  5: { targetMin: 8, targetMax: 12, min: 8, maxPerTopic: 4 },
  10: { targetMin: 15, targetMax: 20, min: 12, maxPerTopic: 6 },
};

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

function getUserSlots(user: UserPrefs, options: ProcessOptions): SlotConfig[] {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startedAt = Date.now();
  let payload: CronPayload = {};
  try {
    payload = (await req.json()) as CronPayload;
  } catch {
    /* empty or non-JSON body is ok */
  }

  const targetSlot = payload.radio_slot?.trim();
  const processOptions: ProcessOptions = {
    force: payload.force === true,
    sendTestPush: payload.send_test_push === true,
    targetRadioSlot:
      targetSlot === "morning" || targetSlot === "evening" ? targetSlot : undefined,
    pushDedup: { sentDeviceKeys: new Set<string>() },
    pushTokenIndex: new Map<string, number>(),
    finalPushCount: { value: 0 },
  };

  console.log("Daily Radio started", {
    triggered_at: payload.triggered_at ?? null,
    app: payload.app ?? null,
    force: processOptions.force,
    send_test_push: processOptions.sendTestPush,
    target_user_id: payload.target_user_id ?? null,
    radio_slot: processOptions.targetRadioSlot ?? null,
    timestamp: new Date().toISOString(),
  });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const cronSecret = Deno.env.get("CRON_SECRET")?.trim();
  const cronHeader = req.headers.get("x-cron-secret");
  let authorized = false;

  if (cronSecret && cronHeader === cronSecret) {
    authorized = true;
    console.log("cron secret verified");
  } else {
    const targetUserId = payload.target_user_id?.trim();
    const authHeader = req.headers.get("Authorization");
    const bearer = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (payload.force === true && targetUserId && bearer && supabaseUrl && serviceKey) {
      const authClient = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: userData, error: userError } =
        await authClient.auth.getUser(bearer);
      if (!userError && userData.user?.id === targetUserId) {
        authorized = true;
        console.log("[DailyRadioCron] user self-trigger authorized", {
          user_id: targetUserId,
        });
      } else {
        console.warn("[DailyRadioCron] user self-trigger rejected", {
          target_user_id: targetUserId,
          error: userError?.message ?? "user_mismatch",
        });
      }
    }
  }

  if (!authorized && cronSecret) {
    console.error("invalid cron secret or user auth");
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ ok: false, error: "Missing Supabase env" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!openaiKey) {
    return new Response(JSON.stringify({ ok: false, error: "Missing OPENAI_API_KEY" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { count: totalPreferencesCount, error: countError } = await supabase
    .from("news_user_preferences")
    .select("*", { count: "exact", head: true });

  if (countError) {
    console.error("failed to count preferences", { error: countError.message });
    return new Response(JSON.stringify({ ok: false, error: countError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let usersQuery = supabase
    .from("news_user_preferences")
    .select(
      "user_id, topics, custom_keywords, daily_radio_enabled, daily_radio_time, morning_radio_enabled, evening_radio_enabled, morning_radio_time, evening_radio_time, morning_duration_minutes, evening_duration_minutes, timezone, push_token, push_platform, display_name, ai_anchor_id, ai_anchor_voice, ai_anchor_style, ai_playback_rate, voice_feature_enabled"
    )
    .eq("daily_radio_enabled", true);

  const targetUserId = payload.target_user_id?.trim();
  if (targetUserId) {
    usersQuery = usersQuery.eq("user_id", targetUserId);
    console.log("test mode: target_user_id filter", { target_user_id: targetUserId });
  }

  const { data: users, error: usersError } = await usersQuery;

  if (usersError) {
    console.error("failed to fetch enabled preferences", { error: usersError.message });
    return new Response(JSON.stringify({ ok: false, error: usersError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const enabledUsers = (users ?? []) as UserPrefs[];
  processOptions.pushTokenIndex = buildPushTokenIndex(enabledUsers);

  const duplicateTokenGroups = [...processOptions.pushTokenIndex.entries()]
    .filter(([, count]) => count > 1)
    .map(([token, count]) => ({
      device_token_prefix: tokenPrefix(token),
      token_count_before_dedupe: count,
      token_count_after_dedupe: 1,
    }));

  if (duplicateTokenGroups.length > 0) {
    console.log(
      JSON.stringify({
        event: "daily_radio_push_token_dedupe_preview",
        duplicate_token_groups: duplicateTokenGroups.length,
        groups: duplicateTokenGroups,
      })
    );
  }

  console.log("preferences loaded", {
    total_preferences_count: totalPreferencesCount ?? 0,
    enabled_users_count: enabledUsers.length,
    test_mode: processOptions.force || processOptions.sendTestPush || Boolean(targetUserId),
  });

  const results: ProcessResult[] = [];

  for (const user of enabledUsers) {
    const slots = getUserSlots(user, processOptions);
    if (slots.length === 0) {
      results.push({
        user_id: user.user_id,
        status: "skipped",
        reason: "no_enabled_slots",
      });
      continue;
    }

    for (const slotConfig of slots) {
      try {
        const result = await processUserSlot(
          supabase,
          user,
          slotConfig,
          openaiKey,
          processOptions
        );
        results.push(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        console.error("user slot processing error", {
          user_id: user.user_id,
          radio_slot: slotConfig.slot,
          error: msg,
        });
        results.push({
          user_id: user.user_id,
          radio_slot: slotConfig.slot,
          status: "failed",
          reason: msg,
        });
      }
    }
  }

  const skippedUsers = results.filter((r) => r.status === "skipped").length;
  const generatedScripts = results.filter((r) => r.status === "completed").length;
  const failedUsers = results.filter((r) => r.status === "failed").length;
  const testPushSent = results.filter((r) => r.status === "test_push_sent_existing_script").length;
  const noPushToken = results.filter((r) => r.status === "no_push_token").length;
  const totalTimeMs = Date.now() - startedAt;

  console.log("Daily Radio summary", {
    processedSlots: results.length,
    skippedUsers,
    generatedScripts,
    failedUsers,
    testPushSent,
    noPushToken,
    totalTimeMs,
    force: processOptions.force,
    send_test_push: processOptions.sendTestPush,
    final_push_count: processOptions.finalPushCount.value,
    unique_push_tokens: processOptions.pushTokenIndex.size,
    duplicate_token_groups: duplicateTokenGroups.length,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      processed: results.length,
      test_mode: processOptions.force || processOptions.sendTestPush || Boolean(targetUserId),
      results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

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
async function processUserSlot(
  supabase: any,
  user: UserPrefs,
  slotConfig: SlotConfig,
  openaiKey: string,
  options: ProcessOptions
): Promise<ProcessResult> {
  const tz = user.timezone || "Asia/Taipei";
  const windowMinutes =
    slotConfig.slot === "morning" ? MORNING_PUSH_WINDOW_MINUTES : 15;
  const inTimeWindow = shouldGenerateNow(tz, slotConfig.time, windowMinutes);

  console.log("processing user slot", {
    user_id: user.user_id,
    radio_slot: slotConfig.slot,
    timezone: tz,
    scheduled_time: slotConfig.time,
    duration_minutes: slotConfig.duration,
    should_generate_now: inTimeWindow,
    force: options.force,
    send_test_push: options.sendTestPush,
  });

  if (!options.force && !inTimeWindow) {
    console.log("slot skipped", {
      user_id: user.user_id,
      radio_slot: slotConfig.slot,
      reason: "not_in_time_window",
    });
    return {
      user_id: user.user_id,
      radio_slot: slotConfig.slot,
      status: "skipped",
      reason: "not_in_time_window",
    };
  }

  if (options.force) {
    console.log("force mode: skipping time window check", {
      user_id: user.user_id,
      radio_slot: slotConfig.slot,
    });
  }

  const scriptDate = todayInTimezone(tz);
  const requestedDuration = slotConfig.requestedDuration;
  let duration = slotConfig.duration;
  const radioSlot = slotConfig.slot;

  const serverRow = await fetchScriptBySource(
    supabase,
    user.user_id,
    scriptDate,
    duration,
    SERVER_SOURCE,
    radioSlot
  );
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
        openaiKey
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

    const durationRule = AUTO_DURATION_RULES[duration as 3 | 5 | 10];
    const news: NewsItem[] = await collectNewsForUser(feeds, 2, 5, {
      radioSlot,
      userId: user.user_id,
      excludeKeys,
      maxPerTopic: durationRule.maxPerTopic,
      maxTotal: durationRule.targetMax,
    });

    const finalDuration = resolveFinalDurationForNews(duration as 3 | 5 | 10, news.length);
    const fallbackReason =
      finalDuration.fallbackReason ?? slotConfig.requestedFallbackReason;
    duration = finalDuration.duration;
    const finalRule = AUTO_DURATION_RULES[duration as 3 | 5 | 10];

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
      throw new Error(
        radioSlot === "evening"
          ? "無法取得晚報新新聞（可能與早報重複或來源暫無更新）"
          : "無法取得新聞"
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
      limitedNews: duration === 10 && news.length < AUTO_DURATION_RULES[10].targetMin,
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
    };
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
    reason: "today_audio_and_push_ensured",
    script_id: fullRow.id,
  };
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
  openaiKey: string
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
    { force: true, sendTestPush: true },
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function claimPushSentAt(
  supabase: any,
  userId: string,
  scriptDate: string,
  duration: number,
  radioSlot: RadioSlot
): Promise<{ claimed: boolean; pushSentAtBefore: string | null; scriptId: string | null }> {
  const { data: beforeRow } = await supabase
    .from("news_daily_radio_scripts")
    .select("id, push_sent_at")
    .eq("user_id", userId)
    .eq("script_date", scriptDate)
    .eq("duration_minutes", duration)
    .eq("generation_source", SERVER_SOURCE)
    .eq("radio_slot", radioSlot)
    .maybeSingle();

  const pushSentAtBefore =
    (beforeRow as { push_sent_at?: string | null } | null)?.push_sent_at ?? null;
  const scriptId = (beforeRow as { id?: string } | null)?.id ?? null;

  if (pushSentAtBefore) {
    return { claimed: false, pushSentAtBefore, scriptId };
  }

  const now = new Date().toISOString();
  const { data: claimedRow, error } = await supabase
    .from("news_daily_radio_scripts")
    .update({ push_sent_at: now })
    .eq("user_id", userId)
    .eq("script_date", scriptDate)
    .eq("duration_minutes", duration)
    .eq("generation_source", SERVER_SOURCE)
    .eq("radio_slot", radioSlot)
    .is("push_sent_at", null)
    .select("id, push_sent_at")
    .maybeSingle();

  if (error) {
    console.log("push claim failed", {
      user_id: userId,
      radio_slot: radioSlot,
      error: error.message,
    });
    return { claimed: false, pushSentAtBefore, scriptId };
  }

  return {
    claimed: Boolean(claimedRow),
    pushSentAtBefore,
    scriptId: (claimedRow as { id?: string } | null)?.id ?? scriptId,
  };
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
): Promise<PushSendResult> {
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
    const claim = await claimPushSentAt(
      supabase,
      user.user_id,
      scriptDate,
      duration,
      radioSlot
    );
    pushSentAtBefore = claim.pushSentAtBefore;
    claimed = claim.claimed;
    if (!claimed) {
      logAttempt({
        push_sent_at_before: pushSentAtBefore,
        token_count_after_dedupe: 0,
        claim_success: false,
        skipped_reason: "push_already_sent",
        final_push_count: 0,
      });
      return { push_status: "sent" };
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
    }
  );

  if (pushResult.push_status === "sent") {
    if (!forceTestPush) {
      options.pushDedup.sentDeviceKeys.add(deviceKey);
    }
    options.finalPushCount.value += 1;
    logAttempt({
      push_sent_at_before: pushSentAtBefore,
      claim_success: forceTestPush ? null : true,
      skipped_reason: null,
      final_push_count: 1,
      token_count_after_dedupe: pushToken ? 1 : 0,
    });
  } else {
    if (!forceTestPush && claimed) {
      await supabase
        .from("news_daily_radio_scripts")
        .update({ push_sent_at: null })
        .eq("user_id", user.user_id)
        .eq("script_date", scriptDate)
        .eq("duration_minutes", duration)
        .eq("generation_source", SERVER_SOURCE)
        .eq("radio_slot", radioSlot);
    }
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
