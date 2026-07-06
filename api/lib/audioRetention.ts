import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const AUDIO_BUCKET = "news-audio";
export const MS_HOUR = 60 * 60 * 1000;
export const MS_DAY = 24 * MS_HOUR;

export const AUDIO_RETENTION_MS = {
  free: MS_DAY,
  pro: 7 * MS_DAY,
  favorited: 30 * MS_DAY,
} as const;

export type AudioRetentionTier = keyof typeof AUDIO_RETENTION_MS;

export function computeAudioExpiresAt(
  isPro: boolean,
  isFavorited: boolean,
  from = new Date()
): string {
  let retentionMs = AUDIO_RETENTION_MS.free;
  if (isFavorited) {
    retentionMs = AUDIO_RETENTION_MS.favorited;
  } else if (isPro) {
    retentionMs = AUDIO_RETENTION_MS.pro;
  }
  return new Date(from.getTime() + retentionMs).toISOString();
}

export function audioStoragePath(scriptId: string): string {
  return `audio/${scriptId}.mp3`;
}

export function getSupabaseAdmin(): SupabaseClient | null {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function verifyCronSecret(req: {
  headers?: Record<string, string | string[] | undefined>;
}): boolean {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) return false;

  const headerSecret = req.headers?.["x-cron-secret"];
  const xCron =
    typeof headerSecret === "string"
      ? headerSecret
      : Array.isArray(headerSecret)
        ? headerSecret[0]
        : "";

  const authHeader = req.headers?.authorization;
  const auth =
    typeof authHeader === "string"
      ? authHeader
      : Array.isArray(authHeader)
        ? authHeader[0]
        : "";

  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return xCron === cronSecret || bearer === cronSecret;
}

export const AUDIO_CLEAR_FIELDS = {
  audio_url: null,
  audio_voice: null,
  audio_style: null,
  audio_generated_at: null,
  audio_expires_at: null,
  audio_duration_seconds: null,
} as const;

export type ExpiredAudioRow = {
  id: string;
  user_id: string;
  audio_url: string | null;
};

export async function fetchExpiredAudioRows(
  supabase: SupabaseClient,
  limit = 200
): Promise<ExpiredAudioRow[]> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("news_daily_radio_scripts")
    .select("id, user_id, audio_url")
    .not("audio_url", "is", null)
    .not("audio_expires_at", "is", null)
    .lt("audio_expires_at", now)
    .order("audio_expires_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`fetch expired audio failed: ${error.message}`);
  }

  return (data ?? []) as ExpiredAudioRow[];
}

export async function deleteAudioStorageFiles(
  supabase: SupabaseClient,
  scriptIds: string[]
): Promise<{ deletedIds: string[]; failedIds: string[] }> {
  if (scriptIds.length === 0) {
    return { deletedIds: [], failedIds: [] };
  }

  const paths = scriptIds.map((id) => audioStoragePath(id));
  const { error } = await supabase.storage.from(AUDIO_BUCKET).remove(paths);

  if (error) {
    console.warn("[audio-cleanup] batch storage remove error", error.message);
    const deletedIds: string[] = [];
    const failedIds: string[] = [];

    for (const id of scriptIds) {
      const { error: singleError } = await supabase.storage
        .from(AUDIO_BUCKET)
        .remove([audioStoragePath(id)]);
      if (singleError) {
        console.warn("[audio-cleanup] remove failed", { id, error: singleError.message });
        failedIds.push(id);
      } else {
        deletedIds.push(id);
      }
    }
    return { deletedIds, failedIds };
  }

  return { deletedIds: scriptIds, failedIds: [] };
}

export async function clearAudioFieldsForScripts(
  supabase: SupabaseClient,
  scriptIds: string[]
): Promise<void> {
  if (scriptIds.length === 0) return;

  const { error } = await supabase
    .from("news_daily_radio_scripts")
    .update({
      ...AUDIO_CLEAR_FIELDS,
      updated_at: new Date().toISOString(),
    })
    .in("id", scriptIds);

  if (error) {
    throw new Error(`clear audio fields failed: ${error.message}`);
  }
}
