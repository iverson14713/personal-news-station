/**
 * Pro 訂閱狀態與方案限制（本機模擬，結構預留 Supabase / IAP / Stripe）
 */

export type ProSource = "purchase" | "promo" | "manual" | null;

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
export const DEBUG_MODE_KEY = "pns_debug_mode";

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

/** 兌換碼 → 天數（之後可改為呼叫 /api/promo/redeem） */
export const PROMO_CODE_DAYS: Record<string, number> = {
  NEWSVIP30: 30,
  KOLNEWS90: 90,
  LAUNCH2026: 30,
  TESTPRO: 7,
};

type StoredPro = {
  proExpiresAt: string | null;
  proSource: ProSource;
};

function endOfLocalDayIso(d: Date): string {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
}

function parseStored(raw: string | null): StoredPro | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as {
      proExpiresAt?: unknown;
      proSource?: unknown;
    };
    const proExpiresAt =
      typeof o.proExpiresAt === "string" ? o.proExpiresAt : o.proExpiresAt === null ? null : null;
    const src = o.proSource;
    const proSource: ProSource =
      src === "purchase" || src === "promo" || src === "manual" ? src : null;
    return { proExpiresAt, proSource };
  } catch {
    return null;
  }
}

function migrateLegacyPlanTier(): StoredPro | null {
  try {
    if (localStorage.getItem(LEGACY_PLAN_TIER_KEY) === "pro") {
      const expires = endOfLocalDayIso(new Date(Date.now() + 30 * 86400000));
      return { proExpiresAt: expires, proSource: "manual" };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function computeIsPro(stored: StoredPro | null): boolean {
  if (!stored?.proExpiresAt) return false;
  return new Date(stored.proExpiresAt).getTime() > Date.now();
}

export function getProStatus(): ProStatus {
  let stored: StoredPro | null = null;
  try {
    stored = parseStored(localStorage.getItem(PRO_STORAGE_KEY));
    if (!stored) {
      stored = migrateLegacyPlanTier();
      if (stored) writeProStatusRaw(stored);
    }
  } catch {
    stored = null;
  }

  const isPro = computeIsPro(stored);
  if (!stored || !isPro) {
    return { isPro: false, proExpiresAt: stored?.proExpiresAt ?? null, proSource: null };
  }
  return {
    isPro: true,
    proExpiresAt: stored.proExpiresAt,
    proSource: stored.proSource,
  };
}

function writeProStatusRaw(stored: StoredPro) {
  try {
    localStorage.setItem(PRO_STORAGE_KEY, JSON.stringify(stored));
    localStorage.setItem(LEGACY_PLAN_TIER_KEY, computeIsPro(stored) ? "pro" : "free");
  } catch {
    /* ignore */
  }
}

export function writeProStatus(status: ProStatus) {
  if (!status.isPro) {
    writeProStatusRaw({ proExpiresAt: null, proSource: null });
    return;
  }
  writeProStatusRaw({
    proExpiresAt: status.proExpiresAt,
    proSource: status.proSource,
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

/** 由 iOS 內購恢復或正式訂閱寫入 Pro 狀態（不影響測試模式覆蓋） */
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
    if (current.isPro && current.proExpiresAt) {
      expiresAt = current.proExpiresAt;
    } else {
      expiresAt = endOfLocalDayIso(new Date(Date.now() + 35 * 86400000));
    }
  }

  const next: ProStatus = {
    isPro: true,
    proExpiresAt: expiresAt,
    proSource: "purchase",
  };
  writeProStatus(next);
  return getProStatus();
}

export function setPromoPro(days: number, source: ProSource = "promo"): ProStatus {
  const current = getProStatus();
  const base = current.isPro && current.proExpiresAt
    ? Math.max(Date.now(), new Date(current.proExpiresAt).getTime())
    : Date.now();
  const expires = endOfLocalDayIso(new Date(base + days * 86400000));
  const next: ProStatus = {
    isPro: true,
    proExpiresAt: expires,
    proSource: source,
  };
  writeProStatus(next);
  return next;
}

export type RedeemPromoResult =
  | { ok: true; status: ProStatus; message: string }
  | { ok: false; message: string };

/** 本機兌換；之後可改為 fetch('/api/promo/redeem', ...) */
export async function redeemPromoCode(code: string): Promise<RedeemPromoResult> {
  const normalized = code.trim().toUpperCase();
  const days = PROMO_CODE_DAYS[normalized];
  if (!days) {
    return { ok: false, message: "兌換碼無效或已過期" };
  }
  const status = setPromoPro(days, "promo");
  const until = formatProExpiresAt(status.proExpiresAt);
  return {
    ok: true,
    status,
    message: `兌換成功，已解鎖 Pro 到 ${until}`,
  };
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
  if (source === "promo") return "兌換碼";
  if (source === "purchase") return "訂閱";
  if (source === "manual") return "手動";
  return null;
}

export function syncProDebugModeFromUrl(): boolean {
  try {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("debug") === "1") {
        localStorage.setItem(DEBUG_MODE_KEY, "1");
      }
    }
  } catch {
    /* ignore */
  }
  return isProDebugToolsVisible();
}

export function isProDebugToolsVisible(): boolean {
  try {
    if (import.meta.env.DEV) return true;
    if (typeof window !== "undefined") {
      if (new URLSearchParams(window.location.search).get("debug") === "1") {
        return true;
      }
      if (localStorage.getItem(DEBUG_MODE_KEY) === "1") return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function resetProTestState(): void {
  try {
    localStorage.removeItem(PRO_STORAGE_KEY);
    localStorage.removeItem(LEGACY_PLAN_TIER_KEY);
  } catch {
    /* ignore */
  }
}

export function clearProForDebug() {
  resetProTestState();
}
