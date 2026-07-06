import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_STYLE_ID,
  DEFAULT_TTS_VOICE,
  normalizeStyleId,
  normalizeVoice,
  resolveStyleInstructions,
} from "./aiAnchor";
import {
  AUDIO_BUCKET,
  audioStoragePath,
  computeAudioExpiresAt,
} from "./audioRetention";

const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const OPENAI_TIMEOUT_MS = 55_000;
const MAX_SCRIPT_CHARS = 3000;
const PRO_DAILY_AUDIO_LIMIT = 10;

type ScriptRow = {
  id: string;
  user_id: string;
  script_text: string;
  audio_url: string | null;
  audio_voice: string | null;
  audio_style: string | null;
  audio_generated_at: string | null;
  audio_expires_at: string | null;
};

export type GenerateAudioForScriptInput = {
  supabase: SupabaseClient;
  openaiKey: string;
  scriptId: string;
  userId: string;
  scriptText: string;
  voice?: string;
  style?: string;
  isPro: boolean;
  isFavorited?: boolean;
  /** 每日推播預生成不計入使用者手動配額 */
  skipQuotaCheck?: boolean;
};

export type GenerateAudioForScriptSuccess = {
  ok: true;
  audioUrl: string;
  cached: boolean;
  voice: string;
  style: string;
  audioExpiresAt: string | null;
  generatedAt?: string;
};

export type GenerateAudioForScriptFailure = {
  ok: false;
  code: string;
  error: string;
};

export type GenerateAudioForScriptResult =
  | GenerateAudioForScriptSuccess
  | GenerateAudioForScriptFailure;

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function countTodayAudioGenerations(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const start = `${todayUtcDate()}T00:00:00.000Z`;
  const { count, error } = await supabase
    .from("news_daily_radio_scripts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .not("audio_generated_at", "is", null)
    .gte("audio_generated_at", start);

  if (error) {
    console.warn("[generateAudioForScript] quota count failed", error.message);
    return 0;
  }
  return count ?? 0;
}

function isAudioCacheHit(
  row: ScriptRow,
  requestedVoice: string,
  requestedStyle: string
): boolean {
  if (!row.audio_url?.trim()) return false;
  if (row.audio_expires_at && new Date(row.audio_expires_at).getTime() <= Date.now()) {
    return false;
  }
  if ((row.audio_voice ?? "") !== requestedVoice) return false;
  if ((row.audio_style ?? "") !== requestedStyle) return false;
  return true;
}

async function synthesizeMp3(
  apiKey: string,
  text: string,
  voice: string,
  instructions: string
): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const res = await fetch(OPENAI_SPEECH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice,
        input: text,
        response_format: "mp3",
        instructions,
      }),
    });

    if (!res.ok) {
      const raw = await res.text();
      throw new Error(`OpenAI TTS ${res.status}: ${raw.slice(0, 200)}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timer);
  }
}

export async function generateAudioForScript(
  input: GenerateAudioForScriptInput
): Promise<GenerateAudioForScriptResult> {
  const voice = normalizeVoice(input.voice ?? DEFAULT_TTS_VOICE) ?? DEFAULT_TTS_VOICE;
  const style = normalizeStyleId(input.style ?? DEFAULT_STYLE_ID) ?? DEFAULT_STYLE_ID;
  const instructions = resolveStyleInstructions(style);
  const isFavorited = input.isFavorited === true;

  if (!input.isPro) {
    return {
      ok: false,
      code: "PRO_REQUIRED",
      error: "升級 Pro 即可使用真人語音播報",
    };
  }

  const { data: row, error: fetchError } = await input.supabase
    .from("news_daily_radio_scripts")
    .select(
      "id, user_id, script_text, audio_url, audio_voice, audio_style, audio_generated_at, audio_expires_at"
    )
    .eq("id", input.scriptId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (fetchError) {
    return {
      ok: false,
      code: "DB_FETCH_FAILED",
      error: `讀取稿件失敗：${fetchError.message}`,
    };
  }
  if (!row) {
    return { ok: false, code: "NOT_FOUND", error: "找不到稿件" };
  }

  const script = row as ScriptRow;

  if (isAudioCacheHit(script, voice, style)) {
    return {
      ok: true,
      audioUrl: script.audio_url!,
      cached: true,
      voice: script.audio_voice ?? voice,
      style: script.audio_style ?? style,
      audioExpiresAt: script.audio_expires_at,
    };
  }

  if (!input.skipQuotaCheck) {
    const usedToday = await countTodayAudioGenerations(input.supabase, input.userId);
    if (usedToday >= PRO_DAILY_AUDIO_LIMIT) {
      return {
        ok: false,
        code: "QUOTA_EXCEEDED",
        error: `今日語音生成已達上限（${PRO_DAILY_AUDIO_LIMIT} 次）`,
      };
    }
  }

  const textForTts = (input.scriptText || script.script_text || "").trim();
  if (!textForTts) {
    return { ok: false, code: "EMPTY_SCRIPT", error: "主播稿不可為空" };
  }
  if (textForTts.length > MAX_SCRIPT_CHARS) {
    return {
      ok: false,
      code: "TOO_LONG",
      error: `主播稿過長（最多 ${MAX_SCRIPT_CHARS} 字）`,
    };
  }

  let mp3: Buffer;
  try {
    mp3 = await synthesizeMp3(input.openaiKey, textForTts, voice, instructions);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "OpenAI TTS failed";
    return {
      ok: false,
      code: "TTS_FAILED",
      error: msg.includes("OpenAI") ? msg : `OpenAI 語音生成失敗：${msg}`,
    };
  }

  const storagePath = audioStoragePath(input.scriptId);
  const { error: uploadError } = await input.supabase.storage
    .from(AUDIO_BUCKET)
    .upload(storagePath, mp3, {
      contentType: "audio/mpeg",
      upsert: true,
      cacheControl: "31536000",
    });

  if (uploadError) {
    return {
      ok: false,
      code: "STORAGE_FAILED",
      error: `語音儲存失敗：${uploadError.message}`,
    };
  }

  const { data: publicData } = input.supabase.storage
    .from(AUDIO_BUCKET)
    .getPublicUrl(storagePath);
  const audioUrl = publicData.publicUrl;
  const generatedAt = new Date().toISOString();
  const audioExpiresAt = computeAudioExpiresAt(
    input.isPro,
    isFavorited,
    new Date(generatedAt)
  );

  const { error: updateError } = await input.supabase
    .from("news_daily_radio_scripts")
    .update({
      audio_url: audioUrl,
      audio_voice: voice,
      audio_style: style,
      audio_generated_at: generatedAt,
      audio_expires_at: audioExpiresAt,
      updated_at: generatedAt,
    })
    .eq("id", input.scriptId)
    .eq("user_id", input.userId);

  if (updateError) {
    return {
      ok: false,
      code: "DB_FAILED",
      error: `更新語音欄位失敗：${updateError.message}`,
    };
  }

  return {
    ok: true,
    audioUrl,
    cached: false,
    voice,
    style,
    audioExpiresAt,
    generatedAt,
  };
}
