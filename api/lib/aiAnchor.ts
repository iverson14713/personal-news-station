export const ALLOWED_TTS_VOICES = new Set([
  "coral",
  "ash",
  "sage",
  "alloy",
  "nova",
]);

export const AI_ANCHOR_STYLE_INSTRUCTIONS: Record<string, string> = {
  news: "請以沉穩、專業、自然的新聞主播語氣播報，語速適中，重點清楚。",
  morning: "請以親切、自然、像早晨簡報的語氣播報，不要太嚴肅。",
  podcast: "請像 Podcast 主持人一樣自然播報，有節奏、有親和力。",
  finance: "請以冷靜、理性、重點明確的財經主播語氣播報。",
  sports: "請以有活力的運動主播語氣播報，但不要過度誇張。",
};

export const DEFAULT_TTS_VOICE = "coral";
export const DEFAULT_STYLE_ID = "news";

const VOICE_TO_ANCHOR_ID: Record<string, string> = {
  coral: "emily",
  ash: "ryan",
  sage: "sage",
  alloy: "breeze",
  nova: "nova",
};

export function isAllowedVoice(voice: string): boolean {
  return ALLOWED_TTS_VOICES.has(voice.trim().toLowerCase());
}

export function isAllowedStyleId(styleId: string): boolean {
  return Object.prototype.hasOwnProperty.call(AI_ANCHOR_STYLE_INSTRUCTIONS, styleId);
}

export function normalizeVoice(raw: string): string | null {
  const voice = raw.trim().toLowerCase();
  return isAllowedVoice(voice) ? voice : null;
}

export function normalizeStyleId(raw: string): string | null {
  const styleId = raw.trim();
  return isAllowedStyleId(styleId) ? styleId : null;
}

export function resolveStyleInstructions(styleId: string): string {
  return (
    AI_ANCHOR_STYLE_INSTRUCTIONS[styleId] ??
    AI_ANCHOR_STYLE_INSTRUCTIONS[DEFAULT_STYLE_ID]
  );
}

export function anchorIdForVoice(voice: string): string {
  return VOICE_TO_ANCHOR_ID[voice.trim().toLowerCase()] ?? "emily";
}

export const ANCHOR_DISPLAY_NAMES: Record<string, string> = {
  emily: "Emily",
  ryan: "Ryan",
  sage: "Sage",
  breeze: "Breeze",
  nova: "Nova",
};

export function anchorDisplayName(anchorId: string): string {
  return ANCHOR_DISPLAY_NAMES[anchorId] ?? "Emily";
}
