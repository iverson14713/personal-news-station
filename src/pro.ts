/**
 * Pro 訂閱狀態與方案限制
 * 正式 Pro：Apple IAP / Restore Purchases（優先）
 * 本機覆蓋：隱藏內部代碼（pns_internal_access_v2）
 */

import {
  isInternalAccessActive,
  readInternalAccess,
} from "./hiddenDevUnlock";

export type ProSource = "purchase" | "internal" | null;

export type ProStatus = {
  isPro: boolean;
  proExpiresAt: string | null;
  proSource: ProSource;
};

export type PlanLimits = {
  aiDailyLimit: number;
  topicLimit: number;
  customKeywordLimit: number;
  totalTrackingLimit: number;
  favoriteLimit: number;
  historyDays: number;
  fiveMinuteEnabled: boolean;
  deepModeEnabled: boolean;
  dailyInsightEnabled: boolean;
};

const PRO_STORAGE_KEY = "pns_pro_status_v1";
const LEGACY_PLAN_TIER_KEY = "pns_plan_tier_v1";
const TEST_PLAN_STORAGE_KEY = "news_station_test_plan";
const DEBUG_MODE_KEY = "pns_debug_mode";

const FREE_LIMITS: PlanLimits = {
  aiDailyLimit: 2,
  topicLimit: 3,
  customKeywordLimit: 1,
  totalTrackingLimit: 4,
  favoriteLimit: 20,
  historyDays: 7,
  fiveMinuteEnabled: false,
  deepModeEnabled: false,
  dailyInsightEnabled: false,
};

const PRO_LIMITS: PlanLimits = {
  aiDailyLimit: 10,
  topicLimit: 5,
  customKeywordLimit: 5,
  totalTrackingLimit: 10,
  favoriteLimit: 500,
  historyDays: 180,
  fiveMinuteEnabled: true,
  deepModeEnabled: true,
  dailyInsightEnabled: true,
};

/** @deprecated 請改用 getPlanLimits */
export const AI_DAILY_LIMIT_FREE = FREE_LIMITS.aiDailyLimit;
/** @deprecated 請改用 getPlanLimits */
export const AI_DAILY_LIMIT_PRO = PRO_LIMITS.aiDailyLimit;

type StoredPro = {
  proExpiresAt: string | null;
  proSource: "purchase" | null;
};

function endOfLocalDayIso(d: Date): string {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
}

function parseStoredPurchase(raw: string | null): StoredPro | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as {
      proExpiresAt?: unknown;
      proSource?: unknown;
    };
    const proExpiresAt =
      typeof o.proExpiresAt === "string" ? o.proExpiresAt : o.proExpiresAt === null ? null : null;
    const proSource: StoredPro["proSource"] = o.proSource === "purchase" ? "purchase" : null;
    if (proExpiresAt == null && proSource == null) return null;
    return { proExpiresAt, proSource };
  } catch {
    return null;
  }
}

function isPurchaseActive(stored: StoredPro | null): boolean {
  if (!stored?.proExpiresAt || stored.proSource !== "purchase") return false;
  return new Date(stored.proExpiresAt).getTime() > Date.now();
}

function writePurchaseStatusRaw(stored: StoredPro) {
  try {
    localStorage.setItem(PRO_STORAGE_KEY, JSON.stringify(stored));
    localStorage.setItem(LEGACY_PLAN_TIER_KEY, isPurchaseActive(stored) ? "pro" : "free");
  } catch {
    /* ignore */
  }
}

/** 清除舊版 promo / test 覆蓋；保留 pns_internal_access_v2 */
export function sanitizeNonIapProUnlocks(): void {
  try {
    localStorage.removeItem(TEST_PLAN_STORAGE_KEY);
    localStorage.removeItem(DEBUG_MODE_KEY);
    const stored = parseStoredPurchase(localStorage.getItem(PRO_STORAGE_KEY));
    if (stored && stored.proSource !== "purchase") {
      writePurchaseStatusRaw({ proExpiresAt: null, proSource: null });
    }
    if (localStorage.getItem(LEGACY_PLAN_TIER_KEY) === "pro") {
      const purchase = parseStoredPurchase(localStorage.getItem(PRO_STORAGE_KEY));
      if (!isPurchaseActive(purchase) && !isInternalAccessActive()) {
        localStorage.removeItem(LEGACY_PLAN_TIER_KEY);
      }
    }
  } catch {
    /* ignore */
  }
}

export function getProStatus(): ProStatus {
  sanitizeNonIapProUnlocks();

  let purchaseStored: StoredPro | null = null;
  try {
    purchaseStored = parseStoredPurchase(localStorage.getItem(PRO_STORAGE_KEY));
  } catch {
    purchaseStored = null;
  }

  if (purchaseStored && isPurchaseActive(purchaseStored)) {
    return {
      isPro: true,
      proExpiresAt: purchaseStored.proExpiresAt,
      proSource: "purchase",
    };
  }

  if (isInternalAccessActive()) {
    const internal = readInternalAccess();
    return {
      isPro: true,
      proExpiresAt: internal?.expiresAt ?? null,
      proSource: "internal",
    };
  }

  return {
    isPro: false,
    proExpiresAt: purchaseStored?.proExpiresAt ?? null,
    proSource: null,
  };
}

