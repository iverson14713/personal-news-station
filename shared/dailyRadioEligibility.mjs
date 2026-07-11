/**
 * 每日早報生成資格（Cron 名單 + slot 過濾）— Edge / Node 測試共用。
 */

/** Pro 唯一判斷來源：voice_feature_enabled */
export function isProUser(user) {
  return user?.voice_feature_enabled === true;
}

export function isVoiceFeatureEnabled(user) {
  return isProUser(user);
}

export function getUserSlots(user, options = {}) {
  const morningResolved = resolveAllowedAutoDuration(user?.morning_duration_minutes ?? 3, user ?? {});
  const eveningResolved = resolveAllowedAutoDuration(user?.evening_duration_minutes ?? 3, user ?? {});
  const morning = {
    slot: "morning",
    enabled: user?.morning_radio_enabled !== false,
    time: user?.morning_radio_time || user?.daily_radio_time || "07:00",
    duration: morningResolved.duration,
  };
  const evening = {
    slot: "evening",
    enabled: isProUser(user) && user?.evening_radio_enabled === true,
    time: user?.evening_radio_time || "17:00",
    duration: eveningResolved.duration,
  };
  let slots = [morning, evening].filter((s) => s.enabled);
  if (options.targetRadioSlot) {
    slots = slots.filter((s) => s.slot === options.targetRadioSlot);
  }
  return slots;
}

export function shouldAllowEveningDispatch(user, radioSlot) {
  if (radioSlot !== "evening") return { ok: true };
  if (!isProUser(user)) return { ok: false, reason: "free_evening_not_allowed" };
  return { ok: true };
}

export function shouldAllowEveningPush(user, radioSlot) {
  if (radioSlot !== "evening") return { ok: true };
  if (!isProUser(user)) return { ok: false, reason: "free_evening_push_not_allowed" };
  return { ok: true };
}

export function normalizeRequestedAutoDuration(duration) {
  return duration === 5 || duration === 10 ? duration : 3;
}

export function resolveAllowedAutoDuration(requestedDuration, user) {
  const requested = normalizeRequestedAutoDuration(requestedDuration);
  if (!isVoiceFeatureEnabled(user) && requested !== 3) {
    return { duration: 3, fallbackReason: "free_plan_auto_duration_limited_to_3" };
  }
  if (requestedDuration === 15) {
    return { duration: 3, fallbackReason: "15_min_auto_not_allowed" };
  }
  if (requestedDuration !== requested) {
    return { duration: requested, fallbackReason: "invalid_auto_duration_normalized" };
  }
  return { duration: requested, fallbackReason: null };
}

export function topicCount(user) {
  const topics = Array.isArray(user?.topics) ? user.topics : [];
  const keywords = Array.isArray(user?.custom_keywords) ? user.custom_keywords : [];
  return topics.length + keywords.length;
}

/** Cron 初始查詢：news_user_preferences WHERE daily_radio_enabled = true */
export function passesCronPreferencesQuery(user) {
  return user != null && user.daily_radio_enabled === true;
}

export function getMorningSlotConfig(user) {
  const resolved = resolveAllowedAutoDuration(user?.morning_duration_minutes ?? 3, user ?? {});
  return {
    slot: "morning",
    enabled: user?.morning_radio_enabled !== false,
    duration: resolved.duration,
    requestedDuration: user?.morning_duration_minutes ?? 3,
    time: user?.morning_radio_time || user?.daily_radio_time || "07:00",
  };
}

export function evaluateMorningGenerationEligibility(user, options = {}) {
  const { requireTopics = true, hasPushToken } = options;

  if (!user?.user_id) {
    return { eligible: false, exclusionReason: "missing_preferences_row" };
  }
  if (!passesCronPreferencesQuery(user)) {
    return { eligible: false, exclusionReason: "daily_radio_disabled" };
  }
  const morning = getMorningSlotConfig(user);
  if (!morning.enabled) {
    return { eligible: false, exclusionReason: "morning_disabled" };
  }
  if (![3, 5, 10].includes(morning.duration)) {
    return { eligible: false, exclusionReason: "invalid_duration" };
  }
  if (requireTopics && topicCount(user) === 0) {
    return { eligible: false, exclusionReason: "no_topics" };
  }
  if (hasPushToken === false) {
    return {
      eligible: true,
      exclusionReason: "eligible",
      note: "no_push_token_does_not_block_generation",
    };
  }
  return { eligible: true, exclusionReason: "eligible", morning };
}

/** App sync：update 0 rows 時應 fallback upsert */
export function shouldFallbackUpsert(updateRowCount) {
  return updateRowCount === 0;
}

export const AUTO_DURATION_RULES = {
  3: { targetMin: 5, targetMax: 8, min: 3, maxPerTopic: 3 },
  5: { targetMin: 7, targetMax: 10, min: 5, maxPerTopic: 4 },
  10: { targetMin: 10, targetMax: 15, min: 8, maxPerTopic: 5 },
};

/** 55dfc2e 回歸版：3 分鐘要求 min=5 則 Free 易被拒 */
export const AUTO_DURATION_RULES_REGRESSION_55dfc2e = {
  3: { targetMin: 5, targetMax: 8, min: 5, maxPerTopic: 3 },
  5: { targetMin: 8, targetMax: 12, min: 8, maxPerTopic: 4 },
  10: { targetMin: 15, targetMax: 20, min: 12, maxPerTopic: 5 },
};

export function hasEnoughNewsForDuration(duration, newsCount, rules = AUTO_DURATION_RULES) {
  return newsCount >= rules[duration].min;
}
