/**
 * App Store / Google Play 截圖專用頁（1290×2796，不影響正式 App）
 */

import type { CSSProperties } from "react";

const W = 1290;
const H = 2796;

const SCREENSHOTS = [
  {
    id: 1,
    tagline: "打造你的個人 AI 新聞台",
    subtitle: "自訂 NBA、MLB、台股、ETF、BTC、國際新聞等主題",
  },
  {
    id: 2,
    tagline: "今日大事，快速掌握",
    subtitle: "重要新聞列表與 AI 重點整理",
  },
  {
    id: 3,
    tagline: "一鍵生成 1 / 3 / 5 分鐘新聞稿",
    subtitle: "依通勤時間選擇 AI 主播稿長度",
  },
  {
    id: 4,
    tagline: "通勤、運動、開車都能聽",
    subtitle: "播放控制 · 語速調整 · AI 主播稿",
  },
  {
    id: 5,
    tagline: "Pro 解鎖無廣告與 5 分鐘深度稿",
    subtitle: "移除廣告 · 每日更多 AI 次數",
  },
] as const;

const canvas: CSSProperties = {
  width: W,
  height: H,
  margin: "0 auto",
  boxSizing: "border-box",
  background:
    "radial-gradient(circle at 20% 0%, #1D4ED8 0%, transparent 35%), linear-gradient(180deg, #020617 0%, #0F172A 55%, #020617 100%)",
  color: "#F8FAFC",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif',
  overflow: "hidden",
  position: "relative",
};

