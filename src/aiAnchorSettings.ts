export type AiAnchorVoice = {
  id: string;
  name: string;
  voice: string;
  description: string;
};

export type AiAnchorStyle = {
  id: string;
  name: string;
  instructions: string;
};

export const AI_ANCHOR_VOICES: AiAnchorVoice[] = [
  { id: "emily", name: "Emily", voice: "coral", description: "溫柔自然" },
  { id: "ryan", name: "Ryan", voice: "ash", description: "沉穩清楚" },
  { id: "sage", name: "Sage", voice: "sage", description: "成熟專業" },
  { id: "breeze", name: "Breeze", voice: "alloy", description: "乾淨中性" },
  { id: "nova", name: "Nova", voice: "nova", description: "明亮有活力" },
];

export const AI_ANCHOR_STYLES: AiAnchorStyle[] = [
  {
    id: "news",
    name: "專業新聞",
    instructions: "請以沉穩、專業、自然的新聞主播語氣播報，語速適中，重點清楚。",
  },
  {
    id: "morning",
    name: "早餐聊天",
    instructions: "請以親切、自然、像早晨簡報的語氣播報，不要太嚴肅。",
  },
  {
    id: "podcast",
    name: "Podcast",
    instructions: "請像 Podcast 主持人一樣自然播報，有節奏、有親和力。",
  },
  {
    id: "finance",
    name: "財經分析",
    instructions: "請以冷靜、理性、重點明確的財經主播語氣播報。",
  },
  {
    id: "sports",
    name: "運動主播",
    instructions: "請以有活力的運動主播語氣播報，但不要過度誇張。",
  },
];

export const AI_ANCHOR_PLAYBACK_RATES = [0.8, 1.0, 1.2, 1.5, 2.0] as const;
export type AiAnchorPlaybackRate = (typeof AI_ANCHOR_PLAYBACK_RATES)[number];

export const AI_ANCHOR_VOLUME_GAINS = [1.0, 1.25, 1.5, 1.75, 2.0] as const;
export type AiAnchorVolumeGain = (typeof AI_ANCHOR_VOLUME_GAINS)[number];

export const AI_ANCHOR_VOLUME_PRESETS = [
  { id: "standard", label: "標準", gain: 1.0 as AiAnchorVolumeGain },
  { id: "enhanced", label: "增強", gain: 1.5 as AiAnchorVolumeGain },
  { id: "louder", label: "更大聲", gain: 2.0 as AiAnchorVolumeGain },
] as const;
export type AiAnchorVolumePresetId = (typeof AI_ANCHOR_VOLUME_PRESETS)[number]["id"];

export const AI_NEWS_ANCHOR_ID_KEY = "aiNewsAnchorId";
export const AI_NEWS_ANCHOR_STYLE_KEY = "aiNewsAnchorStyle";
export const AI_NEWS_PLAYBACK_RATE_KEY = "aiNewsPlaybackRate";
export const AI_NEWS_ANCHOR_VOLUME_GAIN_KEY = "aiNewsAnchorVolumeGain";

/** 舊版用戶 / localStorage 無設定時的預設（須與 api/lib/aiAnchorDefaults.ts 一致） */
export const DEFAULT_AI_ANCHOR_SETTINGS = {
  anchorId: "emily",
  voice: "coral",
  style: "news",
  playbackRate: 1.0,
} as const satisfies {
  anchorId: string;
  voice: string;
  style: string;
  playbackRate: AiAnchorPlaybackRate;
};

export const DEFAULT_ANCHOR_ID = DEFAULT_AI_ANCHOR_SETTINGS.anchorId;
export const DEFAULT_STYLE_ID = DEFAULT_AI_ANCHOR_SETTINGS.style;
export const DEFAULT_ANCHOR_PLAYBACK_RATE: AiAnchorPlaybackRate =
  DEFAULT_AI_ANCHOR_SETTINGS.playbackRate;
export const DEFAULT_ANCHOR_VOLUME_GAIN: AiAnchorVolumeGain = 1.5;

/** @deprecated use DEFAULT_AI_ANCHOR_SETTINGS.voice */
export const DEFAULT_TTS_VOICE = DEFAULT_AI_ANCHOR_SETTINGS.voice;

export function getAnchorById(id: string | null | undefined): AiAnchorVoice {
  return (
    AI_ANCHOR_VOICES.find((a) => a.id === id) ??
    AI_ANCHOR_VOICES.find((a) => a.id === DEFAULT_ANCHOR_ID)!
  );
}

export function getAnchorByOpenAiVoice(voice: string | null | undefined): AiAnchorVoice {
  const normalized = (voice ?? "").trim().toLowerCase();
  return (
    AI_ANCHOR_VOICES.find((a) => a.voice === normalized) ??
    getAnchorById(DEFAULT_ANCHOR_ID)
  );
}

export function getStyleById(id: string | null | undefined): AiAnchorStyle {
  return (
    AI_ANCHOR_STYLES.find((s) => s.id === id) ??
    AI_ANCHOR_STYLES.find((s) => s.id === DEFAULT_STYLE_ID)!
  );
}

