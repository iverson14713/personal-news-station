/**
 * Daily radio job error classification + resurrection policy.
 * Keep in sync with `shared/dailyRadioRetry.mjs` (Node tests).
 */

export const DAILY_RADIO_ERROR_CODE = {
  NO_RAW_CANDIDATES: "NO_RAW_CANDIDATES",
  NO_USABLE_CANDIDATES: "NO_USABLE_CANDIDATES",
  NO_TOPICS: "NO_TOPICS",
  FREE_EVENING: "FREE_EVENING",
  USER_PREFS_MISSING: "USER_PREFS_MISSING",
} as const;

/** 全日同一 job 最多被 Dispatcher 從 failed 復活的次數（不含初次 enqueue） */
export const MAX_JOB_RESURRECTIONS = 3;

export const MAX_JOB_ATTEMPTS = 5;

export const RETRY_BACKOFF_SECONDS = [60, 180, 600, 1800, 3600] as const;

export const RESURRECTION_STAGE_PREFIX = "resurrection:";

export function parseResurrectionCount(errorStage: string | null | undefined): number {
  if (typeof errorStage !== "string") return 0;
  const m = errorStage.match(/^resurrection:(\d+)$/);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function formatResurrectionStage(count: number): string {
  return `${RESURRECTION_STAGE_PREFIX}${Math.max(0, Math.floor(count))}`;
}

/** Keep resurrection:N sticky so worker fail/retry paths cannot wipe the cap. */
export function stickyErrorStage(
  existing: string | null | undefined,
  fallback: string
): string {
  return parseResurrectionCount(existing) > 0 ? String(existing) : fallback;
}

export function canResurrectFailedJob(input: {
  hasCompletedScript: boolean;
  hasActiveJob: boolean;
  withinCatchUpWindow: boolean;
  resurrectionCount: number;
  force?: boolean;
}): { ok: boolean; reason?: string } {
  if (input.hasCompletedScript) {
    return { ok: false, reason: "already_completed" };
  }
  if (input.hasActiveJob) {
    return { ok: false, reason: "job_already_pending" };
  }
  if (!input.force && !input.withinCatchUpWindow) {
    return { ok: false, reason: "after_catchup_deadline" };
  }
  if ((input.resurrectionCount ?? 0) >= MAX_JOB_RESURRECTIONS) {
    return { ok: false, reason: "resurrection_limit_reached" };
  }
  return { ok: true };
}

export function buildFailedJobResurrectionPatch(input: {
  nowIso: string;
  previousResurrectionCount: number;
  priority: number;
  triggerSource: string;
}): Record<string, unknown> {
  const nextCount = (input.previousResurrectionCount ?? 0) + 1;
  return {
    status: "pending",
    attempt_count: 0,
    last_error: null,
    next_retry_at: null,
    locked_at: null,
    locked_by: null,
    current_stage: null,
    pgmq_msg_id: null,
    completed_at: null,
    started_at: null,
    error_stage: formatResurrectionStage(nextCount),
    priority: input.priority,
    trigger_source: input.triggerSource,
    queued_at: input.nowIso,
    updated_at: input.nowIso,
  };
}

export function buildEnqueueFailureRevertPatch(
  nowIso: string,
  previousResurrectionCount: number
): Record<string, unknown> {
  return {
    status: "failed",
    last_error: "enqueue_failed_after_resurrection",
    error_stage: formatResurrectionStage(previousResurrectionCount ?? 0),
    locked_at: null,
    locked_by: null,
    pgmq_msg_id: null,
    next_retry_at: null,
    completed_at: nowIso,
    updated_at: nowIso,
  };
}

export type DailyRadioErrorKind = "transient" | "permanent";

export function classifyDailyRadioError(message: string): {
  kind: DailyRadioErrorKind;
  code: string;
} {
  const raw = String(message ?? "");
  const m = raw.toLowerCase();

  if (
    raw.includes(DAILY_RADIO_ERROR_CODE.NO_TOPICS) ||
    m.includes("no_topics") ||
    m.includes("未設定追蹤主題")
  ) {
    return { kind: "permanent", code: DAILY_RADIO_ERROR_CODE.NO_TOPICS };
  }
  if (m.includes("free_evening") || m.includes("free_evening_not_allowed")) {
    return { kind: "permanent", code: DAILY_RADIO_ERROR_CODE.FREE_EVENING };
  }
  if (
    m.includes("user_preferences_not_found") ||
    m.includes("baddevicetoken") ||
    m.includes("unregistered") ||
    (m.includes("invalid") && m.includes("user"))
  ) {
    return { kind: "permanent", code: "CONFIG_OR_AUTH" };
  }

  if (
    raw.includes(DAILY_RADIO_ERROR_CODE.NO_RAW_CANDIDATES) ||
    m.includes("rss 來源暫無資料") ||
    m.includes("rss來源暫無資料") ||
    m.includes("no_fresh_rss")
  ) {
    return { kind: "transient", code: DAILY_RADIO_ERROR_CODE.NO_RAW_CANDIDATES };
  }

  if (
    raw.includes(DAILY_RADIO_ERROR_CODE.NO_USABLE_CANDIDATES) ||
    m.includes("所有候選均為無關或垃圾") ||
    m.includes("無關或垃圾內容")
  ) {
    return { kind: "transient", code: DAILY_RADIO_ERROR_CODE.NO_USABLE_CANDIDATES };
  }

  if (m.includes("429") || m.includes("rate limit")) {
    return { kind: "transient", code: "RATE_LIMIT" };
  }
  if (m.includes("timeout") || m.includes("timed out")) {
    return { kind: "transient", code: "TIMEOUT" };
  }
  if (m.includes("5xx") || m.includes("502") || m.includes("503") || m.includes("504")) {
    return { kind: "transient", code: "HTTP_5XX" };
  }
  if (m.includes("econnreset") || m.includes("network")) {
    return { kind: "transient", code: "NETWORK" };
  }
  if (m.includes("storage") && m.includes("temporar")) {
    return { kind: "transient", code: "STORAGE_TEMP" };
  }
  if (m.includes("rss")) {
    return { kind: "transient", code: DAILY_RADIO_ERROR_CODE.NO_RAW_CANDIDATES };
  }
  if (m.includes("openai") || m.includes("tts") || m.includes("apns")) {
    return { kind: "transient", code: "PROVIDER" };
  }

  return { kind: "permanent", code: "UNKNOWN" };
}

export function isRetryableError(message: string): boolean {
  return classifyDailyRadioError(message).kind === "transient";
}

export function backoffSecondsForAttempt(attempt: number): number {
  const idx = Math.min(Math.max(attempt - 1, 0), RETRY_BACKOFF_SECONDS.length - 1);
  return RETRY_BACKOFF_SECONDS[idx]!;
}
