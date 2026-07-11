import { getTaipeiDateKey } from "./timezone.ts";

export type GenerationRunStatus = "running" | "success" | "partial_success" | "failed";

export type GenerationTriggerSource = "cron" | "manual" | "app_fallback" | "test";

export type GenerationRunContext = {
  executionId: string;
  runDate: string;
  triggerSource: GenerationTriggerSource;
  startedAt: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  rowId: string | null;
};

export function createExecutionId(): string {
  return crypto.randomUUID();
}

export function resolveTriggerSource(payload: {
  triggerSource?: string;
  trigger_source?: string;
  app?: string;
  test?: boolean;
}): GenerationTriggerSource {
  const raw = (payload.triggerSource ?? payload.trigger_source ?? "").trim().toLowerCase();
  if (raw === "cron" || raw === "manual" || raw === "app_fallback" || raw === "test") {
    return raw;
  }
  if (payload.test === true) return "test";
  if (payload.app === "ai-news-station-debug") return "manual";
  return "cron";
}

export function logExecutionEvent(
  executionId: string,
  stage: string,
  fields: Record<string, unknown> = {}
): void {
  console.log(
    JSON.stringify({
      event: "daily_generation_execution",
      executionId,
      stage,
      at: new Date().toISOString(),
      ...fields,
    })
  );
}

export function logExecutionError(
  executionId: string,
  stage: string,
  error: unknown,
  fields: Record<string, unknown> = {}
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  console.log(
    JSON.stringify({
      event: "daily_generation_execution_error",
      executionId,
      stage,
      error_name: err.name,
      error_message: err.message.slice(0, 500),
      error_stack: err.stack?.slice(0, 800) ?? null,
      at: new Date().toISOString(),
      ...fields,
    })
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function startGenerationRun(
  supabase: any,
  executionId: string,
  triggerSource: GenerationTriggerSource
): Promise<GenerationRunContext> {
  const runDate = getTaipeiDateKey();
  const startedAt = Date.now();
  const ctx: GenerationRunContext = {
    executionId,
    runDate,
    triggerSource,
    startedAt,
    supabase,
    rowId: null,
  };

  logExecutionEvent(executionId, "started", {
    trigger_source: triggerSource,
    run_date: runDate,
  });

  const { data, error } = await supabase
    .from("news_daily_generation_runs")
    .insert({
      execution_id: executionId,
      run_date: runDate,
      trigger_source: triggerSource,
      status: "running",
      current_stage: "started",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    logExecutionError(executionId, "run_insert_failed", error);
  } else {
    ctx.rowId = (data as { id: string }).id;
  }

  return ctx;
}

export async function updateGenerationRunStage(
  ctx: GenerationRunContext,
  stage: string,
  patch: Record<string, unknown> = {}
): Promise<void> {
  logExecutionEvent(ctx.executionId, stage, patch);
  if (!ctx.rowId) return;

  await ctx.supabase
    .from("news_daily_generation_runs")
    .update({
      current_stage: stage,
      updated_at: new Date().toISOString(),
      ...patch,
    })
    .eq("id", ctx.rowId);
}

export async function finishGenerationRun(
  ctx: GenerationRunContext,
  args: {
    status: GenerationRunStatus;
    currentStage: string;
    newsCount?: number;
    scriptGenerated?: boolean;
    audioGenerated?: boolean;
    audioUrl?: string | null;
    notificationSuccessCount?: number;
    notificationFailureCount?: number;
    errorMessage?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const durationMs = Date.now() - ctx.startedAt;
  logExecutionEvent(ctx.executionId, args.currentStage, {
    status: args.status,
    duration_ms: durationMs,
    notification_success_count: args.notificationSuccessCount ?? 0,
    notification_failure_count: args.notificationFailureCount ?? 0,
    script_generated: args.scriptGenerated ?? false,
    audio_generated: args.audioGenerated ?? false,
    audio_url: args.audioUrl ?? null,
    error_message: args.errorMessage ?? null,
    ...(args.metadata ?? {}),
  });

  if (!ctx.rowId) return;

  await ctx.supabase
    .from("news_daily_generation_runs")
    .update({
      status: args.status,
      current_stage: args.currentStage,
      news_count: args.newsCount ?? null,
      script_generated: args.scriptGenerated ?? false,
      audio_generated: args.audioGenerated ?? false,
      audio_url: args.audioUrl ?? null,
      notification_success_count: args.notificationSuccessCount ?? 0,
      notification_failure_count: args.notificationFailureCount ?? 0,
      error_message: args.errorMessage?.slice(0, 2000) ?? null,
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      metadata: args.metadata ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq("id", ctx.rowId);
}
