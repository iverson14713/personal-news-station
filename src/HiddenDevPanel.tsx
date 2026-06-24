import { useState } from "react";
import type { CSSProperties } from "react";

import {
  clearInternalAccess,
  isInternalAccessActive,
  readInternalAccess,
  verifyAndEnableInternalCode,
} from "./hiddenDevUnlock";
import { getProStatus, isProActive, type ProStatus } from "./pro";

type HiddenDevPanelProps = {
  open: boolean;
  onClose: () => void;
  onStatusChanged: () => void;
};

export function HiddenDevPanel({ open, onClose, onStatusChanged }: HiddenDevPanelProps) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const proStatus = getProStatus();
  const internalActive = isInternalAccessActive();
  const internalRecord = readInternalAccess();
  const iapActive = proStatus.isPro && proStatus.proSource === "purchase";

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

  return (
    <div style={styles.backdrop} onClick={onClose} role="presentation">
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="內部管理"
      >
        <div style={styles.title}>內部管理</div>
        <p style={styles.desc}>此面板僅供內部測試，不影響 App Store 訂閱。</p>

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
          <button type="button" disabled={busy || !code.trim()} onClick={handleSubmit} style={styles.primary}>
            {busy ? "處理中…" : "套用"}
          </button>
          <button type="button" onClick={handleClearInternal} style={styles.secondary}>
            關閉本機 Pro
          </button>
          <button type="button" onClick={onClose} style={styles.secondary}>
            關閉
          </button>
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
    padding: 20,
  },
  panel: {
    width: "min(420px, 100%)",
    borderRadius: 18,
    padding: "22px 20px",
    background: "linear-gradient(180deg, #0F172A 0%, #111827 100%)",
    border: "1px solid rgba(148,163,184,.22)",
    boxShadow: "0 24px 64px rgba(0,0,0,.45)",
    color: "#F8FAFC",
  },
  title: {
    fontSize: 20,
    fontWeight: 800,
    marginBottom: 6,
  },
  desc: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "#94A3B8",
    margin: "0 0 16px",
  },
  statusBox: {
    borderRadius: 12,
    padding: "12px 14px",
    background: "rgba(255,255,255,.04)",
    border: "1px solid rgba(148,163,184,.16)",
    marginBottom: 16,
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
  },
};
