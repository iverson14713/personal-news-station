import { useState } from "react";
import type { CSSProperties } from "react";
import { TOKENS } from "./theme";

export const ONBOARDING_COMPLETED_KEY = "onboarding_completed";
export const ONBOARDING_TOPIC_PICK_COUNT = 3;

export type OnboardingTopicOption = {
  label: string;
  icon: string;
};

export const SELECTED_TOPICS_STORAGE_KEY = "pns_selected_topics_v1";

export function readStoredSelectedTopics(): string[] {
  try {
    const raw = localStorage.getItem(SELECTED_TOPICS_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((s) => s.trim());
  } catch {
    return [];
  }
}

/** 沒有已存主題時一律顯示主題選擇（不因 onboarding 旗標略過） */
export function shouldShowTopicOnboarding(storedTopics?: string[]): boolean {
  const topics = storedTopics ?? readStoredSelectedTopics();
  return topics.length === 0;
}

export function readOnboardingCompleted(): boolean {
  try {
    if (readStoredSelectedTopics().length > 0) {
      return true;
    }
    return localStorage.getItem(ONBOARDING_COMPLETED_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeOnboardingCompleted(completed: boolean): void {
  try {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, completed ? "true" : "false");
  } catch {
    /* ignore */
  }
}

type TopicOnboardingScreenProps = {
  topics: OnboardingTopicOption[];
  requiredCount?: number;
  onComplete: (selectedLabels: string[]) => void;
};

export function TopicOnboardingScreen({
  topics,
  requiredCount = ONBOARDING_TOPIC_PICK_COUNT,
  onComplete,
}: TopicOnboardingScreenProps) {
  const [draft, setDraft] = useState<string[]>([]);
  const ready = draft.length >= requiredCount;

  const toggleTopic = (label: string) => {
    setDraft((prev) => {
      if (prev.includes(label)) {
        return prev.filter((t) => t !== label);
      }
      if (prev.length >= requiredCount) {
        return prev;
      }
      return [...prev, label];
    });
  };

  return (
    <div style={obStyles.backdrop} role="dialog" aria-modal="true" aria-label="選擇追蹤主題">
      <div style={obStyles.panel}>
        <div style={obStyles.brand}>AI個人新聞台</div>
        <h1 style={obStyles.title}>先選你想追蹤的主題</h1>
        <p style={obStyles.subtitle}>AI 會在你打開 App 後，整理成 3 分鐘專屬 AI 電台</p>

        <div style={obStyles.counter}>
          已選 {draft.length} / {requiredCount}
        </div>

        <div style={obStyles.topicGrid}>
          {topics.map((topic) => {
            const active = draft.includes(topic.label);
            const atLimit = !active && draft.length >= requiredCount;
            return (
              <button
                key={topic.label}
                type="button"
                onClick={() => toggleTopic(topic.label)}
                disabled={atLimit}
                aria-pressed={active}
                style={{
                  ...obStyles.topicChip,
                  ...(active ? obStyles.topicChipActive : {}),
                  ...(atLimit ? obStyles.topicChipDisabled : {}),
                }}
              >
                <span aria-hidden>{topic.icon}</span> {topic.label}
              </button>
            );
          })}
        </div>

        {!ready ? (
          <p style={obStyles.hint}>請選擇 {requiredCount} 個主題</p>
        ) : (
          <p style={obStyles.hintReady}>太好了！可以開始建立你的新聞台</p>
        )}

        <button
          type="button"
          disabled={!ready}
          onClick={() => onComplete(draft)}
          style={{
            ...obStyles.primaryBtn,
            ...(ready ? {} : obStyles.primaryBtnDisabled),
          }}
        >
          開始我的新聞台
        </button>
      </div>
    </div>
  );
}

const obStyles: Record<string, CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 120,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingTop: "max(20px, env(safe-area-inset-top, 0px))",
    paddingBottom: "max(16px, env(safe-area-inset-bottom, 0px))",
    paddingLeft: "max(16px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(16px, env(safe-area-inset-right, 0px))",
    background:
      "radial-gradient(circle at top, rgba(37,99,235,.18) 0%, transparent 42%), linear-gradient(180deg, #020617 0%, #0F172A 100%)",
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
  },
  panel: {
    width: "min(460px, 100%)",
    boxSizing: "border-box",
    padding: "8px 4px 24px",
  },
  brand: {
    fontSize: "12px",
    fontWeight: 800,
    letterSpacing: "0.06em",
    color: "#94A3B8",
    marginBottom: "18px",
  },
  title: {
    margin: "0 0 8px",
    fontSize: "clamp(22px, 5.5vw, 26px)",
    fontWeight: 900,
    lineHeight: 1.25,
    color: TOKENS.textPrimary,
  },
  subtitle: {
    margin: "0 0 16px",
    fontSize: "14px",
    lineHeight: 1.5,
    color: TOKENS.textSecondary,
  },
  counter: {
    fontSize: "13px",
    fontWeight: 800,
    color: "#BFDBFE",
    marginBottom: "12px",
  },
  topicGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginBottom: "14px",
  },
  topicChip: {
    border: "1px solid rgba(148,163,184,.24)",
    borderRadius: "999px",
    padding: "9px 14px",
    fontSize: "13px",
    fontWeight: 800,
    color: "#E2E8F0",
    background: "rgba(255,255,255,.06)",
    cursor: "pointer",
    transition: "background 0.15s ease, border-color 0.15s ease, transform 0.12s ease",
  },
  topicChipActive: {
    background: "white",
    color: "#0F172A",
    border: "1px solid white",
    boxShadow: "0 4px 16px rgba(255,255,255,.12)",
  },
  topicChipDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
  },
  hint: {
    margin: "0 0 14px",
    fontSize: "13px",
    fontWeight: 700,
    color: "#FCD34D",
  },
  hintReady: {
    margin: "0 0 14px",
    fontSize: "13px",
    fontWeight: 700,
    color: "#86EFAC",
  },
  primaryBtn: {
    width: "100%",
    border: "none",
    borderRadius: "14px",
    padding: "14px 16px",
    fontSize: "15px",
    fontWeight: 900,
    color: "white",
    background: TOKENS.primaryGradient,
    cursor: "pointer",
    boxShadow: "0 8px 24px rgba(37,99,235,.35)",
  },
  primaryBtnDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
    boxShadow: "none",
  },
};
