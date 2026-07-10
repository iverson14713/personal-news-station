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
const SHORT_TTS_TIMEOUT_MS = 60_000;
const MEDIUM_TTS_TIMEOUT_MS = 120_000;
const LONG_TTS_TIMEOUT_MS = 150_000;
const TTS_RETRY_DELAY_MS = 2500;
const MAX_TTS_ATTEMPTS = 2;
const MAX_SCRIPT_CHARS = 3000;

const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

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
  radioSlot?: string;
  durationMinutes?: number;
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

export function resolveTtsTimeoutMs(scriptChars: number): number {
  if (scriptChars <= 800) return SHORT_TTS_TIMEOUT_MS;
  if (scriptChars <= 1800) return MEDIUM_TTS_TIMEOUT_MS;
  return LONG_TTS_TIMEOUT_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTtsHttpStatus(message: string): number | null {
  const match = message.match(/OpenAI TTS (\d{3})/i);
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

function isNonRetryableTtsError(error: unknown, httpStatus: number | null): boolean {
  if (httpStatus === 400) return true;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (
    msg.includes("authentication") ||
    msg.includes("invalid api key") ||
    msg.includes("invalid request") ||
    msg.includes("input format")
  ) {
    return true;
  }
  if (httpStatus != null && httpStatus >= 400 && httpStatus < 500) {
    return !RETRYABLE_HTTP_STATUSES.has(httpStatus);
  }
  return false;
}

function isRetryableTtsError(error: unknown, httpStatus: number | null): boolean {
  if (isNonRetryableTtsError(error, httpStatus)) return false;
  if (error instanceof Error && error.name === "AbortError") return true;
  if (httpStatus != null && RETRYABLE_HTTP_STATUSES.has(httpStatus)) return true;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return msg.includes("timeout") || msg.includes("abort") || msg.includes("aborted");
}

type TtsLogContext = {
  scriptId: string;
  radioSlot: string | null;
  durationMinutes: number | null;
  scriptChars: number;
  voice: string;
};

async function synthesizeMp3Once(
  apiKey: string,
  text: string,
  voice: string,
  instructions: string,
  timeoutMs: number
): Promise<{ mp3: Uint8Array; httpStatus: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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

    return {
      mp3: new Uint8Array(await res.arrayBuffer()),
      httpStatus: res.status,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function synthesizeMp3WithRetry(
  apiKey: string,
  text: string,
  voice: string,
  instructions: string,
  logCtx: TtsLogContext
): Promise<Uint8Array> {
  const timeoutMs = resolveTtsTimeoutMs(text.length);
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_TTS_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    console.log(
      JSON.stringify({
        event: "tts_generation_start",
        script_id: logCtx.scriptId,
        radio_slot: logCtx.radioSlot,
        duration_minutes: logCtx.durationMinutes,
        script_chars: logCtx.scriptChars,
        voice: logCtx.voice,
        timeout_ms: timeoutMs,
        attempt,
      })
    );

    try {
      const { mp3, httpStatus } = await synthesizeMp3Once(
        apiKey,
        text,
        voice,
        instructions,
        timeoutMs
      );
      const elapsedMs = Date.now() - startedAt;
      console.log(
        JSON.stringify({
          event: "tts_generation_success",
          script_id: logCtx.scriptId,
          attempt,
          elapsed_ms: elapsedMs,
          audio_bytes: mp3.byteLength,
          storage_path: audioStoragePath(logCtx.scriptId),
          http_status: httpStatus,
        })
      );
      return mp3;
    } catch (error) {
      lastError = error;
      const elapsedMs = Date.now() - startedAt;
      const errorName = error instanceof Error ? error.name : "Error";
      const errorMessage = error instanceof Error ? error.message : String(error);
      const httpStatus = parseTtsHttpStatus(errorMessage);
      const aborted = error instanceof Error && error.name === "AbortError";

      console.log(
        JSON.stringify({
          event: "tts_generation_failed",
          script_id: logCtx.scriptId,
          attempt,
          elapsed_ms: elapsedMs,
          error_name: errorName,
          error_message: errorMessage.slice(0, 300),
          http_status: httpStatus,
          response_body_summary: errorMessage.includes(":")
            ? errorMessage.split(":").slice(1).join(":").trim().slice(0, 200)
            : null,
          aborted,
          timeout_ms: timeoutMs,
          will_retry: attempt < MAX_TTS_ATTEMPTS && isRetryableTtsError(error, httpStatus),
        })
      );

      if (attempt < MAX_TTS_ATTEMPTS && isRetryableTtsError(error, httpStatus)) {
        await sleep(TTS_RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("OpenAI TTS failed");
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

  const logCtx: TtsLogContext = {
    scriptId: input.scriptId,
    radioSlot: input.radioSlot ?? null,
    durationMinutes: input.durationMinutes ?? null,
    scriptChars: textForTts.length,
    voice,
  };

  let mp3: Uint8Array;
  try {
    mp3 = await synthesizeMp3WithRetry(
      input.openaiKey,
      textForTts,
      voice,
      instructions,
      logCtx
    );
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
