import type { AiDuration } from "./aiDuration";
import { DAILY_SCRIPT_TIMEZONE, hourInTimezone } from "./dateLocal";
import { readUserDisplayName } from "./dailyRadio";

/** 設定頁即時預覽：AI 主播開場稱呼 */
export function buildAnchorGreetingPreview(nameDraft: string): string {
  const trimmed = nameDraft.trim();
  if (!trimmed) {
    return "「朋友，歡迎收聽今天的 AI 新聞。」";
  }
  const hour = hourInTimezone(DAILY_SCRIPT_TIMEZONE);
  if (hour >= 17) {
    return `「${trimmed}，晚安，今天有幾則你關心的新聞，我幫你整理成 3 分鐘重點。」`;
  }
  return `「${trimmed}，早安，我已經幫你整理好今天最值得關注的新聞。」`;
}

function greetingForHour(hour: number): string {
  if (hour < 11) return "早安";
  if (hour < 17) return "午安";
  return "晚安";
}

function sampleTopicLabels(topics: string[], max = 3): string {
  const picked = topics.filter(Boolean).slice(0, max);
  if (picked.length === 0) return "你關心的新聞";
  if (picked.length === 1) return picked[0];
  if (picked.length === 2) return `${picked[0]} 與 ${picked[1]}`;
  return `${picked.slice(0, -1).join("、")} 與 ${picked[picked.length - 1]}`;
}

export function buildPlaybackIntro(options: {
  newsCount: number;
  duration: AiDuration;
  topics?: string[];
  userName?: string;
}): string {
  const name = options.userName?.trim() || readUserDisplayName();
  const hour = new Date().getHours();
  const greet = greetingForHour(hour);
  const count = Math.max(1, options.newsCount);
  const topicLine = sampleTopicLabels(options.topics ?? []);
  const duration = options.duration;

  const lines = [
    `${name}，${greet}。`,
    `今天共有 ${count} 則你關心的新聞。`,
    `${topicLine} 今天都有重要更新。`,
    `接下來用 ${duration} 分鐘帶你快速掌握。`,
  ];
  return lines.join("");
}

export function prependPlaybackIntro(script: string, intro: string): string {
  const body = script.trim();
  if (!body) return intro;
  return `${intro}\n\n${body}`;
}
