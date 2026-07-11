import {
  sendDailyRadioCompletedPush,
  type PushEnvironment,
  type PushSendResult,
  type RadioSlot,
} from "./push.ts";
import { isScriptAudioReady } from "./generateAudio.ts";
import { resolveAnchorSettings } from "./aiAnchor.ts";
import { newsKeysFromSourceNews } from "./news.ts";

const SERVER_SOURCE = "server";
const PUSH_CLAIM_TTL_MS = 10 * 60 * 1000;

type PushPrefs = {
  user_id: string;
  push_token: string | null;
  push_platform: string | null;
  push_environment: PushEnvironment | null;
  display_name: string | null;
  ai_anchor_id: string | null;
  ai_anchor_voice: string | null;
  ai_anchor_style: string | null;
  voice_feature_enabled: boolean | null;
};

type ScriptRow = {
  id: string;
  user_id: string;
  script_date: string;
  duration_minutes: number;
  radio_slot: RadioSlot;
  status: string;
  generation_source: string;
  push_sent_at: string | null;
  push_claimed_at: string | null;
  audio_url: string | null;
  audio_voice: string | null;
  audio_style: string | null;
  audio_expires_at: string | null;
  source_news: unknown;
};

const PUSH_PREFS_SELECT =
  "user_id, push_token, push_platform, push_environment, display_name, ai_anchor_id, ai_anchor_voice, ai_anchor_style, voice_feature_enabled";

function sanitizePushError(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/bearer\s+\S+/gi, "bearer [redacted]")
    .slice(0, 500);
}

