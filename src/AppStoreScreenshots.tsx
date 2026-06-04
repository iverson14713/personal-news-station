/**
 * App Store / Google Play 行銷型截圖頁（1290×2796）
 * 僅作用於 /app-store-screenshot/*，不影響正式 App
 */

import type { CSSProperties, ReactNode } from "react";
import {
  Headphones,
  Home,
  Mic2,
  Newspaper,
  Radio,
  Settings,
  Sparkles,
  Star,
  Volume2,
} from "lucide-react";

const W = 1290;
const H = 2796;

const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif';

const SCREENSHOTS = [
  {
    id: 1,
    title: "打造你的個人 AI 新聞台",
    subtitle: "選擇 NBA、MLB、台股、ETF、BTC、國際新聞，只看你真正關心的內容。",
    footnote: "不用再看一堆無關資訊，新聞從你的興趣開始。",
    chips: ["個人化追蹤", "自訂關鍵字", "一鍵更新新聞"],
  },
  {
    id: 2,
    title: "今日大事，快速掌握",
    subtitle: "AI 幫你整理重點新聞，不用在大量資訊裡迷路。",
    footnote: "每天先看最重要的幾則，不浪費時間。",
    chips: ["AI 整理重點", "多主題整合", "快速閱讀"],
  },
  {
    id: 3,
    title: "一鍵生成 1 / 3 / 5 分鐘新聞稿",
    subtitle: "依照通勤、休息、開車時間，自由選擇想收聽的新聞長度。",
    footnote: "不用自己整理，AI 幫你變成可以直接收聽的新聞稿。",
    chips: ["1 / 3 / 5 分鐘", "AI 自動生成", "深度整理 Pro"],
  },
  {
    id: 4,
    title: "像聽廣播一樣掌握新聞",
    subtitle: "支援播放、暫停、語速調整，通勤、運動、開車時都能收聽。",
    footnote: "忙碌的時候也能掌握重要資訊。",
    chips: ["語速調整", "邊走邊聽", "廣播式體驗"],
  },
  {
    id: 5,
    title: "Pro 解鎖更完整的 AI 新聞體驗",
    subtitle: "無廣告、5 分鐘深度稿、更多主題與每日 20 次 AI 額度。",
    footnote: "適合每天都想快速掌握重點新聞的重度用戶。",
    chips: ["無廣告", "5 分鐘深度稿", "每日 20 次 AI"],
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
  opacity: 0.22,
  color: "#93C5FD",
  pointerEvents: "none",
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
        padding: "18px 32px",
        borderRadius: 999,
        background: "rgba(255,255,255,.12)",
        border: "1.5px solid rgba(147,197,253,.35)",
        fontSize: 30,
        fontWeight: 800,
        color: "#E2E8F0",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function PhoneStatusBar() {
  return (
    <div
      style={{
        height: 52,
        padding: "14px 28px 0",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: 22,
        fontWeight: 700,
        color: "#F8FAFC",
        flexShrink: 0,
      }}
    >
      <span>9:41</span>
      <span style={{ fontSize: 18, letterSpacing: 2 }}>●●●●</span>
    </div>
  );
}

function PhoneTabBar({ active }: { active: "home" | "player" | "fav" | "settings" }) {
  const tab = (id: typeof active, Icon: typeof Home, label: string) => (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        color: active === id ? "#F8FAFC" : "#64748B",
        fontSize: 18,
        fontWeight: active === id ? 800 : 600,
      }}
    >
      <Icon size={28} strokeWidth={active === id ? 2.5 : 2} />
      <span>{label}</span>
    </div>
  );
  return (
    <div
      style={{
        height: 88,
        padding: "10px 12px 16px",
        display: "flex",
        borderTop: "1px solid rgba(255,255,255,.08)",
        background: "rgba(15,23,42,.95)",
        flexShrink: 0,
      }}
    >
      {tab("home", Home, "首頁")}
      {tab("player", Headphones, "播放")}
      {tab("fav", Star, "收藏")}
      {tab("settings", Settings, "設定")}
    </div>
  );
}

