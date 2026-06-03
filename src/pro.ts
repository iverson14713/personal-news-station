/**
 * Pro 訂閱狀態（本機模擬，結構預留 Supabase / IAP / Stripe）
 */

export type ProSource = "purchase" | "promo" | "manual" | null;

export type ProStatus = {
  isPro: boolean;
  proExpiresAt: string | null;
  proSource: ProSource;
};

const PRO_STORAGE_KEY = "pns_pro_status_v1";
const LEGACY_PLAN_TIER_KEY = "pns_plan_tier_v1";
export const DEBUG_MODE_KEY = "pns_debug_mode";

export const AI_DAILY_LIMIT_FREE = 3;
export const AI_DAILY_LIMIT_PRO = 20;

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

export function getAiDailyLimit(status?: ProStatus): number {
  return isProActive(status) ? AI_DAILY_LIMIT_PRO : AI_DAILY_LIMIT_FREE;
}

export function canUseFiveMinuteScript(status?: ProStatus): boolean {
  return isProActive(status);
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

/** 開發／測試工具是否可見 */
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

/** 僅清除 Pro 相關本機狀態，不影響收藏、主題、AI 歷史等 */
export function resetProTestState(): void {
  try {
    localStorage.removeItem(PRO_STORAGE_KEY);
    localStorage.removeItem(LEGACY_PLAN_TIER_KEY);
  } catch {
    /* ignore */
  }
}

/** @deprecated 請改用 resetProTestState */
export function clearProForDebug() {
  resetProTestState();
}
