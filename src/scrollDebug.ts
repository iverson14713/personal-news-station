/** P0 捲動診斷 — 真機確認後可改為 import.meta.env.DEV */
const SCROLL_DEBUG_ENABLED = false;

function overflowBlocksScroll(value: string): boolean {
  return value === "hidden" || value === "auto" || value === "scroll" || value === "clip";
}

export function logScrollDebug(
  label: string,
  pageEl: HTMLElement | null,
  navEl?: HTMLElement | null
): void {
  if (!SCROLL_DEBUG_ENABLED) return;

  const html = document.documentElement;
  const body = document.body;
  const root = document.getElementById("root");

  const pageScrollHeight = pageEl?.scrollHeight ?? 0;
  const pageClientHeight = pageEl?.clientHeight ?? 0;
  const pageCanScroll = pageScrollHeight > pageClientHeight + 1;

  console.log(`[ScrollDebug] ${label}`);
  console.log("[ScrollDebug] page can scroll?", pageCanScroll);
  console.log("[ScrollDebug] scrollHeight > clientHeight?", pageCanScroll);
  console.log("[ScrollDebug] documentElement", {
    scrollHeight: html.scrollHeight,
    clientHeight: html.clientHeight,
  });
  console.log("[ScrollDebug] body", {
    scrollHeight: body.scrollHeight,
    clientHeight: body.clientHeight,
    overflow: getComputedStyle(body).overflow,
    overflowY: getComputedStyle(body).overflowY,
  });
  console.log("[ScrollDebug] #root", root
    ? {
        scrollHeight: root.scrollHeight,
        clientHeight: root.clientHeight,
        overflow: getComputedStyle(root).overflow,
        overflowY: getComputedStyle(root).overflowY,
      }
    : null);
  console.log("[ScrollDebug] .page", pageEl
    ? {
        scrollHeight: pageScrollHeight,
        clientHeight: pageClientHeight,
        overflow: getComputedStyle(pageEl).overflow,
        overflowY: getComputedStyle(pageEl).overflowY,
      }
    : null);

  if (navEl) {
    const navCs = getComputedStyle(navEl);
    console.log("[ScrollDebug] TopicQuickNavBar", {
      position: navCs.position,
      top: navCs.top,
      zIndex: navCs.zIndex,
      height: navCs.height,
    });
  }

  const blocking: string[] = [];
  let node: HTMLElement | null = pageEl;
  while (node) {
    const cs = getComputedStyle(node);
    if (
      overflowBlocksScroll(cs.overflow) ||
      overflowBlocksScroll(cs.overflowY) ||
      overflowBlocksScroll(cs.overflowX)
    ) {
      const id = node.id ? `#${node.id}` : "";
      const cls = node.className && typeof node.className === "string" ? `.${node.className.split(" ")[0]}` : "";
      blocking.push(`${node.tagName.toLowerCase()}${id}${cls} overflow=${cs.overflow} overflowY=${cs.overflowY}`);
    }
    node = node.parentElement;
  }
  console.log("[ScrollDebug] blocking overflow parent?", blocking.length ? blocking : "none");
}
