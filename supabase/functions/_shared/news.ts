export type NewsItem = {
  id: string;
  title: string;
  source: string;
  summary: string;
  url: string;
  publishedAt: string;
  fetchedAt: string;
  topic: string;
};

export type RadioSlot = "morning" | "evening";

export type CollectNewsOptions = {
  radioSlot?: RadioSlot;
  userId?: string;
  /** 早報已使用的新聞 key（title normalized），晚報生成時排除 */
  excludeKeys?: Set<string>;
  maxPerTopic?: number;
  maxTotal?: number;
};

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function pickTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeXmlEntities(m[1].trim()) : "";
}

export function normalizeNewsKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export function newsKeysFromSourceNews(sourceNews: unknown): Set<string> {
  const keys = new Set<string>();
  if (!Array.isArray(sourceNews)) return keys;
  for (const row of sourceNews) {
    if (!row || typeof row !== "object") continue;
    const title = "title" in row ? String((row as { title?: unknown }).title ?? "") : "";
    if (title.trim()) keys.add(normalizeNewsKey(title));
  }
  return keys;
}

export function morningHeadlinesFromSourceNews(sourceNews: unknown): string[] {
  if (!Array.isArray(sourceNews)) return [];
  const titles: string[] = [];
  for (const row of sourceNews) {
    if (!row || typeof row !== "object") continue;
    const title = "title" in row ? String((row as { title?: unknown }).title ?? "").trim() : "";
    if (title) titles.push(title);
  }
  return titles;
}

function freshnessWindow(radioSlot: RadioSlot): string {
  return radioSlot === "evening" ? "when:12h" : "when:24h";
}

function parseNewsTime(value: string | null | undefined): number {
  if (!value?.trim()) return 0;
  const ts = Date.parse(value.trim());
  return Number.isFinite(ts) ? ts : 0;
}

function newsSortTime(item: NewsItem): number {
  return parseNewsTime(item.publishedAt) || parseNewsTime(item.fetchedAt);
}

export async function fetchGoogleNewsRss(
  query: string,
  options?: { radioSlot?: RadioSlot; feedLabel?: string }
): Promise<NewsItem[]> {
  const slot = options?.radioSlot ?? "morning";
  const baseQuery = query.trim();
  const withWindow = /\bwhen:\d+[dh]\b/i.test(baseQuery)
    ? baseQuery
    : `${baseQuery} ${freshnessWindow(slot)}`.trim();
  const cacheBust = Date.now();
  const url =
    `https://news.google.com/rss/search?q=${encodeURIComponent(withWindow)}` +
    `&hl=zh-TW&gl=TW&ceid=TW:zh-Hant&_=${cacheBust}`;

  console.log("[News] fresh RSS fetch", {
    radio_slot: slot,
    feed: options?.feedLabel ?? null,
    query: withWindow,
    cache: "no-store",
  });

  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
    },
  });
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
  const xml = await res.text();
  const items: NewsItem[] = [];
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  const fetchedAt = new Date(cacheBust).toISOString();

  for (const block of itemBlocks.slice(0, 16)) {
    const title = pickTag(block, "title");
    if (!title) continue;
    const link = pickTag(block, "link");
    const pubDate = pickTag(block, "pubDate");
    const description = pickTag(block, "description").replace(/<[^>]+>/g, " ").trim();
    const source = pickTag(block, "source") || "Google News";
    items.push({
      id: normalizeNewsKey(title).slice(0, 120),
      title: title.slice(0, 500),
      source: source.slice(0, 200),
      summary: description.slice(0, 800),
      url: link.slice(0, 500),
      publishedAt: pubDate.slice(0, 80),
      fetchedAt,
      topic: "",
    });
  }
  return items.sort((a, b) => newsSortTime(b) - newsSortTime(a));
}

export async function collectNewsForUser(
  feeds: { label: string; query: string }[],
  maxPerTopic = 2,
  maxTotal = 5,
  options?: CollectNewsOptions
): Promise<NewsItem[]> {
  const radioSlot = options?.radioSlot ?? "morning";
  const excludeKeys = options?.excludeKeys ?? new Set<string>();
  const perTopic = options?.maxPerTopic ?? (radioSlot === "evening" ? 4 : maxPerTopic);
  const scanMax = options?.maxTotal ?? (radioSlot === "evening" ? 10 : maxTotal);

  const merged: NewsItem[] = [];
  const seen = new Set<string>();

  for (const feed of feeds) {
    let rows: NewsItem[] = [];
    try {
      rows = await fetchGoogleNewsRss(feed.query, {
        radioSlot,
        feedLabel: feed.label,
      });
    } catch (e) {
      console.warn("[News] RSS fetch failed for feed", {
        feed: feed.label,
        error: e instanceof Error ? e.message : "unknown",
      });
      continue;
    }
    let count = 0;
    for (const row of rows.sort((a, b) => newsSortTime(b) - newsSortTime(a))) {
      if (count >= perTopic) break;
      const key = normalizeNewsKey(row.title);
      if (seen.has(key) || excludeKeys.has(key)) continue;
      seen.add(key);
      merged.push({ ...row, topic: feed.label });
      count += 1;
      if (merged.length >= scanMax) break;
    }
    if (merged.length >= scanMax) break;
  }

  const result = merged
    .sort((a, b) => newsSortTime(b) - newsSortTime(a))
    .slice(0, scanMax);
  const publishedTimes = result.map((n) => parseNewsTime(n.publishedAt)).filter((v) => v > 0);
  const fetchedTimes = result.map((n) => parseNewsTime(n.fetchedAt)).filter((v) => v > 0);
  const selectedTimes = result.map(newsSortTime).filter((v) => v > 0);

  console.log("[News] collectNewsForUser", {
    radio_slot: radioSlot,
    feeds: feeds.length,
    exclude_count: excludeKeys.size,
    fetched_count: result.length,
    used_fresh_rss: true,
  });

  console.log(
    JSON.stringify({
      event: "news_refresh_before_radio",
      radio_slot: radioSlot,
      user_id: options?.userId ?? null,
      topics: feeds.map((f) => f.label),
      force_refresh: true,
      last_fetch_at: null,
      fetched_count: merged.length,
      upserted_count: 0,
      selected_count: result.length,
      newest_published_at: publishedTimes.length
        ? new Date(Math.max(...publishedTimes)).toISOString()
        : null,
      newest_fetched_at: fetchedTimes.length
        ? new Date(Math.max(...fetchedTimes)).toISOString()
        : null,
      oldest_selected_at: selectedTimes.length
        ? new Date(Math.min(...selectedTimes)).toISOString()
        : null,
      freshness_window_hours: radioSlot === "evening" ? 12 : 24,
      used_cache: false,
      fallback_reason: result.length === 0 ? "no_fresh_rss_items" : null,
    })
  );

  return result;
}