export function writeProStatus(status: ProStatus) {
  if (!status.isPro || status.proSource !== "purchase") {
    writePurchaseStatusRaw({ proExpiresAt: null, proSource: null });
    return;
  }
  writePurchaseStatusRaw({
    proExpiresAt: status.proExpiresAt,
    proSource: "purchase",
  });
}

export function isProActive(status?: ProStatus): boolean {
  const s = status ?? getProStatus();
  return s.isPro;
}

export function getPlanLimits(status?: ProStatus): PlanLimits {
  return isProActive(status) ? { ...PRO_LIMITS } : { ...FREE_LIMITS };
}

export function getAiDailyLimit(status?: ProStatus): number {
  return getPlanLimits(status).aiDailyLimit;
}

export function canUseFiveMinuteScript(status?: ProStatus): boolean {
  return getPlanLimits(status).fiveMinuteEnabled;
}

export function getTotalTrackingCount(topicCount: number, keywordCount: number): number {
  return topicCount + keywordCount;
}

export function canAddTrackingTopic(
  topicCount: number,
  keywordCount: number,
  status?: ProStatus
): boolean {
  const limits = getPlanLimits(status);
  return (
    topicCount < limits.topicLimit &&
    topicCount + keywordCount < limits.totalTrackingLimit
  );
}

export function canAddTrackingKeyword(
  topicCount: number,
  keywordCount: number,
  status?: ProStatus
): boolean {
  const limits = getPlanLimits(status);
  return (
    keywordCount < limits.customKeywordLimit &&
    topicCount + keywordCount < limits.totalTrackingLimit
  );
}

export function canAddTopic(
  currentCount: number,
  status?: ProStatus,
  keywordCount = 0
): boolean {
  return canAddTrackingTopic(currentCount, keywordCount, status);
}

export function canAddCustomKeyword(
  currentCount: number,
  status?: ProStatus,
  topicCount = 0
): boolean {
  return canAddTrackingKeyword(topicCount, currentCount, status);
}

export function clampTrackingToPlan(
  topics: string[],
  keywords: string[],
  status?: ProStatus
): { topics: string[]; keywords: string[] } {
  const limits = getPlanLimits(status);
  let nextTopics = topics.slice(0, limits.topicLimit);
  let nextKeywords = keywords.slice(0, limits.customKeywordLimit);
  while (nextTopics.length + nextKeywords.length > limits.totalTrackingLimit) {
    if (nextTopics.length >= nextKeywords.length && nextTopics.length > 0) {
      nextTopics = nextTopics.slice(0, -1);
    } else if (nextKeywords.length > 0) {
      nextKeywords = nextKeywords.slice(0, -1);
    } else {
      break;
    }
  }
  return { topics: nextTopics, keywords: nextKeywords };
}

export function canUseDailyInsight(status?: ProStatus): boolean {
  return getPlanLimits(status).dailyInsightEnabled;
}

export function canAddFavorite(currentCount: number, status?: ProStatus): boolean {
  return currentCount < getPlanLimits(status).favoriteLimit;
}

export function getHistoryVisibleSince(status?: ProStatus): number {
  const days = getPlanLimits(status).historyDays;
  return Date.now() - days * 86400000;
}

export function filterHistoryByPlan<T extends { savedAt: number }>(
  entries: T[],
  status?: ProStatus
): T[] {
  const since = getHistoryVisibleSince(status);
  return entries.filter((e) => e.savedAt >= since);
}

export function canUseDeepMode(status?: ProStatus): boolean {
  return getPlanLimits(status).deepModeEnabled;
}

/** 由 iOS 內購恢復或正式訂閱寫入 Pro 狀態（優先於本機覆蓋） */
export function applyRestoredPurchase(options?: {
  expiresAtIso?: string | null;
  expiresAtMs?: number;
}): ProStatus {
  let expiresAt: string | null = null;

  if (options?.expiresAtIso) {
    expiresAt = options.expiresAtIso;
  } else if (options?.expiresAtMs != null && options.expiresAtMs > 0) {
    expiresAt = endOfLocalDayIso(new Date(options.expiresAtMs));
  } else {
    const current = getProStatus();
    if (current.isPro && current.proExpiresAt && current.proSource === "purchase") {
      expiresAt = current.proExpiresAt;
    } else {
      expiresAt = endOfLocalDayIso(new Date(Date.now() + 35 * 86400000));
    }
  }

  writePurchaseStatusRaw({
    proExpiresAt: expiresAt,
    proSource: "purchase",
  });
  return getProStatus();
}

export function formatProExpiresAt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

export function proSourceLabel(source: ProSource): string | null {
  if (source === "purchase") return "訂閱";
  if (source === "internal") return "已啟用";
  return null;
}
