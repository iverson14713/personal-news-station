/**
 * 驗證 push_claimed_at / push_sent_at 分離邏輯（直接測 DB 原子 claim 條件）
 * 用法：SUPABASE_SERVICE_ROLE_KEY=... npm run test:push-delivery-claim
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(path) {
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* ignore */
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const url = process.env.VITE_SUPABASE_URL?.trim();
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const TEST_SCRIPT_ID = process.env.PUSH_CLAIM_TEST_SCRIPT_ID?.trim();

const PUSH_CLAIM_TTL_MS = 10 * 60 * 1000;
const SERVER_SOURCE = "server";

async function fetchRow(admin, scriptId) {
  const { data, error } = await admin
    .from("news_daily_radio_scripts")
    .select(
      "id, user_id, script_date, duration_minutes, radio_slot, push_sent_at, push_claimed_at, push_last_error"
    )
    .eq("id", scriptId)
    .single();
  if (error) throw error;
  return data;
}

async function tryClaim(admin, row) {
  const now = new Date().toISOString();
  const claimExpiresBefore = new Date(Date.now() - PUSH_CLAIM_TTL_MS).toISOString();
  const { data, error } = await admin
    .from("news_daily_radio_scripts")
    .update({
      push_claimed_at: now,
      push_last_attempt_at: now,
      updated_at: now,
    })
    .eq("user_id", row.user_id)
    .eq("script_date", row.script_date)
    .eq("duration_minutes", row.duration_minutes)
    .eq("generation_source", SERVER_SOURCE)
    .eq("radio_slot", row.radio_slot)
    .is("push_sent_at", null)
    .or(`push_claimed_at.is.null,push_claimed_at.lt.${claimExpiresBefore}`)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function restoreRow(admin, scriptId, snapshot) {
  await admin
    .from("news_daily_radio_scripts")
    .update({
      push_sent_at: snapshot.push_sent_at,
      push_claimed_at: snapshot.push_claimed_at,
      push_last_error: snapshot.push_last_error,
      push_last_attempt_at: snapshot.push_last_attempt_at ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", scriptId);
}

async function main() {
  if (!url || !serviceRole) {
    console.error("FAIL: need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!TEST_SCRIPT_ID) {
    console.error("FAIL: set PUSH_CLAIM_TEST_SCRIPT_ID to a test script uuid");
    process.exit(1);
  }

  const admin = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const snapshot = await fetchRow(admin, TEST_SCRIPT_ID);
  const results = [];

  const runCase = async (name, setup, expectedClaimed) => {
    await restoreRow(admin, TEST_SCRIPT_ID, snapshot);
    await setup();
    const row = await fetchRow(admin, TEST_SCRIPT_ID);
    const claimed = await tryClaim(admin, row);
    const ok = claimed === expectedClaimed;
    results.push([name, ok, `claimed=${claimed}, expected=${expectedClaimed}`]);
    return row;
  };

  // 1. null / null → can claim
  await runCase(
    "null sent + null claim → claim ok",
    async () => {
      await admin
        .from("news_daily_radio_scripts")
        .update({
          push_sent_at: null,
          push_claimed_at: null,
          push_last_error: null,
        })
        .eq("id", TEST_SCRIPT_ID);
    },
    true
  );

  // 2. claim 5 min ago → cannot claim
  await runCase(
    "claim 5 min ago → claim blocked",
    async () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      await admin
        .from("news_daily_radio_scripts")
        .update({
          push_sent_at: null,
          push_claimed_at: fiveMinAgo,
          push_last_error: null,
        })
        .eq("id", TEST_SCRIPT_ID);
    },
    false
  );

  // 3. claim 15 min ago → can reclaim
  await runCase(
    "claim 15 min ago → reclaim ok",
    async () => {
      const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      await admin
        .from("news_daily_radio_scripts")
        .update({
          push_sent_at: null,
          push_claimed_at: fifteenMinAgo,
          push_last_error: null,
        })
        .eq("id", TEST_SCRIPT_ID);
    },
    true
  );

  // 4. push_sent_at set → cannot claim
  await runCase(
    "push_sent_at already set → claim blocked",
    async () => {
      await admin
        .from("news_daily_radio_scripts")
        .update({
          push_sent_at: new Date().toISOString(),
          push_claimed_at: null,
        })
        .eq("id", TEST_SCRIPT_ID);
    },
    false
  );

  await restoreRow(admin, TEST_SCRIPT_ID, snapshot);

  console.log("\n=== Push Delivery Claim Tests ===\n");
  for (const [name, ok, detail] of results) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    console.log(`       ${detail}`);
  }
  console.log("");
  console.log("Note: APNs success/failure paths are covered by Edge Function code review + deploy.");
  console.log("Restore snapshot applied after tests.\n");

  const failed = results.some((r) => !r[1]);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
