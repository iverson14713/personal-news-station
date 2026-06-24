import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

const DEFAULT_ICON = "/wayne-apps/default-app-icon.png";

export type InternalPromotion = {
  id: string;
  iconSrc: string;
  title: string;
  description: string;
  ctaLabel: string;
  url: string;
};

export const INTERNAL_PROMOTIONS: InternalPromotion[] = [
  {
    id: "pet-care",
    iconSrc: "/wayne-apps/pet-care-icon.png",
    title: "Pet Care 寵物日記",
    description: "寵物喝水、尿尿與照護紀錄",
    ctaLabel: "下載",
    url: "https://apps.apple.com/tw/app/pet-care%E5%AF%B5%E7%89%A9%E6%97%A5%E8%A8%98/id6772930939",
  },
  {
    id: "lovequest",
    iconSrc: "/wayne-apps/lovequest-icon.png",
    title: "LoveQuest 情侶日常",
    description: "情侶任務、紀念日與互動工具",
    ctaLabel: "下載",
    url: "https://apps.apple.com/tw/app/lovequest%E6%83%85%E4%BE%B6%E6%97%A5%E5%B8%B8/id6772859319",
  },
  {
    id: "ai-mouth",
    iconSrc: "/wayne-apps/ai-meme-icon.png",
    title: "AI有點嘴",
    description: "AI 毒舌分析，產生可分享結果",
    ctaLabel: "下載",
    url: "https://apps.apple.com/tw/app/ai%E6%9C%89%E9%BB%9E%E5%98%B4/id6779218310",
  },
];

const PROMO_INDEX_KEY = "pns_internal_promo_index_v1";
const PROMO_ROTATE_MS = 8000;

function readPromoIndex(): number {
  if (INTERNAL_PROMOTIONS.length === 0) return 0;
  try {
    const raw = localStorage.getItem(PROMO_INDEX_KEY);
    const n = raw != null ? parseInt(raw, 10) : 0;
    if (!Number.isFinite(n) || n < 0) return 0;
    return n % INTERNAL_PROMOTIONS.length;
  } catch {
    return 0;
  }
}

function writePromoIndex(index: number) {
  if (INTERNAL_PROMOTIONS.length === 0) return;
  try {
    localStorage.setItem(PROMO_INDEX_KEY, String(index % INTERNAL_PROMOTIONS.length));
  } catch {
    /* ignore */
  }
}

function PromotionAppIcon({ src, alt }: { src: string; alt: string }) {
  const [iconSrc, setIconSrc] = useState(src);

  useEffect(() => {
    setIconSrc(src);
  }, [src]);

  return (
    <img
      src={iconSrc}
      alt={alt}
      width={44}
      height={44}
      loading="lazy"
      decoding="async"
      style={styles.appIcon}
      onError={() => {
        if (iconSrc !== DEFAULT_ICON) setIconSrc(DEFAULT_ICON);
      }}
    />
  );
}

type InternalPromotionBannerProps = {
  isPro?: boolean;
  /** 設為 true 時 Pro 也會看到推薦；預設 false（Pro 無廣告閱讀體驗） */
  showForPro?: boolean;
  variant?: "home" | "player";
};

export function InternalPromotionBanner({
  isPro = false,
  showForPro = false,
  variant = "home",
}: InternalPromotionBannerProps) {
  const [index, setIndex] = useState(readPromoIndex);

  useEffect(() => {
    writePromoIndex(index);
  }, [index]);

  useEffect(() => {
    if (INTERNAL_PROMOTIONS.length <= 1) return;
    const timerId = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % INTERNAL_PROMOTIONS.length);
    }, PROMO_ROTATE_MS);
    return () => window.clearInterval(timerId);
  }, []);

  if (isPro && !showForPro) return null;
  if (INTERNAL_PROMOTIONS.length === 0) return null;

  const app = INTERNAL_PROMOTIONS[index % INTERNAL_PROMOTIONS.length];
  if (!app) return null;

  const wrapStyle = variant === "home" ? styles.wrapHome : styles.wrapPlayer;

  return (
    <div style={wrapStyle} role="complementary" aria-label="推薦 Wayne Apps">
      <div style={styles.frame}>
        <span style={styles.sectionLabel}>推薦 Wayne Apps</span>

        <a
          href={app.url}
          target="_blank"
          rel="noopener noreferrer"
          className="internal-promo-mini-card"
          aria-label={`${app.title} — ${app.ctaLabel}`}
        >
          <PromotionAppIcon src={app.iconSrc} alt={app.title} />
          <span style={styles.textCol}>
            <span style={styles.appTitle}>{app.title}</span>
            <span style={styles.description}>{app.description}</span>
          </span>
          <span style={styles.cta}>{app.ctaLabel}</span>
        </a>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrapHome: {
    marginTop: "10px",
    marginBottom: "10px",
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
  },
  wrapPlayer: {
    marginTop: "10px",
    marginBottom: "4px",
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
  },
  frame: {
    borderRadius: "10px",
    padding: "6px 8px 7px",
    background: "rgba(15,23,42,.38)",
    border: "1px solid rgba(148,163,184,.16)",
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
    minHeight: "72px",
    maxHeight: "88px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    overflow: "hidden",
  },
  sectionLabel: {
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.02em",
    color: "rgba(148,163,184,.75)",
    lineHeight: 1.2,
    flexShrink: 0,
  },
  appIcon: {
    width: 44,
    height: 44,
    borderRadius: 11,
    flexShrink: 0,
    objectFit: "cover",
    background: "rgba(255,255,255,.06)",
    border: "1px solid rgba(148,163,184,.18)",
  },
  textCol: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: "1px",
    overflow: "hidden",
  },
  appTitle: {
    fontSize: "13px",
    fontWeight: 700,
    color: "#CBD5E1",
    lineHeight: 1.25,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  description: {
    fontSize: "11px",
    lineHeight: 1.3,
    color: "#64748B",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cta: {
    flexShrink: 0,
    fontSize: "11px",
    fontWeight: 700,
    color: "#94A3B8",
    background: "rgba(255,255,255,.05)",
    border: "1px solid rgba(148,163,184,.22)",
    borderRadius: "999px",
    padding: "4px 9px",
    lineHeight: 1.2,
  },
};
