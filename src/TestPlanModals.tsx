import { useState } from "react";
import type { CSSProperties } from "react";

import type { EffectivePlan } from "./testPlan";
import {
  clearTestPlan,
  setTestPlan,
  verifyTestModePassword,
  type TestPlanValue,
} from "./testPlan";

type TestPlanModalsProps = {
  passwordOpen: boolean;
  panelOpen: boolean;
  effectivePlan: EffectivePlan;
  onClosePassword: () => void;
  onOpenPanel: () => void;
  onClosePanel: () => void;
  onPlanChanged: () => void;
};

export function TestPlanModals({
  passwordOpen,
  panelOpen,
  effectivePlan,
  onClosePassword,
  onOpenPanel,
  onClosePanel,
  onPlanChanged,
}: TestPlanModalsProps) {
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const handlePasswordSubmit = () => {
    if (!verifyTestModePassword(password)) {
      setPasswordError("密碼錯誤");
      return;
    }
    setPassword("");
    setPasswordError("");
    onClosePassword();
    onOpenPanel();
  };

  const handleSwitch = (plan: TestPlanValue) => {
    setTestPlan(plan);
    onPlanChanged();
  };

  const handleClearOverride = () => {
    clearTestPlan();
    onPlanChanged();
  };

  const closePassword = () => {
    setPassword("");
    setPasswordError("");
    onClosePassword();
  };

  return (
    <>
      {passwordOpen ? (
        <div style={styles.backdrop} onClick={closePassword} role="presentation">
          <div
            style={styles.panel}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="測試模式密碼"
          >
            <div style={styles.title}>測試模式</div>
            <p style={styles.desc}>請輸入密碼以開啟測試面板</p>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePasswordSubmit();
              }}
              placeholder="密碼"
              style={styles.input}
              autoFocus
            />
            {passwordError ? <div style={styles.error}>{passwordError}</div> : null}
            <div style={styles.btnRow}>
              <button type="button" onClick={closePassword} style={styles.secondaryBtn}>
                取消
              </button>
              <button type="button" onClick={handlePasswordSubmit} style={styles.primaryBtn}>
                確認
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {panelOpen ? (
        <div style={styles.backdrop} onClick={onClosePanel} role="presentation">
          <div
            style={styles.panel}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="測試模式面板"
          >
            <div style={styles.title}>測試模式面板</div>
            <p style={styles.note}>此功能僅供測試，不會影響正式訂閱狀態</p>

            <div style={styles.statusBox}>
              <div style={styles.statusRow}>
                <span style={styles.statusLabel}>目前 UI 狀態</span>
                <span style={styles.statusValue}>
                  {effectivePlan.isPro ? "Pro" : "Free"}
                </span>
              </div>
              <div style={styles.statusRow}>
                <span style={styles.statusLabel}>正式訂閱</span>
                <span style={styles.statusValueMuted}>
                  {effectivePlan.realStatus.isPro ? "Pro" : "Free"}
                </span>
              </div>
              {effectivePlan.hasTestOverride ? (
                <div style={styles.overrideTag}>測試覆蓋中</div>
              ) : null}
            </div>

            <div style={styles.btnRow}>
              <button
                type="button"
                onClick={() => handleSwitch("free")}
                style={{
                  ...styles.planBtn,
                  ...(effectivePlan.testPlan === "free" ? styles.planBtnActive : {}),
                }}
              >
                切換為 Free
              </button>
              <button
                type="button"
                onClick={() => handleSwitch("pro")}
                style={{
                  ...styles.planBtn,
                  ...(effectivePlan.testPlan === "pro" ? styles.planBtnActive : {}),
                }}
              >
                切換為 Pro
              </button>
            </div>

            {effectivePlan.hasTestOverride ? (
              <button type="button" onClick={handleClearOverride} style={styles.clearBtn}>
                清除測試覆蓋（恢復正式狀態）
              </button>
            ) : null}

            <button type="button" onClick={onClosePanel} style={styles.closeBtn}>
              關閉
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 200,
    background: "rgba(2,6,23,.78)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
  },
  panel: {
    width: "min(360px, 100%)",
    borderRadius: "16px",
    padding: "18px 16px 16px",
    background: "rgba(15,23,42,.96)",
    border: "1px solid rgba(148,163,184,.22)",
    boxShadow: "0 20px 50px rgba(0,0,0,.45)",
  },
  title: {
    fontSize: "16px",
    fontWeight: 800,
    color: "#F8FAFC",
    marginBottom: "8px",
  },
  desc: {
    margin: "0 0 12px",
    fontSize: "13px",
    color: "#94A3B8",
    lineHeight: 1.45,
  },
  note: {
    margin: "0 0 14px",
    fontSize: "11px",
    color: "#64748B",
    lineHeight: 1.4,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    borderRadius: "10px",
    border: "1px solid rgba(148,163,184,.28)",
    background: "rgba(2,6,23,.6)",
    color: "#E2E8F0",
    padding: "10px 12px",
    fontSize: "14px",
    marginBottom: "8px",
  },
  error: {
    fontSize: "12px",
    color: "#FCA5A5",
    marginBottom: "10px",
    fontWeight: 600,
  },
  statusBox: {
    borderRadius: "12px",
    padding: "12px",
    background: "rgba(255,255,255,.04)",
    border: "1px solid rgba(255,255,255,.08)",
    marginBottom: "14px",
  },
  statusRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    marginBottom: "6px",
  },
  statusLabel: {
    fontSize: "12px",
    color: "#94A3B8",
  },
  statusValue: {
    fontSize: "13px",
    fontWeight: 800,
    color: "#E2E8F0",
  },
  statusValueMuted: {
    fontSize: "12px",
    fontWeight: 700,
    color: "#64748B",
  },
  overrideTag: {
    marginTop: "6px",
    display: "inline-block",
    fontSize: "10px",
    fontWeight: 800,
    color: "#FDE68A",
    background: "rgba(251,191,36,.12)",
    border: "1px solid rgba(251,191,36,.35)",
    borderRadius: "999px",
    padding: "3px 8px",
  },
  btnRow: {
    display: "flex",
    gap: "8px",
    marginBottom: "10px",
  },
  primaryBtn: {
    flex: 1,
    border: "none",
    borderRadius: "10px",
    padding: "10px 12px",
    fontSize: "13px",
    fontWeight: 800,
    color: "#fff",
    background: "linear-gradient(135deg, #2563EB, #4F46E5)",
    cursor: "pointer",
  },
  secondaryBtn: {
    flex: 1,
    borderRadius: "10px",
    padding: "10px 12px",
    fontSize: "13px",
    fontWeight: 700,
    color: "#CBD5E1",
    background: "rgba(255,255,255,.06)",
    border: "1px solid rgba(255,255,255,.12)",
    cursor: "pointer",
  },
  planBtn: {
    flex: 1,
    borderRadius: "10px",
    padding: "10px 12px",
    fontSize: "13px",
    fontWeight: 700,
    color: "#CBD5E1",
    background: "rgba(255,255,255,.05)",
    border: "1px solid rgba(255,255,255,.12)",
    cursor: "pointer",
  },
  planBtnActive: {
    color: "#BFDBFE",
    background: "rgba(37,99,235,.22)",
    border: "1px solid rgba(96,165,250,.45)",
  },
  clearBtn: {
    width: "100%",
    marginBottom: "8px",
    borderRadius: "10px",
    padding: "9px 12px",
    fontSize: "12px",
    fontWeight: 700,
    color: "#94A3B8",
    background: "transparent",
    border: "1px dashed rgba(148,163,184,.28)",
    cursor: "pointer",
  },
  closeBtn: {
    width: "100%",
    border: "none",
    borderRadius: "10px",
    padding: "10px 12px",
    fontSize: "13px",
    fontWeight: 700,
    color: "#E2E8F0",
    background: "rgba(255,255,255,.08)",
    cursor: "pointer",
  },
};
