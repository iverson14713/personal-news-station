import {
  anchorIdForVoice,
  DEFAULT_STYLE_ID,
  DEFAULT_TTS_VOICE,
  normalizeStyleId,
  normalizeVoice,
  resolveStyleInstructions,
} from "./aiAnchor.ts";
import {
  AUDIO_BUCKET,
  audioStoragePath,
  computeAudioExpiresAt,
} from "./audioRetention.ts";

const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const OPENAI_TIMEOUT_MS = 55_000;
const MAX_SCRIPT_CHARS = 3000;

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  openaiKey: string;
  scriptId: string;
  userId: string;
  scriptText: string;
  voice?: string;
  style?: string;
  isPro: boolean;
  isFavorited?: boolean;
  skipQuotaCheck?: boolean;
};

export type GenerateAudioForScriptResult =
  | {
      ok: true;
      audioUrl: string;
      cached: boolean;
      voice: string;
      style: string;
      audioExpiresAt: string | null;
      generatedAt?: string;
    }
  | { ok: false; code: string; error: string };

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

/** 今日稿件是否需要（重新）生成 AI 主播語音；以 voice/style/expiry 判斷，列本身須已用 script_date 篩選。 */
export function isScriptAudioReady(
  row: Pick<
    ScriptRow,
    "audio_url" | "audio_voice" | "audio_style" | "audio_expires_at"
  >,
  requestedVoice: string,
  requestedStyle: string
): boolean {
  return isAudioCacheHit(row as ScriptRow, requestedVoice, requestedStyle);
}

async function synthesizeMp3(
  apiKey: string,
  text: string,
  voice: string,
  instructions: string
): Promise<Uint8Array> {
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

    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

export async function generateAudioForScript(
  input: GenerateAudioForScriptInput
): Promise<GenerateAudioForScriptResult> {
  const voice = normalizeVoice(input.voice ?? DEFAULT_TTS_VOICE);
  const style = normalizeStyleId(input.style ?? DEFAULT_STYLE_ID);
  const instructions = resolveStyleInstructions(style);
  const isFavorited = input.isFavorited === true;

  if (!input.isPro) {
    return {
      ok: false,
      code: "PRO_REQUIRED",
      error: "Pro required for anchor audio",
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
      error: fetchError.message,
    };
  }
  if (!row) {
    return { ok: false, code: "NOT_FOUND", error: "script not found" };
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

  const textForTts = (input.scriptText || script.script_text || "").trim();
  if (!textForTts) {
    return { ok: false, code: "EMPTY_SCRIPT", error: "empty script" };
  }
  if (textForTts.length > MAX_SCRIPT_CHARS) {
    return { ok: false, code: "TOO_LONG", error: "script too long" };
  }

  let mp3: Uint8Array;
  try {
    mp3 = await synthesizeMp3(input.openaiKey, textForTts, voice, instructions);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "OpenAI TTS failed";
    return { ok: false, code: "TTS_FAILED", error: msg };
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
    return { ok: false, code: "STORAGE_FAILED", error: uploadError.message };
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
    return { ok: false, code: "DB_FAILED", error: updateError.message };
  }

  console.log("[generateAudio] success", {
    scriptId: input.scriptId,
    userId: input.userId,
    voice,
    style,
    anchorId: anchorIdForVoice(voice),
    cached: false,
  });

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
