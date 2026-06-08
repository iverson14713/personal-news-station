import type { CSSProperties } from "react";

import type { NewsItem, ProStatus } from "./App";

export type AiDailyInsight = {
  attentionLevel: "低" | "中" | "高";
  sentiment: "偏正面" | "偏負面" | "中立" | "分歧";
  viralReason: string;
  hotKeywords: string[];
  recommendedIds: string[];
};

export type AiDailyInsightCardProps = {
  isPro: boolean;
  proStatus: ProStatus;
  news: NewsItem[];
  aiLoading: boolean;
  insight: AiDailyInsight | null;
  loadingInsight: boolean;
  onRequestInsight: () => void;
  onOpenProModal: () => void;
  onOpenNewsLink: (id: string) => void;
};

export function AiDailyInsightCard({
  isPro,
  news,
  insight,
  loadingInsight,
  onRequestInsight,
  onOpenProModal,
  onOpenNewsLink,
}: AiDailyInsightCardProps) {
  const hasNews = news.length > 0;

  const handleToggle = () => {
    if (!hasNews) return;
    if (!isPro) {
      onOpenProModal();
      if (!insight) {
        onRequestInsight();
      }
      return;
    }
    if (!insight && !loadingInsight) {
      onRequestInsight();
    }
  };

  const attentionText = insight?.attentionLevel ?? "—";
  const sentimentText = insight?.sentiment ?? "—";
  const viralReason = insight?.viralReason ?? "需要更多新聞才能提供洞察。";
  const keywordTags = insight?.hotKeywords ?? [];
  const recommendedIds = insight?.recommendedIds ?? [];

  const recommendedNews = recommendedIds
    .map((id) => news.find((n) => n.id === id) || null)
    .filter((n): n is NewsItem => !!n)
    .slice(0, 3);

  const previewBlur = !isPro;

  return (
    <section style={styles.wrap}>
      <button
        type="button"
        style={styles.headerButton}
        onClick={handleToggle}
        disabled={!hasNews}
      >
        <div>
          <div style={styles.kickerRow}>
            <span style={styles.kicker}>AI 今日洞察（Pro）</span>
          </div>
          <p style={styles.subtitle}>
            AI 幫你快速理解今天最值得注意的事件與風向
          </p>
        </div>
        <div style={styles.chevronArea} aria-hidden>
          <span style={styles.chevron}>▼</span>
        </div>
      </button>

      <div
        style={{
          ...styles.body,
          ...(previewBlur ? styles.bodyBlurred : {}),
        }}
      >
        {loadingInsight && (
          <div style={styles.loadingRow}>AI 分析中，請稍候…</div>
        )}

        {!loadingInsight && (
          <>
            <div style={styles.rowGrid}>
              <div style={styles.metricCard}>
                <div style={styles.metricLabel}>今日關注度</div>
                <div style={styles.metricValue}>{attentionText}</div>
              </div>
              <div style={styles.metricCard}>
                <div style={styles.metricLabel}>今日風向</div>
                <div style={styles.metricValue}>{sentimentText}</div>
              </div>
            </div>

            <div style={styles.block}>
              <div style={styles.blockTitle}>爆紅原因</div>
              <p style={styles.blockBody}>{viralReason}</p>
            </div>

            {keywordTags.length > 0 && (
              <div style={styles.block}>
                <div style={styles.blockTitle}>熱門關鍵字</div>
                <div style={styles.tagRow}>
                  {keywordTags.slice(0, 5).map((tag) => (
                    <span key={tag} style={styles.tag}>
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {recommendedNews.length > 0 && (
              <div style={styles.block}>
                <div style={styles.blockTitle}>AI 建議先看</div>
                <ul style={styles.recoList}>
                  {recommendedNews.map((item) => (
                    <li key={item.id} style={styles.recoItem}>
                      <button
                        type="button"
                        onClick={() => onOpenNewsLink(item.id)}
                        style={styles.recoLink}
                      >
                        {item.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {!isPro && (
        <div style={styles.freeHint}>
          升級 Pro 可解鎖完整 AI 洞察，現在點擊可試看模糊預覽。
        </div>
      )}
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    marginTop: 12,
    marginBottom: 8,
  },
  headerButton: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    borderRadius: "18px",
    border: "1px solid rgba(148,163,184,.45)",
    background:
      "radial-gradient(circle at 0% 0%, rgba(59,130,246,.3), transparent 55%), rgba(15,23,42,.92)",
    color: "#E2E8F0",
    cursor: "pointer",
    boxShadow: "0 10px 35px rgba(15,23,42,.8)",
  },
  kickerRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  kicker: {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#93C5FD",
  },
  subtitle: {
    margin: 0,
    marginTop: 1,
    fontSize: 12,
    color: "#CBD5F5",
  },
  chevronArea: {
    marginLeft: 12,
    flexShrink: 0,
  },
  chevron: {
    fontSize: 16,
    color: "#BFDBFE",
  },
  body: {
    marginTop: 8,
    padding: "10px 12px",
    borderRadius: "16px",
    background: "rgba(15,23,42,.9)",
    border: "1px solid rgba(148,163,184,.45)",
    overflow: "hidden",
  },
  bodyBlurred: {
    filter: "blur(3px)",
  },
  loadingRow: {
    fontSize: 12,
    color: "#CBD5E1",
  },
  rowGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
    marginBottom: 8,
  },
  metricCard: {
    borderRadius: "12px",
    padding: "8px 10px",
    background:
      "linear-gradient(135deg, rgba(30,64,175,.9), rgba(15,23,42,.9))",
    border: "1px solid rgba(129,140,248,.55)",
  },
  metricLabel: {
    fontSize: 11,
    color: "#BFDBFE",
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 14,
    fontWeight: 800,
    color: "#E5E7EB",
  },
  block: {
    marginTop: 8,
  },
  blockTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: "#94A3B8",
    marginBottom: 4,
  },
  blockBody: {
    fontSize: 12,
    lineHeight: 1.45,
    color: "#E5E7EB",
    margin: 0,
  },
  tagRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  tag: {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: "999px",
    background: "rgba(15,23,42,.9)",
    border: "1px solid rgba(129,140,248,.6)",
    color: "#E5E7EB",
  },
  recoList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  recoItem: {
    margin: 0,
  },
  recoLink: {
    width: "100%",
    textAlign: "left",
    border: "none",
    background: "transparent",
    padding: "4px 0",
    fontSize: 12,
    color: "#BFDBFE",
    textDecoration: "underline",
    cursor: "pointer",
  },
  freeHint: {
    marginTop: 6,
    fontSize: 11,
    color: "#94A3B8",
  },
};

