/**
 * 驗證 PetCare 共用 Supabase 上的 AI 新聞台後端
 * 用法：npm run test:supabase-daily-radio
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
const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();
const cronSecret = process.env.CRON_SECRET?.trim();
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

function todayYmd() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(
    new Date()
  );
}

async function main() {
  const results = [];

  if (!url || !anonKey) {
    console.error("FAIL: missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Anonymous sign-in
  const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
  if (authError || !authData.user?.id) {
    const msg = authError?.message ?? "no user";
    const hint =
      msg.includes("Anonymous sign-ins are disabled")
        ? " → Dashboard: Authentication → Providers → Anonymous Sign-In 啟用"
        : "";
    results.push(["anonymous sign-in", false, msg + hint]);
    printResults(results);
    process.exit(1);
  }
  const userId = authData.user.id;
  results.push(["anonymous sign-in", true, userId]);

  // 2. Upsert preferences
  const { error: prefError } = await supabase.from("news_user_preferences").upsert(
    {
      user_id: userId,
      topics: ["NBA", "BTC"],
      custom_keywords: ["台積電"],
      daily_radio_enabled: true,
      daily_radio_time: "07:00",
      timezone: "Asia/Taipei",
      display_name: "TestUser",
    },
    { onConflict: "user_id" }
  );
  results.push(["write news_user_preferences", !prefError, prefError?.message ?? "ok"]);

  // 3. App-generated script
  const today = todayYmd();
  const appScript = `測試早報 ${today}：這是一段 App fallback 測試稿件。`;
  const { data: appRow, error: appError } = await supabase
    .from("news_daily_radio_scripts")
    .upsert(
      {
        user_id: userId,
        script_date: today,
        duration_minutes: 3,
        title: "測試早報",
        script_text: appScript,
        source_news: [{ title: "測試新聞", source: "test" }],
        status: "completed",
        generation_source: "app",
        is_daily_auto: true,
      },
      { onConflict: "user_id,script_date,duration_minutes,generation_source" }
    )
    .select("id, generation_source")
    .single();
  results.push([
    "write news_daily_radio_scripts (app)",
    !appError && appRow?.generation_source === "app",
    appError?.message ?? appRow?.id ?? "ok",
  ]);

  // 4. Edge Function（需 CRON_SECRET 或已 deploy）
  if (cronSecret) {
    const fnRes = await fetch(`${url}/functions/v1/generate-daily-radio`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": cronSecret,
      },
      body: JSON.stringify({
        triggerSource: "manual",
        force: false,
        test: true,
      }),
    });
    const fnBody = await fnRes.json().catch(() => ({}));
    results.push([
      "edge function generate-daily-radio",
      fnRes.ok && fnBody.ok === true,
      fnRes.ok ? `processed=${fnBody.processed}` : JSON.stringify(fnBody).slice(0, 120),
    ]);

    if (serviceRole) {
      const admin = createClient(url, serviceRole, {
        auth: { persistSession: false },
      });
      const { data: serverRow } = await admin
        .from("news_daily_radio_scripts")
        .select("id, generation_source, status")
        .eq("user_id", userId)
        .eq("script_date", today)
        .eq("duration_minutes", 3)
        .maybeSingle();
      results.push([
        "server generated script exists",
        serverRow?.generation_source === "server" || serverRow?.status === "completed",
        serverRow ? `${serverRow.generation_source}/${serverRow.status}` : "not found",
      ]);
    }
  } else {
    results.push([
      "edge function generate-daily-radio",
      false,
      "skip: set CRON_SECRET in env to test",
    ]);
  }

  printResults(results);
  const failed = results.some((r) => !r[1]);
  process.exit(failed ? 1 : 0);
}

function printResults(rows) {
  console.log("\n=== Supabase Daily Radio Test ===\n");
  for (const [name, ok, detail] of rows) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (detail) console.log(`       ${detail}`);
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
