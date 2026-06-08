import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import type { NewsItem } from "./App";

export type AiDailyInsight = {
  attentionLevel: "低" | "中" | "高";
  sentiment: "偏正面" | "偏負面" | "中立" | "分歧";
  hotReason: string;
  keywords: string[];
  controversies: string[];
  recommendedNews: string[];
};

function resolveInsightNewsItem(news: NewsItem[], ref: string): NewsItem | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  const byId = news.find((n) => n.id === trimmed);
  if (byId) return byId;
  const num = Number(trimmed);
  if (!Number.isNaN(num) && Number.isFinite(num)) {
    const oneBased = num >= 1 && num <= news.length ? news[num - 1] : null;
    if (oneBased) return oneBased;
    const zeroBased = num >= 0 && num < news.length ? news[num] : null;
    if (zeroBased) return zeroBased;
  }
  return null;
}

export type AiDailyInsightCardProps = {
  isPro: boolean;
  news: NewsItem[];
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
  const [expanded, setExpanded] = useState(false);

  const handleToggle = () => {
    if (!hasNews) return;
    if (!isPro) {
      onOpenProModal();
      setExpanded(true); // 允許看到模糊 preview，但不呼叫 API
      return;
    }
    setExpanded((prev) => !prev);
  };

  useEffect(() => {
    if (!isPro) return;
    if (!expanded) return;
    if (insight) return;
    if (loadingInsight) return;
    // 只在 Pro 展開時才觸發請求，避免首頁載入就耗用成本
    onRequestInsight();
  }, [expanded, insight, isPro, loadingInsight, onRequestInsight]);

  const attentionText = insight?.attentionLevel ?? "—";
  const sentimentText = insight?.sentiment ?? "—";
  const hotReason =
    insight?.hotReason ??
    (expanded ? "AI 洞察生成中或資料不足，請稍後再試。" : "");
  const keywordTags = insight?.keywords ?? [];
  const controversyTags = insight?.controversies ?? [];
  const recommendedRefs = insight?.recommendedNews ?? [];

  const recommendedNews = useMemo(() => {
    const seen = new Set<string>();
    const out: NewsItem[] = [];
    for (const ref of recommendedRefs) {
      const item = resolveInsightNewsItem(news, ref);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
      if (out.length >= 3) break;
    }
    return out;
  }, [news, recommendedRefs]);

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
          <span
            style={{
              ...styles.chevron,
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            ▼
          </span>
        </div>
      </button>

      <div style={{ ...styles.panel, ...(expanded ? styles.panelExpanded : {}) }}>
        <div
          style={{
            ...styles.body,
            ...(previewBlur ? styles.bodyBlurred : {}),
            ...(expanded ? styles.bodyExpanded : {}),
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
              <div style={styles.blockTitle}>今日最值得注意</div>
              <p style={styles.blockBody}>{hotReason}</p>
            </div>

            {controversyTags.length > 0 && (
              <div style={styles.blockCompact}>
                <div style={styles.blockTitle}>主要爭議</div>
                <div style={styles.tagRow}>
                  {controversyTags.slice(0, 5).map((tag) => (
                    <span key={`c-${tag}`} style={styles.controversyTag}>
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {keywordTags.length > 0 && (
              <div style={styles.blockCompact}>
                <div style={styles.blockTitle}>熱門關鍵字</div>
                <div style={styles.tagRow}>
                  {keywordTags.slice(0, 5).map((tag) => (
                    <span key={`k-${tag}`} style={styles.tag}>
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {recommendedNews.length > 0 && (
              <div style={styles.blockCompact}>
                <div style={styles.blockTitle}>AI 建議先看</div>
                <div style={styles.recoList}>
                  {recommendedNews.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onOpenNewsLink(item.id)}
                      style={styles.recoChip}
                      title={item.title}
                    >
                      <span style={styles.recoIndex}>{index + 1}</span>
                      <span style={styles.recoTitle}>{item.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        </div>
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
    transition: "transform 0.18s ease",
  },
  panel: {
    maxHeight: 0,
    overflow: "hidden",
    transition: "max-height 0.22s ease",
  },
  panelExpanded: {
    maxHeight: 460,
  },
  body: {
    marginTop: 8,
    padding: "10px 12px",
    borderRadius: "16px",
    background: "rgba(15,23,42,.9)",
    border: "1px solid rgba(148,163,184,.45)",
    overflow: "hidden",
    opacity: 0,
    transform: "translateY(-4px)",
    transition: "opacity 0.18s ease, transform 0.18s ease",
  },
  bodyExpanded: {
    opacity: 1,
    transform: "translateY(0px)",
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
  blockCompact: {
    marginTop: 6,
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
    padding: "3px 8px",
    borderRadius: "999px",
    background: "rgba(15,23,42,.9)",
    border: "1px solid rgba(129,140,248,.6)",
    color: "#E5E7EB",
  },
  controversyTag: {
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: "999px",
    background: "rgba(30,27,75,.55)",
    border: "1px solid rgba(251,191,36,.45)",
    color: "#FDE68A",
  },
  recoList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  recoChip: {
    width: "100%",
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    textAlign: "left",
    border: "1px solid rgba(96,165,250,.35)",
    borderRadius: "10px",
    background: "rgba(30,58,138,.25)",
    padding: "6px 8px",
    cursor: "pointer",
  },
  recoIndex: {
    flexShrink: 0,
    width: 18,
    height: 18,
    borderRadius: "999px",
    background: "rgba(59,130,246,.35)",
    color: "#BFDBFE",
    fontSize: 10,
    fontWeight: 800,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  recoTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 1.35,
    color: "#E2E8F0",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  freeHint: {
    marginTop: 6,
    fontSize: 11,
    color: "#94A3B8",
  },
};

