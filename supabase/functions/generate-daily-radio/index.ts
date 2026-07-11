import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  createExecutionId,
  finishGenerationRun,
  logExecutionError,
  logExecutionEvent,
  resolveTriggerSource,
  startGenerationRun,
  updateGenerationRunStage,
} from "../_shared/dailyGenerationRun.ts";
import {
  dispatchDailyRadioJobs,
  isCanaryOnly,
  isQueueEnabled,
  parseCanaryUserIds,
} from "../_shared/dailyRadioDispatch.ts";
import {
  buildPushTokenIndex,
  processSingleDailyRadioJob,
  getUserSlots,
  type CronPayload,
  type ProcessOptions,
  type ProcessResult,
  type UserPrefs,
} from "../_shared/dailyRadioProcessor.ts";
import { getTaipeiDateKey } from "../_shared/timezone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startedAt = Date.now();
  const executionId = createExecutionId();
  let payload: CronPayload = {};
  try {
    payload = (await req.json()) as CronPayload;
  } catch {
    /* empty body ok */
  }

  const triggerSource = resolveTriggerSource(payload);
  const targetSlot = payload.radio_slot?.trim();
  const targetUserId = payload.target_user_id?.trim();
  const processOptions: ProcessOptions = {
    force: payload.force === true,
    sendTestPush: payload.send_test_push === true,
    targetRadioSlot:
      targetSlot === "morning" || targetSlot === "evening" ? targetSlot : undefined,
    pushDedup: { sentDeviceKeys: new Set<string>() },
    pushTokenIndex: new Map<string, number>(),
    finalPushCount: { value: 0 },
    pushFailureCount: { value: 0 },
  };

  logExecutionEvent(executionId, "request_received", {
    trigger_source: triggerSource,
    run_date: getTaipeiDateKey(),
    queue_enabled: isQueueEnabled(),
    force: processOptions.force,
    target_user_id: targetUserId ?? null,
  });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim();
  const cronHeader = req.headers.get("x-cron-secret");
  let authorized = false;

  if (cronSecret && cronHeader === cronSecret) {
    authorized = true;
  } else if (
    payload.force === true &&
    targetUserId &&
    supabaseUrl &&
    serviceKey
  ) {
    const authHeader = req.headers.get("Authorization");
    const bearer = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";
    if (bearer) {
      const authClient = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: userData, error: userError } = await authClient.auth.getUser(bearer);
      if (!userError && userData.user?.id === targetUserId) authorized = true;
    }
  }

  if (!authorized && cronSecret) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ ok: false, error: "Missing Supabase env" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const queueMode = isQueueEnabled();
  if (!queueMode && !Deno.env.get("OPENAI_API_KEY")) {
    return new Response(JSON.stringify({ ok: false, error: "Missing OPENAI_API_KEY" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const runCtx = await startGenerationRun(supabase, executionId, triggerSource);
  await updateGenerationRunStage(runCtx, "authorized");

  let usersQuery = supabase
    .from("news_user_preferences")
    .select(
      "user_id, topics, custom_keywords, daily_radio_enabled, daily_radio_time, morning_radio_enabled, evening_radio_enabled, morning_radio_time, evening_radio_time, morning_duration_minutes, evening_duration_minutes, timezone, push_token, push_platform, display_name, ai_anchor_id, ai_anchor_voice, ai_anchor_style, ai_playback_rate, voice_feature_enabled"
    )
    .eq("daily_radio_enabled", true);

  if (targetUserId) usersQuery = usersQuery.eq("user_id", targetUserId);

  const { data: users, error: usersError } = await usersQuery;
  if (usersError) {
    await finishGenerationRun(runCtx, {
      status: "failed",
      currentStage: "preferences_fetch_failed",
      errorMessage: usersError.message,
    });
    return new Response(JSON.stringify({ ok: false, error: usersError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const enabledUsers = (users ?? []) as UserPrefs[];
  await updateGenerationRunStage(runCtx, "users_loaded", {
    enabled_users_count: enabledUsers.length,
    mode: queueMode ? "dispatcher" : "legacy_serial",
  });

  if (queueMode) {
    const summary = await dispatchDailyRadioJobs(supabase, enabledUsers, {
      force: processOptions.force,
      triggerSource,
      targetRadioSlot: processOptions.targetRadioSlot,
      targetUserId,
      canaryOnly: isCanaryOnly(),
      canaryUserIds: parseCanaryUserIds(),
    });

    const totalTimeMs = Date.now() - startedAt;
    logExecutionEvent(executionId, "dispatcher_summary", {
      queued: summary.queued,
      skipped: summary.skipped,
      totalTimeMs,
    });

    await finishGenerationRun(runCtx, {
      status: "success",
      currentStage: "dispatcher_finished",
      metadata: {
        mode: "dispatcher",
        queued: summary.queued,
        skipped: summary.skipped,
        results: summary.results,
        total_time_ms: totalTimeMs,
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        executionId,
        mode: "dispatcher",
        queued: summary.queued,
        skipped: summary.skipped,
        processed: summary.queued + summary.skipped,
        totalTimeMs,
        results: summary.results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  processOptions.pushTokenIndex = buildPushTokenIndex(enabledUsers);
  const results: ProcessResult[] = [];

  for (const user of enabledUsers) {
    const slots = getUserSlots(user, processOptions);
    if (slots.length === 0) {
      results.push({ user_id: user.user_id, status: "skipped", reason: "no_enabled_slots" });
      continue;
    }
    for (const slotConfig of slots) {
      try {
        const result = await processSingleDailyRadioJob(
          supabase,
          user,
          slotConfig,
          openaiKey,
          processOptions
        );
        results.push(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        results.push({
          user_id: user.user_id,
          radio_slot: slotConfig.slot,
          status: "failed",
          reason: msg,
        });
      }
    }
  }

  const generatedScripts = results.filter((r) => r.status === "completed").length;
  const failedUsers = results.filter((r) => r.status === "failed").length;
  const runStatus =
    failedUsers > 0 && generatedScripts === 0 ? "failed" : "success";

  await finishGenerationRun(runCtx, {
    status: runStatus,
    currentStage: "legacy_finished",
    scriptGenerated: generatedScripts > 0,
    notificationSuccessCount: processOptions.finalPushCount.value,
    metadata: { mode: "legacy_serial", results },
  });

  return new Response(
    JSON.stringify({
      ok: true,
      executionId,
      mode: "legacy_serial",
      processed: results.length,
      status: runStatus,
      results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
