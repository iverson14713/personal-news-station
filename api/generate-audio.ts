import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { applyCorsHeaders, handleOptionsPreflight } from "./lib/cors";
import {
  DEFAULT_STYLE_ID,
  DEFAULT_TTS_VOICE,
  normalizeStyleId,
  normalizeVoice,
} from "./lib/aiAnchor";
import { getSupabaseAdmin } from "./lib/audioRetention";
import { generateAudioForScript } from "./lib/generateAudioForScript";

function sendJson(res: any, payload: Record<string, unknown>, status = 200) {
  return res.status(status).json(payload);
}

function parseBody(req: any): Record<string, unknown> {
  const b = req.body;
  if (b == null) return {};
  if (typeof b === "string") {
    try {
      return JSON.parse(b) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof b === "object") return b as Record<string, unknown>;
  return {};
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}


export default async function handler(req: any, res: any) {
  applyCorsHeaders(res, "POST, OPTIONS");

  if (handleOptionsPreflight(req, res)) {
    return;
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, { ok: false, error: "僅支援 POST" }, 405);
  }

  try {
    const openaiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!openaiKey) {
      return sendJson(res, {
        ok: false,
        code: "NO_KEY",
        error: "伺服器尚未設定 OPENAI_API_KEY",
      });
    }

    const supabaseUrl = (
      process.env.SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      ""
    ).trim();
    const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!supabaseUrl) {
      return sendJson(res, {
        ok: false,
        code: "NO_SUPABASE",
        error: "伺服器尚未設定 SUPABASE_URL",
      });
    }
    if (!serviceRoleKey) {
      return sendJson(res, {
        ok: false,
        code: "NO_SUPABASE",
        error: "伺服器尚未設定 SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return sendJson(res, {
        ok: false,
        code: "NO_SUPABASE",
        error: "後端 Supabase 設定異常",
      });
    }

    const body = parseBody(req);
    const scriptId = String(body.scriptId ?? "").trim();
    const scriptText = String(body.scriptText ?? "").trim();
    const rawVoice = String(body.voice ?? DEFAULT_TTS_VOICE).trim();
    const rawStyle = String(body.style ?? DEFAULT_STYLE_ID).trim();
    const userId = String(body.userId ?? "").trim();
    const isPro = body.isPro === true;
    const isFavorited = body.isFavorited === true;

    const voice = normalizeVoice(rawVoice);
    if (!voice) {
      return sendJson(
        res,
        {
          ok: false,
          code: "INVALID_VOICE",
          error: `不支援的語音（${rawVoice}），允許：coral、ash、sage、alloy、nova`,
        },
        400
      );
    }

    const style = normalizeStyleId(rawStyle);
    if (!style) {
      return sendJson(
        res,
        {
          ok: false,
          code: "INVALID_STYLE",
          error: `不支援的播報風格（${rawStyle}）`,
        },
        400
      );
    }

    if (!scriptId || !isUuid(scriptId)) {
      return sendJson(
        res,
        { ok: false, code: "INVALID_SCRIPT", error: "稿件 ID 必須為 UUID" },
        400
      );
    }
    if (!userId || !isUuid(userId)) {
      return sendJson(res, { ok: false, error: "無效的使用者 ID" }, 400);
    }
    if (!scriptText) {
      return sendJson(res, { ok: false, error: "主播稿不可為空" }, 400);
    }

    const result = await generateAudioForScript({
      supabase: supabase as SupabaseClient,
      openaiKey,
      scriptId,
      userId,
      scriptText,
      voice,
      style,
      isPro,
      isFavorited,
    });

    if (!result.ok) {
      const status =
        result.code === "PRO_REQUIRED"
          ? 403
          : result.code === "QUOTA_EXCEEDED"
            ? 429
            : result.code === "NOT_FOUND"
              ? 404
              : result.code === "TTS_FAILED"
                ? 502
                : 500;
      return sendJson(res, { ok: false, code: result.code, error: result.error }, status);
    }

    return sendJson(res, {
      ok: true,
      audioUrl: result.audioUrl,
      cached: result.cached,
      voice: result.voice,
      style: result.style,
      generatedAt: result.generatedAt,
      audioExpiresAt: result.audioExpiresAt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "伺服器錯誤";
    console.error("[generate-audio] unhandled", msg);
    return sendJson(res, { ok: false, error: msg }, 500);
  }
}
