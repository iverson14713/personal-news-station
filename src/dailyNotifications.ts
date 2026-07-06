/**
 * 本機排程提醒（非伺服器生成完成通知）
 *
 * 伺服器真正生成完成後的 Push 由 Edge Function + APNs 發送。
 */
import { Capacitor } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import {
  markDailyNotificationSent,
  readDailyRadioState,
} from "./dailyRadio";

const DAILY_REMINDER_NOTIFICATION_ID = 9002;

let localNotificationsModule: typeof import("@capacitor/local-notifications") | null =
  null;
let initialized = false;
let initPromise: Promise<void> | null = null;
let listenerHandle: PluginListenerHandle | null = null;
let permissionRequested = false;
let lastScheduledTime: string | null = null;
let scheduleInFlight: Promise<void> | null = null;

type DailyOpenSource = "local_reminder" | "server_completed";

let onOpenDailyHandler: ((source: DailyOpenSource) => void) | null = null;

async function getLocalNotifications() {
  if (localNotificationsModule) return localNotificationsModule;
  try {
    localNotificationsModule = await import("@capacitor/local-notifications");
    return localNotificationsModule;
  } catch {
    return null;
  }
}

async function requestDailyNotificationPermissionOnce(): Promise<boolean> {
  if (permissionRequested) return true;
  if (!Capacitor.isNativePlatform()) return false;

  const mod = await getLocalNotifications();
  if (!mod) return false;

  try {
    permissionRequested = true;
    const perm = await mod.LocalNotifications.requestPermissions();
    return perm.display === "granted";
  } catch {
    return false;
  }
}

/** 本機提醒：僅提示時間到了，不宣稱已生成完成 */
export function buildLocalReminderNotification(): { title: string; body: string } {
  return {
    title: "☕ 今天的 AI 早報時間到了",
    body: "打開 App 收聽你的專屬新聞",
  };
}

async function scheduleDailyRadioReminderInternal(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const state = readDailyRadioState();
  const scheduledTime = state.scheduledTime;

  if (scheduleInFlight) {
    await scheduleInFlight;
    if (lastScheduledTime === scheduledTime) return;
  }

  scheduleInFlight = (async () => {
    const mod = await getLocalNotifications();
    if (!mod) return;

    const [hourStr, minuteStr] = scheduledTime.split(":");
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    const { title, body } = buildLocalReminderNotification();

    try {
      await mod.LocalNotifications.cancel({
        notifications: [{ id: DAILY_REMINDER_NOTIFICATION_ID }],
      });

      const at = new Date();
      at.setHours(hour, minute, 0, 0);
      if (at.getTime() <= Date.now()) {
        at.setDate(at.getDate() + 1);
      }

      await mod.LocalNotifications.schedule({
        notifications: [
          {
            id: DAILY_REMINDER_NOTIFICATION_ID,
            title,
            body,
            schedule: {
              at,
              repeats: true,
              every: "day",
            },
            extra: { action: "open_daily" },
          },
        ],
      });

      lastScheduledTime = scheduledTime;
      markDailyNotificationSent();
    } catch {
      /* ignore */
    }
  })();

  try {
    await scheduleInFlight;
  } finally {
    scheduleInFlight = null;
  }
}

/** 排程時間變更時重新 schedule（不重跑 permission / listener） */
export async function maybeRescheduleDailyRadioReminder(
  scheduledTime: string
): Promise<void> {
  if (!initialized) return;
  if (lastScheduledTime === scheduledTime) return;
  await scheduleDailyRadioReminderInternal();
}

async function registerDailyNotificationListenerOnce(): Promise<void> {
  if (listenerHandle) return;
  if (!Capacitor.isNativePlatform()) return;

  const mod = await getLocalNotifications();
  if (!mod) return;

  listenerHandle = await mod.LocalNotifications.addListener(
    "localNotificationActionPerformed",
    (event) => {
      const action = (event.notification.extra as { action?: string } | undefined)
        ?.action;
      const handler = onOpenDailyHandler;
      if (!handler) return;
      if (action === "daily_radio_completed") {
        handler("server_completed");
      } else if (action === "open_daily") {
        handler("local_reminder");
      }
    }
  );
}

/**
 * 全 App 只初始化一次：permission + listener + 首次 schedule。
 * handler 可透過 ref 更新，不需重跑 init。
 */
export async function initDailyNotificationsOnce(
  onOpenDaily: (source: DailyOpenSource) => void
): Promise<void> {
  onOpenDailyHandler = onOpenDaily;

  if (initialized) {
    console.log("[LocalNotifications] skip: already initialized");
    return;
  }

  if (initPromise) {
    await initPromise;
    onOpenDailyHandler = onOpenDaily;
    return;
  }

  initPromise = (async () => {
    console.log("[LocalNotifications] init once");
    await requestDailyNotificationPermissionOnce();
    await registerDailyNotificationListenerOnce();
    await scheduleDailyRadioReminderInternal();
    initialized = true;
  })();

  await initPromise;
}

/** @deprecated 使用 initDailyNotificationsOnce */
export async function setupDailyNotifications(
  onOpenDaily: (source: DailyOpenSource) => void
): Promise<void> {
  return initDailyNotificationsOnce(onOpenDaily);
}

/** @deprecated 使用 maybeRescheduleDailyRadioReminder */
export function ensureDailyReminderScheduled(): void {
  void maybeRescheduleDailyRadioReminder(readDailyRadioState().scheduledTime);
}

/** @deprecated */
export async function requestDailyNotificationPermission(): Promise<boolean> {
  return requestDailyNotificationPermissionOnce();
}

/** @deprecated */
export async function scheduleDailyRadioReminder(): Promise<void> {
  await scheduleDailyRadioReminderInternal();
}

/** @deprecated */
export async function initDailyNotificationListeners(
  onOpenDaily: (source: DailyOpenSource) => void
): Promise<() => void> {
  onOpenDailyHandler = onOpenDaily;
  await registerDailyNotificationListenerOnce();
  return () => {
    void listenerHandle?.remove();
    listenerHandle = null;
  };
}
