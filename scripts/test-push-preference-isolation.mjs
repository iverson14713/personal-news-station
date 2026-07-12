/**
 * Push token sync must not mutate product preference columns.
 * Usage: npm run test:push-preference-isolation
 */

import {
  GUARDED_PREFERENCE_FIELDS,
  LEGACY_PUSH_UPSERT_DEFAULTS,
  buildPushTokenUpdatePayload,
  preferenceFieldsUnchanged,
  pushPayloadTouchesPreferences,
  simulateIsolatedPushUpdate,
  simulateLegacyPushUpsert,
} from "../shared/pushPreferenceIsolation.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    return true;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

let passed = 0;
let failed = 0;

function run(name, fn) {
  if (test(name, fn)) passed += 1;
  else failed += 1;
}

const proRow = {
  voice_feature_enabled: true,
  ai_anchor_id: "nova",
  ai_anchor_voice: "nova",
  ai_anchor_style: "news",
  morning_duration_minutes: 10,
  evening_duration_minutes: 10,
  evening_radio_enabled: true,
  topics: ["科技"],
  custom_keywords: [],
  timezone: "Asia/Taipei",
};

const freeRow = {
  voice_feature_enabled: false,
  ai_anchor_id: "emily",
  ai_anchor_voice: "coral",
  ai_anchor_style: "news",
  morning_duration_minutes: 3,
  evening_duration_minutes: 3,
  evening_radio_enabled: false,
  topics: ["科技"],
  custom_keywords: [],
  timezone: "Asia/Taipei",
};

run("Case 1: Pro/Nova/10min/evening on survives isolated push update", () => {
  const patch = buildPushTokenUpdatePayload({
    pushToken: "abc123token456",
    pushPlatform: "ios",
    pushEnvironment: "sandbox",
    updatedAt: "2026-07-12T04:00:00.000Z",
  });
  assert(!pushPayloadTouchesPreferences(patch), "push patch must not include preference fields");
  const after = simulateIsolatedPushUpdate(proRow, patch);
  assert(preferenceFieldsUnchanged(proRow, after), "preference fields changed after push sync");
  assert(after.push_token === "abc123token456", "push token not updated");
  assert(after.morning_duration_minutes === 10, "morning duration overwritten");
  assert(after.evening_radio_enabled === true, "evening overwritten");
});

run("Case 2: Free/Emily/3min survives isolated push update", () => {
  const patch = buildPushTokenUpdatePayload({
    pushToken: "free-user-token",
    pushPlatform: "ios",
    pushEnvironment: "production",
    updatedAt: "2026-07-12T04:00:00.000Z",
  });
  const after = simulateIsolatedPushUpdate(freeRow, patch);
  assert(preferenceFieldsUnchanged(freeRow, after), "free preferences changed");
  assert(after.ai_anchor_id === "emily", "anchor changed");
});

run("Case 3: legacy push upsert would overwrite Pro preferences (regression guard)", () => {
  const patch = buildPushTokenUpdatePayload({
    pushToken: "legacy-bad",
    pushPlatform: "ios",
    pushEnvironment: "sandbox",
    updatedAt: "2026-07-12T04:00:00.000Z",
  });
  const after = simulateLegacyPushUpsert(proRow, patch);
  assert(after.morning_duration_minutes === 3, "legacy regression missing");
  assert(after.evening_radio_enabled === false, "legacy regression missing");
  assert(!preferenceFieldsUnchanged(proRow, after), "legacy upsert should change prefs");
});

run("Case 10: concurrent preference + push — isolated push preserves prefs", () => {
  const prefSynced = { ...proRow, morning_duration_minutes: 10, evening_radio_enabled: true };
  const patch = buildPushTokenUpdatePayload({
    pushToken: "concurrent-token",
    pushPlatform: "ios",
    pushEnvironment: "sandbox",
    updatedAt: "2026-07-12T04:01:00.000Z",
  });
  const finalRow = simulateIsolatedPushUpdate(prefSynced, patch);
  assert(finalRow.morning_duration_minutes === 10, "final morning duration wrong");
  assert(finalRow.evening_radio_enabled === true, "final evening wrong");
  assert(finalRow.push_token === "concurrent-token", "token not saved");
});

run("push patch only contains allowed keys", () => {
  const patch = buildPushTokenUpdatePayload({
    pushToken: "tok",
    pushPlatform: "ios",
    pushEnvironment: "production",
    updatedAt: "2026-07-12T04:00:00.000Z",
  });
  const keys = Object.keys(patch);
  for (const key of keys) {
    assert(
      ["push_token", "push_platform", "push_environment", "updated_at"].includes(key),
      `unexpected key in push patch: ${key}`
    );
  }
});

run("guarded field list covers legacy defaults", () => {
  for (const key of Object.keys(LEGACY_PUSH_UPSERT_DEFAULTS)) {
    assert(GUARDED_PREFERENCE_FIELDS.includes(key), `missing guarded field: ${key}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
