/** AI 新聞稿時長（分鐘） */
export type AiDuration = 3 | 5 | 10 | 15;

export const AI_DURATIONS: AiDuration[] = [3, 5, 10, 15];
export const FREE_DURATION: AiDuration = 3;
export const DAILY_AUTO_DURATION: AiDuration = 3;
export const PRO_DURATIONS: AiDuration[] = [5, 10, 15];

export function normalizeAiDuration(raw: unknown): AiDuration {
  const n = Number(raw);
  if (n === 5 || n === 10 || n === 15) return n;
  // 舊版 1 分鐘 → 3 分鐘
  return 3;
}

export function isProDuration(duration: AiDuration): boolean {
  return duration !== FREE_DURATION;
}

export function durationOptionSubtitle(duration: AiDuration): string {
  switch (duration) {
    case 3:
      return "快速掌握今天重點";
    case 5:
      return "推薦長度 · 資訊較完整";
    case 10:
      return "深入版 · 更多新聞與背景";
    case 15:
      return "完整 Podcast · 洞察與多元觀點";
    default:
      return "";
  }
}

export function durationBadgeLabel(duration: AiDuration): string {
  if (duration === 5) return "推薦";
  if (duration >= 10) return "Pro";
  return "";
}
