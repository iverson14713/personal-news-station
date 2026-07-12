/**
 * iOS 內購恢復購買（Capacitor / StoreKit）
 * Web 與本機瀏覽器僅顯示提示，不寫入正式 Pro 狀態。
 */

import { applyRestoredPurchase, clearPurchaseProStatus, getProStatus, isProActive, sanitizeNonIapProUnlocks, type ProStatus } from "./pro";
import { PRO_IAP_PRODUCT_IDS, type ProPlanTier } from "./proPricing";
import { resolveSilentEntitlementOutcome } from "../shared/silentEntitlement.mjs";
import {
  logPrefSync,
  recordSilentEntitlementDiagnostics,
  type SilentEntitlementResult,
} from "./prefSyncTrace";

export const RESTORE_WEB_MESSAGE = "此功能會在 iOS App 內啟用";
export const PURCHASE_WEB_MESSAGE = "正式付款將在 iOS App 內啟用";
export const PURCHASE_CANCELLED_MESSAGE = "已取消訂閱";
export const PURCHASE_PRODUCT_NOT_FOUND_MESSAGE =
  "找不到訂閱商品，請確認 App Store Connect 商品 ID 是否正確";
const PURCHASE_FAILED_MESSAGE = "訂閱失敗，請稍後再試";
const NO_PURCHASES_MESSAGE = "找不到可恢復的購買紀錄";
const RESTORE_FAILED_MESSAGE = "恢復購買失敗，請稍後再試";
const RESTORE_SUCCESS_MESSAGE = "已成功恢復 Pro 訂閱";
const PURCHASE_SYNC_FAILED_MESSAGE =
  "訂閱已完成，但狀態同步失敗，請點擊恢復購買";
const PRO_STORAGE_KEY = "pns_pro_status_v1";

/** App Store 訂閱 product id（與 iOS 專案一致） */
export const PRO_SUBSCRIPTION_PRODUCT_IDS = [
  PRO_IAP_PRODUCT_IDS.monthly,
  PRO_IAP_PRODUCT_IDS.yearly,
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
  productId?: string;
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
      productId,
    };

    const rank = expiresAtMs ?? Number.MAX_SAFE_INTEGER;
    if (!best || rank > best.expiresAtMs) {
      best = { payload, expiresAtMs: rank };
    }
  }

  return best?.payload ?? null;
}

function isEmptyPurchasesError(error: unknown): boolean {
  const msg = extractErrorMessage(error).toLowerCase();
  return (
    msg.includes("no purchase") ||
    msg.includes("no purchases") ||
    msg.includes("empty") ||
    msg.includes("nothing to restore")
  );
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const o = error as { message?: unknown; errorMessage?: unknown };
    if (typeof o.message === "string" && o.message.trim()) return o.message;
    if (typeof o.errorMessage === "string" && o.errorMessage.trim()) {
      return o.errorMessage;
    }
  }
  return String(error);
}

function isProductNotFoundPurchaseError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("cannot find product") ||
    m.includes("product not found") ||
    (m.includes("product") && m.includes("not found"))
  );
}

function isUserCancelledPurchaseError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("user cancelled") ||
    m.includes("user canceled") ||
    m.includes("payment cancelled") ||
    m.includes("payment canceled") ||
    (m.includes("cancel") && m.includes("purchase"))
  );
}

function resolvePurchaseFailureMessage(error: unknown): string {
  const errMsg = extractErrorMessage(error);
  if (isProductNotFoundPurchaseError(errMsg)) {
    return PURCHASE_PRODUCT_NOT_FOUND_MESSAGE;
  }
  if (isUserCancelledPurchaseError(errMsg)) {
    return PURCHASE_CANCELLED_MESSAGE;
  }
  return PURCHASE_FAILED_MESSAGE;
}

type StoredProSnapshot = {
  proExpiresAt: string | null;
  proSource: ProStatus["proSource"];
};

