/**
 * 遠端 APNs / FCM 推播（Capacitor Push Notifications）
 */
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import type { PluginListenerHandle } from "@capacitor/core";
import { syncPushTokenToSupabase } from "./dailyRadioApi";
import type { RadioSlot } from "./radioSlot";
import { ensureSupabaseUser, isSupabaseConfigured } from "./supabaseClient";
import { logPushOpenReceived } from "./pushOpenDebug";

let cachedPushToken: string | null = null;
let initialized = false;
let initPromise: Promise<void> | null = null;
let listenersAttached = false;

let onOpenDailyHandler: ((info: DailyRadioPushOpenInfo) => void) | null = null;

export type DailyRadioPushOpenTarget = "ai_anchor_audio" | "text_playback";

export type DailyRadioPushOpenInfo = {
  source: "server_completed";
  radioSlot?: RadioSlot;
  scriptId?: string;
  openTarget?: DailyRadioPushOpenTarget;
  autoPlay?: boolean;
  audioReady?: boolean;
};

function isDailyRadioCompletedPayload(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const type = String(data.type ?? "").trim();
  const action = String(data.action ?? "").trim();
  return (
    type === "daily_radio_completed" ||
    type === "daily_radio" ||
    action === "daily_radio_completed"
  );
}

function extractPushData(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const root = raw as Record<string, unknown>;

  const candidates: Record<string, unknown>[] = [root];
  const data = root.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    candidates.push(data as Record<string, unknown>);
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

function parsePushOpenInfo(raw: unknown): DailyRadioPushOpenInfo {
  const data = extractPushData(raw) ?? {};
  const radioSlotRaw = String(data.radio_slot ?? data.radioSlot ?? "").trim();
  const radioSlot =
    radioSlotRaw === "evening" || radioSlotRaw === "morning"
      ? (radioSlotRaw as RadioSlot)
      : undefined;
  const scriptId =
    String(data.script_id ?? data.scriptId ?? "").trim() || undefined;
  const openTargetRaw = String(data.openTarget ?? data.open_target ?? "").trim();
  const openTarget: DailyRadioPushOpenTarget | undefined =
    openTargetRaw === "ai_anchor_audio"
      ? "ai_anchor_audio"
      : openTargetRaw === "text_playback"
        ? "text_playback"
        : undefined;
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
  return { source: "server_completed", radioSlot, scriptId, openTarget, autoPlay, audioReady };
}

/** 將 APNs payload 轉成與點擊推播相同的 open info（供測試模擬） */
export function dailyRadioPushPayloadToOpenInfo(
  data: Record<string, unknown>
): DailyRadioPushOpenInfo | null {
  if (!isDailyRadioCompletedPayload(data)) return null;
  return parsePushOpenInfo(data);
}

function tokenPrefix(token: string): string {
  return token.slice(0, 8);
}

function userPrefix(userId: string): string {
  return userId.slice(0, 8);
}

function getPushPlatform(): "ios" | "android" {
  return Capacitor.getPlatform() === "ios" ? "ios" : "android";
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function handleRegistrationToken(tokenValue: string): Promise<void> {
  const trimmed = tokenValue.trim();
  if (!trimmed) {
    console.warn("[Push] registration token empty");
    return;
  }

  cachedPushToken = trimmed;
  console.log("[Push] registration token received", tokenPrefix(trimmed));

  const ok = await syncPushTokenToSupabase(trimmed, getPushPlatform());
  if (ok) {
    console.log("[Push] token saved to Supabase");
  }
}

function notifyPushOpen(raw: unknown): void {
  const data = extractPushData(raw);
  const info = parsePushOpenInfo(raw);
  const typeRaw = data
    ? String(data.type ?? data.action ?? "").trim() || null
    : null;
  logPushOpenReceived({
    phase: "notification_tapped",
    raw_payload: data ?? raw,
    normalized_openInfo: info,
    openTarget: info.openTarget ?? null,
    type: typeRaw,
    radio_slot: info.radioSlot ?? null,
    scriptId: info.scriptId ?? null,
    autoPlay: info.autoPlay ?? false,
    audioReady: info.audioReady ?? false,
  });
  onOpenDailyHandler?.(info);
}

/** 非阻塞掛載 listener；全 App 只註冊一次 */
function attachPushListenersOnce(): PluginListenerHandle[] {
  if (listenersAttached) return [];
  listenersAttached = true;

  console.log("[Push] attaching listeners (before register)");
  const subs: PluginListenerHandle[] = [];

  const attach = (name: string, setup: () => Promise<PluginListenerHandle>) => {
    try {
      void setup()
        .then((handle) => {
          subs.push(handle);
          console.log("[Push] listener attached:", name);
        })
        .catch((error) => {
          console.warn("[Push] listener attach failed:", name, formatError(error));
        });
    } catch (error) {
      console.warn("[Push] listener attach failed:", name, formatError(error));
    }
  };

  attach("registration", () =>
    PushNotifications.addListener("registration", (token) => {
      void handleRegistrationToken(token.value ?? "");
    })
  );

  attach("registrationError", () =>
    PushNotifications.addListener("registrationError", (error) => {
      console.error("[Push] registration error", JSON.stringify(error));
    })
  );

  attach("pushNotificationReceived", () =>
    PushNotifications.addListener("pushNotificationReceived", (event) => {
      const data = extractPushData(event.notification);
      if (isDailyRadioCompletedPayload(data)) {
        const info = parsePushOpenInfo(event.notification);
        console.log("[Push] received daily_radio while app open", info);
      }
    })
  );

  attach("pushNotificationActionPerformed", () =>
    PushNotifications.addListener("pushNotificationActionPerformed", (event) => {
      const data = extractPushData(event.notification);
      if (isDailyRadioCompletedPayload(data)) {
        notifyPushOpen(event.notification);
      }
    })
  );

  return subs;
}

async function runPushInitOnce(): Promise<void> {
  const isNative = Capacitor.isNativePlatform();
  console.log("[Push] running on native?", isNative);

  if (!isNative) {
    console.log("[Push] skip: not native platform");
    initialized = true;
    return;
  }

  attachPushListenersOnce();

  if (isSupabaseConfigured()) {
    const userId = await ensureSupabaseUser();
    console.log(
      "[Push] auth ready before register",
      userId ? userPrefix(userId) : "none"
    );
    if (!userId) {
      console.warn("[Push] token save may fail: no auth user yet");
    }
  }

  console.log("[Push] requestPermissions start");
  const perm = await PushNotifications.requestPermissions();
  console.log("[Push] permission status", perm.receive ?? "unknown");

  if (perm.receive !== "granted") {
    console.log("[Push] permission denied");
    return;
  }

  console.log("[Push] permission granted");
  console.log("[Push] register start");
  await PushNotifications.register();
  console.log("[Push] register called");
  initialized = true;
}

/**
 * App 啟動時初始化 Push Notifications（全 App 只執行一次）。
 * handler 可透過 ref 更新，不需重跑 init。
 */
export async function initRemotePush(
  onDailyRadioCompleted: (info: DailyRadioPushOpenInfo) => void
): Promise<() => void> {
  onOpenDailyHandler = onDailyRadioCompleted;

  if (initialized) {
    return () => {};
  }

  if (initPromise) {
    await initPromise;
    onOpenDailyHandler = onDailyRadioCompleted;
    return () => {};
  }

  console.log("[Push] init start");
  initPromise = runPushInitOnce().finally(() => {
    initPromise = null;
  });
  await initPromise;

  return () => {};
}

/** @deprecated 使用 initRemotePush */
export async function setupRemotePush(
  onDailyRadioCompleted: (info: DailyRadioPushOpenInfo) => void
): Promise<() => void> {
  return initRemotePush(onDailyRadioCompleted);
}

export function getCachedPushToken(): string | null {
  return cachedPushToken;
}
