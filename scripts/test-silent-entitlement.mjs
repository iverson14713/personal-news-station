/**
 * Silent StoreKit entitlement refresh decision tests.
 * Usage: npm run test:silent-entitlement
 */

import {
  resolveSilentEntitlementOutcome,
  shouldCallAppStoreSyncOnLaunch,
  shouldCallRestoreOnLaunch,
} from "../shared/silentEntitlement.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    return true;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

let passed = 0;
let failed = 0;

function run(name, fn) {
  if (test(name, fn)) passed += 1;
  else failed += 1;
}

const freeLocal = { isPro: false, proExpiresAt: null, proSource: null };
const purchaseLocal = {
  isPro: true,
  proExpiresAt: "2026-08-01T00:00:00.000Z",
  proSource: "purchase",
};
const internalLocal = {
  isPro: true,
  proExpiresAt: null,
  proSource: "internal",
};

run("launch must not call restorePurchases", () => {
  assert(shouldCallRestoreOnLaunch() === false, "restore on launch");
});

run("launch must not call AppStore.sync", () => {
  assert(shouldCallAppStoreSyncOnLaunch() === false, "AppStore.sync on launch");
});

run("Case 4: monthly entitlement applies purchase without restore", () => {
  const outcome = resolveSilentEntitlementOutcome({
    queryKind: "active",
    localStatus: freeLocal,
    activePayload: {
      productId: "com.wayne.personalnews.pro.monthly",
      expiresAtIso: "2026-08-01T00:00:00.000Z",
    },
  });
  assert(outcome.applyPurchase === true, "should apply purchase");
  assert(outcome.status.proSource === "purchase", "pro source");
});

run("Case 5: yearly entitlement applies purchase", () => {
  const outcome = resolveSilentEntitlementOutcome({
    queryKind: "active",
    localStatus: freeLocal,
    activePayload: {
      productId: "com.wayne.personalnews.pro.yearly",
      expiresAtIso: "2027-07-01T00:00:00.000Z",
    },
  });
  assert(outcome.applyPurchase === true, "should apply purchase");
});

run("Case 6: no entitlement clears purchase pro only", () => {
  const outcome = resolveSilentEntitlementOutcome({
    queryKind: "none",
    localStatus: purchaseLocal,
    activePayload: null,
  });
  assert(outcome.downgradePurchase === true, "should clear purchase");
});

run("Case 6b: no entitlement keeps internal pro", () => {
  const outcome = resolveSilentEntitlementOutcome({
    queryKind: "none",
    localStatus: internalLocal,
    activePayload: null,
  });
  assert(outcome.downgradePurchase === false, "must not downgrade internal");
  assert(outcome.status.isPro === true, "internal pro preserved");
});

run("Case 7: API error preserves local purchase pro", () => {
  const outcome = resolveSilentEntitlementOutcome({
    queryKind: "error",
    localStatus: purchaseLocal,
    activePayload: null,
  });
  assert(outcome.action === "preserve_local", "should preserve");
  assert(outcome.downgradePurchase === false, "must not downgrade on error");
  assert(outcome.status.isPro === true, "local pro kept");
});

run("Case 8: new install free local + active entitlement applies purchase", () => {
  const outcome = resolveSilentEntitlementOutcome({
    queryKind: "active",
    localStatus: freeLocal,
    activePayload: {
      productId: "com.wayne.personalnews.pro.monthly",
      expiresAtIso: "2026-09-01T00:00:00.000Z",
    },
  });
  assert(outcome.applyPurchase === true, "auto restore without manual restore");
  assert(outcome.status.isPro === true, "becomes pro");
});

run("Case 9: manual restore path still compatible (active entitlement)", () => {
  const outcome = resolveSilentEntitlementOutcome({
    queryKind: "active",
    localStatus: freeLocal,
    activePayload: {
      productId: "com.wayne.personalnews.pro.monthly",
      expiresAtIso: "2026-08-15T00:00:00.000Z",
    },
  });
  assert(outcome.applyPurchase === true, "restore success applies");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