function parseLocalProSnapshot(raw: string | null): StoredProSnapshot | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as {
      proExpiresAt?: unknown;
      proSource?: unknown;
    };
    const proExpiresAt =
      typeof o.proExpiresAt === "string" ? o.proExpiresAt : o.proExpiresAt === null ? null : null;
    const src = o.proSource;
    const proSource: ProStatus["proSource"] = src === "purchase" ? "purchase" : null;
    if (proExpiresAt == null && proSource == null) return null;
    return { proExpiresAt, proSource };
  } catch {
    return null;
  }
}

function readLocalSubscriptionSnapshot(): StoredProSnapshot | null {
  return parseLocalProSnapshot(readProStorageRaw());
}

function isLocalProStillActive(status: ProStatus): boolean {
  if (!status.isPro || !status.proExpiresAt) return false;
  return new Date(status.proExpiresAt).getTime() > Date.now();
}

function isLocalSubscriptionExpired(snapshot: StoredProSnapshot): boolean {
  if (!snapshot.proExpiresAt) return false;
  return new Date(snapshot.proExpiresAt).getTime() <= Date.now();
}

function logIapDebug(label: string, payload: unknown): void {
  if (!import.meta.env.DEV) return;
  console.log(`[IAP] ${label}:`, payload);
}

function logIapInfo(message: string, payload?: unknown): void {
  if (payload !== undefined) {
    console.log(`[IAP] ${message}`, payload);
    return;
  }
  console.log(`[IAP] ${message}`);
}

