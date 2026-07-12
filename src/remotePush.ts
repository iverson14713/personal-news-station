/**
 * 遠端 APNs / FCM 推播（Capacitor Push Notifications）
 */
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import type { PluginListenerHandle } from "@capacitor/core";
import {
  syncPushTokenToSupabaseDetailed,
  type PushTokenSyncResult,
} from "./dailyRadioApi";
import {
  getPushEnvironment,
  type PushEnvironmentDiagnostics,
} from "./plugins/pushEnvironment";
import type { RadioSlot } from "./radioSlot";
import {
  ensureSupabaseUser,
  isSupabaseConfigured,
  onAuthUserIdChange,
} from "./supabaseClient";
import { logPushOpenReceived } from "./pushOpenDebug";
import {
  createPushNavTraceId,
  getCurrentPushNavTraceId,
  logPushNavTrace,
  probePayloadLayers,
  PUSH_NAV_BUILD_MARKER,
  PUSH_NAV_IMPL_VERSION,
  sanitizePayloadForLog,
} from "./pushNavTrace";
import { parseDailyRadioPush } from "./pushNavigation";

let cachedPushToken: string | null = null;
let cachedPushEnvironment: PushEnvironmentDiagnostics | null = null;
let lastSyncedUserId: string | null = null;
let initialized = false;
let initPromise: Promise<void> | null = null;
let listenersAttached = false;
let authListenerAttached = false;

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
  const parsed = parseDailyRadioPush(raw);
  if (!parsed) {
    return { source: "server_completed" };
  }
  return {
    source: "server_completed",
    radioSlot: parsed.radioSlot ?? undefined,
    scriptId: parsed.scriptId ?? undefined,
    openTarget: parsed.openTarget ?? undefined,
    autoPlay: parsed.autoPlay,
    audioReady: parsed.audioReady,
  };
}

/** 將 APNs payload 轉成與點擊推播相同的 open info（供測試模擬） */
export function dailyRadioPushPayloadToOpenInfo(
  data: Record<string, unknown>
): DailyRadioPushOpenInfo | null {
  if (!isDailyRadioCompletedPayload(data)) return null;
  return parsePushOpenInfo(data);
}

function tokenPrefix(token: string): string {
  return token.slice(0, 12);
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

async function resolvePushEnvironmentDiagnostics(): Promise<PushEnvironmentDiagnostics> {
  if (cachedPushEnvironment) return cachedPushEnvironment;
  cachedPushEnvironment = await getPushEnvironment();
  return cachedPushEnvironment;
}

export function getCachedPushEnvironmentDiagnostics(): PushEnvironmentDiagnostics | null {
  return cachedPushEnvironment;
}

export async function resyncPushTokenForCurrentUser(
  reason: string,
  options?: { forceRegister?: boolean; waitForTokenMs?: number }
): Promise<PushTokenSyncResult> {
  if (!Capacitor.isNativePlatform()) {
    return { ok: false, error: "not_native_platform" };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "supabase_not_configured" };
  }

  const userId = await ensureSupabaseUser();
  if (!userId) {
    return { ok: false, error: "no_auth_user" };
  }

  console.log("[Push] resync requested", {
    reason,
    user_prefix: userPrefix(userId),
    last_synced_user_prefix: lastSyncedUserId ? userPrefix(lastSyncedUserId) : null,
    token_prefix: cachedPushToken ? tokenPrefix(cachedPushToken) : null,
  });

  if (options?.forceRegister) {
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") {
      return { ok: false, error: "permission_denied" };
    }
    await PushNotifications.register();
    const waitMs = options.waitForTokenMs ?? 8000;
    const started = Date.now();
    while (!cachedPushToken && Date.now() - started < waitMs) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  const token = cachedPushToken?.trim();
  if (!token) {
    return { ok: false, error: "no_cached_token_yet" };
  }

  const envDiagnostics = await resolvePushEnvironmentDiagnostics();
  const result = await syncPushTokenToSupabaseDetailed(
    token,
    getPushPlatform(),
    envDiagnostics.environment,
    { trigger: reason }
  );

  if (result.ok) {
    lastSyncedUserId = userId;
  }

  return result;
}

