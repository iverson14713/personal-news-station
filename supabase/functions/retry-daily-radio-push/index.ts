import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { retryDailyRadioPushForScript } from "../_shared/pushRetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type RetryPayload = {
  script_id?: string;
  target_user_id?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let payload: RetryPayload = {};
  try {
    payload = (await req.json()) as RetryPayload;
  } catch {
    /* empty body */
  }

  const scriptId = payload.script_id?.trim();
  if (!scriptId) {
    return new Response(JSON.stringify({ ok: false, error: "missing_script_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim();
  const cronHeader = req.headers.get("x-cron-secret");
  let authorized = false;

  if (cronSecret && cronHeader === cronSecret) {
    authorized = true;
  } else if (supabaseUrl && serviceKey) {
    const authHeader = req.headers.get("Authorization");
    const bearer = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";
    if (bearer) {
      const authClient = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: userData, error: userError } = await authClient.auth.getUser(bearer);
      if (!userError && userData.user?.id) {
        const targetUserId = payload.target_user_id?.trim();
        if (!targetUserId || targetUserId === userData.user.id) {
          const admin = createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: script } = await admin
            .from("news_daily_radio_scripts")
            .select("user_id")
            .eq("id", scriptId)
            .maybeSingle();
          if (script?.user_id === userData.user.id) {
            authorized = true;
          }
        }
      }
    }
  }

  if (!authorized) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ ok: false, error: "Missing Supabase env" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const result = await retryDailyRadioPushForScript(supabase, scriptId);

  return new Response(
    JSON.stringify({
      ok: result.ok,
      mode: "push_only_retry",
      ...result,
    }),
    {
      status: result.ok ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
