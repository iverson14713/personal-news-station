/**
 * 每日早報生成資格回歸測試
 * 用法：npm run test:daily-radio-eligibility
 */
import {
  AUTO_DURATION_RULES,
  AUTO_DURATION_RULES_REGRESSION_55dfc2e,
  evaluateMorningGenerationEligibility,
  getMorningSlotConfig,
  getUserSlots,
  hasEnoughNewsForDuration,
  isProUser,
  isVoiceFeatureEnabled,
  passesCronPreferencesQuery,
  resolveAllowedAutoDuration,
  shouldFallbackUpsert,
} from "../shared/dailyRadioEligibility.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    return true;
  } catch (err) {
    console.error(`FAIL: ${name}`, err.message);
    return false;
  }
}

const freeUser = {
  user_id: "414227e0-ec4d-432b-98d0-d34d215a345d",
  topics: ["大谷翔平", "BTC", "台灣熱門"],
  custom_keywords: [],
  daily_radio_enabled: true,
  morning_radio_enabled: true,
  evening_radio_enabled: false,
  morning_duration_minutes: 3,
  voice_feature_enabled: false,
  push_token: null,
};

let passed = 0;
let failed = 0;

function run(name, fn) {
  if (test(name, fn)) passed++;
  else failed++;
}

run("1. Free + 3 分鐘 + 舊 preferences row", () => {
  const r = evaluateMorningGenerationEligibility(freeUser);
  assert(r.eligible === true, "expected eligible");
  assert(r.morning.duration === 3, "duration must stay 3");
  assert(passesCronPreferencesQuery(freeUser), "must pass cron query");
});

run("2. Free + 3 分鐘 + morning_radio_enabled=null", () => {
  const user = { ...freeUser, morning_radio_enabled: null };
  const morning = getMorningSlotConfig(user);
  assert(morning.enabled === true, "null morning must be treated as enabled");
  const r = evaluateMorningGenerationEligibility(user);
  assert(r.eligible === true, "expected eligible");
});

run("3. Free + 無 push token 仍應可生成", () => {
  const r = evaluateMorningGenerationEligibility(freeUser, { hasPushToken: false });
  assert(r.eligible === true, "push token must not block generation");
  assert(r.note === "no_push_token_does_not_block_generation", "explicit non-block note");
});

run("4. Pro + 10 分鐘", () => {
  const pro = {
    ...freeUser,
    voice_feature_enabled: true,
    evening_radio_enabled: true,
    morning_duration_minutes: 10,
  };
  const resolved = resolveAllowedAutoDuration(10, pro);
  assert(resolved.duration === 10, "Pro should keep 10 minutes");
  const r = evaluateMorningGenerationEligibility(pro);
  assert(r.eligible === true, "Pro eligible");
  assert(isProUser(pro) === true, "pro via voice_feature_enabled only");
});

run("4b. evening_radio_enabled 不得反推 Pro", () => {
  const fakePro = { ...freeUser, evening_radio_enabled: true, voice_feature_enabled: false };
  assert(isProUser(fakePro) === false, "evening flag alone is not pro");
  assert(isVoiceFeatureEnabled(fakePro) === false, "voice feature requires entitlement");
  const slots = getUserSlots(fakePro);
  assert(!slots.some((s) => s.slot === "evening"), "free evening slot blocked");
});

run("5. 缺少 preferences row（無 user_id）", () => {
  const r = evaluateMorningGenerationEligibility(null);
  assert(r.eligible === false, "missing row");
  assert(r.exclusionReason === "missing_preferences_row", "reason");
  const noCron = evaluateMorningGenerationEligibility({
    user_id: "x",
    daily_radio_enabled: false,
    topics: ["NBA"],
    morning_radio_enabled: true,
  });
  assert(!passesCronPreferencesQuery({ daily_radio_enabled: false }), "cron excludes");
  assert(noCron.exclusionReason === "daily_radio_disabled", "disabled");
});

run("6. 已有主題但部分欄位為 null", () => {
  const user = {
    user_id: "partial-null",
    topics: ["科技"],
    custom_keywords: null,
    daily_radio_enabled: true,
    morning_radio_enabled: null,
    morning_duration_minutes: null,
    voice_feature_enabled: null,
  };
  const r = evaluateMorningGenerationEligibility(user);
  assert(r.eligible === true, "partial null should still be eligible");
  assert(r.morning.duration === 3, "null duration defaults to 3");
});

run("7. App update 0 rows 時必須 fallback upsert", () => {
  assert(shouldFallbackUpsert(0) === true, "0 rows needs upsert");
  assert(shouldFallbackUpsert(1) === false, "1 row ok");
});

run("regression: 55dfc2e 用 4 則新聞會讓 3 分鐘不合格", () => {
  assert(
    hasEnoughNewsForDuration(3, 4, AUTO_DURATION_RULES_REGRESSION_55dfc2e) === false,
    "55dfc2e min=5 should reject 4 news"
  );
  assert(
    hasEnoughNewsForDuration(3, 4, AUTO_DURATION_RULES) === true,
    "current min=3 should accept 4 news"
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
