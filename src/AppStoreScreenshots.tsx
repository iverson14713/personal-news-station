/**
 * App Store / Google Play 行銷型截圖頁（1290×2796）
 * 僅作用於 /app-store-screenshot/*，不影響正式 App
 *
 * 手機區塊為「寬短展示卡」，非完整實機比例；優先可讀性。
 */

import type { CSSProperties, ReactNode } from "react";
import { Headphones, Mic2, Newspaper, Radio, Sparkles, Volume2 } from "lucide-react";

const W = 1290;
const H = 2796;

const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif';

/** 寬短展示框：約 75% 畫布寬、高度 1200px（非 19.5:9） */
const SHOWCASE_W = Math.round(W * 0.75);
const SHOWCASE_H = 1200;

/** 截圖頁專用字級（不沿用正式 App 小字） */
const TYPE = {
  screenshotTitle: 80,
  screenshotSubtitle: 42,
  mockupTitle: 66,
  mockupBody: 46,
  mockupCardTitle: 48,
  mockupChip: 44,
  mockupSmall: 36,
  mockupButton: 52,
  mockupBadge: 40,
  mockupPrice: 56,
  mockupCompare: 36,
  mockupSpeed: 52,
  bottomChip: 44,
  footnote: 36,
  brand: 30,
  statusBar: 34,
} as const;

const SCREENSHOTS = [
  {
    id: 1,
    title: "打造你的個人 AI 新聞台",
    subtitle: "選 NBA、台股、BTC，打造專屬新聞台。",
    footnote: "不用再看一堆無關資訊。",
    chips: ["個人化追蹤", "自訂關鍵字", "一鍵更新新聞"],
    floatBadge: "追蹤 5 個主題",
  },
  {
    id: 2,
    title: "今日大事，快速掌握",
    subtitle: "AI 整理重點新聞，每天先看最重要的幾則。",
    footnote: "不浪費時間在大量資訊裡。",
    chips: ["AI 整理重點", "多主題整合", "快速閱讀"],
    floatBadge: "今日 27 則新聞",
  },
  {
    id: 3,
    title: "一鍵生成 1 / 3 / 5 分鐘新聞稿",
    subtitle: "依通勤或開車時間，選擇想收聽的新聞長度。",
    footnote: "AI 幫你變成可直接收聽的新聞稿。",
    chips: ["1 / 3 / 5 分鐘", "AI 自動生成", "深度整理 Pro"],
    floatBadge: "3 分鐘新聞稿",
  },
  {
    id: 4,
    title: "像聽廣播一樣掌握新聞",
    subtitle: "播放、暫停、語速調整，通勤運動都能收聽。",
    footnote: "忙碌時也能掌握重要資訊。",
    chips: ["語速調整", "邊走邊聽", "廣播式體驗"],
    floatBadge: "語速 1.15x",
  },
  {
    id: 5,
    title: "Pro 解鎖更完整的 AI 新聞體驗",
    subtitle: "無廣告、5 分鐘深度稿、每日 20 次 AI 額度。",
    footnote: "適合每天想快速掌握重點的重度用戶。",
    chips: ["無廣告", "5 分鐘深度稿", "每日 20 次 AI"],
    floatBadge: "Pro 專屬",
  },
] as const;

const canvas: CSSProperties = {
  width: W,
  height: H,
  margin: 0,
  boxSizing: "border-box",
  position: "relative",
  overflow: "hidden",
  fontFamily: FONT,
  color: "#F8FAFC",
  background:
    "radial-gradient(ellipse 90% 50% at 50% -5%, rgba(59,130,246,.45) 0%, transparent 55%), radial-gradient(ellipse 70% 40% at 100% 20%, rgba(124,58,237,.35) 0%, transparent 50%), linear-gradient(180deg, #0B1224 0%, #0F172A 42%, #1E1B4B 100%)",
};

const decoIcon: CSSProperties = {
  position: "absolute",
  opacity: 0.14,
  color: "#93C5FD",
  pointerEvents: "none",
};

const ambientLayer: CSSProperties = {
  position: "absolute",
  pointerEvents: "none",
  zIndex: 0,
};

