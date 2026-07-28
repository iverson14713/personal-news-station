import type { RadioSlot } from "./push.ts";
import {
  getUserSlots,
  isProUser,
  type ProcessOptions,
  type UserPrefs,
} from "./dailyRadioProcessor.ts";
import {
  getTaipeiDateKey,
  isAfterSlotStart,
  isBeforeCatchUpDeadline,
} from "./timezone.ts";
import {
  sendDailyRadioJob,
  type DailyRadioJobPayload,
} from "./dailyRadioQueue.ts";
import {
  buildEnqueueFailureRevertPatch,
  buildFailedJobResurrectionPatch,
  canResurrectFailedJob,
  parseResurrectionCount,
} from "./dailyRadioRetry.ts";

export type DispatchResult = {
  user_id: string;
  radio_slot: RadioSlot;
  status: "queued" | "skipped";
  reason?: string;
  job_id?: string;
  priority?: number;
};

export type DispatchSummary = {
  queued: number;
  skipped: number;
  results: DispatchResult[];
};

const SERVER_SOURCE = "server";

function topicCount(user: UserPrefs): number {
  return (user.topics?.length ?? 0) + (user.custom_keywords?.length ?? 0);
}

function computePriority(
  user: UserPrefs,
  slot: RadioSlot,
  duration: number,
  force: boolean,
  overdue: boolean
): number {
  if (force) return 0;
  if (overdue) return 10;
  if (duration === 3) return 30;
  if (duration === 5) return 40;
  return 50;
}

function isSlotOverdue(timezone: string, slotTime: string): boolean {
  const [th, tm] = slotTime.split(":").map((x) => Number(x));
  if (!Number.isFinite(th) || !Number.isFinite(tm)) return false;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const nowMins = hour * 60 + minute;
  const targetMins = th * 60 + tm;
  return nowMins - targetMins >= 45;
}