function readProStorageRaw(): string | null {
  try {
    return localStorage.getItem(PRO_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** StoreKit 寫入 Pro 後確認狀態 */
function commitRestoredProStatus(
  apply: () => ProStatus,
  logContext: string
): { ok: true; status: ProStatus } | { ok: false; status: ProStatus } {
  sanitizeNonIapProUnlocks();
  const applied = apply();
  const status = getProStatus();

  logIapDebug(`${logContext} result.status`, status);
  logIapDebug(`${logContext} pns_pro_status_v1 after`, readProStorageRaw());

  if (!isProActive(status)) {
    console.warn("[IAP] Pro status sync failed after StoreKit apply", {
      context: logContext,
      applied,
      status,
      pns_pro_status_v1: readProStorageRaw(),
    });
    return { ok: false, status };
  }

  return { ok: true, status };
}

async function tryCapGoNativePurchases(): Promise<RestorePayload | null> {
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
  let lastError: unknown = null;

  try {
    const fromCapGo = await tryCapGoNativePurchases();
    if (fromCapGo) return fromCapGo;
  } catch (error) {
    lastError = error;
  }

  try {
    const fromNativePurchases = await tryCapacitorPlugin("NativePurchases");
    if (fromNativePurchases) return fromNativePurchases;
  } catch (error) {
    lastError = error;
  }

  try {
    const fromProStoreKit = await tryCapacitorPlugin("ProStoreKit");
    if (fromProStoreKit) return fromProStoreKit;
  } catch (error) {
    lastError = error;
  }

  if (lastError) throw lastError;
  return null;
}

async function fetchCurrentEntitlementsSilent(): Promise<
  | { kind: "active"; payload: RestorePayload }
  | { kind: "none" }
  | { kind: "error"; message: string }
> {
  try {
    const mod = await import("@capgo/native-purchases");
    const { NativePurchases, PURCHASE_TYPE } = mod;

    if (typeof NativePurchases.isBillingSupported === "function") {
      const billing = await NativePurchases.isBillingSupported();
      if (!billing.isBillingSupported) {
        return { kind: "none" };
      }
    }

    const { purchases } = await NativePurchases.getPurchases({
      productType: PURCHASE_TYPE.SUBS,
      onlyCurrentEntitlements: true,
    });

    const payload = pickActiveProPurchase(purchases ?? []);
    if (payload) return { kind: "active", payload };
    return { kind: "none" };
  } catch (error) {
    return { kind: "error", message: extractErrorMessage(error) };
  }
}

export type SyncPurchasesOnLaunchResult = {
  ran: boolean;
  synced: boolean;
  productId?: string;
  status?: ProStatus;
  entitlementResult?: SilentEntitlementResult;
  skippedReason?: "not_ios";
  error?: string;
};

let launchSyncStarted = false;
let launchSyncPromise: Promise<SyncPurchasesOnLaunchResult> | null = null;

async function runSyncPurchasesOnLaunch(trigger = "app_launch"): Promise<SyncPurchasesOnLaunchResult> {
  const onIos = isCapacitorIos();
  logIapDebug("launch sync isCapacitorIos", onIos);

  const localBefore = getProStatus();
  logPrefSync("silent_entitlement_start", {
    trigger,
    proStatus: localBefore,
  });

  if (!onIos) {
    recordSilentEntitlementDiagnostics({
      result: "skipped_non_native",
      productId: null,
      expiresAt: null,
      lastError: null,
    });
    logPrefSync("silent_entitlement_result", {
      trigger,
      proStatus: localBefore,
      error: "skipped_non_native",
    });
    logIapInfo("launch sync skipped (not required)");
    return {
      ran: false,
      synced: false,
      skippedReason: "not_ios",
      entitlementResult: "skipped_non_native",
      status: localBefore,
    };
  }

  const query = await fetchCurrentEntitlementsSilent();

  if (query.kind === "error") {
    recordSilentEntitlementDiagnostics({
      result: "error",
      productId: null,
      expiresAt: null,
      lastError: query.message,
    });
    logPrefSync("silent_entitlement_error", {
      trigger,
      proStatus: localBefore,
      error: query.message,
    });
    logIapInfo("launch silent entitlement query failed; preserving local status", {
      error: query.message,
    });
    return {
      ran: true,
      synced: false,
      entitlementResult: "error",
      status: localBefore,
      error: query.message,
    };
  }

  const outcome = resolveSilentEntitlementOutcome({
    queryKind: query.kind,
    localStatus: localBefore,
    activePayload: query.kind === "active" ? query.payload : null,
  });

  if (query.kind === "active") {
    recordSilentEntitlementDiagnostics({
      result: "active",
      productId: query.payload.productId ?? null,
      expiresAt: query.payload.expiresAtIso ?? null,
      lastError: null,
    });
    logPrefSync("silent_entitlement_result", {
      trigger,
      proStatus: localBefore,
      entitlementProductId: query.payload.productId ?? null,
      expiresAt: query.payload.expiresAtIso ?? null,
    });
  } else {
    recordSilentEntitlementDiagnostics({
      result: "none",
      productId: null,
      expiresAt: null,
      lastError: null,
    });
    logPrefSync("silent_entitlement_result", {
      trigger,
      proStatus: localBefore,
    });
  }

  if (outcome.applyPurchase && query.kind === "active") {
    const committed = commitRestoredProStatus(
      () =>
        applyRestoredPurchase({
          expiresAtIso: query.payload.expiresAtIso,
          expiresAtMs: query.payload.expiresAtMs,
        }),
      "silent_entitlement"
    );
    const status = committed.ok ? committed.status : getProStatus();
    logPrefSync("local_pro_applied", {
      trigger,
      proStatus: status,
      entitlementProductId: query.payload.productId ?? null,
      expiresAt: query.payload.expiresAtIso ?? null,
    });
    return {
      ran: true,
      synced: committed.ok,
      productId: query.payload.productId,
      status,
      entitlementResult: "active",
    };
  }

  if (outcome.downgradePurchase) {
    const status = clearPurchaseProStatus();
    logPrefSync("local_pro_applied", {
      trigger,
      proStatus: status,
    });
    return {
      ran: true,
      synced: true,
      status,
      entitlementResult: "none",
    };
  }

  return {
    ran: true,
    synced: outcome.synced,
    status: getProStatus(),
    entitlementResult: query.kind,
  };
}

/** App 啟動時靜默讀取 StoreKit current entitlements（不 restore / 不 AppStore.sync） */
export async function syncPurchasesOnLaunch(): Promise<SyncPurchasesOnLaunchResult> {
  if (launchSyncStarted && launchSyncPromise) {
    return launchSyncPromise;
  }
  launchSyncStarted = true;
  launchSyncPromise = runSyncPurchasesOnLaunch("app_launch");
  return launchSyncPromise;
}

/** Hidden Dev：重新靜默檢查訂閱（不呼叫 restorePurchases） */
export async function refreshEntitlementsSilently(): Promise<SyncPurchasesOnLaunchResult> {
  return runSyncPurchasesOnLaunch("hidden_dev_manual");
}

export async function restorePurchases(): Promise<RestorePurchasesResult> {
  if (!isCapacitorIos()) {
    return { ok: false, message: RESTORE_WEB_MESSAGE };
  }

  logIapInfo("manual restore requested");

  try {
    const payload = await restorePurchasesOnIosNative();
    if (!payload) {
      return { ok: false, message: NO_PURCHASES_MESSAGE };
    }

    const committed = commitRestoredProStatus(
      () =>
        applyRestoredPurchase({
          expiresAtIso: payload.expiresAtIso,
          expiresAtMs: payload.expiresAtMs,
        }),
      "restore"
    );

    if (!committed.ok) {
      return { ok: false, message: PURCHASE_SYNC_FAILED_MESSAGE };
    }

    return { ok: true, message: RESTORE_SUCCESS_MESSAGE, status: committed.status };
  } catch (error) {
    if (isEmptyPurchasesError(error)) {
      return { ok: false, message: NO_PURCHASES_MESSAGE };
    }
    return { ok: false, message: RESTORE_FAILED_MESSAGE };
  }
}

/** 使用者手動重新驗證訂閱（等同 restorePurchases，會觸發 StoreKit） */
export async function reverifyProSubscription(): Promise<RestorePurchasesResult> {
  return restorePurchases();
}

export type PurchaseProResult =
  | { ok: true; message: string; status: ProStatus }
  | { ok: false; message: string };

export async function purchaseProSubscription(plan: ProPlanTier): Promise<PurchaseProResult> {
  const productId = PRO_IAP_PRODUCT_IDS[plan];
  const onIos = isCapacitorIos();

  logIapDebug("selected plan", plan);
  logIapDebug("productId", productId);
  logIapDebug("isCapacitorIos", onIos);

  if (!onIos) {
    const result: PurchaseProResult = { ok: false, message: PURCHASE_WEB_MESSAGE };
    logIapDebug("purchase result", result);
    return result;
  }

  try {
    const mod = await import("@capgo/native-purchases");
    const { NativePurchases, PURCHASE_TYPE } = mod;

    if (typeof NativePurchases.isBillingSupported === "function") {
      const billing = await NativePurchases.isBillingSupported();
      if (!billing.isBillingSupported) {
        const result: PurchaseProResult = { ok: false, message: PURCHASE_WEB_MESSAGE };
        logIapDebug("purchase result", result);
        return result;
      }
    }

    const transaction = await NativePurchases.purchaseProduct({
      productIdentifier: productId,
      productType: PURCHASE_TYPE.SUBS,
    });

    logIapDebug("purchase transaction", {
      productIdentifier: transaction.productIdentifier,
      expirationDate: transaction.expirationDate,
      isActive: transaction.isActive,
      environment: transaction.environment,
    });

    let expiresAtIso: string | null = null;
    if (transaction.expirationDate) {
      expiresAtIso = transaction.expirationDate;
    }

    const committed = commitRestoredProStatus(
      () => applyRestoredPurchase({ expiresAtIso }),
      "purchase"
    );

    if (!committed.ok) {
      const result: PurchaseProResult = {
        ok: false,
        message: PURCHASE_SYNC_FAILED_MESSAGE,
      };
      logIapDebug("purchase result", result);
      return result;
    }

    const result: PurchaseProResult = {
      ok: true,
      message: "訂閱成功",
      status: committed.status,
    };
    logIapDebug("purchase result", result);
    return result;
  } catch (error) {
    const message = resolvePurchaseFailureMessage(error);
    const result: PurchaseProResult = { ok: false, message };
    logIapDebug("purchase result", result);
    if (import.meta.env.DEV) {
      console.log("[IAP] purchase error:", extractErrorMessage(error), error);
    }
    return result;
  }
}
