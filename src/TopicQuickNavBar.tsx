import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { CSSProperties } from "react";
import { TOKENS } from "./theme";

const STICKY_TOP_EXTRA_PX = 8;
const PHONE_MAX_WIDTH = 460;
const TOPIC_SCROLL_EXTRA_OFFSET_PX = 120;

export function getTopicSectionDomId(label: string): string {
  const slug = label
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fff\u3400-\u4dbf-]/g, "");
  return `topic-section-${slug || "unknown"}`;
}

function measureSafeAreaTopPx(): number {
  if (typeof document === "undefined") return STICKY_TOP_EXTRA_PX;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;left:0;height:env(safe-area-inset-top,0px);pointer-events:none;visibility:hidden";
  document.body.appendChild(probe);
  const inset = probe.getBoundingClientRect().height;
  document.body.removeChild(probe);
  return inset + STICKY_TOP_EXTRA_PX;
}

export function getTopicScrollMarginPx(barHeightPx = 52): number {
  return measureSafeAreaTopPx() + barHeightPx + 8 + TOPIC_SCROLL_EXTRA_OFFSET_PX;
}

/** @deprecated 請改用 CSS 變數 --pns-topic-scroll-margin */
export const TOPIC_SECTION_SCROLL_MARGIN = getTopicScrollMarginPx();

export type TopicNavItem = {
  label: string;
  count: number;
};

type TopicQuickNavBarProps = {
  items: TopicNavItem[];
  /** 首頁主垂直捲動容器（.page）；未傳則 fallback window */
  scrollRootRef?: RefObject<HTMLElement | null>;
};

function getScrollElement(scrollRootRef?: RefObject<HTMLElement | null>): HTMLElement | Window {
  return scrollRootRef?.current ?? window;
}

export function TopicQuickNavBar({ items, scrollRootRef }: TopicQuickNavBarProps) {
  const [activeLabel, setActiveLabel] = useState(items[0]?.label ?? "");
  const [barHeight, setBarHeight] = useState(52);
  const [stickyTopPx, setStickyTopPx] = useState(STICKY_TOP_EXTRA_PX);

  const barRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const ratiosRef = useRef<Map<string, number>>(new Map());
  const clickLockRef = useRef(false);

  const syncLayoutVars = useCallback((height: number, topPx: number) => {
    const root = document.documentElement;
    root.style.setProperty("--pns-sticky-top", `${topPx}px`);
    root.style.setProperty("--pns-topic-nav-height", `${height}px`);
    root.style.setProperty(
      "--pns-topic-scroll-margin",
      `${topPx + height + 8 + TOPIC_SCROLL_EXTRA_OFFSET_PX}px`
    );
  }, []);

  useEffect(() => {
    if (items.length === 0) {
      setActiveLabel("");
      return;
    }
    setActiveLabel((prev) =>
      items.some((item) => item.label === prev) ? prev : items[0].label
    );
  }, [items]);

  useEffect(() => {
    const topPx = measureSafeAreaTopPx();
    setStickyTopPx(topPx);

    const measureBar = () => {
      const h = barRef.current?.offsetHeight ?? 52;
      setBarHeight(h);
      syncLayoutVars(h, topPx);
    };

    measureBar();
    window.addEventListener("resize", measureBar);
    return () => window.removeEventListener("resize", measureBar);
  }, [items, syncLayoutVars]);

  useEffect(() => {
    if (items.length === 0) return;

    const sectionEls = items
      .map((item) => document.getElementById(getTopicSectionDomId(item.label)))
      .filter((el): el is HTMLElement => el != null);

    if (sectionEls.length === 0) return;

    ratiosRef.current = new Map(items.map((item) => [item.label, 0]));

    const scrollMargin = stickyTopPx + barHeight + 8;
    const scrollRoot = scrollRootRef?.current ?? null;

    const pickActiveFromRatios = () => {
      if (clickLockRef.current) return;

      let bestLabel = items[0].label;
      let bestRatio = -1;

      ratiosRef.current.forEach((ratio, label) => {
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestLabel = label;
        }
      });

      if (bestRatio > 0) {
        setActiveLabel(bestLabel);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const label = (entry.target as HTMLElement).dataset.topicLabel;
          if (!label) return;
          ratiosRef.current.set(label, entry.isIntersecting ? entry.intersectionRatio : 0);
        });
        pickActiveFromRatios();
      },
      {
        root: scrollRoot,
        rootMargin: `-${scrollMargin}px 0px -52% 0px`,
        threshold: [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1],
      }
    );

    sectionEls.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items, stickyTopPx, barHeight, scrollRootRef]);

  useEffect(() => {
    const chip = chipRefs.current.get(activeLabel);
    const scroller = scrollRef.current;
    if (!chip || !scroller) return;

    const chipLeft = chip.offsetLeft;
    const chipWidth = chip.offsetWidth;
    const viewLeft = scroller.scrollLeft;
    const viewWidth = scroller.clientWidth;
    const chipRight = chipLeft + chipWidth;
    const viewRight = viewLeft + viewWidth;

    if (chipLeft < viewLeft + 8) {
      scroller.scrollTo({ left: Math.max(0, chipLeft - 12), behavior: "smooth" });
    } else if (chipRight > viewRight - 8) {
      scroller.scrollTo({
        left: chipRight - viewWidth + 12,
        behavior: "smooth",
      });
    }
  }, [activeLabel]);

  const scrollToTopic = useCallback(
    (label: string) => {
      const sectionId = getTopicSectionDomId(label);
      const scrollToElement = (el: HTMLElement) => {
        const topPx = measureSafeAreaTopPx();
        const h = barRef.current?.offsetHeight ?? barHeight;
        const offset = topPx + h + 8 + TOPIC_SCROLL_EXTRA_OFFSET_PX;
        const scroller = getScrollElement(scrollRootRef);

        clickLockRef.current = true;
        setActiveLabel(label);

        el.style.scrollMarginTop = `${offset}px`;

        if (scroller instanceof Window) {
          const targetTop = el.getBoundingClientRect().top + window.scrollY - offset;
          window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
        } else {
          const scrollerRect = scroller.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          const targetTop =
            scroller.scrollTop + (elRect.top - scrollerRect.top) - offset;
          scroller.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
        }

        window.setTimeout(() => {
          clickLockRef.current = false;
        }, 450);
      };

      const el = document.getElementById(sectionId);
      if (el) {
        scrollToElement(el);
        return;
      }

      console.warn("[TopicNav] section not found, retrying", { label, sectionId });
      window.setTimeout(() => {
        const retryEl = document.getElementById(sectionId);
        if (retryEl) scrollToElement(retryEl);
      }, 120);
    },
    [barHeight, scrollRootRef]
  );

  if (items.length === 0) return null;

  return (
    <div
      ref={barRef}
      style={{
        ...navStyles.stickyShell,
        top: `calc(env(safe-area-inset-top, 0px) + ${STICKY_TOP_EXTRA_PX}px)`,
      }}
      aria-label="主題快速導覽"
    >
      <div ref={scrollRef} className="hide-scrollbar topic-nav-scroller" style={navStyles.scroller}>
        {items.map((item) => {
          const active = item.label === activeLabel;
          return (
            <button
              key={item.label}
              type="button"
              ref={(node) => {
                if (node) chipRefs.current.set(item.label, node);
                else chipRefs.current.delete(item.label);
              }}
              onClick={() => scrollToTopic(item.label)}
              aria-current={active ? "true" : undefined}
              style={{
                ...navStyles.chip,
                ...(active ? navStyles.chipActive : {}),
              }}
            >
              {item.label} ({item.count})
            </button>
          );
        })}
      </div>
    </div>
  );
}