function PhoneMockup({
  children,
  tab = "home",
}: {
  children: ReactNode;
  tab?: "home" | "player" | "fav" | "settings";
}) {
  return (
    <div
      style={{
        width: 748,
        height: 1520,
        borderRadius: 56,
        padding: 14,
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
          borderRadius: 44,
          overflow: "hidden",
          background: "#0F172A",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <PhoneStatusBar />
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            background:
              "radial-gradient(circle at 50% 0%, rgba(59,130,246,.12) 0%, transparent 45%), #0F172A",
          }}
        >
          {children}
        </div>
        <PhoneTabBar active={tab} />
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
  decor,
  phone,
}: {
  id: number;
  title: string;
  subtitle: string;
  footnote: string;
  chips: readonly string[];
  decor: ReactNode;
  phone: ReactNode;
}) {
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
          padding: "88px 64px 24px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
          zIndex: 2,
        }}
      >
        <div
          style={{
            fontSize: 62,
            fontWeight: 900,
            lineHeight: 1.15,
            letterSpacing: "-0.03em",
            textShadow: "0 4px 24px rgba(0,0,0,.35)",
          }}
        >
          {title}
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: 34,
            lineHeight: 1.45,
            color: "#CBD5E1",
            maxWidth: 1100,
          }}
        >
          {subtitle}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: Math.round(H * 0.2),
          left: 0,
          right: 0,
          height: Math.round(H * 0.55),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1,
        }}
      >
        {phone}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: Math.round(H * 0.25),
          padding: "32px 56px 72px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          zIndex: 2,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, justifyContent: "center" }}>
          {chips.map((c) => (
            <Chip key={c}>{c}</Chip>
          ))}
        </div>
        <div style={{ fontSize: 28, color: "#94A3B8", textAlign: "center", maxWidth: 1000 }}>
          {footnote}
        </div>
        <div style={{ fontSize: 24, color: "#64748B", fontWeight: 700 }}>AI個人新聞台</div>
      </div>
    </div>
  );
}

/* —— 手機內 UI（貼近真實 App 風格）—— */

const appHeader: CSSProperties = {
  padding: "20px 24px 12px",
  fontSize: 36,
  fontWeight: 900,
};

const card: CSSProperties = {
  margin: "0 20px 14px",
  padding: "20px 22px",
  borderRadius: 18,
  background: "rgba(255,255,255,.06)",
  border: "1px solid rgba(255,255,255,.1)",
};

function ScreenTopics() {
  const topics = [
    "NBA",
    "MLB",
    "台股",
    "ETF",
    "BTC",
    "國際",
    "科技",
    "財經",
  ];
  return (
    <div style={{ paddingBottom: 16 }}>
      <div style={appHeader}>我的追蹤主題</div>
      <div style={{ padding: "0 20px", fontSize: 22, color: "#94A3B8", marginBottom: 16 }}>
        已選 5 / 5 個主題 · 關鍵字 2 / 2
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          padding: "0 20px 20px",
        }}
      >
        {topics.map((t, i) => (
          <span
            key={t}
            style={{
              padding: "14px 22px",
              borderRadius: 999,
              fontSize: 24,
              fontWeight: 800,
              background: i < 5 ? "#F8FAFC" : "rgba(255,255,255,.08)",
              color: i < 5 ? "#0F172A" : "#CBD5E1",
              border: i < 5 ? "none" : "1px solid rgba(255,255,255,.12)",
            }}
          >
            {t}
          </span>
        ))}
      </div>
      <div style={{ ...card, marginTop: 8 }}>
        <div style={{ fontSize: 22, color: "#94A3B8", marginBottom: 10 }}>自訂關鍵字</div>
        <div
          style={{
            padding: "16px 18px",
            borderRadius: 14,
            background: "rgba(255,255,255,.08)",
            fontSize: 26,
            fontWeight: 700,
          }}
        >
          大谷翔平 · Solana
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
          <span
            style={{
              padding: "10px 18px",
              borderRadius: 12,
              background: "rgba(34,197,94,.2)",
              color: "#86EFAC",
              fontSize: 20,
              fontWeight: 800,
            }}
          >
            套用並更新
          </span>
        </div>
      </div>
      <div style={{ padding: "8px 24px", fontSize: 20, color: "#64748B" }}>
        首頁依主題整理新聞，搜尋框可查單一事件
      </div>
    </div>
  );
}

