/**
 * Push navigation diagnostics — Xcode Console: filter `[PUSH_NAV_TRACE]` or `[PUSH_NAV_BUILD]`
 */

export const PUSH_NAV_BUILD_MARKER = "2026-07-11-v2";
export const PUSH_NAV_IMPL_VERSION = "pending-nav-trace-v2";

const PENDING_STORAGE_KEY = "pns_pending_push_nav_trace_v1";
const TRACE_ID_STORAGE_KEY = "pns_push_nav_trace_id_v1";

export type PushNavTracePhase =
  | "app_boot"
  | "action_received"
  | "payload_parsed"
  | "payload_filtered_out"
  | "pending_saved"
  | "pending_restored"
  | "pending_storage_read"
  | "auth_state"
  | "bootstrap_state"
  | "flush_attempt"
  | "fetch_by_script_id_start"
  | "fetch_by_script_id_result"
  | "fallback_by_slot_start"
  | "fallback_by_slot_result"
  | "active_script_set"
  | "active_script_overwritten"
  | "tab_player_set"
  | "tab_set"
  | "generic_refresh_skipped"
  | "generic_refresh_started"
  | "pending_cleared"
  | "script_id_query_failed"
  | "listener_attached";

export type PushNavTraceFields = {
  traceId?: string | null;
  phase: PushNavTracePhase | string;
  scriptId?: string | null;
  requestedRadioSlot?: string | null;
  activeScriptId?: string | null;
  activeRadioSlot?: string | null;
  pendingExists?: boolean;
  pendingScriptId?: string | null;
  pendingRadioSlot?: string | null;
  authUserId?: string | null;
  bootstrapReady?: boolean;
  currentTab?: string | null;
  caller?: string | null;
  previousScriptId?: string | null;
  nextScriptId?: string | null;
  previousSlot?: string | null;
  nextSlot?: string | null;
  queryKind?: string | null;
  rowCount?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  hasAudioUrl?: boolean | null;
  status?: string | null;
  appState?: string | null;
  actionId?: string | null;
  payloadLayer?: string | null;
  modulePending?: boolean;
  storagePending?: boolean;
  extra?: Record<string, unknown>;
};

let currentTraceId: string | null = null;
let activeScriptIdTrace: string | null = null;
let activeRadioSlotTrace: string | null = null;

export function logPushNavBuildMarker(): void {
  console.log(
    `[PUSH_NAV_BUILD] ${PUSH_NAV_BUILD_MARKER} impl=${PUSH_NAV_IMPL_VERSION}`
  );
}

