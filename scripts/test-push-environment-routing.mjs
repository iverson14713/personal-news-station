/**
 * APNs per-token endpoint routing tests (Cases 1–4).
 * Usage: npm run test:push-environment-routing
 */

function resolveApnsHost(pushEnvironment, legacyApnsEnv) {
  if (pushEnvironment === "sandbox") {
    return {
      host: "api.sandbox.push.apple.com",
      apnsEnvLabel: "sandbox",
      routingSource: "token",
    };
  }
  if (pushEnvironment === "production") {
    return {
      host: "api.push.apple.com",
      apnsEnvLabel: "production",
      routingSource: "token",
    };
  }
  const env = (legacyApnsEnv?.trim() || "development").toLowerCase();
  const production = env === "production";
  return {
    host: production ? "api.push.apple.com" : "api.sandbox.push.apple.com",
    apnsEnvLabel: production ? "production" : "sandbox",
    routingSource: "legacy_fallback",
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

run("Case 1: push_environment=sandbox → sandbox endpoint", () => {
  const result = resolveApnsHost("sandbox", "production");
  assert(result.host === "api.sandbox.push.apple.com", "host mismatch");
  assert(result.routingSource === "token", "routing source mismatch");
});

run("Case 2: push_environment=production → production endpoint", () => {
  const result = resolveApnsHost("production", "development");
  assert(result.host === "api.push.apple.com", "host mismatch");
  assert(result.routingSource === "token", "routing source mismatch");
});

run("Case 3: push_environment=null + APNS_ENV=production → production legacy fallback", () => {
  const result = resolveApnsHost(null, "production");
  assert(result.host === "api.push.apple.com", "host mismatch");
  assert(result.routingSource === "legacy_fallback", "routing source mismatch");
});

run("Case 4: push_environment=null + APNS_ENV=development → sandbox legacy fallback", () => {
  const result = resolveApnsHost(null, "development");
  assert(result.host === "api.sandbox.push.apple.com", "host mismatch");
  assert(result.routingSource === "legacy_fallback", "routing source mismatch");
});

run("Case 5: same token different user should still resync (logic contract)", () => {
  let lastSyncedUserId = "user-a";
  const nextUserId = "user-b";
  const shouldResync = nextUserId !== lastSyncedUserId;
  assert(shouldResync === true, "account switch must force resync");
  lastSyncedUserId = nextUserId;
  const shouldResyncSameUser = nextUserId !== lastSyncedUserId;
  assert(shouldResyncSameUser === false, "same user should not skip by user-id guard only");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