function parseShotId(pathname: string): number | null {
  const m = pathname.match(/\/app-store-screenshot\/news\/(\d+)\/?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 5 ? n : null;
}

function IndexPage() {
  return (
    <div style={{ padding: 24, background: "#0F172A", minHeight: "100vh", color: "#E2E8F0" }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>App Store 截圖索引</h1>
      <ul style={{ lineHeight: 2 }}>
        {SCREENSHOTS.map((s) => (
          <li key={s.id}>
            <a href={`/app-store-screenshot/news/${s.id}`} style={{ color: "#93C5FD" }}>
              第 {s.id} 張 — {s.tagline}
            </a>
          </li>
        ))}
      </ul>
      <p style={{ marginTop: 24, fontSize: 13, color: "#94A3B8" }}>
        畫布尺寸 {W}×{H}（iPhone 6.7&quot;）
      </p>
    </div>
  );
}

function Shot1() {
  const chips = ["NBA", "MLB", "台股", "ETF", "BTC", "國際新聞"];
  return (
    <div style={{ padding: "120px 80px" }}>
      <div style={{ fontSize: 28, color: "#5EEAD4", fontWeight: 800, letterSpacing: "0.08em" }}>
        AI個人新聞台
      </div>
      <div style={{ marginTop: 48, display: "flex", flexWrap: "wrap", gap: 20 }}>
        {chips.map((c) => (
          <span
            key={c}
            style={{
              padding: "22px 36px",
              borderRadius: 999,
              background: "rgba(255,255,255,.1)",
              border: "2px solid rgba(255,255,255,.15)",
              fontSize: 36,
              fontWeight: 800,
            }}
          >
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

function Shot2() {
  const rows = [
    "🔥 聯準會釋出最新利率決策重點",
    "⚠️ 台股早盤震盪，權值股走勢分化",
    "ℹ️ 國際能源價格波動影響市場情緒",
    "ℹ️ 科技龍頭財報公布前夕資金觀望",
  ];
  return (
    <div style={{ padding: "100px 72px" }}>
      <div style={{ fontSize: 32, color: "#94A3B8", marginBottom: 32 }}>今日新聞</div>
      {rows.map((t, i) => (
        <div
          key={i}
          style={{
            marginBottom: 28,
            padding: "36px 40px",
            borderRadius: 28,
            background: "rgba(255,255,255,.07)",
            border: "1px solid rgba(255,255,255,.1)",
            fontSize: 34,
            fontWeight: 700,
            lineHeight: 1.35,
          }}
        >
          {t}
        </div>
      ))}
    </div>
  );
}

function Shot3() {
  return (
    <div style={{ padding: "140px 80px", textAlign: "center" }}>
      <div
        style={{
          margin: "80px auto 0",
          padding: "48px 64px",
          borderRadius: 40,
          background: "linear-gradient(135deg, #0D9488, #059669)",
          fontSize: 44,
          fontWeight: 900,
          boxShadow: "0 24px 60px rgba(13,148,136,.4)",
        }}
      >
        ✨ AI 分析
      </div>
      <div style={{ marginTop: 64, display: "flex", justifyContent: "center", gap: 28 }}>
        {(["1 分鐘", "3 分鐘", "5 分鐘"] as const).map((label, i) => (
          <div
            key={label}
            style={{
              padding: "32px 48px",
              borderRadius: 24,
              background: i === 2 ? "rgba(124,58,237,.35)" : "rgba(255,255,255,.08)",
              border: i === 2 ? "2px solid #A78BFA" : "1px solid rgba(255,255,255,.12)",
              fontSize: 32,
              fontWeight: 800,
            }}
          >
            {label}
            {i === 2 ? <div style={{ fontSize: 22, marginTop: 8, color: "#C4B5FD" }}>Pro</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function Shot4() {
  return (
    <div style={{ padding: "100px 72px" }}>
      <div
        style={{
          marginTop: 60,
          padding: 56,
          borderRadius: 36,
          background: "rgba(15,23,42,.9)",
          border: "1px solid rgba(255,255,255,.12)",
        }}
      >
        <div style={{ fontSize: 40, fontWeight: 900, marginBottom: 24 }}>▶ 播放中</div>
        <div
          style={{
            height: 12,
            borderRadius: 999,
            background: "rgba(255,255,255,.12)",
            overflow: "hidden",
            marginBottom: 40,
          }}
        >
          <div style={{ width: "62%", height: "100%", background: "#6366F1" }} />
        </div>
        <div style={{ fontSize: 30, color: "#94A3B8" }}>語速 1.00x · AI 主播稿</div>
        <div style={{ marginTop: 48, display: "flex", gap: 24 }}>
          {["⏸", "■", "1.0x"].map((b) => (
            <div
              key={b}
              style={{
                flex: 1,
                textAlign: "center",
                padding: "28px 0",
                borderRadius: 20,
                background: "rgba(255,255,255,.1)",
                fontSize: 32,
                fontWeight: 800,
              }}
            >
              {b}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Shot5() {
  return (
    <div style={{ padding: "100px 72px" }}>
      <div
        style={{
          marginTop: 48,
          padding: 48,
          borderRadius: 32,
          background: "linear-gradient(145deg, rgba(30,41,59,.95), rgba(15,23,42,.95))",
          border: "2px solid rgba(167,139,250,.4)",
        }}
      >
        <div style={{ fontSize: 38, fontWeight: 900 }}>升級 Pro</div>
        <ul style={{ marginTop: 32, paddingLeft: 28, fontSize: 30, lineHeight: 1.6, color: "#CBD5E1" }}>
          <li>移除所有廣告</li>
          <li>解鎖 5 分鐘深度 AI 新聞稿</li>
          <li>每日 20 次 AI 分析</li>
        </ul>
        <div style={{ marginTop: 40, fontSize: 34, fontWeight: 800, color: "#A7F3D0" }}>
          月費 NT$49 · 年費 NT$390
        </div>
      </div>
      <div style={{ marginTop: 40, fontSize: 28, color: "#64748B", textAlign: "center" }}>
        無廣告 · 5 分鐘深度稿已解鎖
      </div>
    </div>
  );
}

function ShotBody({ id }: { id: number }) {
  const meta = SCREENSHOTS[id - 1];
  const Body =
    id === 1 ? Shot1 : id === 2 ? Shot2 : id === 3 ? Shot3 : id === 4 ? Shot4 : Shot5;

  return (
    <div style={canvas} id={`screenshot-${id}`}>
      <div
        style={{
          position: "absolute",
          top: 100,
          left: 72,
          right: 72,
          fontSize: 56,
          fontWeight: 900,
          lineHeight: 1.2,
          letterSpacing: "-0.02em",
        }}
      >
        {meta.tagline}
      </div>
      <div
        style={{
          position: "absolute",
          top: 220,
          left: 72,
          right: 72,
          fontSize: 32,
          color: "#94A3B8",
          lineHeight: 1.4,
        }}
      >
        {meta.subtitle}
      </div>
      <Body />
      <div
        style={{
          position: "absolute",
          bottom: 80,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 26,
          color: "#64748B",
        }}
      >
        AI個人新聞台
      </div>
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
      <div style={{ background: "#000", minHeight: "100vh", display: "flex", justifyContent: "center" }}>
        <ShotBody id={id} />
      </div>
    );
  }

  return <IndexPage />;
}
