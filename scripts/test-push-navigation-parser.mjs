/**
 * Push navigation parser tests (Cases 5–7).
 * Usage: npm run test:push-navigation-parser
 */

function extractPushData(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const root = raw;
  const candidates = [root];
  const data = root.data;
  if (data && typeof data === "object" && !Array.isArray(data)) candidates.push(data);
  const aps = root.aps;
  if (aps && typeof aps === "object" && !Array.isArray(aps)) {
    const apsData = aps.data;
    if (apsData && typeof apsData === "object" && !Array.isArray(apsData)) {
      candidates.push(apsData);
    }
  }
  const merged = {};
  for (const candidate of candidates) Object.assign(merged, candidate);
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function parseDailyRadioPush(raw) {
  const data = extractPushData(raw);
  if (!data) return null;
  const type = String(data.type ?? data.action ?? "").trim() || null;
  const action = String(data.action ?? "").trim();
  const isDailyRadio =
    type === "daily_radio" ||
    type === "daily_radio_completed" ||
    action === "daily_radio_completed";
  if (!isDailyRadio) return null;
  const scriptId = String(data.script_id ?? data.scriptId ?? "").trim() || null;
  const radioSlotRaw = String(data.radio_slot ?? data.radioSlot ?? "").trim();
  const radioSlot =
    radioSlotRaw === "evening" || radioSlotRaw === "morning" ? radioSlotRaw : null;
  const openTargetRaw = String(data.openTarget ?? data.open_target ?? "").trim();
  const openTarget =
    openTargetRaw === "ai_anchor_audio"
      ? "ai_anchor_audio"
      : openTargetRaw === "text_playback"
        ? "text_playback"
        : null;
  return { type, scriptId, radioSlot, openTarget };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let passed = 0;
let failed = 0;

function run(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
}

run("Case 5: script_id only without radio_slot", () => {
  const parsed = parseDailyRadioPush({
    type: "daily_radio",
    script_id: "2effd955-7af9-4c38-8db9-897808ce05a4",
    openTarget: "ai_anchor_audio",
  });
  assert(parsed?.scriptId === "2effd955-7af9-4c38-8db9-897808ce05a4", "scriptId");
  assert(parsed?.radioSlot === null, "radioSlot null");
});

run("Case 6: invalid script_id + evening radio_slot fallback intent", () => {
  const parsed = parseDailyRadioPush({
    type: "daily_radio",
    script_id: "invalid-id",
    radio_slot: "evening",
  });
  assert(parsed?.scriptId === "invalid-id", "scriptId kept");
  assert(parsed?.radioSlot === "evening", "evening slot");
});

run("Case 7a: snake_case payload", () => {
  const parsed = parseDailyRadioPush({
    type: "daily_radio",
    script_id: "abc",
    radio_slot: "evening",
    open_target: "ai_anchor_audio",
  });
  assert(parsed?.scriptId === "abc", "script_id");
  assert(parsed?.radioSlot === "evening", "radio_slot");
  assert(parsed?.openTarget === "ai_anchor_audio", "open_target");
});

run("Case 7b: camelCase payload", () => {
  const parsed = parseDailyRadioPush({
    type: "daily_radio",
    scriptId: "abc",
    radioSlot: "evening",
    openTarget: "ai_anchor_audio",
  });
  assert(parsed?.scriptId === "abc", "scriptId");
  assert(parsed?.radioSlot === "evening", "radioSlot");
  assert(parsed?.openTarget === "ai_anchor_audio", "openTarget");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
