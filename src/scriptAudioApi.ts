import { apiUrl } from "./apiBase";
import { DEFAULT_TTS_VOICE, isScriptUuid } from "./audioConstants";
import { ensureSupabaseUser } from "./supabaseClient";

export { isScriptUuid, DEFAULT_TTS_VOICE };

/** iOS / Capacitor 連線測試：GET /api/ping */
export async function pingVercelApi(): Promise<{
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
}> {
  const url = apiUrl("ping");
  console.log("[RealVoice] ping /api/ping", { url });
  try {
    const res = await fetch(url, { method: "GET" });
    const raw = await res.text();
    let body: unknown = raw;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      /* keep raw */
    }
    console.log("[RealVoice] ping response", { status: res.status, body });
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "network error";
    console.error("[RealVoice] ping failed", msg);
    return { ok: false, error: msg };
  }
}

export type GenerateScriptAudioRequest = {
  scriptId: string;
  scriptText: string;
  voice: string;
  style: string;
  isPro: boolean;
  isFavorited?: boolean;
};

export type GenerateScriptAudioResult =
  | {
      ok: true;
      audioUrl: string;
      cached?: boolean;
      voice?: string;
      style?: string;
      status: number;
    }
  | {
      ok: false;
      error: string;
      code?: string;
      status?: number;
      responseBody?: unknown;
    };

function formatApiError(
  status: number,
  data: Record<string, unknown> | null,
  raw: string
): string {
  const code = typeof data?.code === "string" ? data.code : undefined;
  const message = typeof data?.error === "string" ? data.error : null;

  if (message) {
    return code ? `${message}（${code}）` : message;
  }

  if (status === 404) {
    return "語音 API 尚未部署（404）。請確認 Vercel 已發布 api/generate-audio.ts 與 api/ping.ts";
  }
  if (status === 401 || status === 403) {
    return message ?? "目前方案無法使用真人語音，請升級 Pro";
  }
  if (status >= 500) {
    return message ?? `伺服器錯誤（HTTP ${status}）`;
  }

  const snippet = raw.trim().slice(0, 160);
  return snippet
    ? `語音 API 回應異常（HTTP ${status}）：${snippet}`
    : `語音 API 回應異常（HTTP ${status}）`;
}

/**
 * 真人 AI 語音：僅呼叫 /api/generate-audio，回傳 MP3 URL。
 * 不使用 speechSynthesis / Capacitor TextToSpeech。
 */
export async function generateScriptAudio(
  input: GenerateScriptAudioRequest
): Promise<GenerateScriptAudioResult> {
  const userId = await ensureSupabaseUser();
  if (!userId) {
    return { ok: false, error: "無法取得使用者 ID，請重新開啟 App 後再試", code: "NO_USER" };
  }
  if (!isScriptUuid(input.scriptId)) {
    return {
      ok: false,
      error: "稿件 ID 無效，請先同步稿件後再試",
      code: "INVALID_SCRIPT",
    };
  }

  const text = input.scriptText.trim();
  if (!text) {
    return { ok: false, error: "尚無主播稿可轉語音", code: "EMPTY_SCRIPT" };
  }

  const voice = input.voice.trim();
  const style = input.style.trim();
  const requestBody = {
    scriptId: input.scriptId,
    scriptText: text,
    voice,
    style,
    userId,
    isPro: input.isPro,
    isFavorited: input.isFavorited === true,
  };

  const url = apiUrl("generate-audio");
  console.log("[RealVoice] fetch /api/generate-audio", {
    url,
    scriptId: requestBody.scriptId,
    voice: requestBody.voice,
    style: requestBody.style,
    isFavorited: requestBody.isFavorited,
    isPro: requestBody.isPro,
    scriptTextLength: text.length,
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const raw = await res.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
      data = null;
    }

    console.log("[RealVoice] API response", {
      status: res.status,
      ok: res.ok,
      body: data ?? raw.slice(0, 500),
      hasAudioUrl: Boolean(data && typeof data.audioUrl === "string" && data.audioUrl),
    });

    const audioUrl =
      data && typeof data.audioUrl === "string" ? data.audioUrl.trim() : "";

    if (!res.ok || data?.ok !== true || !audioUrl) {
      const code = typeof data?.code === "string" ? data.code : undefined;
      return {
        ok: false,
        error: formatApiError(res.status, data, raw),
        code,
        status: res.status,
        responseBody: data ?? raw.slice(0, 500),
      };
    }

    return {
      ok: true,
      audioUrl,
      cached: data.cached === true,
      voice: typeof data.voice === "string" ? data.voice : voice,
      style: typeof data.style === "string" ? data.style : style,
      status: res.status,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "network error";
    console.error("[RealVoice] fetch failed", msg);
    const hint =
      msg === "Load failed" || msg === "Failed to fetch"
        ? "（常見原因：API 尚未部署、網路中斷，或 iOS 無法連線至 Vercel；可先測 GET /api/ping）"
        : "";
    return {
      ok: false,
      error: `網路連線失敗：${msg}${hint}`,
      code: "NETWORK",
    };
  }
}
