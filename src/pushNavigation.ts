import type { RadioSlot } from "./radioSlot";
import {
  clearPersistedPendingForTrace,
  logPushNavTrace,
  persistPendingForTrace,
  readPersistedPendingForTrace,
} from "./pushNavTrace";

export type DailyRadioPushOpenTarget = "ai_anchor_audio" | "text_playback";

export type PendingPushNavigation = {
  type: "daily_radio";
  scriptId: string | null;
  radioSlot: RadioSlot | null;
  openTarget: DailyRadioPushOpenTarget | null;
  autoPlay: boolean;
  audioReady: boolean;
};

export type ParsedDailyRadioPush = {
  type: string | null;
  scriptId: string | null;
  radioSlot: RadioSlot | null;
  openTarget: DailyRadioPushOpenTarget | null;
  autoPlay: boolean;
  audioReady: boolean;
};

let pendingNavigation: PendingPushNavigation | null = null;
let readyListener: (() => void) | null = null;

export function parseDailyRadioPush(raw: unknown): ParsedDailyRadioPush | null {
  const data = extractPushData(raw);
  if (!data) return null;

  const type = String(data.type ?? data.action ?? "").trim() || null;
  const action = String(data.action ?? "").trim();
  const isDailyRadio =
    type === "daily_radio" ||
    type === "daily_radio_completed" ||
    action === "daily_radio_completed";
  if (!isDailyRadio) return null;

  const scriptId =
    String(data.script_id ?? data.scriptId ?? "").trim() || null;
  const radioSlotRaw = String(data.radio_slot ?? data.radioSlot ?? "").trim();
  const radioSlot: RadioSlot | null =
    radioSlotRaw === "evening" || radioSlotRaw === "morning"
      ? radioSlotRaw
      : null;
  const openTargetRaw = String(data.openTarget ?? data.open_target ?? "").trim();
  const openTarget: DailyRadioPushOpenTarget | null =
    openTargetRaw === "ai_anchor_audio"
      ? "ai_anchor_audio"
      : openTargetRaw === "text_playback"
        ? "text_playback"
        : null;
  const autoPlay =
    data.autoPlay === true ||
    data.autoPlay === "true" ||
    data.auto_play === true ||
    data.auto_play === "true";
  const audioReady =
    data.audioReady === true ||
    data.audioReady === "true" ||
    data.audio_ready === true ||
    data.audio_ready === "true";

  return { type, scriptId, radioSlot, openTarget, autoPlay, audioReady };
}

export function pendingFromParsedPush(
  parsed: ParsedDailyRadioPush
): PendingPushNavigation {
  return {
    type: "daily_radio",
    scriptId: parsed.scriptId,
    radioSlot: parsed.radioSlot,
    openTarget: parsed.openTarget,
    autoPlay: parsed.autoPlay,
    audioReady: parsed.audioReady,
  };
}

export function setPendingPushNavigation(nav: PendingPushNavigation): void {
  pendingNavigation = nav;
  persistPendingForTrace(nav);
  logPushNavTrace({
    phase: "pending_saved",
    scriptId: nav.scriptId,
    requestedRadioSlot: nav.radioSlot,
    pendingExists: true,
    pendingScriptId: nav.scriptId,
    pendingRadioSlot: nav.radioSlot,
    modulePending: true,
    storagePending: true,
    caller: "setPendingPushNavigation",
  });
  readyListener?.();
}

export function getPendingPushNavigation(): PendingPushNavigation | null {
  if (pendingNavigation) return pendingNavigation;
  const stored = readPersistedPendingForTrace();
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    const s = stored as PendingPushNavigation;
    logPushNavTrace({
      phase: "pending_restored",
      scriptId: s.scriptId,
      requestedRadioSlot: s.radioSlot,
      pendingExists: true,
      modulePending: false,
      storagePending: true,
      caller: "getPendingPushNavigation",
    });
    pendingNavigation = s;
    return s;
  }
  return null;
}

export function hasPendingPushNavigation(): boolean {
  return getPendingPushNavigation() !== null;
}

export function clearPendingPushNavigation(): void {
  logPushNavTrace({
    phase: "pending_cleared",
    pendingExists: false,
    caller: "clearPendingPushNavigation",
  });
  pendingNavigation = null;
  clearPersistedPendingForTrace();
}

export function onPendingPushNavigationReady(listener: () => void): () => void {
  readyListener = listener;
  return () => {
    if (readyListener === listener) readyListener = null;
  };
}

function extractPushData(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const root = raw as Record<string, unknown>;

  const candidates: Record<string, unknown>[] = [root];

  const notification = root.notification;
  if (notification && typeof notification === "object" && !Array.isArray(notification)) {
    candidates.push(notification as Record<string, unknown>);
  }

  const data = root.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    candidates.push(data as Record<string, unknown>);
  }

  const notif = root.notification ?? root;
  if (notif && typeof notif === "object" && !Array.isArray(notif)) {
    const n = notif as Record<string, unknown>;
    const nData = n.data;
    if (nData && typeof nData === "object" && !Array.isArray(nData)) {
      candidates.push(nData as Record<string, unknown>);
    }
  }

  const aps = root.aps;
  if (aps && typeof aps === "object" && !Array.isArray(aps)) {
    const apsData = (aps as Record<string, unknown>).data;
    if (apsData && typeof apsData === "object" && !Array.isArray(apsData)) {
      candidates.push(apsData as Record<string, unknown>);
    }
  }

  const merged: Record<string, unknown> = {};
  for (const candidate of candidates) {
    Object.assign(merged, candidate);
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}
