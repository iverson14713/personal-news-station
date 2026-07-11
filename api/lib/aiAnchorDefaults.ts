import {
  anchorDisplayName,
  anchorIdForVoice,
  normalizeStyleId,
  normalizeVoice,
} from "./aiAnchor";

/** 舊版用戶 / 尚未同步雲端設定時的預設主播（須與 supabase/functions/_shared/aiAnchor.ts 一致） */
export const DEFAULT_AI_ANCHOR_SETTINGS = {
  anchorId: "emily",
  voice: "coral",
  style: "news",
  playbackRate: 1.0,
} as const;

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

/** Pro 唯一判斷來源：news_user_preferences.voice_feature_enabled */
export function isProUser(user: {
  voice_feature_enabled?: boolean | null;
}): boolean {
  return user.voice_feature_enabled === true;
}

/** Pro 才預生成真人語音（與 isProUser 同義，保留既有呼叫點） */
export function isVoiceFeatureEnabled(user: {
  voice_feature_enabled?: boolean | null;
}): boolean {
  return isProUser(user);
}