function attachAuthResyncListenerOnce(): void {
  if (authListenerAttached) return;
  authListenerAttached = true;

  onAuthUserIdChange((userId) => {
    if (!userId) {
      lastSyncedUserId = null;
      return;
    }
    if (userId === lastSyncedUserId) return;
    console.log("[Push] auth user changed, resync push token", {
      user_prefix: userPrefix(userId),
      previous_user_prefix: lastSyncedUserId ? userPrefix(lastSyncedUserId) : null,
    });
    void resyncPushTokenForCurrentUser("auth_user_changed");
  });
}

async function handleRegistrationToken(tokenValue: string): Promise<void> {
  const trimmed = tokenValue.trim();
  if (!trimmed) {
    console.warn("[Push] registration token empty");
    return;
  }

  cachedPushToken = trimmed;
  cachedPushEnvironment = null;
  console.log("[Push] registration token received", tokenPrefix(trimmed));

  const envDiagnostics = await resolvePushEnvironmentDiagnostics();
  const result = await syncPushTokenToSupabaseDetailed(
    trimmed,
    getPushPlatform(),
    envDiagnostics.environment,
    { trigger: "push_registration_callback" }
  );
  if (result.ok) {
    const userId = await ensureSupabaseUser();
    if (userId) lastSyncedUserId = userId;
    console.log("[Push] token saved to Supabase", {
      push_environment: envDiagnostics.environment,
      entitlement: envDiagnostics.entitlement,
    });
  } else {
    console.warn("[Push] token save failed after registration", result.error);
  }
}

function notifyPushOpen(raw: unknown): void {
  const data = extractPushData(raw);
  const info = parsePushOpenInfo(raw);
  logPushNavTrace({
    phase: "payload_parsed",
    traceId: getCurrentPushNavTraceId(),
    scriptId: info.scriptId ?? null,
    requestedRadioSlot: info.radioSlot ?? null,
    caller: "notifyPushOpen",
    extra: { openTarget: info.openTarget, autoPlay: info.autoPlay, audioReady: info.audioReady },
  });
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
  logPushNavTrace({
    phase: "listener_attached",
    caller: "attachPushListenersOnce",
    extra: { buildMarker: PUSH_NAV_BUILD_MARKER, impl: PUSH_NAV_IMPL_VERSION },
  });
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
      logPushNavTrace({
        phase: "listener_attached",
        caller: "registration",
        extra: { buildMarker: PUSH_NAV_BUILD_MARKER },
      });
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
      const traceId = createPushNavTraceId();
      const probes = probePayloadLayers(event);
      logPushNavTrace({
        phase: "action_received",
        traceId,
        actionId: event.actionId ?? null,
        appState: document.visibilityState,
        extra: {
          buildMarker: PUSH_NAV_BUILD_MARKER,
          impl: PUSH_NAV_IMPL_VERSION,
          event_keys: Object.keys(event as object).sort(),
          notification_keys: event.notification
            ? Object.keys(event.notification as object).sort()
            : [],
          data_keys: event.notification?.data
            ? Object.keys(event.notification.data).sort()
            : [],
          probes,
          notification_sanitized: sanitizePayloadForLog(event.notification),
          event_sanitized: sanitizePayloadForLog(event),
        },
      });

      const parseAttempts: Record<string, ReturnType<typeof parseDailyRadioPush>> = {
        full_event: parseDailyRadioPush(event),
        notification: parseDailyRadioPush(event.notification),
        notification_data: event.notification?.data
          ? parseDailyRadioPush({ data: event.notification.data })
          : null,
      };

      logPushNavTrace({
        phase: "payload_parsed",
        traceId,
        extra: { parseAttempts },
      });

      const data = extractPushData(event.notification);
      const dataFromEvent = extractPushData(event);
      const mergedData = { ...(dataFromEvent ?? {}), ...(data ?? {}) };

      if (!isDailyRadioCompletedPayload(mergedData)) {
        logPushNavTrace({
          phase: "payload_filtered_out",
          traceId,
          extra: {
            mergedData: sanitizePayloadForLog(mergedData),
            reason: "isDailyRadioCompletedPayload_false",
          },
        });
        return;
      }

      notifyPushOpen(event.notification ?? event);
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

  attachAuthResyncListenerOnce();
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

  if (cachedPushToken) {
    void resyncPushTokenForCurrentUser("startup_after_register");
  }
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

export async function reregisterAndSyncPushToken(): Promise<PushTokenSyncResult> {
  cachedPushEnvironment = null;
  return resyncPushTokenForCurrentUser("manual_reregister", { forceRegister: true });
}