function ScreenNewsList() {
  const rows: { level: string; levelColor: string; title: string; source: string }[] = [
    {
      level: "重大",
      levelColor: "#FCA5A5",
      title: "大谷翔平單場雙安助道奇險勝",
      source: "運動新聞",
    },
    {
      level: "市場",
      levelColor: "#FDE68A",
      title: "台股早盤震盪，權值股走勢分化",
      source: "財經媒體",
    },
    {
      level: "注意",
      levelColor: "#FDBA74",
      title: "國際能源價格波動影響市場情緒",
      source: "國際新聞",
    },
    {
      level: "一般",
      levelColor: "#94A3B8",
      title: "科技龍頭財報公布前夕資金觀望",
      source: "科技報導",
    },
    {
      level: "市場",
      levelColor: "#FDE68A",
      title: "比特幣跌破關鍵價位，市場轉趨保守",
      source: "幣圈快訊",
    },
  ];
  return (
    <div>
      <div style={{ ...appHeader, display: "flex", justifyContent: "space-between" }}>
        <span>AI個人新聞台</span>
        <span style={{ fontSize: 22, color: "#94A3B8", fontWeight: 700 }}>27 則</span>
      </div>
      <div style={{ padding: "0 20px 12px", fontSize: 22, color: "#64748B" }}>
        追蹤 4 主題 · 已選 5 則
      </div>
      {rows.map((r) => (
        <div key={r.title} style={card}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span
              style={{
                fontSize: 18,
                fontWeight: 900,
                color: r.levelColor,
                flexShrink: 0,
                marginTop: 4,
              }}
            >
              {r.level}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 800,
                  lineHeight: 1.35,
                  wordBreak: "break-word",
                }}
              >
                {r.title}
              </div>
              <div style={{ marginTop: 8, fontSize: 20, color: "#64748B" }}>{r.source}</div>
            </div>
            <span style={{ fontSize: 28, color: "#64748B" }}>☆</span>
          </div>
        </div>
      ))}
      <div
        style={{
          margin: "12px 20px",
          padding: "18px",
          borderRadius: 16,
          background: "rgba(16,185,129,.15)",
          border: "1px solid rgba(45,212,191,.3)",
          textAlign: "center",
          fontSize: 24,
          fontWeight: 800,
          color: "#6EE7B7",
        }}
      >
        ✨ AI 分析
      </div>
    </div>
  );
}

