/**
 * Daily radio job error classification + resurrection policy.
 * Edge `_shared/dailyRadioQueue.ts` / dispatcher 必須與此邏輯保持一致。
 */

export const DAILY_RADIO_ERROR_CODE = {
  NO_RAW_CANDIDATES: "NO_RAW_CANDIDATES",
  NO_USABLE_CANDIDATES: "NO_USABLE_CANDIDATES",
  NO_TOPICS: "NO_TOPICS",
  FREE_EVENING: "FREE_EVENING",
  USER_PREFS_MISSING: "USER_PREFS_MISSING",
};

/** 全日同一 job 最多被 Dispatcher 從 failed 復活的次數（不含初次 enqueue） */
export const MAX_JOB_RESURRECTIONS = 3;

/** Worker 單輪 attempt 上限（與 DB max_attempts 預設一致） */
export const MAX_JOB_ATTEMPTS = 5;

export const RETRY_BACKOFF_SECONDS = [60, 180, 600, 1800, 3600];

export const RESURRECTION_STAGE_PREFIX = "resurrection:";

export function parseResurrectionCount(errorStage) {
  if (typeof errorStage !== "string") return 0;
  const m = errorStage.match(/^resurrection:(\d+)$/);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function formatResurrectionStage(count) {
  return `${RESURRECTION_STAGE_PREFIX}${Math.max(0, Math.floor(count))}`;
}

/** Keep resurrection:N sticky so worker fail/retry paths cannot wipe the cap. */
export function stickyErrorStage(existing, fallback) {
  return parseResurrectionCount(existing) > 0 ? String(existing) : fallback;
}

export function canResurrectFailedJob({
  hasCompletedScript,
  hasActiveJob,
  withinCatchUpWindow,
  resurrectionCount,
  force = false,
}) {
  if (hasCompletedScript) {
    return { ok: false, reason: "already_completed" };
  }
  if (hasActiveJob) {
    return { ok: false, reason: "job_already_pending" };
  }
  if (!force && !withinCatchUpWindow) {
    return { ok: false, reason: "after_catchup_deadline" };
  }
  if ((resurrectionCount ?? 0) >= MAX_JOB_RESURRECTIONS) {
    return { ok: false, reason: "resurrection_limit_reached" };
  }
  return { ok: true };
}

/**
 * Build patch for concurrency-safe failed → pending reset.
 * Caller must apply with `.eq("status", "failed")`.
 */
export function buildFailedJobResurrectionPatch({
  nowIso,
  previousResurrectionCount,
  priority,
  triggerSource,
}) {
  const nextCount = (previousResurrectionCount ?? 0) + 1;
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
    priority,
    trigger_source: triggerSource,
    queued_at: nowIso,
    updated_at: nowIso,
  };
}

export function buildEnqueueFailureRevertPatch(nowIso, previousResurrectionCount) {
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

/**
 * Classify generation / worker errors for retry decisions.
 * Transient empty-news errors are retryable during catch-up even without "rss" substring.
 */
export function classifyDailyRadioError(message) {
  const raw = String(message ?? "");
  const m = raw.toLowerCase();

  if (
    raw.includes(DAILY_RADIO_ERROR_CODE.NO_TOPICS) ||
    m.includes("no_topics") ||
    m.includes("未設定追蹤主題")
  ) {
    return { kind: "permanent", code: DAILY_RADIO_ERROR_CODE.NO_TOPICS };
  }
  if (
    m.includes("free_evening") ||
    m.includes("free_evening_not_allowed")
  ) {
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

export function isRetryableError(message) {
  return classifyDailyRadioError(message).kind === "transient";
}

export function backoffSecondsForAttempt(attempt) {
  const idx = Math.min(Math.max(attempt - 1, 0), RETRY_BACKOFF_SECONDS.length - 1);
  return RETRY_BACKOFF_SECONDS[idx];
}

/** Simulate two dispatchers racing on conditional update */
export function simulateConcurrentFailedResurrection(initialStatus) {
  const claims = [];
  let status = initialStatus;
  for (let i = 0; i < 2; i++) {
    if (status === "failed") {
      status = "pending";
      claims.push({ dispatcher: i, claimed: true });
    } else {
      claims.push({ dispatcher: i, claimed: false });
    }
  }
  return { finalStatus: status, claims, claimCount: claims.filter((c) => c.claimed).length };
}
