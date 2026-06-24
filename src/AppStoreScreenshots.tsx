/**
 * App Store 截圖（真實 App UI 為主，符合 Guideline 2.3.3）
 * /app-store-screenshot/iphone/:id  → 1242×2688
 * /app-store-screenshot/ipad/:id    → 2064×2752
 */

import type { CSSProperties, ReactNode } from "react";
import { Headphones, Home, Settings, Star } from "lucide-react";
import { InternalPromotionBanner } from "./InternalPromotionBanner";
import { TOKENS } from "./theme";

const IPHONE = { w: 1242, h: 2688 };
const IPAD = { w: 2064, h: 2752 };

const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif';

const SCENES = [
  { id: 1, caption: "追蹤主題，瀏覽今日新聞" },
  { id: 2, caption: "勾選新聞，一鍵產生主播稿" },
  { id: 3, caption: "AI 主播稿產生結果" },
  { id: 4, caption: "播放朗讀，調整語速" },
  { id: 5, caption: "今日洞察、收藏與歷史" },
] as const;

const DEMO_NEWS = [
  { title: "大谷翔平雙安助道奇險勝", source: "MLB", selected: true },
  { title: "台股早盤震盪走勢分化", source: "台股", selected: true },
  { title: "BTC 站穩 9 萬美元關卡", source: "BTC", selected: false },
  { title: "Fed 官員談話影響市場預期", source: "國際", selected: false },
];

const TOPICS = ["NBA", "台股", "BTC", "國際"];

function parseRoute(pathname: string): { device: "iphone" | "ipad"; id: number } | null {
  const m = pathname.match(/\/app-store-screenshot\/(iphone|ipad)\/(\d+)\/?$/);
  if (!m) return null;
  const id = Number(m[2]);
  if (id < 1 || id > 5) return null;
  return { device: m[1] as "iphone" | "ipad", id };
}

function scale(device: "iphone" | "ipad") {
  return device === "ipad" ? 1.28 : 1;
}

function ScreenshotCanvas({
  device,
  sceneId,
  caption,
  children,
}: {
  device: "iphone" | "ipad";
  sceneId: number;
  caption: string;
  children: ReactNode;
}) {
  const size = device === "ipad" ? IPAD : IPHONE;
  const s = scale(device);
  return (
    <div
      id={`screenshot-${device}-${sceneId}`}
      style={{
        width: size.w,
        height: size.h,
        margin: 0,
        boxSizing: "border-box",
        fontFamily: FONT,
        color: TOKENS.textPrimary,
        background: TOKENS.bgPage,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: `${Math.round(28 * s)}px ${Math.round(36 * s)}px ${Math.round(16 * s)}px`,
          fontSize: Math.round(34 * s),
          fontWeight: 700,
          color: TOKENS.textSecondary,
          flexShrink: 0,
        }}
      >
        {caption}
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: `0 ${Math.round(24 * s)}px` }}>{children}</div>
    </div>
  );
}

