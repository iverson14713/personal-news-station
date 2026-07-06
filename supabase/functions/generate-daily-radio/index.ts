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
};

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

const FULL_SCRIPT_SELECT =
  "id, status, updated_at, push_sent_at, generation_source, radio_slot, script_date, script_text, audio_url, audio_voice, audio_style, audio_expires_at";

function getUserSlots(user: UserPrefs, options: ProcessOptions): SlotConfig[] {
  const morning: SlotConfig = {
    slot: "morning",
    enabled: user.morning_radio_enabled !== false,
    time: user.morning_radio_time || user.daily_radio_time || "07:00",
    duration: user.morning_duration_minutes ?? 3,
  };
  const evening: SlotConfig = {
    slot: "evening",
    enabled: user.evening_radio_enabled === true,
    time: user.evening_radio_time || "17:00",
    duration: user.evening_duration_minutes ?? 3,
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
  if (!isVoiceFeatureEnabled(user)) {
    console.log("[DailyRadioCron] skip anchor audio: voice feature disabled", {
      user_id: user.user_id,
      script_date: scriptDate,
      radio_slot: radioSlot,
    });
    return { hasAnchorAudio: false, audioReady: false };
  }

  const scriptText = scriptRow.script_text?.trim();
  if (!scriptText) {
    console.log("[DailyRadioCron] audio failed, fallback push", {
      user_id: user.user_id,
      script_id: scriptRow.id,
      reason: "empty_script",
    });
    return { hasAnchorAudio: false, audioReady: false };
  }

  const anchorPrefs = resolveAnchorSettings(user);

  if (isScriptAudioReady(scriptRow, anchorPrefs.voice, anchorPrefs.style)) {
    console.log("[DailyRadioCron] audio generated", {
      user_id: user.user_id,
      script_id: scriptRow.id,
      script_date: scriptDate,
      cached: true,
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
  const duration = slotConfig.duration;
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
    console.error("slot failed", {
      user_id: user.user_id,
      radio_slot: radioSlot,
      error: claim.error.message,
    });
    return {
      user_id: user.user_id,
      radio_slot: radioSlot,
      status: "failed",
      reason: claim.error.message,
    };
  }

  const scriptId = (claim.data as { id: string } | null)?.id ?? serverRow?.id ?? null;

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

    const news: NewsItem[] = await collectNewsForUser(feeds, 2, 5, {
      radioSlot,
      excludeKeys,
      maxPerTopic: radioSlot === "evening" ? 4 : 2,
      maxTotal: radioSlot === "evening" ? 10 : 5,
    });

    console.log("generating script", {
      user_id: user.user_id,
      radio_slot: radioSlot,
      topics,
      custom_keywords: customKeywords,
      fetched_news_count: news.length,
      fresh_rss: true,
    });

    if (news.length === 0) {
      throw new Error(
        radioSlot === "evening"
          ? "無法取得晚報新新聞（可能與早報重複或來源暫無更新）"
          : "無法取得新聞"
      );
    }

    const { script, title } = await generateRadioScript(openaiKey, news, {
      radioSlot,
      displayName: user.display_name,
      morningHeadlines: radioSlot === "evening" ? morningHeadlines : undefined,
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

    const anchorPrefs = resolveAnchorSettings(user);
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
  }
): Promise<PushSendResult> {
  const forceTestPush = options.sendTestPush;

  if (!forceTestPush && serverRow?.push_sent_at) {
    console.log("skip push: already sent", {
      user_id: user.user_id,
      radio_slot: radioSlot,
    });
    return { push_status: "sent" };
  }

  if (forceTestPush) {
    console.log("send_test_push: sending daily_radio_completed push", {
      user_id: user.user_id,
      radio_slot: radioSlot,
      push_platform: user.push_platform ?? "ios",
    });
  }

  const pushResult = await sendDailyRadioCompletedPush(
    user.push_token,
    user.display_name,
    user.push_platform,
    {
      radioSlot,
      scriptId: scriptId ?? undefined,
      anchorName: pushMeta?.anchorName,
      hasAnchorAudio: pushMeta?.audioReady === true,
      audioReady: pushMeta?.audioReady === true,
      durationMinutes: pushMeta?.durationMinutes ?? duration,
    }
  );

  if (pushResult.push_status === "sent") {
    console.log("push sent", {
      user_id: user.user_id,
      radio_slot: radioSlot,
      type: "daily_radio_completed",
      test: forceTestPush,
      push_status: pushResult.push_status,
    });
    await supabase
      .from("news_daily_radio_scripts")
      .update({ push_sent_at: new Date().toISOString() })
      .eq("user_id", user.user_id)
      .eq("script_date", scriptDate)
      .eq("duration_minutes", duration)
      .eq("generation_source", SERVER_SOURCE)
      .eq("radio_slot", radioSlot);
  } else {
    console.log("push failed", {
      user_id: user.user_id,
      radio_slot: radioSlot,
      test: forceTestPush,
      push_status: pushResult.push_status,
      push_error: pushResult.push_error,
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
