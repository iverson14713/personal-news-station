import type { DisplayScriptSource } from "./scriptAudioBinding";
import type { RadioSlot } from "./radioSlot";

export type ActiveDailyRadioDisplayStatus = "idle" | "loading" | "ready" | "error";

export type ActiveDailyRadioDisplaySource = "server" | "app" | "manual" | null;

export type ActiveDailyRadioDisplay = {
  scriptId: string | null;
  radioSlot: RadioSlot | null;
  status: ActiveDailyRadioDisplayStatus;
  scriptText: string;
  audioUrl: string | null;
  displayScriptSource: ActiveDailyRadioDisplaySource;
  scriptDate: string | null;
};

export type ActiveDisplayRadioSlotOptions = {
  /** 無任何稿件時，產品預設顯示早報 */
  allowMorningDefault?: boolean;
};

export function createEmptyActiveDailyRadioDisplay(): ActiveDailyRadioDisplay {
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

export function isActiveDisplayReady(display: ActiveDailyRadioDisplay | null | undefined): boolean {
  if (!display || display.status !== "ready" || !display.scriptId) return false;
  return Boolean(display.scriptText.trim() || display.audioUrl?.trim());
}

export function activeDisplayFromServerScript(input: {
  id: string;
  radioSlot: RadioSlot;
  scriptText: string;
  scriptDate: string;
  audioUrl: string | null;
}): ActiveDailyRadioDisplay {
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

export function activeDisplayFromLocalState(input: {
  lastEntryId: string | null;
  lastRadioSlot: RadioSlot | null;
  status: string;
  lastGeneratedDate: string | null;
  generationSource: "server" | "app" | null;
}): ActiveDailyRadioDisplay {
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

/** UI slot：優先 active display，避免 active evening 被 morning 覆蓋。 */
export function resolveDisplayRadioSlot(
  active: ActiveDailyRadioDisplay | null | undefined,
  lastRadioSlot: RadioSlot | null | undefined,
  options: ActiveDisplayRadioSlotOptions = {}
): RadioSlot | null {
  if (isActiveDisplayReady(active) && active!.radioSlot) {
    return active!.radioSlot;
  }
  if (active?.radioSlot) {
    return active.radioSlot;
  }
  if (lastRadioSlot === "morning" || lastRadioSlot === "evening") {
    return lastRadioSlot;
  }
  return options.allowMorningDefault ? "morning" : null;
}

export function scriptIdPrefix(scriptId: string | null | undefined): string | null {
  if (!scriptId) return null;
  return scriptId.slice(0, 8);
}

export type DailyRadioUiTracePhase =
  | "active_display_set"
  | "active_display_preserved"
  | "active_display_cleared"
  | "generic_refresh_not_found"
  | "generic_refresh_ignored"
  | "hero_render"
  | "player_render";

export function logDailyRadioUi(
  phase: DailyRadioUiTracePhase | string,
  display: ActiveDailyRadioDisplay | null | undefined,
  caller: string,
  extra?: Record<string, unknown>
): void {
  const entry = {
    event: "daily_radio_ui",
    phase,
    caller,
    scriptIdPrefix: scriptIdPrefix(display?.scriptId),
    radioSlot: display?.radioSlot ?? null,
    status: display?.status ?? null,
    hasScriptText: Boolean(display?.scriptText?.trim()),
    hasAudioUrl: Boolean(display?.audioUrl?.trim()),
    displayScriptSource: display?.displayScriptSource ?? null,
    scriptDate: display?.scriptDate ?? null,
    extra: extra ?? null,
  };
  console.log(`[DAILY_RADIO_UI] ${phase}`, JSON.stringify(entry));
}

export function shouldPreserveActiveOnGenericNotFound(
  active: ActiveDailyRadioDisplay | null | undefined,
  hasExplicitTarget: boolean
): boolean {
  if (hasExplicitTarget) return false;
  return isActiveDisplayReady(active);
}
