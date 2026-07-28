/** pgmq queue operations for daily_radio_jobs */

export {
  MAX_JOB_ATTEMPTS,
  RETRY_BACKOFF_SECONDS,
  backoffSecondsForAttempt,
  classifyDailyRadioError,
  isRetryableError,
} from "./dailyRadioRetry.ts";

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

/**
 * Archive a pgmq queue message only (daily_radio_jobs).
 * Does NOT touch news article archive / candidate pools.
 */
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

export const DEFAULT_VISIBILITY_TIMEOUT_SEC = 600;
export const DEFAULT_WORKER_BATCH_SIZE = 3;
export const JOB_LOCK_STALE_MS = 15 * 60 * 1000;