function parseShotId(pathname: string): number | null {
  const m = pathname.match(/\/app-store-screenshot\/news\/(\d+)\/?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 5 ? n : null;
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        padding: "28px 44px",
        minHeight: 88,
        boxSizing: "border-box",
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        background: "rgba(255,255,255,.12)",
        border: "1.5px solid rgba(147,197,253,.35)",
        fontSize: TYPE.bottomChip,
        fontWeight: 800,
        color: "#E2E8F0",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** 畫布安全邊距（badge 不超出右邊界） */
const CANVAS_SAFE_X = 56;

/** 浮動 badge：置於副標與展示框之間的上方安全區 */
function FloatingBadge({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "16px 28px",
        borderRadius: 999,
        background: "rgba(99,102,241,.28)",
        border: "1.5px solid rgba(167,139,250,.4)",
        backdropFilter: "blur(8px)",
        fontSize: 30,
        fontWeight: 800,
        color: "#E0E7FF",
        whiteSpace: "nowrap",
        boxShadow: "0 8px 32px rgba(0,0,0,.25)",
        maxWidth: "100%",
        boxSizing: "border-box",
      }}
    >
      {label}
    </span>
  );
}

/** 寬短展示框：保留手機外框感，內容填滿、無底部 tab */
function ShowcaseFrame({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: SHOWCASE_W,
        height: SHOWCASE_H,
        borderRadius: 48,
        padding: 12,
        background: "linear-gradient(145deg, #334155 0%, #1E293B 50%, #0F172A 100%)",
        boxShadow:
          "0 40px 100px rgba(0,0,0,.55), 0 0 0 2px rgba(255,255,255,.08), inset 0 1px 0 rgba(255,255,255,.15)",
        boxSizing: "border-box",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 38,
          overflow: "hidden",
          background:
            "radial-gradient(circle at 50% 0%, rgba(59,130,246,.14) 0%, transparent 50%), #0F172A",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            height: 44,
            padding: "12px 32px 0",
            display: "flex",
            justifyContent: "space-between",
            fontSize: TYPE.statusBar,
            fontWeight: 700,
            color: "#64748B",
            flexShrink: 0,
          }}
        >
          <span>9:41</span>
          <span style={{ letterSpacing: 2 }}>●●●</span>
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "8px 28px 28px",
            boxSizing: "border-box",
            minHeight: 0,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function ScreenshotLayout({
  id,
  title,
  subtitle,
  footnote,
  chips,
  floatBadge,
  decor,
  phone,
}: {
  id: number;
  title: string;
  subtitle: string;
  footnote: string;
  chips: readonly string[];
  floatBadge: string;
  decor: ReactNode;
  phone: ReactNode;
}) {
  const middleTop = Math.round(H * 0.2);
  const middleHeight = Math.round(H * 0.55);
  return (
    <div style={canvas} id={`screenshot-${id}`}>
      {decor}

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: Math.round(H * 0.2),
          padding: "96px 64px 20px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
          zIndex: 2,
        }}
      >
        <div
          style={{
            fontSize: TYPE.screenshotTitle,
            fontWeight: 900,
            lineHeight: 1.12,
            letterSpacing: "-0.03em",
            textShadow: "0 4px 24px rgba(0,0,0,.35)",
          }}
        >
          {title}
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: TYPE.screenshotSubtitle,
            lineHeight: 1.32,
            color: "#CBD5E1",
            maxWidth: 980,
            wordBreak: "keep-all",
            overflowWrap: "normal",
          }}
        >
          {subtitle}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: middleTop,
          left: 0,
          right: 0,
          height: middleHeight,
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          zIndex: 2,
        }}
      >
        <div
          style={{
            flexShrink: 0,
            padding: `32px ${CANVAS_SAFE_X}px 0`,
            display: "flex",
            justifyContent: "flex-end",
            boxSizing: "border-box",
          }}
        >
          <FloatingBadge label={floatBadge} />
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            paddingTop: 28,
            minHeight: 0,
          }}
        >
          {phone}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: Math.round(H * 0.25),
          padding: "28px 56px 80px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 32,
          zIndex: 2,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24, justifyContent: "center" }}>
          {chips.map((c) => (
            <Chip key={c}>{c}</Chip>
          ))}
        </div>
        <div
          style={{
            fontSize: TYPE.footnote,
            color: "#94A3B8",
            textAlign: "center",
            maxWidth: 1000,
            lineHeight: 1.35,
          }}
        >
          {footnote}
        </div>
        <div style={{ fontSize: TYPE.brand, color: "#64748B", fontWeight: 700, marginTop: 8 }}>
          AI個人新聞台
        </div>
      </div>
    </div>
  );
}

/* —— 展示用 UI：大字、少資訊、填滿展示框 —— */

