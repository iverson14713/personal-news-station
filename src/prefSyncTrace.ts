/**
 * [PREF_SYNC] preference / entitlement / push token sync diagnostics.
 * Never log full push tokens, receipts, or Apple account data.
 */

import type { ProSource, ProStatus } from "./pro";
import type { PushEnvironment } from "./plugins/pushEnvironment";

export type PrefSyncEvent =
  | "silent_entitlement_start"
  | "silent_entitlement_result"
  | "silent_entitlement_error"
  | "local_pro_applied"
  | "preference_sync_start"
  | "preference_sync_success"
  | "preference_sync_error"
  | "push_token_sync_start"
  | "push_token_sync_success"
  | "push_token_sync_verified_no_preference_change";

export type SilentEntitlementResult =
  | "active"
  | "none"
  | "error"
  | "skipped_non_native";

export type PrefSyncLogEntry = {
  event: PrefSyncEvent;
  trigger: string;
  userIdPrefix: string | null;
  localPro: boolean | null;
  proSource: ProSource | null;
  entitlementProductId: string | null;
  expiresAt: string | null;
  anchor: string | null;
  morningDuration: number | null;
  eveningEnabled: boolean | null;
  eveningDuration: number | null;
  pushTokenPrefix: string | null;
  pushEnvironment: PushEnvironment | null;
  preferenceFieldsChanged: boolean | null;
  error: string | null;
  timestamp: string;
};

export type SilentEntitlementDiagnostics = {
  lastCheckedAt: string | null;
  result: SilentEntitlementResult | null;
  productId: string | null;
  expiresAt: string | null;
  lastError: string | null;
};

export type PushTokenSyncDiagnostics = {
  lastSyncedAt: string | null;
  lastPreferenceFieldsChanged: boolean | null;
  lastTokenPrefix: string | null;
};

const silentEntitlementDiagnostics: SilentEntitlementDiagnostics = {
  lastCheckedAt: null,
  result: null,
  productId: null,
  expiresAt: null,
  lastError: null,
};

const pushTokenSyncDiagnostics: PushTokenSyncDiagnostics = {
  lastSyncedAt: null,
  lastPreferenceFieldsChanged: null,
  lastTokenPrefix: null,
};

let lastPreferenceSyncAt: string | null = null;
let lastPreferenceSyncError: string | null = null;
let lastSyncedTimezone: string | null = null;

export function getSilentEntitlementDiagnostics(): SilentEntitlementDiagnostics {
  return { ...silentEntitlementDiagnostics };
}

export function getPushTokenSyncDiagnostics(): PushTokenSyncDiagnostics {
  return { ...pushTokenSyncDiagnostics };
}

export function getLastPreferenceSyncAt(): string | null {
  return lastPreferenceSyncAt;
}

export function getLastPreferenceSyncError(): string | null {
  return lastPreferenceSyncError;
}

export function getLastSyncedTimezone(): string | null {
  return lastSyncedTimezone;
}

export function setLastSyncedTimezone(timezone: string): void {
  lastSyncedTimezone = timezone;
}

export function recordSilentEntitlementDiagnostics(
  patch: Partial<SilentEntitlementDiagnostics> & { result: SilentEntitlementResult }
): void {
  Object.assign(silentEntitlementDiagnostics, {
    lastCheckedAt: new Date().toISOString(),
    ...patch,
  });
}

export function recordPushTokenSyncDiagnostics(
  patch: Partial<PushTokenSyncDiagnostics>
): void {
  Object.assign(pushTokenSyncDiagnostics, {
    lastSyncedAt: new Date().toISOString(),
    ...patch,
  });
}

export function recordPreferenceSyncResult(ok: boolean, error?: string | null): void {
  lastPreferenceSyncAt = new Date().toISOString();
  lastPreferenceSyncError = ok ? null : error ?? "unknown";
}

export type PrefSyncLogInput = {
  trigger: string;
  userId?: string | null;
  proStatus?: ProStatus | null;
  entitlementProductId?: string | null;
  expiresAt?: string | null;
  anchor?: string | null;
  morningDuration?: number | null;
  eveningEnabled?: boolean | null;
  eveningDuration?: number | null;
  pushToken?: string | null;
  pushEnvironment?: PushEnvironment | null;
  preferenceFieldsChanged?: boolean | null;
  error?: string | null;
};

export function logPrefSync(event: PrefSyncEvent, input: PrefSyncLogInput): void {
  const entry: PrefSyncLogEntry = {
    event,
    trigger: input.trigger,
    userIdPrefix: input.userId ? input.userId.slice(0, 8) : null,
    localPro: input.proStatus?.isPro ?? null,
    proSource: input.proStatus?.proSource ?? null,
    entitlementProductId: input.entitlementProductId ?? null,
    expiresAt: input.expiresAt ?? null,
    anchor: input.anchor ?? null,
    morningDuration: input.morningDuration ?? null,
    eveningEnabled: input.eveningEnabled ?? null,
    eveningDuration: input.eveningDuration ?? null,
    pushTokenPrefix: input.pushToken ? input.pushToken.slice(0, 12) : null,
    pushEnvironment: input.pushEnvironment ?? null,
    preferenceFieldsChanged: input.preferenceFieldsChanged ?? null,
    error: input.error ?? null,
    timestamp: new Date().toISOString(),
  };

  console.log("[PREF_SYNC]", entry);
}
