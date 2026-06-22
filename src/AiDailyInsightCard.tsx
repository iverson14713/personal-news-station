import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import type { NewsItem } from "./newsFeed";
import { TOKENS } from "./theme";

export type AiDailyInsightRecommended = {
  title: string;
  reason: string;
};

export type AiDailyInsight = {
  attentionLevel: "低" | "中" | "高";
  sentiment: "偏正面" | "偏負面" | "中立" | "分歧";
  hotReason: string;
  keywords: string[];
  controversies: string[];
  recommendedNews: AiDailyInsightRecommended[];
};

export type RecommendedDisplayItem = {
  title: string;
  reason: string;
  matchedItem: NewsItem | null;
};

/** 與 App.tsx normalizeKey 一致，供標題比對 */
export function normalizeInsightTitleKey(title: string): string {
  return title.replace(/[，。！？、\s\-｜|:：]/g, "").slice(0, 28);
}

function fuzzyTitleScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.88;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (longer.includes(shorter) && shorter.length >= 6) return 0.75;
  const setA = new Set(a.split(""));
  let overlap = 0;
  for (const ch of b) {
    if (setA.has(ch)) overlap += 1;
  }
  return overlap / Math.max(a.length, b.length, 1);
}

export function findClosestNewsByTitle(
  news: NewsItem[],
  aiTitle: string
): NewsItem | null {
  const key = normalizeInsightTitleKey(aiTitle);
  if (!key) return null;

  const exact = news.find((n) => normalizeInsightTitleKey(n.title) === key);
  if (exact) return exact;

  const includes = news.find((n) => {
    const nk = normalizeInsightTitleKey(n.title);
    return nk.includes(key) || key.includes(nk);
  });
  if (includes) return includes;

  let best: NewsItem | null = null;
  let bestScore = 0;
  for (const n of news) {
    const score = fuzzyTitleScore(key, normalizeInsightTitleKey(n.title));
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return bestScore >= 0.42 ? best : null;
}

export function matchNewsByTitle(
  news: NewsItem[],
  aiTitle: string
): NewsItem | null {
  return findClosestNewsByTitle(news, aiTitle);
}

export function coerceInsightRecommendedNews(raw: unknown): AiDailyInsightRecommended[] {
  if (!Array.isArray(raw)) return [];
  const out: AiDailyInsightRecommended[] = [];
  for (const row of raw.slice(0, 3)) {
    if (typeof row === "string") {
      const text = row.trim();
      if (text.length >= 6 && /[\u4e00-\u9fffA-Za-z]/.test(text)) {
        out.push({ title: text.slice(0, 300), reason: "值得優先關注" });
      }
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const title =
      typeof o.title === "string"
        ? o.title.trim()
        : typeof o.id === "string" && o.id.length > 12
          ? ""
          : "";
    const reason =
      typeof o.reason === "string" ? o.reason.trim().slice(0, 40) : "值得優先關注";
    if (title) {
      out.push({ title: title.slice(0, 300), reason: reason || "值得優先關注" });
    }
  }
  return out;
}

export function normalizeDailyInsight(raw: unknown): AiDailyInsight | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const attention = o.attentionLevel;
  const sentiment = o.sentiment;
  const hotReason = typeof o.hotReason === "string" ? o.hotReason.trim().slice(0, 60) : "";
  const attentionLevel =
    attention === "低" || attention === "中" || attention === "高" ? attention : null;
  const sentimentLevel =
    sentiment === "偏正面" || sentiment === "偏負面" || sentiment === "中立" || sentiment === "分歧"
      ? sentiment
      : null;
  if (!attentionLevel || !sentimentLevel || !hotReason) return null;

  const keywords = Array.isArray(o.keywords)
    ? o.keywords.filter((x) => typeof x === "string").map((s) => s.trim()).filter(Boolean).slice(0, 5)
    : [];
  const controversies = Array.isArray(o.controversies)
    ? o.controversies
        .filter((x) => typeof x === "string")
        .map((s) => s.trim().replace(/^#+/, ""))
        .filter(Boolean)
        .slice(0, 5)
    : [];
  const recommendedNews = coerceInsightRecommendedNews(o.recommendedNews);

  return {
    attentionLevel,
    sentiment: sentimentLevel,
    hotReason,
    keywords,
    controversies,
    recommendedNews,
  };
}

const FREE_UPGRADE_BULLETS = [
  "今日最重要事件",
  "市場情緒方向",
  "關鍵趨勢變化",
  "風險與機會提醒",
] as const;

export type AiDailyInsightCardProps = {
  isPro: boolean;
  news: NewsItem[];
  insight: AiDailyInsight | null;
  loadingInsight: boolean;
  onRequestInsight: () => void;
  onOpenProModal: () => void;
  onOpenRecommendedNews: (title: string, matchedNewsId: string | null) => void;
};

export function AiDailyInsightCard({
  isPro,
  news,
  insight,
  loadingInsight,
  onRequestInsight,
  onOpenProModal,
  onOpenRecommendedNews,
}: AiDailyInsightCardProps) {
  const hasNews = news.length > 0;
  const [expanded, setExpanded] = useState(false);

  const handleToggle = () => {
    if (!hasNews) return;
    setExpanded((prev) => !prev);
  };

  useEffect(() => {
    if (!isPro) return;
    if (!expanded) return;
    if (insight) return;
    if (loadingInsight) return;
    onRequestInsight();
  }, [expanded, insight, isPro, loadingInsight, onRequestInsight]);

  const recommendedRefs = insight?.recommendedNews ?? [];

  const recommendedItems = useMemo((): RecommendedDisplayItem[] => {
    if (!isPro || !insight) return [];

    console.log("[AI Insight] recommendedNews from AI:", recommendedRefs);

    const seen = new Set<string>();
    const out: RecommendedDisplayItem[] = [];
    let matched = 0;

    for (const ref of recommendedRefs) {
      const title = ref.title.trim();
      if (!title) continue;
      const dedupeKey = normalizeInsightTitleKey(title);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const matchedItem = matchNewsByTitle(news, title);
      if (matchedItem) matched += 1;

      out.push({
        title,
        reason: ref.reason.trim() || "值得優先關注",
        matchedItem,
      });
      if (out.length >= 3) break;
    }

    console.log("[AI Insight] recommended mapping matched:", matched, "/", out.length);
    return out;
  }, [insight, isPro, news, recommendedRefs]);

  const showRecommendedSection = recommendedRefs.length > 0;

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
            <span style={styles.kicker}>
              {isPro ? "AI 今日洞察（Pro）" : "AI 今日洞察"}
            </span>
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
        {!isPro ? (
          <div
            style={{
              ...styles.freeUpgradePanel,
              ...(expanded ? styles.freeUpgradePanelExpanded : {}),
            }}
          >
            <div style={styles.freeUpgradeTitle}>🔒 AI 今日洞察（Pro 專屬）</div>
            <p style={styles.freeUpgradeLead}>AI 幫你從所有新聞中快速找出：</p>
            <ul style={styles.freeUpgradeList}>
              {FREE_UPGRADE_BULLETS.map((item) => (
                <li key={item} style={styles.freeUpgradeItem}>
                  ✓ {item}
                </li>
              ))}
            </ul>
            <button
              type="button"
              style={styles.freeUpgradeButton}
              onClick={(e) => {
                e.stopPropagation();
                onOpenProModal();
              }}
            >
              立即升級 Pro
            </button>
          </div>
        ) : (
          <div
            style={{
              ...styles.body,
              ...(expanded ? styles.bodyExpanded : {}),
            }}
          >
            {loadingInsight && (
              <div style={styles.loadingRow}>AI 分析中，請稍候…</div>
            )}

            {!loadingInsight && insight && (
              <>
                <div style={styles.rowGrid}>
                  <div style={styles.metricCard}>
                    <div style={styles.metricLabel}>今日關注度</div>
                    <div style={styles.metricValue}>{insight.attentionLevel}</div>
                  </div>
                  <div style={styles.metricCard}>
                    <div style={styles.metricLabel}>今日風向</div>
                    <div style={styles.metricValue}>{insight.sentiment}</div>
                  </div>
                </div>

                <div style={styles.leadBlock}>
                  <div style={styles.leadTitle}>今日最值得注意</div>
                  <p style={styles.leadBody}>{insight.hotReason}</p>
                </div>

                {insight.controversies.length > 0 && (
                  <div style={styles.blockCompact}>
                    <div style={styles.sectionHeadTitle}>
                      主要爭議 ({Math.min(insight.controversies.length, 3)})
                    </div>
                    <div style={styles.controversyTagRow}>
                      {insight.controversies.slice(0, 3).map((tag) => (
                        <span key={`c-${tag}`} style={styles.controversyTag}>
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {insight.keywords.length > 0 && (
                  <div style={styles.blockCompact}>
                    <div style={styles.sectionHeadTitle}>
                      熱門關鍵字 ({Math.min(insight.keywords.length, 3)})
                    </div>
                    <div style={styles.keywordTagRow}>
                      {insight.keywords.slice(0, 3).map((tag) => (
                        <span key={`k-${tag}`} style={styles.tag}>
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {showRecommendedSection && (
                  <div style={styles.blockCompact}>
                    <div style={styles.sectionHeadTitle}>AI 建議先看</div>
                    <div style={styles.recoList}>
                      {recommendedItems.map(({ title, reason, matchedItem }, index) => (
                        <button
                          key={`reco-${normalizeInsightTitleKey(title)}-${index}`}
                          type="button"
                          onClick={() =>
                            onOpenRecommendedNews(title, matchedItem?.id ?? null)
                          }
                          style={styles.recoChip}
                          title={matchedItem?.title ?? title}
                        >
                          <span style={styles.recoIndex}>{index + 1}</span>
                          <span style={styles.recoTextCol}>
                            <span style={styles.recoTitle}>
                              {matchedItem?.title ?? title}
                            </span>
                            <span style={styles.recoReason}>{reason}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {!loadingInsight && !insight && (
              <div style={styles.loadingRow}>AI 洞察生成中或資料不足，請稍後再試。</div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    marginTop: 12,
    marginBottom: 4,
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
    maxHeight: 2000,
    overflow: "visible",
  },
  freeUpgradePanel: {
    marginTop: 6,
    padding: "12px 14px",
    borderRadius: "14px",
    background: "rgba(15,23,42,.92)",
    border: "1px solid rgba(148,163,184,.35)",
    opacity: 0,
    transform: "translateY(-4px)",
    transition: "opacity 0.18s ease, transform 0.18s ease",
  },
  freeUpgradePanelExpanded: {
    opacity: 1,
    transform: "translateY(0px)",
  },
  freeUpgradeTitle: {
    fontSize: 15,
    fontWeight: 800,
    color: "#F8FAFC",
    marginBottom: 6,
    lineHeight: 1.3,
  },
  freeUpgradeLead: {
    margin: "0 0 6px",
    fontSize: 13,
    color: "#CBD5E1",
    lineHeight: 1.4,
  },
  freeUpgradeList: {
    margin: "0 0 10px",
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  freeUpgradeItem: {
    fontSize: 13,
    lineHeight: 1.35,
    color: "#E2E8F0",
  },
  freeUpgradeButton: {
    width: "100%",
    border: "none",
    borderRadius: TOKENS.radiusPill,
    padding: "11px 16px",
    fontSize: 14,
    fontWeight: 800,
    color: "#FFFFFF",
    background: TOKENS.primaryGradient,
    cursor: "pointer",
    boxShadow: "0 6px 18px rgba(37,99,235,.35)",
  },
  body: {
    marginTop: 6,
    padding: "10px 12px 8px",
    borderRadius: "16px",
    background: "rgba(15,23,42,.9)",
    border: "1px solid rgba(148,163,184,.45)",
    overflow: "visible",
    opacity: 0,
    transform: "translateY(-4px)",
    transition: "opacity 0.18s ease, transform 0.18s ease",
  },
  bodyExpanded: {
    opacity: 1,
    transform: "translateY(0px)",
  },
  loadingRow: {
    fontSize: 12,
    color: "#CBD5E1",
  },
  rowGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
    marginBottom: 6,
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
  leadBlock: {
    marginTop: 4,
    marginBottom: 4,
    paddingBottom: 8,
    borderBottom: "1px solid rgba(148,163,184,.18)",
  },
  leadTitle: {
    fontSize: 22,
    fontWeight: 800,
    color: "#F8FAFC",
    marginBottom: 6,
    lineHeight: 1.2,
  },
  leadBody: {
    fontSize: 17,
    lineHeight: 1.55,
    color: "#E2E8F0",
    margin: 0,
  },
  blockCompact: {
    marginTop: 5,
  },
  sectionHeadTitle: {
    fontSize: 17,
    fontWeight: 800,
    color: "#CBD5E1",
    marginBottom: 5,
    lineHeight: 1.25,
  },
  controversyTagRow: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  keywordTagRow: {
    display: "flex",
    flexWrap: "nowrap",
    gap: 8,
    overflowX: "auto",
  },
  tag: {
    fontSize: 15,
    padding: "6px 12px",
    borderRadius: "999px",
    background: "rgba(15,23,42,.9)",
    border: "1px solid rgba(129,140,248,.6)",
    color: "#E5E7EB",
    lineHeight: 1.25,
    flexShrink: 0,
  },
  controversyTag: {
    fontSize: 15,
    padding: "7px 12px",
    borderRadius: "10px",
    background: "rgba(30,27,75,.55)",
    border: "1px solid rgba(251,191,36,.45)",
    color: "#FDE68A",
    lineHeight: 1.3,
    width: "100%",
    boxSizing: "border-box",
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
    gap: 10,
    textAlign: "left",
    border: "1px solid rgba(96,165,250,.35)",
    borderRadius: "10px",
    background: "rgba(30,58,138,.25)",
    padding: "8px 10px",
    cursor: "pointer",
  },
  recoIndex: {
    flexShrink: 0,
    width: 22,
    height: 22,
    borderRadius: "999px",
    background: "rgba(59,130,246,.35)",
    color: "#BFDBFE",
    fontSize: 11,
    fontWeight: 800,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  recoTextCol: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  recoTitle: {
    fontSize: 17,
    lineHeight: 1.38,
    color: "#E2E8F0",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  recoReason: {
    fontSize: 15,
    lineHeight: 1.35,
    color: "#93C5FD",
  },
};
