/**
 * Active daily radio display model tests (Cases 1–7).
 * Usage: npm run test:active-daily-radio-display
 */

function createEmptyActiveDailyRadioDisplay() {
  return {
    scriptId: null,
    radioSlot: null,
    status: "idle",
    scriptText: "",
    audioUrl: null,
    displayScriptSource: null,
    scriptDate: null,
  };
}

function isActiveDisplayReady(display) {
  if (!display || display.status !== "ready" || !display.scriptId) return false;
  return Boolean(display.scriptText.trim() || display.audioUrl?.trim());
}

function activeDisplayFromServerScript(input) {
  return {
    scriptId: input.id,
    radioSlot: input.radioSlot,
    status: "ready",
    scriptText: input.scriptText,
    audioUrl: input.audioUrl,
    displayScriptSource: "server",
    scriptDate: input.scriptDate,
  };
}

function activeDisplayFromLocalState(input) {
  if (
    input.status === "ready" &&
    input.lastEntryId &&
    (input.lastRadioSlot === "morning" || input.lastRadioSlot === "evening")
  ) {
    return {
      scriptId: input.lastEntryId,
      radioSlot: input.lastRadioSlot,
      status: "ready",
      scriptText: "",
      audioUrl: null,
      displayScriptSource: input.generationSource,
      scriptDate: input.lastGeneratedDate,
    };
  }
  return createEmptyActiveDailyRadioDisplay();
}

function resolveDisplayRadioSlot(active, lastRadioSlot, options = {}) {
  if (isActiveDisplayReady(active) && active.radioSlot) {
    return active.radioSlot;
  }
  if (active?.radioSlot) {
    return active.radioSlot;
  }
  if (lastRadioSlot === "morning" || lastRadioSlot === "evening") {
    return lastRadioSlot;
  }
  return options.allowMorningDefault ? "morning" : null;
}

function shouldPreserveActiveOnGenericNotFound(active, hasExplicitTarget) {
  if (hasExplicitTarget) return false;
  return isActiveDisplayReady(active);
}

function dailyRadioHeroStatus(params) {
  const { hasScript, aiLoading, localState, serverSyncState, activeDisplay } = params;
  if (isActiveDisplayReady(activeDisplay)) return "ready";
  if (aiLoading || localState.status === "generating") return "generating";
  if (serverSyncState === "loading") return "idle";
  if (
    hasScript &&
    localState.status === "ready" &&
    (params.generationSource === "server" || params.generationSource === "app")
  ) {
    return "ready";
  }
  if (localState.status === "failed") return "failed";
  return "idle";
}

function radioSlotCompletedTitle(slot) {
  return slot === "evening" ? "今日 AI 晚報已完成" : "今日 AI 早報已完成";
}

function dailyRadioHeroDisplay(params) {
  const { ready, radioSlot, activeDisplay } = params;
  const slot =
    resolveDisplayRadioSlot(activeDisplay, radioSlot, {
      allowMorningDefault: !ready && !isActiveDisplayReady(activeDisplay),
    }) ?? "morning";
  if (ready) {
    return { title: radioSlotCompletedTitle(slot) };
  }
  const slotName = slot === "evening" ? "晚報" : "早報";
  return { title: `今日 AI ${slotName}尚未完成` };
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

const EVENING_SCRIPT_ID = "3bb40360-16ee-465f-af5b-ecf28abba7b8";

run("Case 1: push evening script success → hero shows evening completed", () => {
  const active = activeDisplayFromServerScript({
    id: EVENING_SCRIPT_ID,
    radioSlot: "evening",
    scriptText: "晚報內容",
    scriptDate: "2026-07-11",
    audioUrl: "https://example.com/evening.mp3",
  });
  const status = dailyRadioHeroStatus({
    hasScript: true,
    aiLoading: false,
    localState: { status: "ready" },
    serverSyncState: "ready",
    generationSource: "server",
    activeDisplay: active,
  });
  assert(status === "ready", "hero status ready");
  const hero = dailyRadioHeroDisplay({
    ready: true,
    radioSlot: "evening",
    activeDisplay: active,
  });
  assert(hero.title === "今日 AI 晚報已完成", hero.title);
});

run("Case 2: generic not_found preserves active evening display", () => {
  const active = activeDisplayFromServerScript({
    id: EVENING_SCRIPT_ID,
    radioSlot: "evening",
    scriptText: "晚報內容",
    scriptDate: "2026-07-11",
    audioUrl: "https://example.com/evening.mp3",
  });
  assert(
    shouldPreserveActiveOnGenericNotFound(active, false),
    "preserve active on generic not_found"
  );
  assert(
    !shouldPreserveActiveOnGenericNotFound(active, true),
    "do not preserve when explicit target"
  );
  const slot = resolveDisplayRadioSlot(active, null, { allowMorningDefault: true });
  assert(slot === "evening", `slot stays evening, got ${slot}`);
});

run("Case 3: active evening with null lastRadioSlot does not fallback morning", () => {
  const active = activeDisplayFromLocalState({
    lastEntryId: EVENING_SCRIPT_ID,
    lastRadioSlot: "evening",
    status: "ready",
    lastGeneratedDate: "2026-07-11",
    generationSource: "server",
  });
  const slot = resolveDisplayRadioSlot(active, null, { allowMorningDefault: true });
  assert(slot === "evening", `slot=${slot}`);
});

run("Case 4: no script → morning default for idle homepage", () => {
  const active = createEmptyActiveDailyRadioDisplay();
  const slot = resolveDisplayRadioSlot(active, null, { allowMorningDefault: true });
  assert(slot === "morning", `slot=${slot}`);
  const hero = dailyRadioHeroDisplay({
    ready: false,
    radioSlot: null,
    activeDisplay: active,
  });
  assert(hero.title === "今日 AI 早報尚未完成", hero.title);
});

run("Case 5: morning script success → morning completed", () => {
  const active = activeDisplayFromServerScript({
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    radioSlot: "morning",
    scriptText: "早報內容",
    scriptDate: "2026-07-11",
    audioUrl: "https://example.com/morning.mp3",
  });
  const hero = dailyRadioHeroDisplay({
    ready: true,
    radioSlot: "morning",
    activeDisplay: active,
  });
  assert(hero.title === "今日 AI 早報已完成", hero.title);
});

run("Case 6: same scriptId and evening slot across navigation context", () => {
  const active = activeDisplayFromServerScript({
    id: EVENING_SCRIPT_ID,
    radioSlot: "evening",
    scriptText: "晚報內容",
    scriptDate: "2026-07-11",
    audioUrl: "https://example.com/evening.mp3",
  });
  const homeSlot = resolveDisplayRadioSlot(active, null, { allowMorningDefault: false });
  const playerSlot = resolveDisplayRadioSlot(active, null, { allowMorningDefault: false });
  assert(homeSlot === "evening" && playerSlot === "evening", "home/player same slot");
  assert(active.scriptId === EVENING_SCRIPT_ID, "same scriptId");
});

run("Case 7: logout clears active display", () => {
  const cleared = createEmptyActiveDailyRadioDisplay();
  assert(cleared.scriptId === null, "scriptId cleared");
  assert(cleared.radioSlot === null, "radioSlot cleared");
  assert(cleared.status === "idle", "status idle");
  assert(!isActiveDisplayReady(cleared), "not ready after clear");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
