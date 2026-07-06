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

export const ANCHOR_DISPLAY_NAMES: Record<string, string> = {
  emily: "Emily",
  ryan: "Ryan",
  sage: "Sage",
  breeze: "Breeze",
  nova: "Nova",
};

/** 舊版用戶 / 尚未同步雲端設定時的預設主播（須與 api/lib/aiAnchorDefaults.ts 一致） */
export const DEFAULT_AI_ANCHOR_SETTINGS = {
  anchorId: "emily",
  voice: "coral",
  style: "news",
  playbackRate: 1.0,
} as const;

export const DEFAULT_TTS_VOICE = DEFAULT_AI_ANCHOR_SETTINGS.voice;
export const DEFAULT_STYLE_ID = DEFAULT_AI_ANCHOR_SETTINGS.style;
export const DEFAULT_ANCHOR_ID = DEFAULT_AI_ANCHOR_SETTINGS.anchorId;

export type AiAnchorSettingsSnapshot = {
  anchorId: string;
  anchorName: string;
  voice: string;
  style: string;
  playbackRate: number;
};

export type AiAnchorPrefsInput = {
  ai_anchor_id?: string | null;
  ai_anchor_voice?: string | null;
  ai_anchor_style?: string | null;
  ai_playback_rate?: number | null;
};

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed || null;
}

/** 從雲端偏好（或空值）解析主播設定，缺欄位時回傳 Emily / 專業新聞 / 1.0x */
export function resolveAnchorSettings(
  input?: AiAnchorPrefsInput | null
): AiAnchorSettingsSnapshot {
  const voice = normalizeVoice(
    nonEmpty(input?.ai_anchor_voice) ?? DEFAULT_AI_ANCHOR_SETTINGS.voice
  );
  const style = normalizeStyleId(
    nonEmpty(input?.ai_anchor_style) ?? DEFAULT_AI_ANCHOR_SETTINGS.style
  );
  const anchorId =
    nonEmpty(input?.ai_anchor_id) ??
    anchorIdForVoice(voice) ??
    DEFAULT_AI_ANCHOR_SETTINGS.anchorId;
  const rate = Number(input?.ai_playback_rate);
  const playbackRate =
    Number.isFinite(rate) && rate >= 0.5 && rate <= 3
      ? rate
      : DEFAULT_AI_ANCHOR_SETTINGS.playbackRate;

  return {
    anchorId,
    anchorName: anchorDisplayName(anchorId),
    voice,
    style,
    playbackRate,
  };
}

/** Pro / 內部測試才預生成真人語音；舊版 Pro 可能只有 evening_radio_enabled */
export function isVoiceFeatureEnabled(user: {
  voice_feature_enabled?: boolean | null;
  evening_radio_enabled?: boolean | null;
}): boolean {
  if (user.voice_feature_enabled === true) return true;
  if (user.evening_radio_enabled === true) return true;
  return false;
}

const VOICE_TO_ANCHOR_ID: Record<string, string> = {
  coral: "emily",
  ash: "ryan",
  sage: "sage",
  alloy: "breeze",
  nova: "nova",
};

export function normalizeVoice(raw: string): string {
  const voice = raw.trim().toLowerCase();
  return ALLOWED_TTS_VOICES.has(voice) ? voice : DEFAULT_TTS_VOICE;
}

export function normalizeStyleId(raw: string): string {
  const styleId = raw.trim();
  return Object.prototype.hasOwnProperty.call(AI_ANCHOR_STYLE_INSTRUCTIONS, styleId)
    ? styleId
    : DEFAULT_STYLE_ID;
}

export function resolveStyleInstructions(styleId: string): string {
  return (
    AI_ANCHOR_STYLE_INSTRUCTIONS[styleId] ??
    AI_ANCHOR_STYLE_INSTRUCTIONS[DEFAULT_STYLE_ID]
  );
}

export function anchorIdForVoice(voice: string): string {
  return VOICE_TO_ANCHOR_ID[voice.trim().toLowerCase()] ?? DEFAULT_ANCHOR_ID;
}

export function anchorDisplayName(anchorId: string): string {
  return ANCHOR_DISPLAY_NAMES[anchorId] ?? "Emily";
}
