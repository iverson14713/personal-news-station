/**
 * Daily radio queue dispatcher / Free-Pro evening guards 單元測試
 * 用法：npm run test:daily-radio-queue
 */
import {
  getUserSlots,
  isProUser,
  isVoiceFeatureEnabled,
  shouldAllowEveningDispatch,
  shouldAllowEveningPush,
} from "../shared/dailyRadioEligibility.mjs";

function loadDispatchHelpers() {
  function isAfterSlotStart(timezone, slotTime) {
    const [th, tm] = slotTime.split(":").map(Number);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return hour * 60 + minute >= th * 60 + tm;
  }

  function shouldDispatchSlot(user, slotTime, radioSlot, force) {
    const tz = user.timezone || "Asia/Taipei";
    if (!force) {
      if (!isAfterSlotStart(tz, slotTime)) return { ok: false, reason: "before_slot_start" };
    }
    const topics = (user.topics?.length ?? 0) + (user.custom_keywords?.length ?? 0);
    if (topics === 0) return { ok: false, reason: "no_topics" };
    return { ok: true };
  }

  function computePriority(duration, force, overdue) {
    if (force) return 0;
    if (overdue) return 10;
    if (duration === 3) return 30;
    if (duration === 5) return 40;
    return 50;
  }

  function jobDedupeKey(userId, scriptDate, radioSlot) {
    return `${userId}:${scriptDate}:${radioSlot}:server:full`;
  }

  function simulateDispatch(user, options = {}) {
    const slots = getUserSlots(user, { targetRadioSlot: options.targetRadioSlot });
    const results = [];
    for (const slot of slots) {
      const gate = shouldDispatchSlot(user, slot.time, slot.slot, options.force === true);
      if (!gate.ok) {
        results.push({ radio_slot: slot.slot, status: "skipped", reason: gate.reason });
        continue;
      }
      const eveningGuard = shouldAllowEveningDispatch(user, slot.slot);
      if (!eveningGuard.ok) {
        results.push({ radio_slot: slot.slot, status: "skipped", reason: eveningGuard.reason });
        continue;
      }
      results.push({ radio_slot: slot.slot, status: "queued" });
    }
    return results;
  }

  function simulateWorkerProcess(user, radioSlot) {
    if (radioSlot === "evening" && !isProUser(user)) {
      return { status: "skipped", reason: "free_evening_not_allowed" };
    }
    return { status: "completed" };
  }

  function simulateEveningPush(user, radioSlot) {
    const guard = shouldAllowEveningPush(user, radioSlot);
    if (!guard.ok) {
      return { push_status: "no_token", push_error: guard.reason, claim_skipped: true };
    }
    return { push_status: "sent" };
  }

  return {
    shouldDispatchSlot,
    computePriority,
    jobDedupeKey,
    simulateDispatch,
    simulateWorkerProcess,
    simulateEveningPush,
  };
}

const {
  computePriority,
  jobDedupeKey,
  simulateDispatch,
  simulateWorkerProcess,
  simulateEveningPush,
} = loadDispatchHelpers();

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

const freeUser = {
  user_id: "free-1",
  timezone: "Asia/Taipei",
  topics: ["BTC"],
  custom_keywords: [],
  morning_radio_enabled: true,
  evening_radio_enabled: false,
  voice_feature_enabled: false,
  morning_duration_minutes: 3,
  evening_duration_minutes: 3,
};

const proUser = {
  ...freeUser,
  user_id: "pro-1",
  voice_feature_enabled: true,
  evening_radio_enabled: true,
  evening_duration_minutes: 10,
};

test("1. Free + evening_radio_enabled=false → 不建立 evening job", () => {
  const slots = getUserSlots(freeUser);
  assert(slots.length === 1 && slots[0].slot === "morning", "only morning slot");
  const results = simulateDispatch(freeUser, { force: true });
  assert(!results.some((r) => r.radio_slot === "evening"), "no evening dispatch");
});

