import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { CSSProperties } from "react";
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

import { fetchPushDiagnosticsFromSupabase } from "./dailyRadioApi";
import {
  getAnchorById,
  readAnchorId,
  readAnchorStyleId,
} from "./aiAnchorSettings";
import { readDailyRadioState } from "./dailyRadio";
import { normalizeAutoRadioDuration } from "./aiDuration";
import {
  clearInternalAccess,
  isInternalAccessActive,
  readInternalAccess,
  verifyAndEnableInternalCode,
} from "./hiddenDevUnlock";
import {
  formatAppDistributionLabel,
  getPushEnvironment,
  type PushEnvironmentDiagnostics,
} from "./plugins/pushEnvironment";
import { refreshEntitlementsSilently } from "./iapRestore";
import { getProStatus, isProActive, proSourceLabel } from "./pro";
import {
  getLastPreferenceSyncAt,
  getPushTokenSyncDiagnostics,
  getSilentEntitlementDiagnostics,
} from "./prefSyncTrace";
import {
  PUSH_NAV_BUILD_MARKER,
  PUSH_NAV_IMPL_VERSION,
} from "./pushNavTrace";
import {
  getCachedPushEnvironmentDiagnostics,
  getCachedPushToken,
  reregisterAndSyncPushToken,
} from "./remotePush";

type HiddenDevPanelProps = {
  open: boolean;
  onClose: () => void;
  onStatusChanged: () => void;
  supabaseUserId?: string | null;
  todayServerScriptId?: string | null;
  onTriggerServerDailyRadio?: () => Promise<void>;
  onSimulateAiAnchorPushClick?: () => Promise<void>;
  onSyncPreferences?: () => Promise<boolean>;
};

type DevPanelSectionProps = {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

function DevPanelSection({ title, defaultOpen = false, children }: DevPanelSectionProps) {
  const [expanded, setExpanded] = useState(defaultOpen);

  return (
    <div style={styles.section}>
      <button
        type="button"
        style={styles.sectionToggle}
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span style={styles.sectionTitle}>{title}</span>
        <span style={styles.sectionChevron} aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded ? <div style={styles.sectionBody}>{children}</div> : null}
    </div>
  );
}

