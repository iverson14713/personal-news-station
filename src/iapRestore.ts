/**
 * iOS 內購恢復購買（Capacitor / StoreKit）
 * Web 與本機瀏覽器僅顯示提示，不寫入正式 Pro 狀態。
 */

import { applyRestoredPurchase, type ProStatus } from "./pro";

export const RESTORE_WEB_MESSAGE = "此功能會在 iOS App 內啟用";
const NO_PURCHASES_MESSAGE = "找不到可恢復的購買紀錄";
const RESTORE_FAILED_MESSAGE = "恢復購買失敗，請稍後再試";
const RESTORE_SUCCESS_MESSAGE = "已成功恢復 Pro 訂閱";

/** App Store 訂閱 product id（與 iOS 專案一致） */
export const PRO_SUBSCRIPTION_PRODUCT_IDS = [
  "com.wayne.personalnews.pro.monthly",
  "com.wayne.personalnews.pro.yearly",
] as const;

export type RestorePurchasesResult =
  | { ok: true; message: string; status: ProStatus }
  | { ok: false; message: string };

type CapacitorGlobal = {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, CapacitorIapPlugin | undefined>;
};

type CapacitorIapPlugin = {
  restorePurchases?: () => Promise<unknown>;
  getPurchases?: (options?: { productType?: string }) => Promise<unknown>;
  isBillingSupported?: () => Promise<{ isSupported?: boolean } | boolean>;
};

type RestorePayload = {
  expiresAtMs?: number;
  expiresAtIso?: string | null;
};

type PurchaseRecord = {
  productIdentifier?: string;
  productId?: string;
  expirationDate?: string | number;
  expiresDate?: string | number;
  isActive?: boolean;
};

export function isCapacitorIos(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const cap = (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
    if (!cap) return false;
    if (typeof cap.isNativePlatform === "function" && !cap.isNativePlatform()) {
      return false;
    }
    if (typeof cap.getPlatform === "function") {
      return cap.getPlatform() === "ios";
    }
  } catch {
    /* ignore */
  }
  return false;
}

function getCapacitorPlugins(): Record<string, CapacitorIapPlugin | undefined> | null {
  try {
    const cap = (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
    return cap?.Plugins ?? null;
  } catch {
    return null;
  }
}

function isProProductId(id: string | undefined): id is (typeof PRO_SUBSCRIPTION_PRODUCT_IDS)[number] {
  if (!id) return false;
  return (PRO_SUBSCRIPTION_PRODUCT_IDS as readonly string[]).includes(id);
}

function parseExpiryMs(record: PurchaseRecord): number | undefined {
  const raw = record.expirationDate ?? record.expiresDate;
  if (raw == null) return undefined;
  const ms = typeof raw === "number" ? raw : new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

function pickActiveProPurchase(purchases: PurchaseRecord[]): RestorePayload | null {
  const now = Date.now();
  let best: { payload: RestorePayload; expiresAtMs: number } | null = null;

  for (const purchase of purchases) {
    const productId = purchase.productIdentifier ?? purchase.productId;
    if (!isProProductId(productId)) continue;

    const expiresAtMs = parseExpiryMs(purchase);
    const active =
      purchase.isActive === true ||
      expiresAtMs == null ||
      expiresAtMs > now;

    if (!active) continue;

    const payload: RestorePayload = {
      expiresAtMs,
      expiresAtIso: expiresAtMs != null ? new Date(expiresAtMs).toISOString() : null,
    };

    const rank = expiresAtMs ?? Number.MAX_SAFE_INTEGER;
    if (!best || rank > best.expiresAtMs) {
      best = { payload, expiresAtMs: rank };
    }
  }

  return best?.payload ?? null;
}

function isEmptyPurchasesError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    msg.includes("no purchase") ||
    msg.includes("no purchases") ||
    msg.includes("not found") ||
    msg.includes("empty") ||
    msg.includes("nothing to restore")
  );
}

async function tryCapGoNativePurchases(): Promise<RestorePayload | null> {
  try {
    const mod = await import("@capgo/native-purchases");
    const { NativePurchases, PURCHASE_TYPE } = mod;

    if (typeof NativePurchases.isBillingSupported === "function") {
      const billing = await NativePurchases.isBillingSupported();
      if (!billing.isBillingSupported) return null;
    }

    await NativePurchases.restorePurchases();

    const { purchases } = await NativePurchases.getPurchases({
      productType: PURCHASE_TYPE.SUBS,
      onlyCurrentEntitlements: true,
    });

    return pickActiveProPurchase(purchases ?? []);
  } catch {
    return null;
  }
}

async function tryCapacitorPlugin(
  pluginName: string
): Promise<RestorePayload | null> {
  const plugins = getCapacitorPlugins();
  const plugin = plugins?.[pluginName];
  if (!plugin?.restorePurchases) return null;

  await plugin.restorePurchases();

  if (plugin.getPurchases) {
    const result = await plugin.getPurchases({ productType: "subs" });
    const purchases = normalizePurchaseList(result);
    const active = pickActiveProPurchase(purchases);
    if (active) return active;
  }

  return null;
}

function normalizePurchaseList(result: unknown): PurchaseRecord[] {
  if (Array.isArray(result)) return result as PurchaseRecord[];
  if (result && typeof result === "object") {
    const o = result as { purchases?: PurchaseRecord[]; items?: PurchaseRecord[] };
    if (Array.isArray(o.purchases)) return o.purchases;
    if (Array.isArray(o.items)) return o.items;
  }
  return [];
}

async function restorePurchasesOnIosNative(): Promise<RestorePayload | null> {
  const fromCapGo = await tryCapGoNativePurchases();
  if (fromCapGo) return fromCapGo;

  const fromNativePurchases = await tryCapacitorPlugin("NativePurchases");
  if (fromNativePurchases) return fromNativePurchases;

  const fromProStoreKit = await tryCapacitorPlugin("ProStoreKit");
  if (fromProStoreKit) return fromProStoreKit;

  return null;
}

export async function restorePurchases(): Promise<RestorePurchasesResult> {
  if (!isCapacitorIos()) {
    return { ok: false, message: RESTORE_WEB_MESSAGE };
  }

  try {
    const payload = await restorePurchasesOnIosNative();
    if (!payload) {
      return { ok: false, message: NO_PURCHASES_MESSAGE };
    }

    const status = applyRestoredPurchase({
      expiresAtIso: payload.expiresAtIso,
      expiresAtMs: payload.expiresAtMs,
    });

    return { ok: true, message: RESTORE_SUCCESS_MESSAGE, status };
  } catch (error) {
    if (isEmptyPurchasesError(error)) {
      return { ok: false, message: NO_PURCHASES_MESSAGE };
    }
    return { ok: false, message: RESTORE_FAILED_MESSAGE };
  }
}
