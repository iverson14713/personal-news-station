export const TAIPEI_TIMEZONE = "Asia/Taipei";

/** 台灣今日 YYYY-MM-DD（Cron / Edge / App 每日內容統一日期 key） */
export function getTaipeiDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TAIPEI_TIMEZONE }).format(d);
}

/** 使用者時區的今日 YYYY-MM-DD */
export function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

/** 是否已過 slot 開始時間（含排程當下） */
export function isAfterSlotStart(
  timezone: string,
  slotTime: string
): boolean {
  const [th, tm] = slotTime.split(":").map((x) => Number(x));
  if (!Number.isFinite(th) || !Number.isFinite(tm)) return false;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const nowMins = hour * 60 + minute;
  const targetMins = th * 60 + tm;
  return nowMins >= targetMins;
}

/** catch-up 截止（morning 12:00 / evening 22:00，使用者時區） */
export function isBeforeCatchUpDeadline(
  timezone: string,
  radioSlot: "morning" | "evening"
): boolean {
  const deadlineHour = radioSlot === "morning" ? 12 : 22;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const nowMins = hour * 60 + minute;
  return nowMins < deadlineHour * 60;
}

/** 是否落在 daily_radio_time 後的 windowMinutes 內（含排程當下） */
export function shouldGenerateNow(
  timezone: string,
  dailyTime: string,
  windowMinutes = 15
): boolean {
  const [th, tm] = dailyTime.split(":").map((x) => Number(x));
  if (!Number.isFinite(th) || !Number.isFinite(tm)) return false;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);

  const nowMins = hour * 60 + minute;
  const targetMins = th * 60 + tm;
  const diff = nowMins - targetMins;
  return diff >= 0 && diff < windowMinutes;
}