function sourceNewsCount(sourceNews: unknown): number {
  return newsKeysFromSourceNews(sourceNews).length;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function claimPushDelivery(
  supabase: any,
  userId: string,
  scriptDate: string,
  duration: number,
  radioSlot: RadioSlot
): Promise<{
  claimed: boolean;
  skipReason: "already_sent" | "claim_active" | "claim_failed" | null;
}> {
  const { data: beforeRow } = await supabase
    .from("news_daily_radio_scripts")
    .select("id, push_sent_at, push_claimed_at")
    .eq("user_id", userId)
    .eq("script_date", scriptDate)
    .eq("duration_minutes", duration)
    .eq("generation_source", SERVER_SOURCE)
    .eq("radio_slot", radioSlot)
    .maybeSingle();

  const row = beforeRow as {
    push_sent_at?: string | null;
    push_claimed_at?: string | null;
  } | null;

  if (row?.push_sent_at) {
    return { claimed: false, skipReason: "already_sent" };
  }

  const now = new Date().toISOString();
  const claimExpiresBefore = new Date(Date.now() - PUSH_CLAIM_TTL_MS).toISOString();

  const { data: claimedRow, error } = await supabase
    .from("news_daily_radio_scripts")
    .update({
      push_claimed_at: now,
      push_last_attempt_at: now,
      updated_at: now,
    })
    .eq("user_id", userId)
    .eq("script_date", scriptDate)
    .eq("duration_minutes", duration)
    .eq("generation_source", SERVER_SOURCE)
    .eq("radio_slot", radioSlot)
    .is("push_sent_at", null)
    .or(`push_claimed_at.is.null,push_claimed_at.lt.${claimExpiresBefore}`)
    .select("id")
    .maybeSingle();

  if (error) {
    return { claimed: false, skipReason: "claim_failed" };
  }
  if (!claimedRow) {
    const skipReason =
      row?.push_claimed_at && row.push_claimed_at >= claimExpiresBefore
        ? "claim_active"
        : "claim_failed";
    return { claimed: false, skipReason };
  }

  return { claimed: true, skipReason: null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function markPushApnsSuccess(
  supabase: any,
  userId: string,
  scriptDate: string,
  duration: number,
  radioSlot: RadioSlot
): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from("news_daily_radio_scripts")
    .update({
      push_sent_at: now,
      push_claimed_at: null,
      push_last_error: null,
      push_last_attempt_at: now,
      updated_at: now,
    })
    .eq("user_id", userId)
    .eq("script_date", scriptDate)
    .eq("duration_minutes", duration)
    .eq("generation_source", SERVER_SOURCE)
    .eq("radio_slot", radioSlot)
    .is("push_sent_at", null);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function releasePushClaimOnFailure(
  supabase: any,
  userId: string,
  scriptDate: string,
  duration: number,
  radioSlot: RadioSlot,
  errorMessage: string
): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from("news_daily_radio_scripts")
    .update({
      push_claimed_at: null,
      push_last_error: sanitizePushError(errorMessage),
      push_last_attempt_at: now,
      updated_at: now,
    })
    .eq("user_id", userId)
    .eq("script_date", scriptDate)
    .eq("duration_minutes", duration)
    .eq("generation_source", SERVER_SOURCE)
    .eq("radio_slot", radioSlot);
}

export type PushRetryResult = {
  ok: boolean;
  script_id: string;
  push_status: PushSendResult["push_status"];
  push_error?: string;
  skipped_reason?: string;
};

/** Push-only retry for an existing completed script (no news/AI/TTS). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function retryDailyRadioPushForScript(
  supabase: any,
  scriptId: string
): Promise<PushRetryResult> {
  const { data: script, error: scriptError } = await supabase
    .from("news_daily_radio_scripts")
    .select(
      "id, user_id, script_date, duration_minutes, radio_slot, status, generation_source, push_sent_at, push_claimed_at, audio_url, audio_voice, audio_style, audio_expires_at, source_news"
    )
    .eq("id", scriptId)
    .maybeSingle();

  if (scriptError || !script) {
    return {
      ok: false,
      script_id: scriptId,
      push_status: "failed",
      push_error: scriptError?.message ?? "script_not_found",
    };
  }

  const row = script as ScriptRow;

  if (row.generation_source !== SERVER_SOURCE) {
    return {
      ok: false,
      script_id: scriptId,
      push_status: "failed",
      push_error: "not_server_script",
    };
  }

  if (row.status !== "completed") {
    return {
      ok: false,
      script_id: scriptId,
      push_status: "failed",
      push_error: `script_not_completed:${row.status}`,
    };
  }

  if (row.push_sent_at) {
    return {
      ok: true,
      script_id: scriptId,
      push_status: "sent",
      skipped_reason: "push_already_sent",
    };
  }

  const { data: prefs, error: prefsError } = await supabase
    .from("news_user_preferences")
    .select(PUSH_PREFS_SELECT)
    .eq("user_id", row.user_id)
    .maybeSingle();

  if (prefsError || !prefs) {
    return {
      ok: false,
      script_id: scriptId,
      push_status: "failed",
      push_error: prefsError?.message ?? "user_prefs_not_found",
    };
  }

  const user = prefs as PushPrefs;
  const pushToken = user.push_token?.trim() ?? "";
  if (!pushToken) {
    return {
      ok: false,
      script_id: scriptId,
      push_status: "no_token",
      push_error: "missing_push_token",
    };
  }

  const claim = await claimPushDelivery(
    supabase,
    row.user_id,
    row.script_date,
    row.duration_minutes,
    row.radio_slot
  );

  if (!claim.claimed) {
    return {
      ok: false,
      script_id: scriptId,
      push_status: claim.skipReason === "already_sent" ? "sent" : "failed",
      push_error: claim.skipReason ?? "push_claim_failed",
      skipped_reason: claim.skipReason ?? undefined,
    };
  }

  const anchorPrefs = resolveAnchorSettings(user);
  const audioReady = isScriptAudioReady(
    row,
    anchorPrefs.voice,
    anchorPrefs.style
  );

  const pushResult = await sendDailyRadioCompletedPush(
    pushToken,
    user.display_name,
    user.push_platform,
    {
      radioSlot: row.radio_slot,
      scriptId: row.id,
      anchorName: anchorPrefs.anchorName,
      hasAnchorAudio: audioReady,
      audioReady,
      durationMinutes: row.duration_minutes,
      newsCount: sourceNewsCount(row.source_news),
      pushEnvironment: user.push_environment,
    }
  );

  if (pushResult.push_status === "sent") {
    await markPushApnsSuccess(
      supabase,
      row.user_id,
      row.script_date,
      row.duration_minutes,
      row.radio_slot
    );
    return {
      ok: true,
      script_id: scriptId,
      push_status: "sent",
    };
  }

  await releasePushClaimOnFailure(
    supabase,
    row.user_id,
    row.script_date,
    row.duration_minutes,
    row.radio_slot,
    pushResult.push_error ?? pushResult.push_status
  );

  return {
    ok: false,
    script_id: scriptId,
    push_status: pushResult.push_status,
    push_error: pushResult.push_error,
  };
}
