/** 每日電台時段：早報 / 晚報 */
export type RadioSlot = "morning" | "evening";

export const MORNING_RADIO_TIME = "07:00";
export const EVENING_RADIO_TIME = "17:00";

export function radioSlotLabel(slot: RadioSlot): string {
  return slot === "evening" ? "晚報" : "早報";
}

export function radioSlotCompletedTitle(slot: RadioSlot): string {
  return slot === "evening" ? "🌆 今日 AI 晚報已完成" : "📰 今日 AI 早報已完成";
}