export function HiddenDevPanel({
  open,
  onClose,
  onStatusChanged,
  supabaseUserId,
  todayServerScriptId,
  onTriggerServerDailyRadio,
  onSimulateAiAnchorPushClick,
  onSyncPreferences,
}: HiddenDevPanelProps) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [triggerBusy, setTriggerBusy] = useState(false);
  const [simulatePushBusy, setSimulatePushBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [nativeEnv, setNativeEnv] = useState<PushEnvironmentDiagnostics | null>(null);
  const [dbPushTokenPrefix, setDbPushTokenPrefix] = useState<string | null>(null);
  const [dbPushEnvironment, setDbPushEnvironment] = useState<string | null>(null);
  const [dbPushUpdatedAt, setDbPushUpdatedAt] = useState<string | null>(null);
  const [pushSyncMessage, setPushSyncMessage] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [appBuild, setAppBuild] = useState<string | null>(null);
  const [prefsSyncBusy, setPrefsSyncBusy] = useState(false);
  const [prefsSyncMessage, setPrefsSyncMessage] = useState<string | null>(null);
  const [entitlementBusy, setEntitlementBusy] = useState(false);
  const [entitlementMessage, setEntitlementMessage] = useState<string | null>(null);
  const [dbPrefs, setDbPrefs] = useState<Awaited<ReturnType<typeof fetchPushDiagnosticsFromSupabase>>>(null);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const info = await CapApp.getInfo();
        setAppVersion(info.version ?? null);
        setAppBuild(info.build ?? null);
      } catch {
        setAppVersion(null);
        setAppBuild(null);
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const scrollY = window.scrollY;
    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyPosition = document.body.style.position;
    const prevBodyTop = document.body.style.top;
    const prevBodyWidth = document.body.style.width;
    const prevBodyTouchAction = document.body.style.touchAction;

    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    document.body.style.touchAction = "none";

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.position = prevBodyPosition;
      document.body.style.top = prevBodyTop;
      document.body.style.width = prevBodyWidth;
      document.body.style.touchAction = prevBodyTouchAction;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  const refreshPushDiagnostics = useCallback(async () => {
    const cachedNative = getCachedPushEnvironmentDiagnostics();
    if (cachedNative) {
      setNativeEnv(cachedNative);
    } else if (Capacitor.getPlatform() === "ios") {
      const resolved = await getPushEnvironment();
      setNativeEnv(resolved);
    }

    const row = await fetchPushDiagnosticsFromSupabase();
    setDbPrefs(row);
    if (row) {
      const token = row.push_token?.trim() ?? "";
      setDbPushTokenPrefix(token ? token.slice(0, 12) : null);
      setDbPushEnvironment(row.push_environment ?? "null");
      setDbPushUpdatedAt(row.updated_at ?? null);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshPushDiagnostics();
  }, [open, refreshPushDiagnostics, supabaseUserId]);

  if (!open) return null;

  const proStatus = getProStatus();
  const internalActive = isInternalAccessActive();
  const internalRecord = readInternalAccess();
  const iapActive = proStatus.isPro && proStatus.proSource === "purchase";
  const cachedTokenPrefix = getCachedPushToken()?.slice(0, 12) ?? null;

  const handleSubmit = () => {
    setBusy(true);
    try {
      const result = verifyAndEnableInternalCode(code);
      setMessage(result.message);
      if (result.ok) {
        setCode("");
        onStatusChanged();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleClearInternal = () => {
    clearInternalAccess();
    setMessage("已關閉本機 Pro");
    onStatusChanged();
  };

  const handleTriggerServer = () => {
    if (!onTriggerServerDailyRadio) return;
    setTriggerBusy(true);
    void onTriggerServerDailyRadio()
      .catch((e) => {
        setMessage(e instanceof Error ? e.message : "觸發失敗");
      })
      .finally(() => {
        setTriggerBusy(false);
      });
  };

  const handleSimulatePush = () => {
    if (!onSimulateAiAnchorPushClick) return;
    setSimulatePushBusy(true);
    void onSimulateAiAnchorPushClick()
      .catch((e) => {
        setMessage(e instanceof Error ? e.message : "模擬失敗");
      })
      .finally(() => {
        setSimulatePushBusy(false);
      });
  };

  const handleReregisterPush = () => {
    setPushBusy(true);
    setPushSyncMessage(null);
    void reregisterAndSyncPushToken()
      .then(async (result) => {
        await refreshPushDiagnostics();
        if (result.ok) {
          setPushSyncMessage("同步成功");
        } else {
          setPushSyncMessage(`同步錯誤：${result.error ?? "unknown"}`);
        }
      })
      .catch((e) => {
        setPushSyncMessage(
          `同步錯誤：${e instanceof Error ? e.message : "unknown"}`
        );
      })
      .finally(() => {
        setPushBusy(false);
      });
  };

  const handleSyncPreferences = () => {
    if (!onSyncPreferences) return;
    setPrefsSyncBusy(true);
    setPrefsSyncMessage(null);
    void onSyncPreferences()
      .then(async (ok) => {
        await refreshPushDiagnostics();
        setPrefsSyncMessage(ok ? "同步成功" : "同步失敗（請查看 console）");
      })
      .catch((e) => {
        setPrefsSyncMessage(
          `同步錯誤：${e instanceof Error ? e.message : "unknown"}`
        );
      })
      .finally(() => {
        setPrefsSyncBusy(false);
      });
  };

  const handleSilentEntitlementRefresh = () => {
    setEntitlementBusy(true);
    setEntitlementMessage(null);
    void refreshEntitlementsSilently()
      .then(async (result) => {
        onStatusChanged();
        await refreshPushDiagnostics();
        setEntitlementMessage(
          `靜默檢查：${result.entitlementResult ?? "—"}${result.productId ? ` (${result.productId})` : ""}`
        );
      })
      .catch((e) => {
        setEntitlementMessage(
          `靜默檢查錯誤：${e instanceof Error ? e.message : "unknown"}`
        );
      })
      .finally(() => {
        setEntitlementBusy(false);
      });
  };

  const silentEntitlement = getSilentEntitlementDiagnostics();
  const pushTokenSync = getPushTokenSyncDiagnostics();
  const lastPrefSyncAt = getLastPreferenceSyncAt();

  const localRadioState = readDailyRadioState();
  const localAnchorId = readAnchorId();
  const localAnchorStyle = readAnchorStyleId();
  const localAnchor = getAnchorById(localAnchorId);
  const localMorningDur = normalizeAutoRadioDuration(
    localRadioState.morningDuration,
    isProActive(proStatus)
  );
  const localEveningDur = normalizeAutoRadioDuration(
    localRadioState.eveningDuration,
    isProActive(proStatus)
  );
  const localEveningEnabled = isProActive(proStatus);
  const dbPro = dbPrefs?.voice_feature_enabled === true;
  const dbEveningEnabled = dbPrefs?.evening_radio_enabled === true;
  const proSourceText = proSourceLabel(proStatus.proSource) ?? proStatus.proSource ?? "—";
  const durationConsistent =
    dbPrefs?.morning_duration_minutes === localMorningDur &&
    dbPrefs?.evening_duration_minutes === localEveningDur;
  const eveningConsistent =
    dbEveningEnabled === localEveningEnabled &&
    (localEveningEnabled
      ? dbPrefs?.evening_duration_minutes === localEveningDur
      : true);

  return (
    <div style={styles.backdrop} onClick={onClose} role="presentation">
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="內部管理"
      >
        <header style={styles.header}>
          <div>
            <div style={styles.title}>內部管理</div>
            <p style={styles.desc}>此面板僅供內部測試，不影響 App Store 訂閱。</p>
          </div>
          <button type="button" onClick={onClose} style={styles.closeButton} aria-label="關閉">
            關閉
          </button>
        </header>

        <div style={styles.content}>
          <DevPanelSection title="Push Nav 診斷" defaultOpen>
            <div style={styles.statusBox}>
              <div style={styles.statusHint}>
                Web build marker：{PUSH_NAV_BUILD_MARKER}
              </div>
              <div style={styles.statusHint}>
                Push nav impl：{PUSH_NAV_IMPL_VERSION}
              </div>
              <div style={styles.statusHint}>
                App version：{appVersion ?? "—"}
              </div>
              <div style={styles.statusHint}>
                App build：{appBuild ?? "—"}
              </div>
            </div>
          </DevPanelSection>

          <DevPanelSection title="Push 診斷" defaultOpen>
            <div style={styles.statusBox}>
              <div style={styles.statusHint}>
                目前 user_id: {supabaseUserId ?? "未登入"}
              </div>
              <div style={styles.statusHint}>
                方案：{isProActive(proStatus) ? "Pro" : "Free"}
              </div>
              <div style={styles.statusHint}>
                push_token（本機快取前 12 碼）：{cachedTokenPrefix ?? "—"}
              </div>
              <div style={styles.statusHint}>
                push_token（DB 前 12 碼）：{dbPushTokenPrefix ?? "—"}
              </div>
              <div style={styles.statusHint}>
                DB push_environment：{dbPushEnvironment ?? "—"}
              </div>
              <div style={styles.statusHint}>
                iOS entitlement：{nativeEnv?.entitlement ?? "—"}
              </div>
              <div style={styles.statusHint}>
                實際判斷 Push Environment：{nativeEnv?.environment ?? "—"}
                {nativeEnv?.usedFallback ? " (fallback)" : ""}
              </div>
              <div style={styles.statusHint}>
                目前 App：{nativeEnv ? formatAppDistributionLabel(nativeEnv.appDistribution) : "—"}
              </div>
              <div style={styles.statusHint}>
                Token 最後同步時間：
                {dbPushUpdatedAt
                  ? new Date(dbPushUpdatedAt).toLocaleString("zh-TW")
                  : "—"}
              </div>
              {pushSyncMessage ? (
                <div style={styles.statusHint}>{pushSyncMessage}</div>
              ) : null}
              <button
                type="button"
                disabled={pushBusy || !supabaseUserId}
                onClick={handleReregisterPush}
                style={styles.secondary}
              >
                {pushBusy ? "同步中…" : "重新註冊並同步 Push Token"}
              </button>
            </div>
          </DevPanelSection>

          <DevPanelSection title="訂閱狀態">
            <div style={styles.statusBox}>
              <div style={styles.statusRow}>
                <span>正式訂閱</span>
                <strong>{iapActive ? "已啟用" : "未啟用"}</strong>
              </div>
              <div style={styles.statusRow}>
                <span>本機狀態</span>
                <strong>{internalActive ? "已啟用" : "未啟用"}</strong>
              </div>
              {internalRecord?.expiresAt ? (
                <div style={styles.statusHint}>
                  本機有效至 {new Date(internalRecord.expiresAt).toLocaleDateString("zh-TW")}
                </div>
              ) : null}
              <div style={styles.statusHint}>
                目前方案：{isProActive(proStatus) ? "Pro" : "Free"}
              </div>
            </div>
          </DevPanelSection>

          <DevPanelSection title="偏好同步" defaultOpen>
            <div style={styles.statusBox}>
              <div style={styles.statusRow}>
                <span>本機 Pro</span>
                <strong>{isProActive(proStatus) ? "是" : "否"}</strong>
              </div>
              <div style={styles.statusHint}>
                StoreKit / IAP 來源：{proSourceText}
              </div>
              <div style={styles.statusRow}>
                <span>DB voice_feature_enabled</span>
                <strong>
                  {dbPrefs?.voice_feature_enabled == null
                    ? "—"
                    : dbPrefs.voice_feature_enabled
                      ? "true"
                      : "false"}
                </strong>
              </div>
              <div style={styles.statusHint}>
                Pro 一致：{isProActive(proStatus) === dbPro ? "是" : "否（需同步）"}
              </div>
              <div style={styles.statusHint}>
                靜默 entitlement 最後檢查：
                {silentEntitlement.lastCheckedAt
                  ? new Date(silentEntitlement.lastCheckedAt).toLocaleString("zh-TW")
                  : "—"}
              </div>
              <div style={styles.statusHint}>
                entitlement 結果：{silentEntitlement.result ?? "—"}
              </div>
              <div style={styles.statusHint}>
                entitlement product id：{silentEntitlement.productId ?? "—"}
              </div>
              <div style={styles.statusHint}>
                entitlement expiresAt：
                {silentEntitlement.expiresAt
                  ? new Date(silentEntitlement.expiresAt).toLocaleString("zh-TW")
                  : "—"}
              </div>
              {silentEntitlement.lastError ? (
                <div style={styles.statusHint}>
                  entitlement 錯誤：{silentEntitlement.lastError}
                </div>
              ) : null}
              <div style={styles.statusHint}>
                本機 Pro source：{proSourceText}
              </div>
              <div style={styles.statusRow}>
                <span>本機主播</span>
                <strong>
                  {localAnchorId} / {localAnchor.voice} / {localAnchorStyle}
                </strong>
              </div>
              <div style={styles.statusRow}>
                <span>DB 主播</span>
                <strong>
                  {dbPrefs?.ai_anchor_id ?? "—"} / {dbPrefs?.ai_anchor_voice ?? "—"} /{" "}
                  {dbPrefs?.ai_anchor_style ?? "—"}
                </strong>
              </div>
              <div style={styles.statusHint}>
                主播一致：
                {dbPrefs?.ai_anchor_id === localAnchorId &&
                dbPrefs?.ai_anchor_voice === localAnchor.voice &&
                dbPrefs?.ai_anchor_style === localAnchorStyle
                  ? "是"
                  : "否（需同步）"}
              </div>
              <div style={styles.statusRow}>
                <span>本機早報時長</span>
                <strong>{localMorningDur} 分鐘</strong>
              </div>
              <div style={styles.statusRow}>
                <span>DB 早報時長</span>
                <strong>
                  {dbPrefs?.morning_duration_minutes != null
                    ? `${dbPrefs.morning_duration_minutes} 分鐘`
                    : "—"}
                </strong>
              </div>
              <div style={styles.statusHint}>
                早報時長一致：
                {dbPrefs?.morning_duration_minutes === localMorningDur ? "是" : "否（需同步）"}
              </div>
              <div style={styles.statusHint}>
                duration / evening 整體一致：{durationConsistent && eveningConsistent ? "是" : "否（需同步）"}
              </div>
              <div style={styles.statusRow}>
                <span>本機晚報</span>
                <strong>
                  {localEveningEnabled ? `開啟 / ${localEveningDur} 分鐘` : "關閉（Free）"}
                </strong>
              </div>
              <div style={styles.statusRow}>
                <span>DB 晚報</span>
                <strong>
                  {dbPrefs?.evening_radio_enabled
                    ? `開啟 / ${dbPrefs.evening_duration_minutes ?? "—"} 分鐘`
                    : "關閉"}
                </strong>
              </div>
              <div style={styles.statusHint}>
                preferences updated_at：
                {dbPrefs?.updated_at
                  ? new Date(dbPrefs.updated_at).toLocaleString("zh-TW")
                  : "—"}
              </div>
              <div style={styles.statusHint}>
                偏好最後同步：
                {lastPrefSyncAt ? new Date(lastPrefSyncAt).toLocaleString("zh-TW") : "—"}
              </div>
              <div style={styles.statusHint}>
                push token 最後同步：
                {pushTokenSync.lastSyncedAt
                  ? new Date(pushTokenSync.lastSyncedAt).toLocaleString("zh-TW")
                  : "—"}
              </div>
              <div style={styles.statusHint}>
                push token sync 改動偏好欄位：
                {pushTokenSync.lastPreferenceFieldsChanged === true
                  ? "是（異常）"
                  : pushTokenSync.lastPreferenceFieldsChanged === false
                    ? "否"
                    : "—"}
              </div>
              {prefsSyncMessage ? (
                <div style={styles.statusHint}>{prefsSyncMessage}</div>
              ) : null}
              {onSyncPreferences ? (
                <button
                  type="button"
                  disabled={prefsSyncBusy || !supabaseUserId}
                  onClick={handleSyncPreferences}
                  style={styles.secondary}
                >
                  {prefsSyncBusy ? "同步中…" : "立即同步偏好至 DB"}
                </button>
              ) : null}
              <button
                type="button"
                disabled={entitlementBusy}
                onClick={handleSilentEntitlementRefresh}
                style={styles.secondary}
              >
                {entitlementBusy ? "檢查中…" : "重新靜默檢查訂閱"}
              </button>
              {entitlementMessage ? (
                <div style={styles.statusHint}>{entitlementMessage}</div>
              ) : null}
            </div>
          </DevPanelSection>

          <DevPanelSection title="內部代碼">
            <label style={styles.label} htmlFor="hidden-dev-code">
              內部代碼
            </label>
            <input
              id="hidden-dev-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="輸入內部代碼"
              style={styles.input}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
            />
            {message ? <p style={styles.message}>{message}</p> : null}
            <div style={styles.actions}>
              <button
                type="button"
                disabled={busy || !code.trim()}
                onClick={handleSubmit}
                style={styles.primary}
              >
                {busy ? "處理中…" : "套用"}
              </button>
              <button type="button" onClick={handleClearInternal} style={styles.secondary}>
                關閉本機 Pro
              </button>
            </div>
          </DevPanelSection>

          {onTriggerServerDailyRadio || onSimulateAiAnchorPushClick ? (
            <DevPanelSection title="Server 稿件測試">
              <div style={styles.devActionBox}>
                <div style={styles.statusHint}>
                  user_id: {supabaseUserId ? `${supabaseUserId.slice(0, 8)}…` : "未登入"}
                </div>
                {todayServerScriptId ? (
                  <div style={styles.statusHint}>
                    server script: {todayServerScriptId.slice(0, 8)}…
                  </div>
                ) : null}
                {onTriggerServerDailyRadio ? (
                  <button
                    type="button"
                    disabled={triggerBusy || !supabaseUserId}
                    onClick={handleTriggerServer}
                    style={styles.secondary}
                  >
                    {triggerBusy ? "生成中…" : "立即生成今日 Server 稿 + MP3"}
                  </button>
                ) : null}
                {onSimulateAiAnchorPushClick ? (
                  <button
                    type="button"
                    disabled={simulatePushBusy || !supabaseUserId}
                    onClick={handleSimulatePush}
                    style={styles.secondary}
                  >
                    {simulatePushBusy ? "模擬中…" : "模擬點擊 AI 主播推播"}
                  </button>
                ) : null}
              </div>
            </DevPanelSection>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 10050,
    background: "rgba(2,6,23,.72)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
    paddingRight: 12,
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
    paddingLeft: 12,
    overflow: "hidden",
    touchAction: "none",
  },
  panel: {
    width: "min(680px, 100%)",
    maxHeight: "calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 24px)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: 24,
    background: "linear-gradient(180deg, #0F172A 0%, #111827 100%)",
    border: "1px solid rgba(148,163,184,.22)",
    boxShadow: "0 24px 64px rgba(0,0,0,.45)",
    color: "#F8FAFC",
  },
  header: {
    flex: "0 0 auto",
    position: "sticky",
    top: 0,
    zIndex: 2,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    padding: "18px 20px 14px",
    borderBottom: "1px solid rgba(148,163,184,.16)",
    background: "linear-gradient(180deg, #0F172A 0%, #111827 100%)",
  },
  title: {
    fontSize: 20,
    fontWeight: 800,
    marginBottom: 4,
  },
  desc: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "#94A3B8",
    margin: 0,
  },
  closeButton: {
    flex: "0 0 auto",
    borderRadius: 10,
    padding: "8px 12px",
    fontSize: 14,
    fontWeight: 700,
    color: "#F8FAFC",
    background: "rgba(255,255,255,.08)",
    border: "1px solid rgba(148,163,184,.28)",
    cursor: "pointer",
  },
  content: {
    flex: "1 1 auto",
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    overscrollBehavior: "contain",
    WebkitOverflowScrolling: "touch",
    touchAction: "pan-y",
    padding: "12px 20px",
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
  },
  section: {
    marginBottom: 10,
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,.14)",
    background: "rgba(255,255,255,.02)",
    overflow: "hidden",
  },
  sectionToggle: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 14px",
    border: "none",
    background: "transparent",
    color: "#E2E8F0",
    cursor: "pointer",
    textAlign: "left",
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
  },
  sectionChevron: {
    fontSize: 14,
    color: "#94A3B8",
    flexShrink: 0,
  },
  sectionBody: {
    padding: "0 14px 14px",
  },
  statusBox: {
    borderRadius: 12,
    padding: "12px 14px",
    background: "rgba(255,255,255,.04)",
    border: "1px solid rgba(148,163,184,.16)",
  },
  statusRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    fontSize: 14,
    marginBottom: 6,
    color: "#CBD5E1",
  },
  statusHint: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 4,
  },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 700,
    color: "#CBD5E1",
    marginBottom: 8,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,.28)",
    background: "rgba(15,23,42,.9)",
    color: "#F8FAFC",
    padding: "12px 14px",
    fontSize: 16,
    marginBottom: 12,
  },
  message: {
    fontSize: 13,
    color: "#A5B4FC",
    margin: "0 0 12px",
  },
  devActionBox: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  primary: {
    border: "none",
    borderRadius: 12,
    padding: "12px 14px",
    fontSize: 15,
    fontWeight: 800,
    color: "#fff",
    background: "linear-gradient(135deg, #2563EB 0%, #6366F1 100%)",
    cursor: "pointer",
  },
  secondary: {
    borderRadius: 12,
    padding: "11px 14px",
    fontSize: 14,
    fontWeight: 700,
    color: "#CBD5E1",
    background: "rgba(255,255,255,.06)",
    border: "1px solid rgba(148,163,184,.22)",
    cursor: "pointer",
    marginTop: 8,
  },
};