function shuffleKey(userId: string, scriptDate: string, slot: RadioSlot): number {
  let h = 0;
  const s = `${scriptDate}:${slot}:${userId}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 1000;
}

export function shouldDispatchSlot(
  user: UserPrefs,
  slotTime: string,
  radioSlot: RadioSlot,
  force: boolean
): { ok: boolean; reason?: string } {
  const tz = user.timezone || "Asia/Taipei";
  if (!force) {
    if (!isAfterSlotStart(tz, slotTime)) {
      return { ok: false, reason: "before_slot_start" };
    }
    if (!isBeforeCatchUpDeadline(tz, radioSlot)) {
      return { ok: false, reason: "after_catchup_deadline" };
    }
  }
  if (topicCount(user) === 0) {
    return { ok: false, reason: "no_topics" };
  }
  return { ok: true };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hasCompletedScript(
  supabase: any,
  userId: string,
  scriptDate: string,
  duration: number,
  radioSlot: RadioSlot
): Promise<boolean> {
  const { data } = await supabase
    .from("news_daily_radio_scripts")
    .select("id, status")
    .eq("user_id", userId)
    .eq("script_date", scriptDate)
    .eq("duration_minutes", duration)
    .eq("generation_source", SERVER_SOURCE)
    .eq("radio_slot", radioSlot)
    .eq("status", "completed")
    .maybeSingle();
  return Boolean(data);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hasActiveJob(
  supabase: any,
  userId: string,
  scriptDate: string,
  radioSlot: RadioSlot
): Promise<boolean> {
  const { data } = await supabase
    .from("news_daily_radio_job_runs")
    .select("id, status, locked_at")
    .eq("user_id", userId)
    .eq("script_date", scriptDate)
    .eq("radio_slot", radioSlot)
    .eq("generation_source", SERVER_SOURCE)
    .eq("job_type", "full")
    .in("status", ["pending", "processing", "retry_wait"])
    .maybeSingle();

  if (!data) return false;
  if (data.status === "processing" && data.locked_at) {
    const lockedAt = new Date(data.locked_at).getTime();
    if (Date.now() - lockedAt > 15 * 60 * 1000) return false;
  }
  return true;
}

type FailedJobRow = {
  id: string;
  status: string;
  error_stage: string | null;
  duration_minutes: number;
  attempt_count: number | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findFailedJob(
  supabase: any,
  userId: string,
  scriptDate: string,
  radioSlot: RadioSlot
): Promise<FailedJobRow | null> {
  const { data } = await supabase
    .from("news_daily_radio_job_runs")
    .select("id, status, error_stage, duration_minutes, attempt_count")
    .eq("user_id", userId)
    .eq("script_date", scriptDate)
    .eq("radio_slot", radioSlot)
    .eq("generation_source", SERVER_SOURCE)
    .eq("job_type", "full")
    .eq("status", "failed")
    .maybeSingle();
  return (data as FailedJobRow | null) ?? null;
}

/**
 * Concurrency-safe failed → pending reset + re-enqueue (same job_id).
 * Uses WHERE status='failed' so only one Dispatcher wins.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tryResurrectFailedJob(
  supabase: any,
  failedJob: FailedJobRow,
  args: {
    user: UserPrefs;
    radioSlot: RadioSlot;
    scriptDate: string;
    priority: number;
    triggerSource: string;
    force: boolean;
  }
): Promise<DispatchResult> {
  const resurrectionCount = parseResurrectionCount(failedJob.error_stage);
  const tz = args.user.timezone || "Asia/Taipei";
  const withinCatchUp = isBeforeCatchUpDeadline(tz, args.radioSlot);
  const gate = canResurrectFailedJob({
    hasCompletedScript: false,
    hasActiveJob: false,
    withinCatchUpWindow: withinCatchUp,
    resurrectionCount,
    force: args.force,
  });
  if (!gate.ok) {
    return {
      user_id: args.user.user_id,
      radio_slot: args.radioSlot,
      status: "skipped",
      reason: gate.reason,
      job_id: failedJob.id,
    };
  }

  const now = new Date().toISOString();
  const patch = buildFailedJobResurrectionPatch({
    nowIso: now,
    previousResurrectionCount: resurrectionCount,
    priority: args.priority,
    triggerSource: args.triggerSource,
  });

  const { data: claimed, error: claimError } = await supabase
    .from("news_daily_radio_job_runs")
    .update(patch)
    .eq("id", failedJob.id)
    .eq("status", "failed")
    .select("id")
    .maybeSingle();

  if (claimError) {
    return {
      user_id: args.user.user_id,
      radio_slot: args.radioSlot,
      status: "skipped",
      reason: claimError.message,
      job_id: failedJob.id,
    };
  }

  if (!claimed) {
    return {
      user_id: args.user.user_id,
      radio_slot: args.radioSlot,
      status: "skipped",
      reason: "concurrent_resurrection_lost",
      job_id: failedJob.id,
    };
  }

  const duration = (
    failedJob.duration_minutes === 5 || failedJob.duration_minutes === 10
      ? failedJob.duration_minutes
      : 3
  ) as 3 | 5 | 10;

  const payload: DailyRadioJobPayload = {
    job_id: failedJob.id,
    user_id: args.user.user_id,
    script_date: args.scriptDate,
    radio_slot: args.radioSlot,
    duration_minutes: duration,
    job_type: "full",
    trigger_source: args.triggerSource,
    force: args.force,
    priority: args.priority,
    created_at: now,
  };

  const msgId = await sendDailyRadioJob(supabase, payload, 0);
  if (msgId == null) {
    // Keep the incremented resurrection count from the claim patch (not the pre-claim value).
    const revert = buildEnqueueFailureRevertPatch(now, resurrectionCount + 1);
    await supabase
      .from("news_daily_radio_job_runs")
      .update(revert)
      .eq("id", failedJob.id)
      .eq("status", "pending");
    return {
      user_id: args.user.user_id,
      radio_slot: args.radioSlot,
      status: "skipped",
      reason: "enqueue_failed_after_resurrection",
      job_id: failedJob.id,
    };
  }

  await supabase
    .from("news_daily_radio_job_runs")
    .update({ pgmq_msg_id: msgId, updated_at: new Date().toISOString() })
    .eq("id", failedJob.id);

  console.log(
    JSON.stringify({
      event: "daily_radio_job_resurrected",
      user_id: args.user.user_id,
      radio_slot: args.radioSlot,
      job_id: failedJob.id,
      resurrection_count: resurrectionCount + 1,
      pgmq_msg_id: msgId,
      note: "pgmq_message_requeued_only_no_news_archive",
    })
  );

  return {
    user_id: args.user.user_id,
    radio_slot: args.radioSlot,
    status: "queued",
    reason: "resurrected_failed_job",
    job_id: failedJob.id,
    priority: args.priority,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function dispatchDailyRadioJobs(
  supabase: any,
  users: UserPrefs[],
  args: {
    force: boolean;
    triggerSource: string;
    targetRadioSlot?: RadioSlot;
    targetUserId?: string;
    canaryUserIds?: Set<string>;
    canaryOnly?: boolean;
  }
): Promise<DispatchSummary> {
  const scriptDate = getTaipeiDateKey();
  const results: DispatchResult[] = [];
  const processOpts: ProcessOptions = {
    force: args.force,
    sendTestPush: false,
    targetRadioSlot: args.targetRadioSlot,
    pushDedup: { sentDeviceKeys: new Set() },
    pushTokenIndex: new Map(),
    finalPushCount: { value: 0 },
    pushFailureCount: { value: 0 },
  };

  const candidates: Array<{
    user: UserPrefs;
    slot: ReturnType<typeof getUserSlots>[number];
    sortKey: number;
  }> = [];

  for (const user of users) {
    const bypassCanary = args.force && args.targetUserId === user.user_id;
    if (args.canaryOnly && args.canaryUserIds && !args.canaryUserIds.has(user.user_id) && !bypassCanary) {
      continue;
    }
    for (const slot of getUserSlots(user, processOpts)) {
      candidates.push({
        user,
        slot,
        sortKey:
          computePriority(user, slot.slot, slot.duration, args.force, false) * 1000 +
          shuffleKey(user.user_id, scriptDate, slot.slot),
      });
    }
  }

  candidates.sort((a, b) => a.sortKey - b.sortKey);

  for (const { user, slot } of candidates) {
    const gate = shouldDispatchSlot(user, slot.time, slot.slot, args.force);
    if (!gate.ok) {
      results.push({
        user_id: user.user_id,
        radio_slot: slot.slot,
        status: "skipped",
        reason: gate.reason,
      });
      continue;
    }

    if (slot.slot === "evening" && !isProUser(user)) {
      results.push({
        user_id: user.user_id,
        radio_slot: slot.slot,
        status: "skipped",
        reason: "free_evening_not_allowed",
      });
      continue;
    }

    if (!args.force) {
      const done = await hasCompletedScript(
        supabase,
        user.user_id,
        scriptDate,
        slot.duration,
        slot.slot
      );
      if (done) {
        results.push({
          user_id: user.user_id,
          radio_slot: slot.slot,
          status: "skipped",
          reason: "already_completed",
        });
        continue;
      }

      const active = await hasActiveJob(supabase, user.user_id, scriptDate, slot.slot);
      if (active) {
        results.push({
          user_id: user.user_id,
          radio_slot: slot.slot,
          status: "skipped",
          reason: "job_already_pending",
        });
        continue;
      }
    }

    const tz = user.timezone || "Asia/Taipei";
    const overdue = !args.force && isSlotOverdue(tz, slot.time);
    const priority = computePriority(user, slot.slot, slot.duration, args.force, overdue);
    const now = new Date().toISOString();

    // Prefer resurrecting existing failed job over inserting (unique constraint).
    if (!args.force) {
      const failedJob = await findFailedJob(supabase, user.user_id, scriptDate, slot.slot);
      if (failedJob) {
        const resurrected = await tryResurrectFailedJob(supabase, failedJob, {
          user,
          radioSlot: slot.slot,
          scriptDate,
          priority,
          triggerSource: args.triggerSource,
          force: args.force,
        });
        results.push(resurrected);
        continue;
      }
    }

    const jobId = crypto.randomUUID();

    const { data: inserted, error: insertError } = await supabase
      .from("news_daily_radio_job_runs")
      .insert({
        id: jobId,
        user_id: user.user_id,
        script_date: scriptDate,
        radio_slot: slot.slot,
        duration_minutes: slot.duration,
        generation_source: SERVER_SOURCE,
        job_type: "full",
        status: "pending",
        priority,
        trigger_source: args.triggerSource,
        force_regenerate: args.force,
        queued_at: now,
      })
      .select("id")
      .maybeSingle();

    if (insertError) {
      if (insertError.code === "23505") {
        // Race: another worker inserted, or a failed row exists — try resurrect once.
        const failedJob = await findFailedJob(supabase, user.user_id, scriptDate, slot.slot);
        if (failedJob) {
          const resurrected = await tryResurrectFailedJob(supabase, failedJob, {
            user,
            radioSlot: slot.slot,
            scriptDate,
            priority,
            triggerSource: args.triggerSource,
            force: args.force,
          });
          results.push(resurrected);
          continue;
        }
        results.push({
          user_id: user.user_id,
          radio_slot: slot.slot,
          status: "skipped",
          reason: "duplicate_job",
        });
        continue;
      }
      results.push({
        user_id: user.user_id,
        radio_slot: slot.slot,
        status: "skipped",
        reason: insertError.message,
      });
      continue;
    }

    if (!inserted) {
      results.push({
        user_id: user.user_id,
        radio_slot: slot.slot,
        status: "skipped",
        reason: "duplicate_job",
      });
      continue;
    }

    const payload: DailyRadioJobPayload = {
      job_id: jobId,
      user_id: user.user_id,
      script_date: scriptDate,
      radio_slot: slot.slot,
      duration_minutes: slot.duration as 3 | 5 | 10,
      job_type: "full",
      trigger_source: args.triggerSource,
      force: args.force,
      priority,
      created_at: now,
    };

    const msgId = await sendDailyRadioJob(supabase, payload);
    if (msgId != null) {
      await supabase
        .from("news_daily_radio_job_runs")
        .update({ pgmq_msg_id: msgId, updated_at: now })
        .eq("id", jobId);
    }

    results.push({
      user_id: user.user_id,
      radio_slot: slot.slot,
      status: "queued",
      job_id: jobId,
      priority,
    });
  }

  return {
    queued: results.filter((r) => r.status === "queued").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    results,
  };
}

export function isQueueEnabled(): boolean {
  const v = (Deno.env.get("DAILY_RADIO_QUEUE_ENABLED") ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function isCanaryOnly(): boolean {
  const v = (Deno.env.get("DAILY_RADIO_QUEUE_CANARY_ONLY") ?? "").trim().toLowerCase();
  return v === "true" || v === "1";
}

export function parseCanaryUserIds(): Set<string> {
  const raw = Deno.env.get("DAILY_RADIO_QUEUE_CANARY_USER_IDS") ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}
