import {
  calculateNewsQualityScore,
  pickNewsForScript,
  selectQualityNews,
  type NewsArticleInput,
} from "./newsQuality.ts";

export type NewsItem = {
  id: string;
  title: string;
  source: string;
  summary: string;
  url: string;
  publishedAt: string;
  fetchedAt: string;
  topic: string;
  qualityFinalScore?: number;
};

export type RadioSlot = "morning" | "evening";

export type CollectNewsOptions = {
  radioSlot?: RadioSlot;
  userId?: string;
  /** 早報已使用的新聞 key（title normalized），晚報生成時排除 */
  excludeKeys?: Set<string>;
  maxPerTopic?: number;
  maxTotal?: number;
  durationMinutes?: number;
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

  for (const block of itemBlocks.slice(0, 50)) {
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

function toArticleInput(row: NewsItem): NewsArticleInput {
  return {
    title: row.title,
    source: row.source,
    summary: row.summary,
    url: row.url,
    publishedAt: row.publishedAt,
    fetchedAt: row.fetchedAt,
  };
}

function fromScoredArticle(row: NewsItem, scored: NewsArticleInput & { quality: { finalScore: number } }): NewsItem {
  return {
    ...row,
    title: scored.title,
    source: scored.source,
    summary: scored.summary ?? scored.description ?? row.summary,
    url: scored.url ?? scored.link ?? row.url,
    publishedAt: scored.publishedAt ?? scored.pubDate ?? row.publishedAt,
    fetchedAt: scored.fetchedAt ?? row.fetchedAt,
    qualityFinalScore: scored.quality.finalScore,
  };
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

  const perTopicPool = Math.max(perTopic + 4, 12);
  const topicBuckets: NewsItem[] = [];

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

    const candidates = rows
      .filter((row) => !excludeKeys.has(normalizeNewsKey(row.title)))
      .map((row) => ({ ...row, topic: feed.label }));

    const { selected } = selectQualityNews(
      candidates.map(toArticleInput),
      feed.label,
      {
        targetCount: perTopic,
        minCount: perTopic,
        maxPerSource: 3,
        maxPerEvent: 2,
        scoreTiers: [8, 6, 4],
        minTopicRelevance: 2,
        maxAgeHoursHard: radioSlot === "evening" ? 48 : 72,
        maxAgeHoursSoft: radioSlot === "evening" ? 12 : 24,
        enableLog: true,
      }
    );

    const rowByTitle = new Map(candidates.map((r) => [normalizeNewsKey(r.title), r]));
    for (const picked of selected) {
      const base = rowByTitle.get(normalizeNewsKey(picked.title));
      if (!base) continue;
      topicBuckets.push(fromScoredArticle({ ...base, topic: feed.label }, picked as NewsArticleInput & { quality: { finalScore: number } }));
      if (topicBuckets.filter((n) => n.topic === feed.label).length >= perTopicPool) break;
    }
  }

  const seen = new Set<string>();
  const seenUrls = new Set<string>();
  const merged: NewsItem[] = [];

  const sortedBuckets = [...topicBuckets].sort(
    (a, b) => (b.qualityFinalScore ?? 0) - (a.qualityFinalScore ?? 0)
  );

  for (const row of sortedBuckets) {
    if (merged.length >= scanMax) break;
    const key = normalizeNewsKey(row.title);
    const urlKey = row.url?.trim().toLowerCase();
    if (seen.has(key) || excludeKeys.has(key)) continue;
    if (urlKey && seenUrls.has(urlKey)) continue;
    seen.add(key);
    if (urlKey) seenUrls.add(urlKey);
    merged.push(row);
  }

  const durationMinutes = options?.durationMinutes ?? (scanMax >= 18 ? 10 : scanMax >= 12 ? 5 : 3);
  const result = pickNewsForScript(
    merged.map((row) => {
      const input = toArticleInput(row);
      const quality = calculateNewsQualityScore(input, row.topic);
      return {
        ...input,
        quality: {
          ...quality,
          finalScore: row.qualityFinalScore ?? quality.finalScore,
        },
      };
    }),
    durationMinutes
  ).map((picked) => {
    const match = merged.find((m) => normalizeNewsKey(m.title) === normalizeNewsKey(picked.title));
    return match ?? ({
      id: normalizeNewsKey(picked.title).slice(0, 120),
      title: picked.title,
      source: picked.source,
      summary: picked.summary ?? picked.description ?? "",
      url: picked.url ?? picked.link ?? "",
      publishedAt: picked.publishedAt ?? picked.pubDate ?? "",
      fetchedAt: picked.fetchedAt ?? new Date().toISOString(),
      topic: feeds[0]?.label ?? "",
    } satisfies NewsItem);
  });
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
