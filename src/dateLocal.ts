export function todayYmdLocal(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 指定時區的今日 YYYY-MM-DD（早報 script_date 與後端 Cron 對齊） */
export function todayYmdInTimezone(timezone = "Asia/Taipei", d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d);
}

export const DAILY_SCRIPT_TIMEZONE = "Asia/Taipei";

export function hourInTimezone(timezone = DAILY_SCRIPT_TIMEZONE, d = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return Number.isFinite(hour) ? hour : 0;
}

export function ymdFromTimestamp(ms: number): string {
  return todayYmdLocal(new Date(ms));
}

export function parseScheduledTime(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(":").map((x) => Number(x));
  return {
    hour: Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 7,
    minute: Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : 0,
  };
}

export function isPastScheduledTime(scheduledTime: string, now = new Date()): boolean {
  const { hour, minute } = parseScheduledTime(scheduledTime);
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  return now.getTime() >= target.getTime();
}

export function formatScheduledTimeLabel(time: string): string {
  const { hour, minute } = parseScheduledTime(time);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
