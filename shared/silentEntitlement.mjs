/**
 * Silent StoreKit entitlement refresh decision logic.
 * Shared by iapRestore and npm run test:silent-entitlement
 */

export function resolveSilentEntitlementOutcome({ queryKind, localStatus, activePayload }) {
  if (queryKind === "error") {
    return {
      action: "preserve_local",
      synced: false,
      downgradePurchase: false,
      applyPurchase: false,
      status: localStatus,
    };
  }

  if (queryKind === "skipped_non_native") {
    return {
      action: "skipped",
      synced: false,
      downgradePurchase: false,
      applyPurchase: false,
      status: localStatus,
    };
  }

  if (queryKind === "active" && activePayload) {
    return {
      action: "apply_purchase",
      synced: true,
      downgradePurchase: false,
      applyPurchase: true,
      status: {
        isPro: true,
        proExpiresAt: activePayload.expiresAtIso ?? null,
        proSource: "purchase",
      },
      productId: activePayload.productId ?? null,
    };
  }

  if (queryKind === "none") {
    if (localStatus?.proSource === "purchase" && localStatus?.isPro) {
      return {
        action: "clear_purchase",
        synced: true,
        downgradePurchase: true,
        applyPurchase: false,
        status: {
          isPro: false,
          proExpiresAt: localStatus.proExpiresAt ?? null,
          proSource: null,
        },
      };
    }

    return {
      action: "stay_free_or_internal",
      synced: false,
      downgradePurchase: false,
      applyPurchase: false,
      status: localStatus,
    };
  }

  return {
    action: "preserve_local",
    synced: false,
    downgradePurchase: false,
    applyPurchase: false,
    status: localStatus,
  };
}

export function shouldCallRestoreOnLaunch() {
  return false;
}

export function shouldCallAppStoreSyncOnLaunch() {
  return false;
}