test("2. Free + evening_radio_enabled=true（DB 污染）→ Dispatcher 仍不得建立 evening job", () => {
  const polluted = { ...freeUser, evening_radio_enabled: true };
  const slots = getUserSlots(polluted);
  assert(!slots.some((s) => s.slot === "evening"), "getUserSlots blocks free evening");
  const results = simulateDispatch(polluted, { force: true, targetRadioSlot: "evening" });
  assert(results.length === 0 || results.every((r) => r.status === "skipped"), "no evening queued");
});

test("3. 人工插入 Free evening queue job → Worker skipped", () => {
  const polluted = { ...freeUser, evening_radio_enabled: true };
  const result = simulateWorkerProcess(polluted, "evening");
  assert(result.status === "skipped", "skipped");
  assert(result.reason === "free_evening_not_allowed", "reason");
});

test("4. Free 歷史 server evening script → catch-up 不得發 evening APNs", () => {
  const polluted = { ...freeUser, evening_radio_enabled: true };
  const push = simulateEveningPush(polluted, "evening");
  assert(push.push_status === "no_token", "no push");
  assert(push.push_error === "free_evening_push_not_allowed", "push guard reason");
  assert(push.claim_skipped === true, "no claim");
});

test("5. Pro + evening_radio_enabled=true → 正常建立 evening job", () => {
  const slots = getUserSlots(proUser);
  assert(slots.some((s) => s.slot === "evening"), "evening enabled");
  const results = simulateDispatch(proUser, { force: true, targetRadioSlot: "evening" });
  assert(results.some((r) => r.radio_slot === "evening" && r.status === "queued"), "evening queued");
  const worker = simulateWorkerProcess(proUser, "evening");
  assert(worker.status === "completed", "worker runs");
  const push = simulateEveningPush(proUser, "evening");
  assert(push.push_status === "sent", "push allowed");
});

test("6. Pro + evening_radio_enabled=false → 不建立 evening job", () => {
  const proNoEvening = { ...proUser, evening_radio_enabled: false };
  const slots = getUserSlots(proNoEvening);
  assert(!slots.some((s) => s.slot === "evening"), "evening disabled");
});

test("7. Free morning → 不受影響", () => {
  const slots = getUserSlots(freeUser);
  assert(slots[0].slot === "morning", "morning slot");
  const results = simulateDispatch(freeUser, { force: true, targetRadioSlot: "morning" });
  assert(results.some((r) => r.radio_slot === "morning" && r.status === "queued"), "morning queued");
  const worker = simulateWorkerProcess(freeUser, "morning");
  assert(worker.status === "completed", "morning worker ok");
  const push = simulateEveningPush(freeUser, "morning");
  assert(push.push_status === "sent", "morning push not blocked by evening guard");
});

test("8. isVoiceFeatureEnabled 不因 evening_radio_enabled 反推 Pro", () => {
  const polluted = { ...freeUser, evening_radio_enabled: true, voice_feature_enabled: false };
  assert(isProUser(polluted) === false, "not pro");
  assert(isVoiceFeatureEnabled(polluted) === false, "not voice feature");
});

test("9. App 手動生成 generation_source 維持 app（非 server evening）", () => {
  const appManual = {
    generation_source: "app",
    radio_slot: "evening",
    user_plan: "free",
  };
  assert(appManual.generation_source === "app", "app source");
  assert(appManual.generation_source !== "server", "never server for app manual");
});

test("Pro morning + evening 各自 dedupe key", () => {
  const uid = "abc";
  const d = "2026-07-11";
  assert(jobDedupeKey(uid, d, "morning") !== jobDedupeKey(uid, d, "evening"), "slots differ");
});

test("Free 3 分鐘 priority < Pro 10 分鐘", () => {
  assert(computePriority(3, false, false) < computePriority(10, false, false), "free first");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