const navStyles: Record<string, CSSProperties> = {
  stickyShell: {
    position: "sticky",
    zIndex: 12,
    marginTop: "4px",
    marginBottom: "6px",
    width: "100%",
    maxWidth: `${PHONE_MAX_WIDTH}px`,
    marginLeft: "auto",
    marginRight: "auto",
    boxSizing: "border-box",
    minHeight: "48px",
    maxHeight: "56px",
    display: "flex",
    alignItems: "center",
    paddingTop: "6px",
    paddingBottom: "6px",
    paddingLeft: "max(2px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(2px, env(safe-area-inset-right, 0px))",
    background:
      "linear-gradient(180deg, rgba(2,6,23,.98) 0%, rgba(15,23,42,.97) 100%)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    borderBottom: "1px solid rgba(148,163,184,.22)",
    boxShadow: "0 8px 22px rgba(2,6,23,.55)",
    pointerEvents: "auto",
  },
  scroller: {
    display: "flex",
    gap: "10px",
    overflowX: "auto",
    overflowY: "hidden",
    flexWrap: "nowrap",
    width: "100%",
    minHeight: "44px",
    alignItems: "center",
    padding: "0 2px",
    WebkitOverflowScrolling: "touch",
  },
  chip: {
    flexShrink: 0,
    border: "1px solid rgba(148,163,184,.28)",
    borderRadius: TOKENS.radiusPill,
    padding: "11px 20px",
    minHeight: "44px",
    fontSize: "15px",
    fontWeight: 700,
    lineHeight: 1.2,
    color: "#CBD5E1",
    background: "rgba(255,255,255,.06)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    transition:
      "background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.12s ease",
  },
  chipActive: {
    color: "#FFFFFF",
    fontWeight: 800,
    fontSize: "16px",
    background: "linear-gradient(135deg, rgba(37,99,235,.62), rgba(99,102,241,.52))",
    border: "2px solid rgba(147,197,253,.75)",
    boxShadow:
      "0 0 0 1px rgba(99,102,241,.28), 0 6px 18px rgba(37,99,235,.38), inset 0 1px 0 rgba(255,255,255,.12)",
    transform: "scale(1.02)",
  },
};