export function createPushNavTraceId(): string {
  const id = `pnv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  currentTraceId = id;
  try {
    sessionStorage.setItem(TRACE_ID_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

export function getCurrentPushNavTraceId(): string | null {
  if (currentTraceId) return currentTraceId;
  try {
    return sessionStorage.getItem(TRACE_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setActiveScriptTrace(scriptId: string | null, slot: string | null): void {
  const prevId = activeScriptIdTrace;
  const prevSlot = activeRadioSlotTrace;
  activeScriptIdTrace = scriptId;
  activeRadioSlotTrace = slot;
  if (prevId && scriptId && prevId !== scriptId) {
    logPushNavTrace({
      phase: "active_script_overwritten",
      previousScriptId: prevId,
      nextScriptId: scriptId,
      previousSlot: prevSlot,
      nextSlot: slot,
      caller: "setActiveScriptTrace",
    });
  } else {
    logPushNavTrace({
      phase: "active_script_set",
      activeScriptId: scriptId,
      activeRadioSlot: slot,
      caller: "setActiveScriptTrace",
    });
  }
}

export function getActiveScriptTrace(): {
  scriptId: string | null;
  radioSlot: string | null;
} {
  return { scriptId: activeScriptIdTrace, radioSlot: activeRadioSlotTrace };
}

export function persistPendingForTrace(payload: unknown): void {
  try {
    sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function readPersistedPendingForTrace(): unknown | null {
  try {
    const raw = sessionStorage.getItem(PENDING_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function clearPersistedPendingForTrace(): void {
  try {
    sessionStorage.removeItem(PENDING_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function userIdPrefix(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return userId.slice(0, 8);
}

export function scriptIdPrefix(scriptId: string | null | undefined): string | null {
  if (!scriptId) return null;
  return scriptId.slice(0, 8);
}

/** Safe key listing for Capacitor notification payloads (no token values). */
export function safeObjectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.keys(value as Record<string, unknown>).sort();
}

/** Redact token-like fields from payload for logging. */
export function sanitizePayloadForLog(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  if (Array.isArray(raw)) return raw.map(sanitizePayloadForLog);

  const obj = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("token") ||
      lower.includes("password") ||
      lower.includes("secret") ||
      lower.includes("authorization")
    ) {
      out[key] = "[redacted]";
      continue;
    }
    if (val && typeof val === "object") {
      out[key] = sanitizePayloadForLog(val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

/** Probe which layers contain daily_radio fields (diagnostic only). */
export function probePayloadLayers(raw: unknown): Record<string, unknown> {
  const probes: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object") return probes;

  const root = raw as Record<string, unknown>;
  probes.root_keys = safeObjectKeys(root);

  const notification = root.notification;
  if (notification && typeof notification === "object") {
    const n = notification as Record<string, unknown>;
    probes.notification_keys = safeObjectKeys(n);
    probes.notification_data_keys = safeObjectKeys(n.data);
    probes.notification_sanitized = sanitizePayloadForLog(n);
  }

  const data = root.data;
  if (data && typeof data === "object") {
    probes.action_data_keys = safeObjectKeys(data);
    probes.action_data_sanitized = sanitizePayloadForLog(data);
  }

  probes.action_keys = safeObjectKeys(root);
  probes.action_sanitized = sanitizePayloadForLog(root);

  return probes;
}

export function logPushNavTrace(fields: PushNavTraceFields): void {
  const traceId = fields.traceId ?? getCurrentPushNavTraceId();
  const entry = {
    event: "push_nav_trace",
    marker: PUSH_NAV_BUILD_MARKER,
    impl: PUSH_NAV_IMPL_VERSION,
    timestamp: new Date().toISOString(),
    traceId,
    phase: fields.phase,
    scriptId: fields.scriptId ?? null,
    scriptIdPrefix: scriptIdPrefix(fields.scriptId),
    requestedRadioSlot: fields.requestedRadioSlot ?? null,
    activeScriptId: fields.activeScriptId ?? activeScriptIdTrace,
    activeScriptIdPrefix: scriptIdPrefix(fields.activeScriptId ?? activeScriptIdTrace),
    activeRadioSlot: fields.activeRadioSlot ?? activeRadioSlotTrace,
    pendingExists: fields.pendingExists ?? null,
    pendingScriptId: fields.pendingScriptId ?? null,
    pendingRadioSlot: fields.pendingRadioSlot ?? null,
    authUserId: userIdPrefix(fields.authUserId),
    bootstrapReady: fields.bootstrapReady ?? null,
    currentTab: fields.currentTab ?? null,
    caller: fields.caller ?? null,
    previousScriptId: scriptIdPrefix(fields.previousScriptId),
    nextScriptId: scriptIdPrefix(fields.nextScriptId),
    previousSlot: fields.previousSlot ?? null,
    nextSlot: fields.nextSlot ?? null,
    queryKind: fields.queryKind ?? null,
    rowCount: fields.rowCount ?? null,
    errorCode: fields.errorCode ?? null,
    errorMessage: fields.errorMessage ?? null,
    hasAudioUrl: fields.hasAudioUrl ?? null,
    status: fields.status ?? null,
    appState: fields.appState ?? null,
    actionId: fields.actionId ?? null,
    payloadLayer: fields.payloadLayer ?? null,
    modulePending: fields.modulePending ?? null,
    storagePending: fields.storagePending ?? null,
    extra: fields.extra ?? null,
  };
  console.log(`[PUSH_NAV_TRACE] ${fields.phase}`, JSON.stringify(entry));
}
