import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  archiveDailyRadioJob,
  backoffSecondsForAttempt,
  DEFAULT_VISIBILITY_TIMEOUT_SEC,
  DEFAULT_WORKER_BATCH_SIZE,
  getQueueMetrics,
  isRetryableError,
  MAX_JOB_ATTEMPTS,
  readDailyRadioJobs,
  sendDailyRadioJob,
  type DailyRadioJobPayload,
  type QueueMessage,
} from "../_shared/dailyRadioQueue.ts";
import {
  processSingleDailyRadioJob,
  type ProcessOptions,
  type UserPrefs,
} from "../_shared/dailyRadioProcessor.ts";
import { createExecutionId, logExecutionEvent } from "../_shared/dailyGenerationRun.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const USER_PREFS_SELECT =
  "user_id, topics, custom_keywords, daily_radio_enabled, daily_radio_time, morning_radio_enabled, evening_radio_enabled, morning_radio_time, evening_radio_time, morning_duration_minutes, evening_duration_minutes, timezone, push_token, push_platform, display_name, ai_anchor_id, ai_anchor_voice, ai_anchor_style, ai_playback_rate, voice_feature_enabled";

function workerBatchSize(): number {
  const raw = Number(Deno.env.get("DAILY_RADIO_WORKER_BATCH_SIZE") ?? DEFAULT_WORKER_BATCH_SIZE);
  return Number.isFinite(raw) && raw >= 1 && raw <= 10 ? Math.floor(raw) : DEFAULT_WORKER_BATCH_SIZE;
}

