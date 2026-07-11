import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";

export type UserNewsPreferencesRow = {
  user_id: string;
  topics: string[];
  custom_keywords: string[];
  daily_radio_enabled: boolean;
  daily_radio_time: string;
  morning_radio_enabled: boolean;
  evening_radio_enabled: boolean;
  morning_radio_time: string;
  evening_radio_time: string;
  morning_duration_minutes: number;
  evening_duration_minutes: number;
  timezone: string;
  push_token: string | null;
  push_platform: string | null;
  push_environment: "sandbox" | "production" | null;
  display_name: string | null;
  ai_anchor_id: string | null;
  ai_anchor_voice: string | null;
  ai_anchor_style: string | null;
  ai_playback_rate: number | null;
  voice_feature_enabled: boolean;
};

export type DailyRadioScriptRow = {
  id: string;
  user_id: string;
  script_date: string;
  duration_minutes: number;
  radio_slot: "morning" | "evening";
  title: string | null;
  script_text: string;
  source_news: unknown;
  status: "pending" | "generating" | "completed" | "failed";
  error_message: string | null;
  is_daily_auto: boolean;
  generation_source: "server" | "app";
  audio_url: string | null;
  audio_voice: string | null;
  audio_style: string | null;
  audio_generated_at: string | null;
  audio_duration_seconds: number | null;
  audio_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

const AUTH_STORAGE_KEY = "pns_supabase_auth_v1";
const AUTH_INIT_TIMEOUT_MS = 8000;

let client: SupabaseClient | null = null;
/** 成功解析後快取，同一裝置維持同一 user_id */
let resolvedUserId: string | null = null;
/** 最近一次通知的 auth user_id（用於帳號切換時重同步 push token） */
let lastNotifiedAuthUserId: string | null = null;
type AuthUserIdListener = (userId: string | null) => void;
const authUserIdListeners = new Set<AuthUserIdListener>();
/** 全 App 唯一 bootstrap promise（含 session 還原 + 單次匿名登入） */
let bootstrapPromise: Promise<string | null> | null = null;

export function onAuthUserIdChange(listener: AuthUserIdListener): () => void {
  authUserIdListeners.add(listener);
  return () => {
    authUserIdListeners.delete(listener);
  };
}

function notifyAuthUserIdChange(userId: string | null): void {
  if (userId === lastNotifiedAuthUserId) return;
  lastNotifiedAuthUserId = userId;
  for (const listener of authUserIdListeners) {
    try {
      listener(userId);
    } catch (error) {
      console.warn("[Supabase] auth user listener failed", error);
    }
  }
}

export function resetResolvedAuthUser(): void {
  resolvedUserId = null;
  bootstrapPromise = null;
}

export function isSupabaseConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  return Boolean(url && key);
}

function getProjectStorageKey(): string {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
  const ref = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] ?? "default";
  return `sb-${ref}-auth-token`;
}

/** Capacitor / WebView 下確保 auth token 寫入 localStorage */
const supabaseStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
      if (key.includes("auth-token")) {
        localStorage.setItem(AUTH_STORAGE_KEY, value);
      }
    } catch {
      /* ignore */
    }
  },
  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
      if (key.includes("auth-token")) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
  },
};

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (client) return client;

  // 若標準 key 遺失但備份存在，先還原
  try {
    const projectKey = getProjectStorageKey();
    const backup = localStorage.getItem(AUTH_STORAGE_KEY);
    if (backup && !localStorage.getItem(projectKey)) {
      localStorage.setItem(projectKey, backup);
    }
  } catch {
    /* ignore */
  }

  client = createClient(
    import.meta.env.VITE_SUPABASE_URL as string,
    import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: supabaseStorage,
        storageKey: getProjectStorageKey(),
      },
    }
  );
  return client;
}

async function waitForStoredSession(
  supabase: SupabaseClient
): Promise<Session | null> {
  const { data: { session: cached } } = await supabase.auth.getSession();
  if (cached?.user?.id) return cached;

  return new Promise((resolve) => {
    let settled = false;
    let subscription: { unsubscribe: () => void } | null = null;

    const finish = (session: Session | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      subscription?.unsubscribe();
      resolve(session);
    };

    const timer = window.setTimeout(() => finish(null), AUTH_INIT_TIMEOUT_MS);

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUserId = session?.user?.id ?? null;
      if (
        event === "SIGNED_OUT" ||
        event === "SIGNED_IN" ||
        event === "INITIAL_SESSION" ||
        event === "TOKEN_REFRESHED"
      ) {
        if (nextUserId !== resolvedUserId) {
          resolvedUserId = nextUserId;
        }
        notifyAuthUserIdChange(nextUserId);
      }
      if (
        (event === "INITIAL_SESSION" ||
          event === "SIGNED_IN" ||
          event === "TOKEN_REFRESHED") &&
        session?.user?.id
      ) {
        finish(session);
      }
    });
    subscription = data.subscription;
  });
}

async function resolveAuthUserId(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const existing = await waitForStoredSession(supabase);
  if (existing?.user?.id) {
    console.log("[Supabase] resolved user_id", existing.user.id);
    notifyAuthUserIdChange(existing.user.id);
    return existing.user.id;
  }

  console.log("[Supabase] anonymous sign-in once");
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user?.id) {
    console.warn(
      "[Supabase] anonymous sign-in failed",
      error?.message ?? "no user"
    );
    return null;
  }

  console.log("[Supabase] resolved user_id", data.user.id);
  notifyAuthUserIdChange(data.user.id);
  return data.user.id;
}

/**
 * App 啟動時呼叫一次；後續 Push / DailyRadio / preferences 皆 await 同一 promise。
 */
export function initSupabaseAuth(): Promise<string | null> {
  return ensureSupabaseUser();
}

/** 匿名登入：reuse 既有 session，全 App 僅一次 signInAnonymously */
export async function ensureSupabaseUser(): Promise<string | null> {
  if (resolvedUserId) return resolvedUserId;

  if (bootstrapPromise) {
    console.log("[Supabase] auth init in-flight, reuse existing promise");
    return bootstrapPromise;
  }

  bootstrapPromise = resolveAuthUserId().then((id) => {
    if (id) resolvedUserId = id;
    return id;
  });

  return bootstrapPromise;
}

export async function getSupabaseAuthUserId(): Promise<string | null> {
  if (resolvedUserId) return resolvedUserId;
  return ensureSupabaseUser();
}

export function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Taipei";
  } catch {
    return "Asia/Taipei";
  }
}
