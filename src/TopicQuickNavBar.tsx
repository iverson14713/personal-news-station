import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { TOKENS } from "./theme";

const STICKY_TOP_EXTRA_PX = 4;
const PHONE_MAX_WIDTH = 460;

export function getTopicSectionDomId(label: string): string {
  return `topic-section-${label.replace(/\s+/g, "-")}`;
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

export function getTopicScrollMarginPx(barHeightPx = 48): number {
  return measureSafeAreaTopPx() + barHeightPx + 8;
}

/** @deprecated 請改用 CSS 變數 --pns-topic-scroll-margin */
export const TOPIC_SECTION_SCROLL_MARGIN = getTopicScrollMarginPx();

export type TopicNavItem = {
  label: string;
  count: number;
};

type TopicQuickNavBarProps = {
  items: TopicNavItem[];
};

export function TopicQuickNavBar({ items }: TopicQuickNavBarProps) {
  const [activeLabel, setActiveLabel] = useState(items[0]?.label ?? "");
  const [pinned, setPinned] = useState(false);
  const [barHeight, setBarHeight] = useState(48);
  const [stickyTopPx, setStickyTopPx] = useState(STICKY_TOP_EXTRA_PX);

  const anchorRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const ratiosRef = useRef<Map<string, number>>(new Map());
  const clickLockRef = useRef(false);

  const syncLayoutVars = useCallback((height: number, topPx: number) => {
    const root = document.documentElement;
    root.style.setProperty("--pns-sticky-top", `${topPx}px`);
    root.style.setProperty("--pns-topic-nav-height", `${height}px`);
    root.style.setProperty("--pns-topic-scroll-margin", `${topPx + height + 8}px`);
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
      const h = barRef.current?.offsetHeight ?? 48;
      setBarHeight(h);
      syncLayoutVars(h, topPx);
    };

    measureBar();
    window.addEventListener("resize", measureBar);
    return () => window.removeEventListener("resize", measureBar);
  }, [items, pinned, syncLayoutVars]);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const updatePinned = () => {
      const topPx = measureSafeAreaTopPx();
      setStickyTopPx(topPx);
      const rect = anchor.getBoundingClientRect();
      setPinned(rect.top <= topPx + 0.5);
    };

    updatePinned();
    window.addEventListener("scroll", updatePinned, { passive: true });
    window.addEventListener("resize", updatePinned);
    return () => {
      window.removeEventListener("scroll", updatePinned);
      window.removeEventListener("resize", updatePinned);
    };
  }, [items]);

  useEffect(() => {
    if (items.length === 0) return;

    const sectionEls = items
      .map((item) => document.getElementById(getTopicSectionDomId(item.label)))
      .filter((el): el is HTMLElement => el != null);

    if (sectionEls.length === 0) return;

    ratiosRef.current = new Map(items.map((item) => [item.label, 0]));

    const scrollMargin = stickyTopPx + barHeight + 8;

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
        root: null,
        rootMargin: `-${scrollMargin}px 0px -52% 0px`,
        threshold: [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1],
      }
    );

    sectionEls.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items, stickyTopPx, barHeight]);

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
      const el = document.getElementById(getTopicSectionDomId(label));
      if (!el) return;

      const topPx = measureSafeAreaTopPx();
      const h = barRef.current?.offsetHeight ?? barHeight;
      const offset = topPx + h + 8;

      clickLockRef.current = true;
      setActiveLabel(label);

      const targetTop = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });

      window.setTimeout(() => {
        clickLockRef.current = false;
      }, 800);
    },
    [barHeight]
  );

  if (items.length === 0) return null;

  const shellStyle: CSSProperties = pinned
    ? {
        ...navStyles.fixedShell,
        top: `${stickyTopPx}px`,
      }
    : navStyles.inFlowShell;

  return (
    <>
      <div ref={anchorRef} style={navStyles.anchor} aria-hidden />
      {pinned ? <div style={{ height: barHeight, flexShrink: 0 }} aria-hidden /> : null}
      <div
        ref={barRef}
        style={{
          ...shellStyle,
          ...navStyles.bar,
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
    </>
  );
}

const navStyles: Record<string, CSSProperties> = {
  anchor: {
    height: 0,
    width: "100%",
    margin: 0,
    padding: 0,
  },
  inFlowShell: {
    position: "relative",
    zIndex: 20,
    marginTop: "4px",
    marginBottom: "6px",
  },
  fixedShell: {
    position: "fixed",
    left: "50%",
    transform: "translateX(-50%)",
    width: `min(${PHONE_MAX_WIDTH}px, 100%)`,
    maxWidth: `${PHONE_MAX_WIDTH}px`,
    paddingLeft: "max(16px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(16px, env(safe-area-inset-right, 0px))",
    boxSizing: "border-box",
    zIndex: 40,
  },
  bar: {
    minHeight: "44px",
    maxHeight: "52px",
    display: "flex",
    alignItems: "center",
    paddingTop: "4px",
    paddingBottom: "4px",
    background:
      "linear-gradient(180deg, rgba(2,6,23,.98) 0%, rgba(15,23,42,.96) 100%)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    borderBottom: "1px solid rgba(148,163,184,.18)",
    boxShadow: "0 6px 18px rgba(2,6,23,.5)",
  },
  scroller: {
    display: "flex",
    gap: "6px",
    overflowX: "auto",
    overflowY: "hidden",
    flexWrap: "nowrap",
    width: "100%",
    minHeight: "36px",
    alignItems: "center",
    padding: "0 1px",
    WebkitOverflowScrolling: "touch",
  },
  chip: {
    flexShrink: 0,
    border: "1px solid rgba(148,163,184,.22)",
    borderRadius: TOKENS.radiusPill,
    padding: "6px 11px",
    fontSize: "12px",
    fontWeight: 800,
    lineHeight: 1.15,
    color: TOKENS.textSecondary,
    background: "rgba(255,255,255,.05)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition:
      "background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease",
  },
  chipActive: {
    color: "#E0E7FF",
    background: "linear-gradient(135deg, rgba(37,99,235,.32), rgba(99,102,241,.28))",
    border: "1px solid rgba(129,140,248,.55)",
    boxShadow: "0 0 0 1px rgba(99,102,241,.18), 0 4px 12px rgba(37,99,235,.2)",
  },
};