const showcaseTitle: CSSProperties = {
  fontSize: TYPE.mockupTitle,
  fontWeight: 900,
  lineHeight: 1.1,
  flexShrink: 0,
};

const bigCard: CSSProperties = {
  padding: "32px 36px",
  borderRadius: 28,
  background: "rgba(255,255,255,.07)",
  border: "2px solid rgba(255,255,255,.12)",
};

const bigBtn: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "center",
  padding: "32px 24px",
  borderRadius: 24,
  fontSize: TYPE.mockupButton,
  fontWeight: 900,
  boxSizing: "border-box",
  flexShrink: 0,
};

function ScreenTopics() {
  const topics = ["NBA", "台股", "BTC", "ETF", "國際"];
  return (
    <>
      <div style={showcaseTitle}>我的追蹤主題</div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 18,
          justifyContent: "center",
          flex: 1,
          alignContent: "center",
        }}
      >
        {topics.map((t) => (
          <span
            key={t}
            style={{
              padding: "24px 38px",
              borderRadius: 999,
              fontSize: TYPE.mockupChip,
              fontWeight: 900,
              background: "#F8FAFC",
              color: "#0F172A",
            }}
          >
            {t}
          </span>
        ))}
      </div>
      <div style={bigCard}>
        <div style={{ fontSize: TYPE.mockupBody, fontWeight: 800, lineHeight: 1.45, color: "#E2E8F0" }}>
          自訂關鍵字：大谷翔平・Solana
        </div>
      </div>
      <span style={{ ...bigBtn, background: "#22C55E", color: "#0F172A" }}>套用並更新</span>
    </>
  );
}

function ScreenNewsList() {
  const titles = [
    "大谷翔平雙安助道奇險勝",
    "台股早盤震盪走勢分化",
    "能源價格波動影響市場",
  ];
  return (
    <>
      <div style={showcaseTitle}>今日重點</div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 20, justifyContent: "center" }}>
        {titles.map((t) => (
          <div
            key={t}
            style={{
              ...bigCard,
              padding: "28px 32px",
            }}
          >
            <div style={{ fontSize: TYPE.mockupCardTitle, fontWeight: 900, lineHeight: 1.25 }}>
              {t}
            </div>
          </div>
        ))}
      </div>
      <span
        style={{
          ...bigBtn,
          background: "rgba(16,185,129,.22)",
          border: "2px solid rgba(45,212,191,.45)",
          color: "#6EE7B7",
        }}
      >
        ✨ AI 分析
      </span>
    </>
  );
}

