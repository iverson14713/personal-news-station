export type PlaybackState =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "stopped"
  | "completed"
  | "error";

export type PlaybackMode = "ai" | "news" | null;

export function logPlaybackState(state: PlaybackState): void {
  console.log(`[Player] ${state}`);
}

export function playbackPageTitle(state: PlaybackState): string {
  switch (state) {
    case "loading":
      return "正在準備播放";
    case "playing":
      return "正在播放";
    case "paused":
      return "已暫停";
    case "completed":
      return "播放完成";
    case "error":
      return "播放失敗，請再試一次";
    case "stopped":
      return "已停止";
    default:
      return "播放";
  }
}

export function playbackStatusLabel(state: PlaybackState): string {
  return playbackPageTitle(state);
}

export function isPlaybackActiveState(state: PlaybackState): boolean {
  return state === "loading" || state === "playing" || state === "paused";
}

export function canStopPlayback(state: PlaybackState): boolean {
  return state === "loading" || state === "playing" || state === "paused";
}

export function canStartPlayback(state: PlaybackState): boolean {
  return (
    state === "idle" ||
    state === "stopped" ||
    state === "completed" ||
    state === "error"
  );
}

export function isPlayPrimaryDisabled(state: PlaybackState): boolean {
  return state === "loading" || state === "playing";
}

/** 重新開始播放（非暫停）僅在這些狀態允許 */
export function canRestartPlayback(state: PlaybackState): boolean {
  return canStartPlayback(state);
}

export function estimateChunkDurationMs(text: string, rate: number): number {
  return Math.max(650, Math.round((text.length * 92) / rate));
}

export function estimatePlaybackSafeFallbackMs(text: string, rate: number): number {
  const estimated = estimateChunkDurationMs(text, rate);
  return Math.max(180_000, Math.round(estimated * 2.5));
}

export function isSpeechSynthesisActive(): boolean {
  const synth = window.speechSynthesis;
  return synth.speaking || synth.pending || synth.paused;
}

export function findResumeIndex(text: string, approxIndex: number): number {
  const t = String(text || "");
  if (!t) return 0;
  const i = Math.max(0, Math.min(t.length, Math.floor(approxIndex)));
  const forward = t.slice(i, Math.min(t.length, i + 80));
  const m = forward.match(/[。！？!?；;，,\n]/);
  if (m && m.index != null) {
    return Math.min(t.length, i + m.index + 1);
  }
  const back = t.slice(Math.max(0, i - 80), i);
  const backIdx = Math.max(
    back.lastIndexOf("。"),
    back.lastIndexOf("！"),
    back.lastIndexOf("？"),
    back.lastIndexOf("!"),
    back.lastIndexOf("?"),
    back.lastIndexOf("；"),
    back.lastIndexOf(";"),
    back.lastIndexOf("，"),
    back.lastIndexOf(","),
    back.lastIndexOf("\n")
  );
  if (backIdx >= 0) {
    return Math.max(0, i - 80 + backIdx + 1);
  }
  return i;
}

export function formatRemainingTime(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `剩餘 ${m}:${String(s).padStart(2, "0")}` : `剩餘 ${sec} 秒`;
}

/** 裝置文字朗讀（speechSynthesis）專用；真人 MP3 語音不走此路徑 */
export function sanitizeForDeviceSpeechSynthesis(text: string): string {
  let s = String(text ?? "");

  // 常見 HTML entity → 純文字，避免 iOS 當成 SSML/XML 解析
  s = s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (match, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : match;
    })
    .replace(/&#x([\da-f]+);/gi, (match, hex) => {
      const n = parseInt(hex, 16);
      return Number.isFinite(n) ? String.fromCharCode(n) : match;
    });

  // 移除 SSML/XML 標籤（speak、break、prosody 等），只保留純文字
  s = s.replace(/<\s*\/?\s*[a-zA-Z][\w:-]*(?:\s+[^<>]*?)?\/?\s*>/g, "");

  // 中性化殘留的 XML 特殊字元，避免 TextToSpeech.SSMLParserError
  return s.replace(/</g, "＜").replace(/>/g, "＞").replace(/&/g, "＆");
}

export async function stopSpeechSynthesis(): Promise<void> {
  console.log("[Player] speech.stop()");
  try {
    window.speechSynthesis.cancel();
    if (
      window.speechSynthesis.speaking ||
      window.speechSynthesis.pending ||
      window.speechSynthesis.paused
    ) {
      window.speechSynthesis.cancel();
    }
  } catch {
    /* ignore */
  }
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 50);
  });
}