function ScreenAiScript() {
  return (
    <div style={{ paddingBottom: 12 }}>
      <div style={appHeader}>AI 分析</div>
      <div style={{ padding: "0 20px 16px", fontSize: 22, color: "#94A3B8" }}>
        今日剩餘 18 / 20 次（Pro）
      </div>
      <div style={{ display: "flex", gap: 12, padding: "0 20px 16px" }}>
        {[
          { label: "1 分鐘", sub: "快報", pro: false },
          { label: "3 分鐘", sub: "平衡", pro: false },
          { label: "5 分鐘", sub: "深度", pro: true },
        ].map((d) => (
          <div
            key={d.label}
            style={{
              flex: 1,
              padding: "16px 10px",
              borderRadius: 16,
              textAlign: "center",
              background: d.pro ? "rgba(124,58,237,.25)" : "rgba(255,255,255,.08)",
              border: d.pro
                ? "2px solid rgba(167,139,250,.5)"
                : "1px solid rgba(255,255,255,.12)",
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 900 }}>{d.label}</div>
            <div style={{ fontSize: 18, color: "#94A3B8", marginTop: 4 }}>{d.sub}</div>
            {d.pro ? (
              <div style={{ fontSize: 16, color: "#C4B5FD", marginTop: 6, fontWeight: 800 }}>
                Pro
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div style={{ ...card, marginTop: 4 }}>
        <div style={{ fontSize: 22, color: "#5EEAD4", fontWeight: 800, marginBottom: 12 }}>
          AI 主播稿 · 3 分鐘
        </div>
        <div
          style={{
            fontSize: 22,
            lineHeight: 1.55,
            color: "#E2E8F0",
            maxHeight: 520,
            overflow: "hidden",
          }}
        >
          今天最值得關注的是大谷翔平的表現與加密貨幣市場波動。大谷翔平單場雙安並貢獻
          2 分打點，幫助道奇險勝響尾蛇，顯示打擊狀態持續回穩。另一個重點是加密市場波動加劇，短線情緒可能偏向保守，後續可觀察比特幣是否守住關鍵價位。
        </div>
      </div>
      <div style={{ margin: "8px 20px", display: "flex", gap: 10 }}>
        <span
          style={{
            flex: 1,
            textAlign: "center",
            padding: "14px",
            borderRadius: 14,
            background: "#22C55E",
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          播放
        </span>
        <span
          style={{
            flex: 1,
            textAlign: "center",
            padding: "14px",
            borderRadius: 14,
            background: "rgba(255,255,255,.1)",
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          複製
        </span>
      </div>
    </div>
  );
}

function ScreenPlayer() {
  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ fontSize: 28, fontWeight: 900, marginBottom: 20 }}>正在播放</div>
      <div style={{ fontSize: 22, color: "#94A3B8", marginBottom: 24 }}>今日 AI 新聞稿 · 3 分鐘</div>
      <div
        style={{
          height: 10,
          borderRadius: 999,
          background: "rgba(255,255,255,.12)",
          overflow: "hidden",
          marginBottom: 28,
        }}
      >
        <div
          style={{
            width: "58%",
            height: "100%",
            background: "linear-gradient(90deg, #6366F1, #8B5CF6)",
            borderRadius: 999,
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 20,
          marginBottom: 28,
        }}
      >
        {["⏮", "⏸", "⏭"].map((icon, i) => (
          <div
            key={icon}
            style={{
              width: i === 1 ? 88 : 64,
              height: i === 1 ? 88 : 64,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              fontSize: i === 1 ? 36 : 28,
              background:
                i === 1
                  ? "linear-gradient(135deg, #6366F1, #8B5CF6)"
                  : "rgba(255,255,255,.1)",
              fontWeight: 800,
            }}
          >
            {icon}
          </div>
        ))}
      </div>
      <div
        style={{
          textAlign: "center",
          fontSize: 24,
          fontWeight: 800,
          color: "#A5B4FC",
          marginBottom: 24,
        }}
      >
        語速 1.15x
      </div>
      <div style={card}>
        <div style={{ fontSize: 20, color: "#94A3B8", marginBottom: 10 }}>主播稿</div>
        <div style={{ fontSize: 22, lineHeight: 1.5, color: "#E2E8F0" }}>
          首先帶您關注大谷翔平。道奇隊在關鍵一戰中靠他的雙安與打點險勝對手，這不只是單場表現，也影響球隊近期戰力配置……
        </div>
      </div>
    </div>
  );
}

function ScreenPro() {
  return (
    <div style={{ padding: "12px 16px" }}>
      <div style={appHeader}>Pro 方案</div>
      <div
        style={{
          margin: "0 12px 16px",
          padding: 24,
          borderRadius: 20,
          background: "linear-gradient(145deg, rgba(30,41,59,.95), rgba(15,23,42,.98))",
          border: "2px solid rgba(167,139,250,.45)",
        }}
      >
        <div style={{ fontSize: 30, fontWeight: 900 }}>升級 Pro，打造完整 AI 新聞台</div>
        <ul
          style={{
            margin: "20px 0 0",
            paddingLeft: 28,
            fontSize: 22,
            lineHeight: 1.65,
            color: "#CBD5E1",
          }}
        >
          <li>移除所有廣告</li>
          <li>解鎖 5 分鐘深度 AI 新聞稿</li>
          <li>每日 20 次 AI 額度</li>
          <li>追蹤更多主題與自訂關鍵字</li>
          <li>收藏與 AI 歷史保留更久</li>
        </ul>
        <div style={{ marginTop: 20, fontSize: 26, fontWeight: 900, color: "#A7F3D0" }}>
          月費 NT$49 · 年費 NT$390
        </div>
        <div style={{ marginTop: 18, display: "flex", gap: 12 }}>
          <span
            style={{
              flex: 1,
              textAlign: "center",
              padding: "14px 8px",
              borderRadius: 14,
              background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
              fontSize: 20,
              fontWeight: 800,
            }}
          >
            升級 Pro
          </span>
          <span
            style={{
              flex: 1,
              textAlign: "center",
              padding: "14px 8px",
              borderRadius: 14,
              background: "rgba(255,255,255,.1)",
              fontSize: 20,
              fontWeight: 800,
            }}
          >
            輸入兌換碼
          </span>
        </div>
      </div>
      <div style={{ ...card, marginTop: 0 }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Free vs Pro</div>
        <div style={{ fontSize: 20, color: "#94A3B8", lineHeight: 1.5 }}>
          Free：每日 AI 3 次 · 主題 5 個 · 顯示廣告
          <br />
          Pro：每日 AI 20 次 · 5 分鐘深度稿 · 無廣告
        </div>
      </div>
    </div>
  );
}

function DecorSet({ variant }: { variant: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <>
      <Sparkles size={120} style={{ ...decoIcon, top: 280, left: 40 }} />
      <Newspaper size={100} style={{ ...decoIcon, top: 420, right: 48 }} />
      {variant === 3 || variant === 4 ? (
        <Mic2 size={96} style={{ ...decoIcon, top: 900, left: 24 }} />
      ) : null}
      {variant === 4 ? (
        <>
          <Headphones size={110} style={{ ...decoIcon, top: 1100, right: 32 }} />
          <Volume2 size={88} style={{ ...decoIcon, top: 1280, left: 56 }} />
          <Radio size={92} style={{ ...decoIcon, bottom: 720, right: 64 }} />
        </>
      ) : null}
      {variant === 5 ? (
        <Sparkles size={88} style={{ ...decoIcon, bottom: 780, left: 80, color: "#C4B5FD" }} />
      ) : null}
    </>
  );
}

function ShotPage({ id }: { id: number }) {
  const meta = SCREENSHOTS[id - 1];
  const screens: Record<number, { phone: ReactNode; tab: "home" | "player" | "fav" | "settings" }> = {
    1: { phone: <ScreenTopics />, tab: "settings" },
    2: { phone: <ScreenNewsList />, tab: "home" },
    3: { phone: <ScreenAiScript />, tab: "home" },
    4: { phone: <ScreenPlayer />, tab: "player" },
    5: { phone: <ScreenPro />, tab: "settings" },
  };
  const { phone, tab } = screens[id];

  return (
    <ScreenshotLayout
      id={id}
      title={meta.title}
      subtitle={meta.subtitle}
      footnote={meta.footnote}
      chips={meta.chips}
      decor={<DecorSet variant={id as 1 | 2 | 3 | 4 | 5} />}
      phone={<PhoneMockup tab={tab}>{phone}</PhoneMockup>}
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
        畫布 {W}×{H}（iPhone 6.7&quot;）· 匯出：<code>npm run screenshot:news</code>
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
