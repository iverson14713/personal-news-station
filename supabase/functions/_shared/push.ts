/**
 * 遠端 Push（後端生成完成後）
 *
 * iOS：Apple APNs HTTP/2（Supabase secrets）
 *   APNS_TEAM_ID, APNS_KEY_ID, APNS_PRIVATE_KEY (.p8 PEM，可含 \\n)
 *   APNS_BUNDLE_ID（預設 com.wayne.personalnews）
 *   APNS_ENV = development | production（legacy fallback when push_environment is null）
 */

export type PushStatus = "sent" | "failed" | "no_token";

export type PushSendResult = {
  push_status: PushStatus;
  push_error?: string;
};

export type PushEnvironment = "sandbox" | "production";

export type ApnsHostResolution = {
  host: string;
  apnsEnvLabel: "sandbox" | "production";
  routingSource: "token" | "legacy_fallback";
};

type ApnsConfig = {
  teamId: string;
  keyId: string;
  privateKeyPem: string;
  bundleId: string;
  host: string;
  apnsEnvLabel: "sandbox" | "production";
  routingSource: "token" | "legacy_fallback";
};

let cachedJwt: { token: string; expiresAt: number } | null = null;

function tokenPrefix(token: string): string {
  return token.slice(0, 12);
}

function normalizePrivateKey(raw: string): string {
  return raw.replace(/\\n/g, "\n").trim();
}

function readLegacyApnsEnv(): string {
  return (Deno.env.get("APNS_ENV")?.trim() || "development").toLowerCase();
}

/** Resolve APNs host from per-token push_environment, else legacy APNS_ENV. */
export function resolveApnsHost(
  pushEnvironment?: PushEnvironment | null,
  legacyApnsEnv?: string | null
): ApnsHostResolution {
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

  const env = (legacyApnsEnv?.trim() || readLegacyApnsEnv()).toLowerCase();
  const production = env === "production";
  return {
    host: production ? "api.push.apple.com" : "api.sandbox.push.apple.com",
    apnsEnvLabel: production ? "production" : "sandbox",
    routingSource: "legacy_fallback",
  };
}

async function importApnsPrivateKey(pem: string): Promise<CryptoKey> {
  const normalized = normalizePrivateKey(pem);
  const contents = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = Uint8Array.from(atob(contents), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binary,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

function encodeBase64Url(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createApnsJwt(config: ApnsConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.expiresAt > now + 60) {
    return cachedJwt.token;
  }

  const key = await importApnsPrivateKey(config.privateKeyPem);
  const headerObj = { alg: "ES256", kid: config.keyId };
  const payloadObj = { iss: config.teamId, iat: now };

  const header = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify(headerObj))
  );
  const payload = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify(payloadObj))
  );
  const signingInput = `${header}.${payload}`;
  const signatureDer = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signingInput)
    )
  );
  const signature = encodeBase64Url(signatureDer);

  const token = `${signingInput}.${signature}`;
  cachedJwt = { token, expiresAt: now + 3300 };
  return token;
}

function readApnsConfig(pushEnvironment?: PushEnvironment | null): ApnsConfig | null {
  const teamId = Deno.env.get("APNS_TEAM_ID")?.trim();
  const keyId = Deno.env.get("APNS_KEY_ID")?.trim();
  const privateKeyRaw = Deno.env.get("APNS_PRIVATE_KEY")?.trim();
  const bundleId =
    Deno.env.get("APNS_BUNDLE_ID")?.trim() || "com.wayne.personalnews";

  if (!teamId || !keyId || !privateKeyRaw) return null;

  const hostResolution = resolveApnsHost(pushEnvironment);

  return {
    teamId,
    keyId,
    privateKeyPem: normalizePrivateKey(privateKeyRaw),
    bundleId,
    host: hostResolution.host,
    apnsEnvLabel: hostResolution.apnsEnvLabel,
    routingSource: hostResolution.routingSource,
  };
}

export type RadioSlot = "morning" | "evening";

export type DailyRadioPushOptions = {
  radioSlot?: RadioSlot;
  scriptId?: string;
  anchorName?: string;
  hasAnchorAudio?: boolean;
  /** DB 已確認 audio_url 就緒；僅 audioReady 時送 AI 主播推播 */
  audioReady?: boolean;
  durationMinutes?: number;
  newsCount?: number;
  pushEnvironment?: PushEnvironment | null;
};

function resolveDisplayName(displayName?: string | null): string {
  const trimmed = displayName?.trim();
  return trimmed || "朋友";
}