function ScreenAiScript() {
  return (
    <>
      <div style={showcaseTitle}>AI 新聞稿</div>
      <div style={{ display: "flex", gap: 16, flexShrink: 0 }}>
        {[
          { label: "1 分鐘", active: false },
          { label: "3 分鐘", active: true },
          { label: "5 分鐘", active: false, pro: true },
        ].map((d) => (
          <div
            key={d.label}
            style={{
              flex: 1,
              padding: "28px 12px",
              borderRadius: 24,
              textAlign: "center",
              background: d.active
                ? "rgba(99,102,241,.4)"
                : d.pro
                  ? "rgba(124,58,237,.3)"
                  : "rgba(255,255,255,.08)",
              border: d.active
                ? "3px solid rgba(129,140,248,.7)"
                : d.pro
                  ? "3px solid rgba(167,139,250,.55)"
                  : "2px solid rgba(255,255,255,.12)",
            }}
          >
            <div style={{ fontSize: TYPE.mockupButton, fontWeight: 900, lineHeight: 1.2 }}>
              {d.label}
            </div>
            {d.pro ? (
              <div
                style={{
                  fontSize: TYPE.mockupBadge,
                  color: "#C4B5FD",
                  marginTop: 8,
                  fontWeight: 900,
                }}
              >
                Pro
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div style={{ ...bigCard, flex: 1, display: "flex", alignItems: "center" }}>
        <div style={{ fontSize: TYPE.mockupBody, fontWeight: 700, lineHeight: 1.5, color: "#E2E8F0" }}>
          大谷翔平雙安，道奇險勝。加密市場波動加劇，短線偏保守。
        </div>
      </div>
      <span style={{ ...bigBtn, background: "#22C55E", color: "#0F172A" }}>▶ 播放</span>
    </>
  );
}

function ScreenPlayer() {
  return (
    <>
      <div style={showcaseTitle}>正在播放</div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 36,
        }}
      >
        <div
          style={{
            width: 188,
            height: 188,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            fontSize: 76,
            background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
            fontWeight: 800,
            boxShadow: "0 12px 40px rgba(99,102,241,.45)",
          }}
        >
          ⏸
        </div>
        <div style={{ fontSize: TYPE.mockupSpeed, fontWeight: 900, color: "#A5B4FC" }}>
          語速 1.15x
        </div>
      </div>
      <div style={bigCard}>
        <div style={{ fontSize: TYPE.mockupBody, fontWeight: 700, lineHeight: 1.5, color: "#E2E8F0" }}>
          大谷翔平雙安，道奇險勝。
          <br />
          加密市場波動，短線偏保守。
        </div>
      </div>
    </>
  );
}

function ScreenPro() {
  const benefits = ["無廣告", "5 分鐘深度稿", "每日 20 次 AI", "更多主題"];
  return (
    <>
      <div style={showcaseTitle}>Pro 方案</div>
      <div
        style={{
          ...bigCard,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
          paddingTop: 28,
          border: "3px solid rgba(167,139,250,.5)",
          background: "linear-gradient(145deg, rgba(30,41,59,.95), rgba(15,23,42,.98))",
        }}
      >
        <div
          style={{
            fontSize: TYPE.mockupSmall,
            fontWeight: 800,
            color: "#C4B5FD",
            marginBottom: 16,
          }}
        >
          升級後立即解鎖
        </div>
        <ul
          style={{
            margin: 0,
            paddingLeft: 40,
            fontSize: TYPE.mockupBody,
            lineHeight: 1.5,
            fontWeight: 800,
            color: "#F1F5F9",
          }}
        >
          {benefits.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <div style={{ marginTop: 24, fontSize: TYPE.mockupPrice, fontWeight: 900, color: "#A7F3D0" }}>
          NT$60 / 月
        </div>
      </div>
      <span
        style={{
          ...bigBtn,
          background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
        }}
      >
        升級 Pro
      </span>
      <div
        style={{
          textAlign: "center",
          flexShrink: 0,
          marginTop: -4,
          padding: "16px 20px",
          borderRadius: 18,
          background: "rgba(255,255,255,.05)",
        }}
      >
        <div style={{ fontSize: 38, fontWeight: 800, color: "#CBD5E1" }}>Free：每日 3 次</div>
        <div style={{ fontSize: 38, fontWeight: 800, color: "#DDD6FE", marginTop: 8 }}>
          Pro：每日 20 次＋5 分鐘深度稿
        </div>
      </div>
    </>
  );
}

function GhostCard({ style }: { style: CSSProperties }) {
  return (
    <div
      style={{
        ...ambientLayer,
        borderRadius: 20,
        border: "2px solid rgba(147,197,253,.12)",
        background: "rgba(255,255,255,.04)",
        ...style,
      }}
    />
  );
}

function GlowOrb({ style }: { style: CSSProperties }) {
  return (
    <div
      style={{
        ...ambientLayer,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(99,102,241,.16) 0%, transparent 70%)",
        ...style,
      }}
    />
  );
}

function SoundWave({ style }: { style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 320 80"
      style={{ ...ambientLayer, opacity: 0.12, ...style }}
      aria-hidden
    >
      <path
        d="M0 40 Q40 10 80 40 T160 40 T240 40 T320 40"
        fill="none"
        stroke="#93C5FD"
        strokeWidth="3"
      />
      <path
        d="M0 50 Q50 20 100 50 T200 50 T300 50"
        fill="none"
        stroke="#A78BFA"
        strokeWidth="2"
        opacity="0.7"
      />
    </svg>
  );
}

function DataLines({ style }: { style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 200 120"
      style={{ ...ambientLayer, opacity: 0.1, ...style }}
      aria-hidden
    >
      {[20, 50, 80, 110].map((y) => (
        <line key={y} x1="0" y1={y} x2="200" y2={y} stroke="#94A3B8" strokeWidth="1.5" />
      ))}
      <polyline
        points="10,90 50,60 90,75 130,35 190,55"
        fill="none"
        stroke="#818CF8"
        strokeWidth="2.5"
      />
    </svg>
  );
}

function DecorSet({ variant }: { variant: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <>
      <GlowOrb style={{ width: 420, height: 420, top: 680, left: -80 }} />
      <GlowOrb
        style={{
          width: 360,
          height: 360,
          bottom: 520,
          right: -60,
          background: "radial-gradient(circle, rgba(124,58,237,.14) 0%, transparent 70%)",
        }}
      />

      <Sparkles size={120} style={{ ...decoIcon, top: 280, left: 40 }} />
      <Newspaper size={100} style={{ ...decoIcon, top: 420, right: 48 }} />

      {variant === 1 ? (
        <>
          <GhostCard style={{ width: 280, height: 72, top: 1180, left: 72, transform: "rotate(-4deg)" }} />
          <GhostCard style={{ width: 240, height: 64, top: 1280, right: 88, transform: "rotate(3deg)" }} />
          <DataLines style={{ width: 180, height: 108, top: 1050, right: 40 }} />
        </>
      ) : null}

      {variant === 2 ? (
        <>
          <GhostCard style={{ width: 300, height: 88, top: 1150, left: 56 }} />
          <GhostCard style={{ width: 260, height: 76, top: 1260, right: 64, opacity: 0.08 }} />
          <Newspaper size={140} style={{ ...decoIcon, bottom: 640, left: 48, opacity: 0.1 }} />
        </>
      ) : null}

      {variant === 3 ? (
        <>
          <Mic2 size={96} style={{ ...decoIcon, top: 900, left: 24 }} />
          <SoundWave style={{ width: 300, height: 75, bottom: 680, left: 48 }} />
          <Sparkles size={72} style={{ ...decoIcon, top: 1050, right: 80, color: "#C4B5FD" }} />
        </>
      ) : null}

      {variant === 4 ? (
        <>
          <Mic2 size={96} style={{ ...decoIcon, top: 900, left: 24 }} />
          <Headphones size={110} style={{ ...decoIcon, top: 1100, right: 32 }} />
          <Volume2 size={88} style={{ ...decoIcon, top: 1280, left: 56 }} />
          <Radio size={92} style={{ ...decoIcon, bottom: 720, right: 64 }} />
          <SoundWave style={{ width: 340, height: 85, bottom: 600, right: 32 }} />
        </>
      ) : null}

      {variant === 5 ? (
        <>
          <Sparkles size={88} style={{ ...decoIcon, bottom: 780, left: 80, color: "#C4B5FD" }} />
          <GlowOrb
            style={{
              width: 280,
              height: 280,
              top: 1000,
              right: 40,
              background: "radial-gradient(circle, rgba(167,139,250,.15) 0%, transparent 70%)",
            }}
          />
        </>
      ) : null}
    </>
  );
}

function ShotPage({ id }: { id: number }) {
  const meta = SCREENSHOTS[id - 1];
  const screens: Record<number, ReactNode> = {
    1: <ScreenTopics />,
    2: <ScreenNewsList />,
    3: <ScreenAiScript />,
    4: <ScreenPlayer />,
    5: <ScreenPro />,
  };

  return (
    <ScreenshotLayout
      id={id}
      title={meta.title}
      subtitle={meta.subtitle}
      footnote={meta.footnote}
      chips={meta.chips}
      floatBadge={meta.floatBadge}
      decor={<DecorSet variant={id as 1 | 2 | 3 | 4 | 5} />}
      phone={<ShowcaseFrame>{screens[id]}</ShowcaseFrame>}
    />
  );
}

function IndexPage() {
  return (
    <div
      style={{
        padding: 32,
        background: "#0F172A",
        minHeight: "100vh",
        color: "#E2E8F0",
        fontFamily: FONT,
      }}
    >
      <h1 style={{ fontSize: 28, marginBottom: 20 }}>App Store 行銷截圖</h1>
      <p style={{ color: "#94A3B8", marginBottom: 24 }}>
        畫布 {W}×{H}（iPhone 6.7&quot;）· 展示框 {SHOWCASE_W}×{SHOWCASE_H} · 匯出：
        <code>npm run screenshot:news</code>
      </p>
      <ul style={{ lineHeight: 2.2, fontSize: 18 }}>
        {SCREENSHOTS.map((s) => (
          <li key={s.id}>
            <a href={`/app-store-screenshot/news/${s.id}`} style={{ color: "#93C5FD" }}>
              第 {s.id} 張 — {s.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AppStoreScreenshots() {
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const id = parseShotId(path);

  if (path === "/app-store-screenshot/news" || path === "/app-store-screenshot/news/") {
    return <IndexPage />;
  }

  if (id != null) {
    return (
      <div
        style={{
          width: W,
          height: H,
          margin: "0 auto",
          background: "#000",
          overflow: "hidden",
        }}
      >
        <ShotPage id={id} />
      </div>
    );
  }

  return <IndexPage />;
}