function PhoneShell({ device, children }: { device: "iphone" | "ipad"; children: ReactNode }) {
  const s = scale(device);
  const maxW = device === "ipad" ? 1180 : 760;
  return (
    <div
      style={{
        width: "100%",
        maxWidth: maxW,
        margin: "0 auto",
        height: "100%",
        borderRadius: Math.round(36 * s),
        border: `2px solid ${TOKENS.cardBorder}`,
        background: "rgba(2,6,23,.92)",
        boxShadow: TOKENS.glowSelected,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

function StatusBar({ s }: { s: number }) {
  return (
    <div
      style={{
        height: Math.round(44 * s),
        padding: `${Math.round(12 * s)}px ${Math.round(24 * s)}px 0`,
        fontSize: Math.round(26 * s),
        color: TOKENS.textMuted,
        display: "flex",
        justifyContent: "space-between",
      }}
    >
      <span>9:41</span>
      <span>5G ▮▮▮</span>
    </div>
  );
}

function BottomNav({ device, active }: { device: "iphone" | "ipad"; active: string }) {
  const s = scale(device);
  const items = [
    { key: "home", label: "首頁", Icon: Home },
    { key: "player", label: "播放", Icon: Headphones },
    { key: "favorites", label: "收藏", Icon: Star },
    { key: "settings", label: "設定", Icon: Settings },
  ];
  return (
    <div
      style={{
        borderTop: `1px solid ${TOKENS.cardBorder}`,
        display: "flex",
        padding: `${Math.round(10 * s)}px 0 calc(${Math.round(14 * s)}px + env(safe-area-inset-bottom))`,
        background: "rgba(15,23,42,.95)",
      }}
    >
      {items.map(({ key, label, Icon }) => (
        <div
          key={key}
          style={{
            flex: 1,
            textAlign: "center",
            fontSize: Math.round(22 * s),
            color: active === key ? "#A5B4FC" : TOKENS.textMuted,
            fontWeight: active === key ? 800 : 600,
          }}
        >
          <Icon size={Math.round(28 * s)} style={{ margin: "0 auto", display: "block" }} />
          {label}
        </div>
      ))}
    </div>
  );
}

function TopicChips({ s }: { s: number }) {
  return (
    <div style={{ display: "flex", gap: Math.round(10 * s), flexWrap: "wrap", padding: `0 ${Math.round(20 * s)}px` }}>
      {TOPICS.map((t, i) => (
        <span
          key={t}
          style={{
            padding: `${Math.round(10 * s)}px ${Math.round(18 * s)}px`,
            borderRadius: 999,
            fontSize: Math.round(24 * s),
            fontWeight: 700,
            background: i < 3 ? "rgba(99,102,241,.35)" : "rgba(255,255,255,.08)",
            border: `1px solid ${i < 3 ? TOKENS.cardBorderActive : TOKENS.cardBorder}`,
          }}
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function NewsRow({
  s,
  title,
  source,
  selected,
}: {
  s: number;
  title: string;
  source: string;
  selected?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: Math.round(14 * s),
        padding: `${Math.round(16 * s)}px ${Math.round(20 * s)}px`,
        borderBottom: `1px solid ${TOKENS.cardBorder}`,
      }}
    >
      <div
        style={{
          width: Math.round(28 * s),
          height: Math.round(28 * s),
          borderRadius: 8,
          border: `2px solid ${selected ? "#818CF8" : TOKENS.cardBorder}`,
          background: selected ? "rgba(99,102,241,.4)" : "transparent",
          flexShrink: 0,
          marginTop: 4,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: Math.round(28 * s), fontWeight: 800, lineHeight: 1.35 }}>{title}</div>
        <div style={{ fontSize: Math.round(22 * s), color: TOKENS.textMuted, marginTop: 6 }}>{source}</div>
      </div>
    </div>
  );
}

function SceneHome({ device }: { device: "iphone" | "ipad" }) {
  const s = scale(device);
  return (
    <PhoneShell device={device}>
      <StatusBar s={s} />
      <div style={{ padding: `${Math.round(12 * s)}px ${Math.round(24 * s)}px` }}>
        <div style={{ fontSize: Math.round(40 * s), fontWeight: 900 }}>今日 AI 新聞台</div>
        <div style={{ fontSize: Math.round(24 * s), color: TOKENS.textSecondary, marginTop: 8 }}>
          追蹤 3 個主題｜27 則新聞
        </div>
      </div>
      <TopicChips s={s} />
      <div style={{ margin: `${Math.round(16 * s)}px ${Math.round(20 * s)}px`, flex: 1, overflow: "hidden", borderRadius: Math.round(16 * s), border: `1px solid ${TOKENS.cardBorder}`, background: TOKENS.cardBg }}>
        <div style={{ padding: `${Math.round(14 * s)}px ${Math.round(20 * s)}px`, fontSize: Math.round(26 * s), fontWeight: 800, color: "#A5B4FC" }}>NBA</div>
        {DEMO_NEWS.slice(0, 3).map((n) => (
          <NewsRow key={n.title} s={s} title={n.title} source={n.source} selected={n.selected} />
        ))}
      </div>
      <div style={{ margin: `0 ${Math.round(20 * s)}px ${Math.round(8 * s)}px` }}>
        <InternalPromotionBanner isPro={false} variant="home" />
      </div>
      <BottomNav device={device} active="home" />
    </PhoneShell>
  );
}

function SceneSelectNews({ device }: { device: "iphone" | "ipad" }) {
  const s = scale(device);
  return (
    <PhoneShell device={device}>
      <StatusBar s={s} />
      <div style={{ padding: `${Math.round(16 * s)}px ${Math.round(24 * s)}px` }}>
        <div style={{ fontSize: Math.round(36 * s), fontWeight: 900 }}>勾選要分析的新聞</div>
        <div style={{ fontSize: Math.round(24 * s), color: TOKENS.textSecondary, marginTop: 8 }}>已選 2 則</div>
      </div>
      <div style={{ flex: 1, margin: `0 ${Math.round(20 * s)}px`, borderRadius: Math.round(16 * s), border: `1px solid ${TOKENS.cardBorder}`, background: TOKENS.cardBg, overflow: "hidden" }}>
        {DEMO_NEWS.map((n) => (
          <NewsRow key={n.title} s={s} title={n.title} source={n.source} selected={n.selected} />
        ))}
      </div>
      <div style={{ padding: Math.round(20 * s) }}>
        <div
          style={{
            width: "100%",
            padding: `${Math.round(18 * s)}px`,
            borderRadius: Math.round(16 * s),
            background: TOKENS.primaryGradient,
            textAlign: "center",
            fontSize: Math.round(30 * s),
            fontWeight: 900,
          }}
        >
          ✨ 產生 AI 主播稿
        </div>
        <div style={{ textAlign: "center", marginTop: 10, fontSize: Math.round(22 * s), color: TOKENS.textMuted }}>
          今日剩餘 2 / 2 次
        </div>
      </div>
      <BottomNav device={device} active="home" />
    </PhoneShell>
  );
}

function SceneAiScript({ device }: { device: "iphone" | "ipad" }) {
  const s = scale(device);
  return (
    <PhoneShell device={device}>
      <StatusBar s={s} />
      <div style={{ padding: `${Math.round(16 * s)}px ${Math.round(24 * s)}px` }}>
        <div style={{ fontSize: Math.round(36 * s), fontWeight: 900 }}>AI 主播稿</div>
        <div style={{ display: "flex", gap: Math.round(10 * s), marginTop: Math.round(14 * s) }}>
          {(["1 分鐘", "3 分鐘", "5 分鐘 Pro"] as const).map((label, i) => (
            <span
              key={label}
              style={{
                flex: 1,
                textAlign: "center",
                padding: `${Math.round(12 * s)}px`,
                borderRadius: Math.round(12 * s),
                fontSize: Math.round(22 * s),
                fontWeight: 800,
                border: `1px solid ${i === 1 ? TOKENS.cardBorderActive : TOKENS.cardBorder}`,
                background: i === 1 ? "rgba(99,102,241,.25)" : "rgba(255,255,255,.06)",
              }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
      <div
        style={{
          flex: 1,
          margin: `0 ${Math.round(20 * s)}px`,
          padding: Math.round(24 * s),
          borderRadius: Math.round(16 * s),
          border: `1px solid ${TOKENS.cardBorder}`,
          background: TOKENS.cardBg,
          fontSize: Math.round(26 * s),
          lineHeight: 1.65,
          color: TOKENS.textPrimary,
        }}
      >
        各位聽眾朋友大家好，歡迎收聽今日 AI 新聞台。首先關注 MLB：大谷翔平今日貢獻雙安，協助道奇以一分之差驚險取勝…
        <br />
        <br />
        轉看台股，早盤呈現震盪格局，類股走勢分化，半導體相對強勢…
      </div>
      <div style={{ padding: Math.round(20 * s), display: "flex", gap: Math.round(12 * s) }}>
        <div style={{ flex: 1, padding: Math.round(16 * s), borderRadius: 14, background: TOKENS.ctaGreen, textAlign: "center", fontWeight: 900, fontSize: Math.round(28 * s) }}>▶ 播放</div>
        <div style={{ flex: 1, padding: Math.round(16 * s), borderRadius: 14, border: `1px solid ${TOKENS.cardBorder}`, textAlign: "center", fontWeight: 800, fontSize: Math.round(26 * s) }}>複製文稿</div>
      </div>
      <BottomNav device={device} active="player" />
    </PhoneShell>
  );
}

function ScenePlayer({ device }: { device: "iphone" | "ipad" }) {
  const s = scale(device);
  return (
    <PhoneShell device={device}>
      <StatusBar s={s} />
      <div style={{ padding: `${Math.round(20 * s)}px ${Math.round(24 * s)}px`, textAlign: "center" }}>
        <div style={{ fontSize: Math.round(32 * s), fontWeight: 900 }}>正在播放</div>
        <div style={{ fontSize: Math.round(24 * s), color: TOKENS.textSecondary, marginTop: 8 }}>3 分鐘 AI 主播稿</div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: Math.round(24 * s) }}>
        <div
          style={{
            width: Math.round(160 * s),
            height: Math.round(160 * s),
            borderRadius: "50%",
            background: TOKENS.ctaPurple,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: Math.round(56 * s),
            boxShadow: "0 16px 48px rgba(99,102,241,.45)",
          }}
        >
          ⏸
        </div>
        <div style={{ width: "80%", height: 8, borderRadius: 999, background: "rgba(255,255,255,.12)" }}>
          <div style={{ width: "42%", height: "100%", borderRadius: 999, background: "#818CF8" }} />
        </div>
        <div style={{ fontSize: Math.round(28 * s), fontWeight: 800, color: "#A5B4FC" }}>語速 1.15x</div>
      </div>
      <div style={{ margin: `0 ${Math.round(20 * s)}px ${Math.round(20 * s)}px`, padding: Math.round(20 * s), borderRadius: 16, background: TOKENS.cardBg, border: `1px solid ${TOKENS.cardBorder}`, fontSize: Math.round(24 * s), lineHeight: 1.5 }}>
        大谷翔平雙安，道奇險勝。台股早盤震盪，類股分化…
      </div>
      <BottomNav device={device} active="player" />
    </PhoneShell>
  );
}

function SceneInsight({ device }: { device: "iphone" | "ipad" }) {
  const s = scale(device);
  return (
    <PhoneShell device={device}>
      <StatusBar s={s} />
      <div style={{ padding: `${Math.round(16 * s)}px ${Math.round(24 * s)}px` }}>
        <div style={{ fontSize: Math.round(36 * s), fontWeight: 900 }}>AI 今日洞察</div>
      </div>
      <div style={{ margin: `0 ${Math.round(20 * s)}px`, padding: Math.round(20 * s), borderRadius: 16, border: `1px solid ${TOKENS.cardBorder}`, background: TOKENS.cardBg }}>
        <div style={{ fontSize: Math.round(24 * s), color: "#A5B4FC", fontWeight: 800 }}>今日重點趨勢</div>
        <ul style={{ margin: `${Math.round(12 * s)}px 0 0`, paddingLeft: Math.round(24 * s), fontSize: Math.round(24 * s), lineHeight: 1.55 }}>
          <li>MLB：大谷表現帶動道奇戰績</li>
          <li>台股：類股輪動，留意半導體</li>
          <li>加密：BTC 高位整理</li>
        </ul>
      </div>
      <div style={{ margin: Math.round(20 * s), fontSize: Math.round(28 * s), fontWeight: 800 }}>⭐ 收藏新聞</div>
      <NewsRow s={s} title="大谷翔平雙安助道奇險勝" source="MLB · 已收藏" />
      <div style={{ margin: `${Math.round(8 * s)}px ${Math.round(20 * s)}px 0`, fontSize: Math.round(28 * s), fontWeight: 800 }}>🕐 AI 歷史紀錄</div>
      <div style={{ margin: `0 ${Math.round(20 * s)}px`, padding: Math.round(16 * s), borderRadius: 12, background: "rgba(255,255,255,.06)", fontSize: Math.round(24 * s) }}>
        3 分鐘稿 · 今天 08:30 · 2 則新聞
      </div>
      <div style={{ flex: 1 }} />
      <BottomNav device={device} active="favorites" />
    </PhoneShell>
  );
}

function SceneView({ device, id }: { device: "iphone" | "ipad"; id: number }) {
  const scene = SCENES.find((x) => x.id === id)!;
  const body =
    id === 1 ? (
      <SceneHome device={device} />
    ) : id === 2 ? (
      <SceneSelectNews device={device} />
    ) : id === 3 ? (
      <SceneAiScript device={device} />
    ) : id === 4 ? (
      <ScenePlayer device={device} />
    ) : (
      <SceneInsight device={device} />
    );

  return (
    <ScreenshotCanvas device={device} sceneId={id} caption={scene.caption}>
      {body}
    </ScreenshotCanvas>
  );
}

function IndexPage() {
  const link: CSSProperties = { color: "#93C5FD", display: "block", margin: "8px 0" };
  return (
    <div style={{ padding: 24, fontFamily: FONT, background: "#0F172A", color: "#F8FAFC", minHeight: "100vh" }}>
      <h1>App Store 截圖預覽</h1>
      <p>真實 App UI 為主 · iPhone 1242×2688 · iPad 2064×2752</p>
      <h2>iPhone</h2>
      {SCENES.map((s) => (
        <a key={`i-${s.id}`} href={`/app-store-screenshot/iphone/${s.id}`} style={link}>
          {s.id}. {s.caption}
        </a>
      ))}
      <h2>iPad</h2>
      {SCENES.map((s) => (
        <a key={`p-${s.id}`} href={`/app-store-screenshot/ipad/${s.id}`} style={link}>
          {s.id}. {s.caption}
        </a>
      ))}
      <p style={{ marginTop: 24, color: "#94A3B8" }}>
        匯出：<code>npm run screenshot:apple</code>
      </p>
    </div>
  );
}

export default function AppStoreScreenshots() {
  const path = window.location.pathname;
  const route = parseRoute(path);
  if (route) {
    return <SceneView device={route.device} id={route.id} />;
  }
  if (path === "/app-store-screenshot" || path === "/app-store-screenshot/") {
    return <IndexPage />;
  }
  const legacy = path.match(/\/app-store-screenshot\/news\/(\d+)/);
  if (legacy) {
    return <SceneView device="iphone" id={Number(legacy[1])} />;
  }
  return <IndexPage />;
}