function pushCopy(
  slot: RadioSlot,
  displayName: string | null | undefined,
  options: DailyRadioPushOptions
): { title: string; body: string } {
  const name = resolveDisplayName(displayName);
  const minutes = options.durationMinutes ?? 3;
  const audioReady =
    options.audioReady === true && options.hasAnchorAudio === true;
  const anchorName = options.anchorName?.trim();

  if (audioReady) {
    if (slot === "evening") {
      const title = anchorName
        ? `🌙 ${name}，${anchorName} 已經準備好今晚的 AI 晚報`
        : `🌙 ${name}，你的 AI 主播已準備好。`;
      return {
        title,
        body: `今天的重要新聞都整理好了，${minutes} 分鐘快速掌握重點。`,
      };
    }

    const title = anchorName
      ? `🎙️ ${name}，${anchorName} 已經準備好今天的 AI 早報`
      : `🎙️ ${name}，你的 AI 主播已準備好。`;
    const newsCount = options.newsCount;
    const body =
      typeof newsCount === "number" && newsCount > 0
        ? `今天整理了 ${newsCount} 則你關心的新聞，濃縮成 ${minutes} 分鐘，點一下立即開始收聽。`
        : `今天整理了你關心的新聞，濃縮成 ${minutes} 分鐘，點一下立即開始收聽。`;
    return { title, body };
  }

  if (slot === "evening") {
    return {
      title: "🌆 今日 AI 新聞已完成",
      body: "可開啟 App 閱讀",
    };
  }
  return {
    title: "📰 今日 AI 新聞已完成",
    body: "可開啟 App 閱讀",
  };
}

async function apnsFetch(url: string, init: RequestInit): Promise<Response> {
  if (typeof Deno !== "undefined" && "createHttpClient" in Deno) {
    const client = Deno.createHttpClient({ http2: true });
    try {
      return await fetch(url, { ...init, client });
    } finally {
      client.close();
    }
  }
  return fetch(url, init);
}

function parseApnsReason(responseBody: string): string | null {
  try {
    const parsed = JSON.parse(responseBody) as { reason?: string };
    return parsed.reason?.trim() || null;
  } catch {
    return null;
  }
}

async function sendViaApns(
  pushToken: string,
  displayName: string | null | undefined,
  pushOptions: DailyRadioPushOptions
): Promise<PushSendResult> {
  const config = readApnsConfig(pushOptions.pushEnvironment);
  if (!config) {
    console.log("push provider apns", { configured: false });
    return {
      push_status: "failed",
      push_error: "missing_apns_config",
    };
  }

  const radioSlot = pushOptions.radioSlot ?? "morning";
  const { title, body } = pushCopy(radioSlot, displayName, pushOptions);
  const audioReady =
    pushOptions.audioReady === true && pushOptions.hasAnchorAudio === true;

  console.log("push provider apns", {
    configured: true,
    apns_endpoint: config.host,
    apns_env: config.apnsEnvLabel,
    routing_source: config.routingSource,
    push_environment: pushOptions.pushEnvironment ?? null,
    bundle_id: config.bundleId,
    token_prefix: tokenPrefix(pushToken),
    radio_slot: radioSlot,
    script_id: pushOptions.scriptId ?? null,
    has_anchor_audio: pushOptions.hasAnchorAudio === true,
    audio_ready: audioReady,
  });

  const payload: Record<string, unknown> = {
    aps: {
      alert: { title, body },
      sound: "default",
    },
    type: audioReady ? "daily_radio" : "daily_radio_completed",
    action: "daily_radio_completed",
    radio_slot: radioSlot,
  };
  if (pushOptions.scriptId) payload.script_id = pushOptions.scriptId;
  if (audioReady) {
    payload.openTarget = "ai_anchor_audio";
    payload.autoPlay = true;
    payload.audioReady = true;
  }

  try {
    const jwt = await createApnsJwt(config);
    const url = `https://${config.host}/3/device/${pushToken}`;

    const res = await apnsFetch(url, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": config.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await res.text();
    const apnsReason = parseApnsReason(responseBody);
    console.log("APNs response status", res.status);
    console.log("APNs delivery context", {
      apns_endpoint: config.host,
      apns_env: config.apnsEnvLabel,
      routing_source: config.routingSource,
      push_environment: pushOptions.pushEnvironment ?? null,
      http_status: res.status,
      reason: apnsReason,
      token_prefix: tokenPrefix(pushToken),
    });
    if (!res.ok) {
      console.log("APNs error response body", responseBody || "(empty)");
      return {
        push_status: "failed",
        push_error: `apns_${res.status}${responseBody ? `: ${responseBody.slice(0, 200)}` : ""}`,
      };
    }

    return { push_status: "sent" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("APNs transport error", {
      apns_endpoint: config.host,
      push_environment: pushOptions.pushEnvironment ?? null,
      message: msg,
      token_prefix: tokenPrefix(pushToken),
    });
    return { push_status: "failed", push_error: msg };
  }
}

export async function sendDailyRadioCompletedPush(
  pushToken: string | null | undefined,
  displayName?: string | null,
  platform?: string | null,
  pushOptions: DailyRadioPushOptions = {}
): Promise<PushSendResult> {
  const token = pushToken?.trim();
  console.log("push token exists", Boolean(token), {
    token_prefix: token ? tokenPrefix(token) : null,
    radio_slot: pushOptions.radioSlot ?? "morning",
    push_environment: pushOptions.pushEnvironment ?? null,
  });

  if (!token) {
    return { push_status: "no_token", push_error: "missing_push_token" };
  }

  const plat = (platform ?? "ios").trim().toLowerCase();
  if (plat === "android") {
    console.log("push provider apns", { configured: false, reason: "android_not_supported" });
    return {
      push_status: "failed",
      push_error: "android_push_not_implemented_use_apns_for_ios",
    };
  }

  return sendViaApns(token, displayName, pushOptions);
}
