/** pgmq queue operations for daily_radio_jobs */

export type DailyRadioJobPayload = {
  job_id: string;
  user_id: string;
  script_date: string;
  radio_slot: "morning" | "evening";
  duration_minutes: 3 | 5 | 10;
  job_type: "full" | "generate_script" | "generate_audio" | "send_push";
  trigger_source: string;
  force: boolean;
  priority: number;
  created_at: string;
};

export type QueueMessage = {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: DailyRadioJobPayload;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendDailyRadioJob(
  supabase: any,
  payload: DailyRadioJobPayload,
  delaySeconds = 0
): Promise<number | null> {
  const { data, error } = await supabase.rpc("daily_radio_queue_send", {
    payload,
    delay_seconds: delaySeconds,
  });
  if (error) {
    console.error("daily_radio_queue_send failed", error.message);
    return null;
  }
  return typeof data === "number" ? data : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readDailyRadioJobs(
  supabase: any,
  batchSize: number,
  visibilityTimeoutSeconds: number
): Promise<QueueMessage[]> {
  const { data, error } = await supabase.rpc("daily_radio_queue_read", {
    batch_size: batchSize,
    visibility_timeout_seconds: visibilityTimeoutSeconds,
  });
  if (error) {
    console.error("daily_radio_queue_read failed", error.message);
    return [];
  }
  return (data ?? []) as QueueMessage[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function archiveDailyRadioJob(
  supabase: any,
  msgId: number
): Promise<void> {
  const { error } = await supabase.rpc("daily_radio_queue_archive", {
    msg_id: msgId,
  });
  if (error) {
    console.error("daily_radio_queue_archive failed", { msg_id: msgId, error: error.message });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getQueueMetrics(supabase: any): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("daily_radio_queue_metrics");
  if (error) return { error: error.message };
  return (data as Record<string, unknown>) ?? {};
}

export const RETRY_BACKOFF_SECONDS = [60, 180, 600, 1800, 3600];
export const MAX_JOB_ATTEMPTS = 5;
export const DEFAULT_VISIBILITY_TIMEOUT_SEC = 600;
export const DEFAULT_WORKER_BATCH_SIZE = 3;
export const JOB_LOCK_STALE_MS = 15 * 60 * 1000;

export function isRetryableError(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes("no_topics") || m.includes("未設定追蹤主題")) return false;
  if (m.includes("baddevicetoken") || m.includes("unregistered")) return false;
  if (m.includes("invalid") && m.includes("user")) return false;
  if (m.includes("429") || m.includes("rate limit")) return true;
  if (m.includes("timeout") || m.includes("timed out")) return true;
  if (m.includes("5xx") || m.includes("502") || m.includes("503") || m.includes("504")) return true;
  if (m.includes("econnreset") || m.includes("network")) return true;
  if (m.includes("storage") && m.includes("temporar")) return true;
  if (m.includes("rss")) return true;
  return m.includes("openai") || m.includes("tts") || m.includes("apns");
}

export function backoffSecondsForAttempt(attempt: number): number {
  const idx = Math.min(Math.max(attempt - 1, 0), RETRY_BACKOFF_SECONDS.length - 1);
  return RETRY_BACKOFF_SECONDS[idx]!;
}
