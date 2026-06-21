import { getProStatus, type ProStatus } from "./pro";

export type TestPlanValue = "free" | "pro";

export const TEST_PLAN_STORAGE_KEY = "news_station_test_plan";

const TEST_MODE_PASSWORDS = ["Ａ126452345", "A126452345"] as const;

export type EffectivePlan = {
  isPro: boolean;
  realStatus: ProStatus;
  effectiveStatus: ProStatus;
  testPlan: TestPlanValue | null;
  hasTestOverride: boolean;
};

export function getTestPlan(): TestPlanValue | null {
  try {
    const raw = localStorage.getItem(TEST_PLAN_STORAGE_KEY);
    if (raw === "free" || raw === "pro") return raw;
  } catch {
    /* ignore */
  }
  return null;
}

export function setTestPlan(plan: TestPlanValue): void {
  try {
    localStorage.setItem(TEST_PLAN_STORAGE_KEY, plan);
  } catch {
    /* ignore */
  }
}

export function clearTestPlan(): void {
  try {
    localStorage.removeItem(TEST_PLAN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function verifyTestModePassword(input: string): boolean {
  const normalized = input.trim();
  return TEST_MODE_PASSWORDS.some((p) => p === normalized);
}

function buildEffectiveStatus(realStatus: ProStatus, testPlan: TestPlanValue | null): ProStatus {
  if (testPlan === "pro") {
    return {
      isPro: true,
      proExpiresAt: realStatus.proExpiresAt,
      proSource: realStatus.proSource ?? "manual",
    };
  }
  if (testPlan === "free") {
    return { isPro: false, proExpiresAt: null, proSource: null };
  }
  return realStatus;
}

/** 正式 Pro 狀態 + 本機測試覆蓋 → 全站 UI / 限制判斷用 */
export function getEffectivePlan(): EffectivePlan {
  const realStatus = getProStatus();
  const testPlan = getTestPlan();
  const effectiveStatus = buildEffectiveStatus(realStatus, testPlan);
  return {
    isPro: effectiveStatus.isPro,
    realStatus,
    effectiveStatus,
    testPlan,
    hasTestOverride: testPlan !== null,
  };
}

/** @deprecated 請改用 getEffectivePlan().effectiveStatus */
export function getEffectiveProStatus(): ProStatus {
  return getEffectivePlan().effectiveStatus;
}
