/**
 * Failed job resurrection + retry classification tests.
 * Usage: npm run test:daily-radio-job-resurrection
 */
import {
  MAX_JOB_RESURRECTIONS,
  backoffSecondsForAttempt,
  buildEnqueueFailureRevertPatch,
  buildFailedJobResurrectionPatch,
  canResurrectFailedJob,
  classifyDailyRadioError,
  formatResurrectionStage,
  isRetryableError,
  parseResurrectionCount,
  simulateConcurrentFailedResurrection,
  stickyErrorStage,
} from "../shared/dailyRadioRetry.mjs";

function assert(c, m) {
  if (!c) throw new Error(m);
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`FAIL: ${name}`, e.message);
    failed++;
  }
}

test("failed evening job within catch-up → can resurrect", () => {
  const gate = canResurrectFailedJob({
    hasCompletedScript: false,
    hasActiveJob: false,
    withinCatchUpWindow: true,
    resurrectionCount: 0,
  });
  assert(gate.ok, "should allow resurrection");
  const patch = buildFailedJobResurrectionPatch({
    nowIso: "2026-07-28T10:00:00.000Z",
    previousResurrectionCount: 0,
    priority: 50,
    triggerSource: "cron",
  });
  assert(patch.status === "pending", "status pending");
  assert(patch.attempt_count === 0, "attempt reset");
  assert(patch.last_error === null, "error cleared");
  assert(patch.next_retry_at === null, "retry cleared");
  assert(patch.locked_at === null && patch.locked_by === null, "lock cleared");
  assert(patch.error_stage === "resurrection:1", "stage counted");
  assert(patch.pgmq_msg_id === null, "msg cleared until enqueue");
});

test("failed evening job after 22:00 catch-up → no resurrect", () => {
  const gate = canResurrectFailedJob({
    hasCompletedScript: false,
    hasActiveJob: false,
    withinCatchUpWindow: false,
    resurrectionCount: 0,
  });
  assert(!gate.ok && gate.reason === "after_catchup_deadline", gate.reason);
});

test("failed job but completed script exists → no resurrect", () => {
  const gate = canResurrectFailedJob({
    hasCompletedScript: true,
    hasActiveJob: false,
    withinCatchUpWindow: true,
    resurrectionCount: 0,
  });
  assert(!gate.ok && gate.reason === "already_completed", gate.reason);
});

test("active job exists → no resurrect", () => {
  const gate = canResurrectFailedJob({
    hasCompletedScript: false,
    hasActiveJob: true,
    withinCatchUpWindow: true,
    resurrectionCount: 0,
  });
  assert(!gate.ok && gate.reason === "job_already_pending", gate.reason);
});

test("resurrection limit prevents infinite loops", () => {
  const gate = canResurrectFailedJob({
    hasCompletedScript: false,
    hasActiveJob: false,
    withinCatchUpWindow: true,
    resurrectionCount: MAX_JOB_RESURRECTIONS,
  });
  assert(!gate.ok && gate.reason === "resurrection_limit_reached", gate.reason);
});

test("two dispatchers concurrent → only one claim", () => {
  const sim = simulateConcurrentFailedResurrection("failed");
  assert(sim.claimCount === 1, `expected 1 claim got ${sim.claimCount}`);
  assert(sim.finalStatus === "pending", "final pending");
  assert(sim.claims[0].claimed === true && sim.claims[1].claimed === false, "second lost");
});

test("unique identity preserved: same job_id on resurrection patch path", () => {
  // Resurrection never creates a new UUID; patch applies to existing id.
  const jobId = "same-job-uuid";
  const patch = buildFailedJobResurrectionPatch({
    nowIso: "2026-07-28T10:00:00.000Z",
    previousResurrectionCount: 1,
    priority: 40,
    triggerSource: "cron",
  });
  assert(!("id" in patch), "must not mint new id in patch");
  assert(parseResurrectionCount(patch.error_stage) === 2, "count 2");
  assert(jobId === "same-job-uuid", "caller keeps job id");
});

test("NO_RAW_CANDIDATES / RSS empty is retryable", () => {
  assert(
    isRetryableError("NO_RAW_CANDIDATES: 無法取得晚報新新聞（RSS 來源暫無資料）"),
    "coded raw"
  );
  assert(isRetryableError("無法取得晚報新新聞（RSS 來源暫無資料）"), "legacy chinese");
  assert(classifyDailyRadioError("NO_RAW_CANDIDATES: x").code === "NO_RAW_CANDIDATES");
});

test("NO_USABLE_CANDIDATES (raw>0 usable=0) is retryable in catch-up", () => {
  assert(
    isRetryableError("NO_USABLE_CANDIDATES: 無法取得晚報新新聞（所有候選均為無關或垃圾內容）"),
    "coded usable"
  );
  assert(
    isRetryableError("無法取得晚報新新聞（所有候選均為無關或垃圾內容）"),
    "legacy usable must retry (was permanent before)"
  );
});

test("permanent config/auth errors do not retry", () => {
  assert(!isRetryableError("no_topics"), "no_topics");
  assert(!isRetryableError("未設定追蹤主題"), "chinese topics");
  assert(!isRetryableError("user_preferences_not_found"), "prefs");
  assert(!isRetryableError("BadDeviceToken"), "apns token");
  assert(!isRetryableError("free_evening_not_allowed"), "free evening");
});

test("pgmq backoff schedule unchanged and delay indices sane", () => {
  assert(backoffSecondsForAttempt(1) === 60, "a1");
  assert(backoffSecondsForAttempt(2) === 180, "a2");
  assert(backoffSecondsForAttempt(3) === 600, "a3");
  assert(backoffSecondsForAttempt(4) === 1800, "a4");
  assert(backoffSecondsForAttempt(5) === 3600, "a5");
  assert(backoffSecondsForAttempt(6) === 3600, "clamp");
});

test("enqueue failure revert restores failed (not stuck pending)", () => {
  const revert = buildEnqueueFailureRevertPatch("2026-07-28T10:01:00.000Z", 1);
  assert(revert.status === "failed", "failed");
  assert(revert.last_error === "enqueue_failed_after_resurrection", "error");
  assert(revert.error_stage === "resurrection:1", "preserve count");
});

test("worker fail/retry must not wipe resurrection error_stage", () => {
  assert(stickyErrorStage("resurrection:2", "process_job") === "resurrection:2");
  assert(stickyErrorStage(null, "process_job") === "process_job");
  assert(stickyErrorStage("worker_exception", "process_job") === "process_job");
});

test("queue archive note: resurrection only requeues pgmq, not news archive", () => {
  // Documentation / contract guard: patch fields never touch news tables.
  const patch = buildFailedJobResurrectionPatch({
    nowIso: "2026-07-28T10:00:00.000Z",
    previousResurrectionCount: 0,
    priority: 50,
    triggerSource: "cron",
  });
  const keys = Object.keys(patch);
  assert(!keys.some((k) => k.includes("news") || k.includes("article")), "no news fields");
  assert(formatResurrectionStage(0) === "resurrection:0");
});

test("attempt_count reset on resurrection avoids immediate MAX exhaustion", () => {
  const patch = buildFailedJobResurrectionPatch({
    nowIso: "2026-07-28T10:00:00.000Z",
    previousResurrectionCount: 2,
    priority: 50,
    triggerSource: "cron",
  });
  assert(patch.attempt_count === 0, "fresh worker attempts");
  assert(parseResurrectionCount(patch.error_stage) === 3, "3rd resurrection");
  assert(3 <= MAX_JOB_RESURRECTIONS, "at limit after this");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
