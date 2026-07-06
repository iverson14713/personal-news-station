import {
  clearAudioFieldsForScripts,
  deleteAudioStorageFiles,
  fetchExpiredAudioRows,
  getSupabaseAdmin,
  verifyCronSecret,
} from "./lib/audioRetention";
import { applyCorsHeaders, handleOptionsPreflight } from "./lib/cors";

function sendJson(res: any, payload: Record<string, unknown>, status = 200) {
  return res.status(status).json(payload);
}

export default async function handler(req: any, res: any) {
  applyCorsHeaders(res, "GET, POST, OPTIONS");

  if (handleOptionsPreflight(req, res)) {
    return;
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, { ok: false, error: "僅支援 GET / POST" }, 405);
  }

  if (!verifyCronSecret(req)) {
    console.error("[cleanup-audio] unauthorized cron request");
    return sendJson(res, { ok: false, error: "Unauthorized" }, 401);
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return sendJson(
      res,
      { ok: false, error: "Missing Supabase server configuration" },
      500
    );
  }

  const startedAt = Date.now();

  try {
    const expiredRows = await fetchExpiredAudioRows(supabase);
    const scriptIds = expiredRows.map((row) => row.id);

    console.log("[cleanup-audio] expired rows", {
      count: scriptIds.length,
      triggered_at: new Date().toISOString(),
    });

    if (scriptIds.length === 0) {
      return sendJson(res, {
        ok: true,
        expired: 0,
        storageDeleted: 0,
        dbCleared: 0,
        failed: 0,
        durationMs: Date.now() - startedAt,
      });
    }

    const { deletedIds, failedIds } = await deleteAudioStorageFiles(supabase, scriptIds);

    if (deletedIds.length > 0) {
      await clearAudioFieldsForScripts(supabase, deletedIds);
    }

    console.log("[cleanup-audio] completed", {
      expired: scriptIds.length,
      storageDeleted: deletedIds.length,
      dbCleared: deletedIds.length,
      failed: failedIds.length,
      durationMs: Date.now() - startedAt,
    });

    return sendJson(res, {
      ok: true,
      expired: scriptIds.length,
      storageDeleted: deletedIds.length,
      dbCleared: deletedIds.length,
      failed: failedIds.length,
      failedIds: failedIds.length > 0 ? failedIds : undefined,
      durationMs: Date.now() - startedAt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "cleanup failed";
    console.error("[cleanup-audio] error", msg);
    return sendJson(res, { ok: false, error: msg }, 500);
  }
}