/** 從雲端偏好列（或 null）解析；缺欄位時與 localStorage 讀取結果一致 */
export function resolveAnchorSettings(input?: {
  ai_anchor_id?: string | null;
  ai_anchor_voice?: string | null;
  ai_anchor_style?: string | null;
  ai_playback_rate?: number | null;
}): {
  anchorId: string;
  anchorName: string;
  voice: string;
  style: string;
  playbackRate: AiAnchorPlaybackRate;
} {
  const nonEmpty = (v: string | null | undefined) => {
    const t = (v ?? "").trim();
    return t || null;
  };
  const anchorId = nonEmpty(input?.ai_anchor_id) ?? DEFAULT_AI_ANCHOR_SETTINGS.anchorId;
  const anchor = getAnchorById(anchorId);
  const voice = nonEmpty(input?.ai_anchor_voice) ?? anchor.voice;
  const styleId = nonEmpty(input?.ai_anchor_style) ?? DEFAULT_AI_ANCHOR_SETTINGS.style;
  const style = getStyleById(styleId);
  const rate = Number(input?.ai_playback_rate);
  const playbackRate = AI_ANCHOR_PLAYBACK_RATES.includes(rate as AiAnchorPlaybackRate)
    ? (rate as AiAnchorPlaybackRate)
    : DEFAULT_AI_ANCHOR_SETTINGS.playbackRate;
  return {
    anchorId: anchor.id,
    anchorName: anchor.name,
    voice,
    style: style.id,
    playbackRate,
  };
}

export function readAnchorId(): string {
  try {
    const raw = localStorage.getItem(AI_NEWS_ANCHOR_ID_KEY);
    if (raw && AI_ANCHOR_VOICES.some((a) => a.id === raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_ANCHOR_ID;
}

export function writeAnchorId(id: string): void {
  try {
    localStorage.setItem(AI_NEWS_ANCHOR_ID_KEY, id);
  } catch {
    /* ignore */
  }
}

export function readAnchorStyleId(): string {
  try {
    const raw = localStorage.getItem(AI_NEWS_ANCHOR_STYLE_KEY);
    if (raw && AI_ANCHOR_STYLES.some((s) => s.id === raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_STYLE_ID;
}

export function writeAnchorStyleId(id: string): void {
  try {
    localStorage.setItem(AI_NEWS_ANCHOR_STYLE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function readAnchorPlaybackRate(): AiAnchorPlaybackRate {
  try {
    const raw = localStorage.getItem(AI_NEWS_PLAYBACK_RATE_KEY);
    const n = raw ? Number(raw) : NaN;
    if (AI_ANCHOR_PLAYBACK_RATES.includes(n as AiAnchorPlaybackRate)) {
      return n as AiAnchorPlaybackRate;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_ANCHOR_PLAYBACK_RATE;
}

export function writeAnchorPlaybackRate(rate: AiAnchorPlaybackRate): void {
  try {
    localStorage.setItem(AI_NEWS_PLAYBACK_RATE_KEY, String(rate));
  } catch {
    /* ignore */
  }
}

export function readAnchorVolumeGain(): AiAnchorVolumeGain {
  try {
    const raw = localStorage.getItem(AI_NEWS_ANCHOR_VOLUME_GAIN_KEY);
    const n = raw ? Number(raw) : NaN;
    if (AI_ANCHOR_VOLUME_GAINS.includes(n as AiAnchorVolumeGain)) {
      return n as AiAnchorVolumeGain;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_ANCHOR_VOLUME_GAIN;
}

export function writeAnchorVolumeGain(gain: AiAnchorVolumeGain): void {
  try {
    localStorage.setItem(AI_NEWS_ANCHOR_VOLUME_GAIN_KEY, String(gain));
  } catch {
    /* ignore */
  }
}

export function isVolumePresetActive(
  preset: (typeof AI_ANCHOR_VOLUME_PRESETS)[number],
  gain: AiAnchorVolumeGain
): boolean {
  if (preset.id === "standard") return gain === 1.0;
  if (preset.id === "louder") return gain === 2.0;
  return gain >= 1.25 && gain <= 1.75;
}

export function formatAnchorPlaybackRate(rate: number): string {
  return `${rate % 1 === 0 ? rate.toFixed(1) : rate}x`;
}

export type ScriptAudioStaleReason = "voice" | "style" | "both" | null;

export function getScriptAudioStaleReason(
  audioUrl: string | null,
  cachedVoice: string | null,
  cachedStyle: string | null,
  selectedVoice: string,
  selectedStyleId: string
): ScriptAudioStaleReason {
  if (!audioUrl?.trim()) return null;
  const voiceMismatch = (cachedVoice ?? "") !== selectedVoice;
  const styleMismatch = (cachedStyle ?? "") !== selectedStyleId;
  if (voiceMismatch && styleMismatch) return "both";
  if (voiceMismatch) return "voice";
  if (styleMismatch) return "style";
  return null;
}

/** 今日稿件 AI 語音是否可直接播放（以 script_date + expiry + voice/style 判斷，非僅 audio_url）。 */
export function isTodayScriptAudioReady(
  scriptDate: string,
  todayYmd: string,
  audioUrl: string | null,
  audioExpiresAt: string | null,
  cachedVoice: string | null,
  cachedStyle: string | null,
  selectedVoice: string,
  selectedStyleId: string
): boolean {
  if (scriptDate !== todayYmd) return false;
  if (!audioUrl?.trim()) return false;
  if (audioExpiresAt && new Date(audioExpiresAt).getTime() <= Date.now()) {
    return false;
  }
  return (
    getScriptAudioStaleReason(
      audioUrl,
      cachedVoice,
      cachedStyle,
      selectedVoice,
      selectedStyleId
    ) === null
  );
}