function visibilityTimeoutSec(): number {
  const raw = Number(
    Deno.env.get("DAILY_RADIO_QUEUE_VISIBILITY_SEC") ?? DEFAULT_VISIBILITY_TIMEOUT_SEC
  );
  return Number.isFinite(raw) && raw >= 60 ? Math.floor(raw) : DEFAULT_VISIBILITY_TIMEOUT_SEC;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadUserPrefs(supabase: any, userId: string): Promise<UserPrefs | null> {
  const { data, error } = await supabase
    .from("news_user_preferences")
    .select(USER_PREFS_SELECT)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as UserPrefs;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processQueueMessage(
  supabase: any,
  openaiKey: string,
  msg: QueueMessage,
  workerId: string
): Promise<{ ok: boolean; retryable: boolean; error?: string }> {
  const payload = msg.message as DailyRadioJobPayload;
  const jobId = payload.job_id;

  const { data: jobRow } = await supabase
    .from("news_daily_radio_job_runs")
    .select("id, status, attempt_count, locked_at")
    .eq("id", jobId)
    .maybeSingle();

  if (jobRow?.status === "completed") {
    await archiveDailyRadioJob(supabase, msg.msg_id);
    return { ok: true, retryable: false };
  }

  if (jobRow?.status === "processing" && jobRow.locked_at) {
    const lockedAt = new Date(jobRow.locked_at).getTime();
    if (Date.now() - lockedAt < 15 * 60 * 1000) {
      return { ok: false, retryable: true, error: "job_locked_by_other_worker" };
    }
  }

  const now = new Date().toISOString();
  await supabase
    .from("news_daily_radio_job_runs")
    .update({
      status: "processing",
      locked_at: now,
      locked_by: workerId,
      started_at: jobRow?.started_at ?? now,
      current_stage: "worker_started",
      attempt_count: (jobRow?.attempt_count ?? 0) + 1,
      updated_at: now,
    })
    .eq("id", jobId);

  const user = await loadUserPrefs(supabase, payload.user_id);
  if (!user) {
    await supabase
      .from("news_daily_radio_job_runs")
      .update({
        status: "failed",
        last_error: "user_preferences_not_found",
        completed_at: now,
        updated_at: now,
      })
      .eq("id", jobId);
    await archiveDailyRadioJob(supabase, msg.msg_id);
    return { ok: false, retryable: false, error: "user_preferences_not_found" };
  }

  const processOptions: ProcessOptions = {
    fromQueue: true,
    force: payload.force === true,
    sendTestPush: false,
    targetRadioSlot: payload.radio_slot,
    pushDedup: { sentDeviceKeys: new Set() },
    pushTokenIndex: new Map(),
    finalPushCount: { value: 0 },
    pushFailureCount: { value: 0 },
  };

  const slotConfig = {
    slot: payload.radio_slot,
    enabled: true,
    time:
      payload.radio_slot === "evening"
        ? user.evening_radio_time || "17:00"
        : user.morning_radio_time || user.daily_radio_time || "07:00",
    duration: payload.duration_minutes,
    requestedDuration: payload.duration_minutes,
    requestedFallbackReason: null,
  };

  try {
    const result = await processSingleDailyRadioJob(
      supabase,
      user,
      slotConfig,
      openaiKey,
      processOptions
    );

    if (result.status === "completed" || result.status === "test_push_sent_existing_script") {
      await supabase
        .from("news_daily_radio_job_runs")
        .update({
          status: "completed",
          current_stage: "finished",
          completed_at: new Date().toISOString(),
          last_error: result.reason ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      await archiveDailyRadioJob(supabase, msg.msg_id);
      return { ok: true, retryable: false };
    }

    if (result.status === "skipped") {
      await supabase
        .from("news_daily_radio_job_runs")
        .update({
          status: "skipped",
          current_stage: result.reason ?? "skipped",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      await archiveDailyRadioJob(supabase, msg.msg_id);
      return { ok: true, retryable: false };
    }

    const errMsg = result.reason ?? result.status;
    const retryable = isRetryableError(errMsg);
    const attempt = (jobRow?.attempt_count ?? 0) + 1;

    if (!retryable || attempt >= MAX_JOB_ATTEMPTS) {
      await supabase
        .from("news_daily_radio_job_runs")
        .update({
          status: "failed",
          last_error: errMsg.slice(0, 500),
          error_stage: "process_job",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      await archiveDailyRadioJob(supabase, msg.msg_id);
      return { ok: false, retryable: false, error: errMsg };
    }

    const delaySec = backoffSecondsForAttempt(attempt);
    await supabase
      .from("news_daily_radio_job_runs")
      .update({
        status: "retry_wait",
        last_error: errMsg.slice(0, 500),
        error_stage: "process_job",
        next_retry_at: new Date(Date.now() + delaySec * 1000).toISOString(),
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    await sendDailyRadioJob(supabase, payload, delaySec);
    await archiveDailyRadioJob(supabase, msg.msg_id);
    return { ok: false, retryable: true, error: errMsg };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const retryable = isRetryableError(errMsg);
    const attempt = (jobRow?.attempt_count ?? 0) + 1;

    if (!retryable || attempt >= MAX_JOB_ATTEMPTS) {
      await supabase
        .from("news_daily_radio_job_runs")
        .update({
          status: "failed",
          last_error: errMsg.slice(0, 500),
          error_stage: "worker_exception",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      await archiveDailyRadioJob(supabase, msg.msg_id);
      return { ok: false, retryable: false, error: errMsg };
    }

    const delaySec = backoffSecondsForAttempt(attempt);
    await supabase
      .from("news_daily_radio_job_runs")
      .update({
        status: "retry_wait",
        last_error: errMsg.slice(0, 500),
        error_stage: "worker_exception",
        next_retry_at: new Date(Date.now() + delaySec * 1000).toISOString(),
        locked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    await sendDailyRadioJob(supabase, payload, delaySec);
    await archiveDailyRadioJob(supabase, msg.msg_id);
    return { ok: false, retryable: true, error: errMsg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const executionId = createExecutionId();
  const workerId = executionId.slice(0, 8);
  const startedAt = Date.now();

  const cronSecret = Deno.env.get("CRON_SECRET")?.trim();
  const cronHeader = req.headers.get("x-cron-secret");
  if (cronSecret && cronHeader !== cronSecret) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";

  if (!supabaseUrl || !serviceKey || !openaiKey) {
    return new Response(JSON.stringify({ ok: false, error: "Missing env" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const batchSize = workerBatchSize();
  const vtSec = visibilityTimeoutSec();
  const messages = await readDailyRadioJobs(supabase, batchSize, vtSec);

  if (messages.length === 0) {
    const metrics = await getQueueMetrics(supabase);
    logExecutionEvent(executionId, "worker_idle", { metrics });
    return new Response(
      JSON.stringify({ ok: true, mode: "worker", processed: 0, idle: true, metrics }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const outcomes = await Promise.allSettled(
    messages.map((msg) => processQueueMessage(supabase, openaiKey, msg, workerId))
  );

  const results = outcomes.map((o, i) => ({
    msg_id: messages[i]?.msg_id,
    ...(o.status === "fulfilled" ? o.value : { ok: false, error: String(o.reason) }),
  }));

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;
  const elapsedMs = Date.now() - startedAt;

  logExecutionEvent(executionId, "worker_batch_done", {
    batch_size: batchSize,
    visibility_timeout_sec: vtSec,
    read_count: messages.length,
    succeeded,
    failed,
    elapsed_ms: elapsedMs,
    wall_clock_warning: elapsedMs > 120_000,
  });

  const metrics = await getQueueMetrics(supabase);
  const oldestPending = Number(metrics.oldest_pending_seconds ?? 0);
  if (oldestPending > 15 * 60) {
    console.log(
      JSON.stringify({
        event: "daily_radio_queue_alert",
        alert: "oldest_pending_age_high",
        oldest_pending_seconds: oldestPending,
      })
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      mode: "worker",
      executionId,
      batchSize,
      visibilityTimeoutSec: vtSec,
      processed: messages.length,
      succeeded,
      failed,
      elapsedMs,
      results,
      metrics,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
