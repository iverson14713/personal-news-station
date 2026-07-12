/**
 * Push token sync must not mutate product preference columns.
 * Shared by runtime checks and npm run test:push-preference-isolation
 */

export const PUSH_TOKEN_SYNC_FIELDS = new Set([
  "user_id",
  "push_token",
  "push_platform",
  "push_environment",
  "updated_at",
]);

export const GUARDED_PREFERENCE_FIELDS = [
  "topics",
  "custom_keywords",
  "display_name",
  "daily_radio_enabled",
  "daily_radio_time",
  "morning_radio_enabled",
  "evening_radio_enabled",
  "morning_radio_time",
  "evening_radio_time",
  "morning_duration_minutes",
  "evening_duration_minutes",
  "timezone",
  "voice_feature_enabled",
  "ai_anchor_id",
  "ai_anchor_voice",
  "ai_anchor_style",
  "ai_playback_rate",
];

/** @deprecated legacy full upsert payload — must never be sent from push sync */
export const LEGACY_PUSH_UPSERT_DEFAULTS = {
  daily_radio_enabled: true,
  daily_radio_time: "07:00",
  morning_radio_enabled: true,
  evening_radio_enabled: false,
  morning_radio_time: "07:00",
  evening_radio_time: "17:00",
  morning_duration_minutes: 3,
  evening_duration_minutes: 3,
};

export function buildPushTokenUpdatePayload({
  pushToken,
  pushPlatform,
  pushEnvironment,
  updatedAt,
}) {
  const patch = {
    push_token: pushToken,
    push_platform: pushPlatform,
    updated_at: updatedAt,
  };
  if (pushEnvironment === "sandbox" || pushEnvironment === "production") {
    patch.push_environment = pushEnvironment;
  }
  return patch;
}

export function pushPayloadTouchesPreferences(payload) {
  return GUARDED_PREFERENCE_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(payload, field));
}

export function preferenceFieldsUnchanged(before, after) {
  for (const field of GUARDED_PREFERENCE_FIELDS) {
    const a = before?.[field] ?? null;
    const b = after?.[field] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      return false;
    }
  }
  return true;
}

export function simulateLegacyPushUpsert(existingRow, patch) {
  return {
    ...existingRow,
    ...LEGACY_PUSH_UPSERT_DEFAULTS,
    ...patch,
  };
}

export function simulateIsolatedPushUpdate(existingRow, patch) {
  return {
    ...existingRow,
    ...patch,
  };
}
