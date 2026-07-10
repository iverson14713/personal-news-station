import {
  calculateNewsQualityScore,
  pickNewsForScript,
  selectQualityNewsForRadio,
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

export type CollectNewsResult = {
  items: NewsItem[];
  rawCandidateCount: number;
  qualitySelectedCount: number;
  hardRejectedCount: number;
  usedRelaxedFallback: boolean;
  usedEmergencyFallback: boolean;
  qualityThresholdUsed: number;
  fallbackLevel: number;
  perTopicStats: Array<{
    topic: string;
    rawCount: number;
    selectedCount: number;
    hardRejectedCount: number;
    usedEmergencyFallback: boolean;
    qualityThresholdUsed: number;
    fallbackLevel: number;
  }>;
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
  // 與首頁 api/news.ts 一致（when:2d）；晚報維持較短視窗
  return radioSlot === "evening" ? "when:12h" : "when:2d";
}

const RADIO_RSS_SCAN_MAX = 130;
const RADIO_MORNING_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const RADIO_EVENING_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function cleanNewsTitle(title: string): string {
  return title.replace(/\s-\s.*$/, "").trim();
}

function newsDedupeKey(url: string, title: string): string {
  const urlKey = url.trim().toLowerCase();
  if (urlKey) return urlKey;
  return normalizeNewsKey(title);
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
  const maxAgeMs = slot === "evening" ? RADIO_EVENING_MAX_AGE_MS : RADIO_MORNING_MAX_AGE_MS;

  for (const block of itemBlocks.slice(0, RADIO_RSS_SCAN_MAX)) {
    const rawTitle = pickTag(block, "title");
    if (!rawTitle) continue;
    const title = cleanNewsTitle(rawTitle).slice(0, 500);
    const link = pickTag(block, "link");
    const pubDate = pickTag(block, "pubDate");
    const pubTs = parseNewsTime(pubDate);
    if (pubTs > 0) {
      const ageMs = cacheBust - pubTs;
      if (ageMs < 0 || ageMs > maxAgeMs) continue;
    }
    const description = pickTag(block, "description").replace(/<[^>]+>/g, " ").trim();
    const source =
      pickTag(block, "source") || rawTitle.split(" - ").pop() || "Google News";
    items.push({
      id: newsDedupeKey(link, title).slice(0, 120),
      title,
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
    description: row.summary,
    url: row.url,
    link: row.url,
    publishedAt: row.publishedAt,
    pubDate: row.publishedAt,
    fetchedAt: row.fetchedAt,
    topic: row.topic,
  };
}

function fromScoredArticle(
  row: NewsItem,
  scored: NewsArticleInput & { quality: { finalScore: number } }
): NewsItem {
  return {
    ...row,
    title: scored.title,
    source: scored.source,
    summary: scored.summary ?? scored.description ?? row.summary,
    url: scored.url ?? scored.link ?? row.url,
    publishedAt: scored.publishedAt ?? scored.pubDate ?? row.publishedAt,
    fetchedAt: scored.fetchedAt ?? row.fetchedAt,
    topic: scored.topic ?? row.topic,
    qualityFinalScore: scored.quality.finalScore,
  };
}

export async function collectNewsForUser(
  feeds: { label: string; query: string }[],
  maxPerTopic = 2,
  maxTotal = 5,
  options?: CollectNewsOptions
): Promise<CollectNewsResult> {
  const radioSlot = options?.radioSlot ?? "morning";
  const excludeKeys = options?.excludeKeys ?? new Set<string>();
  const perTopic = options?.maxPerTopic ?? (radioSlot === "evening" ? 4 : maxPerTopic);
  const scanMax = options?.maxTotal ?? (radioSlot === "evening" ? 10 : maxTotal);
  const durationMinutes = options?.durationMinutes ?? (scanMax >= 18 ? 10 : scanMax >= 12 ? 5 : 3);
  const durationMins: Record<number, number> = { 3: 3, 5: 5, 10: 8 };
  const totalMinNeeded = durationMins[durationMinutes] ?? 3;
  const perTopicMin = Math.max(1, Math.ceil(totalMinNeeded / Math.max(feeds.length, 1)));
  const perTopicTarget = Math.max(perTopic, perTopicMin);

  const perTopicPool = Math.max(perTopicTarget + 4, 12);
  const topicBuckets: NewsItem[] = [];
  const perTopicStats: CollectNewsResult["perTopicStats"] = [];
  let rawCandidateCount = 0;
  let qualitySelectedCount = 0;
  let hardRejectedCount = 0;
  let usedRelaxedFallback = false;
  let usedEmergencyFallback = false;
  let qualityThresholdUsed = 8;
  let fallbackLevel = 0;
  const pendingByTopic: Array<{ label: string; candidates: NewsItem[]; articles: NewsArticleInput[] }> =
    [];

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

    rawCandidateCount += candidates.length;

    const articles = candidates.map(toArticleInput);
    const selection = selectQualityNewsForRadio(articles, feed.label, {
      targetCount: perTopicTarget,
      minCount: perTopicMin,
      maxPerSource: 3,
      maxPerEvent: 2,
      scoreTiers: [8, 6, 4],
      minTopicRelevance: 2,
      maxAgeHoursHard: radioSlot === "evening" ? 48 : 72,
      maxAgeHoursSoft: radioSlot === "evening" ? 12 : 48,
      allowRadioFallback: true,
      enableLog: true,
    });

    hardRejectedCount += selection.hardRejectedCount;
    if (selection.usedRelaxedFallback) usedRelaxedFallback = true;
    if (selection.usedEmergencyFallback) usedEmergencyFallback = true;
    if (selection.fallbackLevel > fallbackLevel) fallbackLevel = selection.fallbackLevel;
    if (selection.qualityThresholdUsed < qualityThresholdUsed) {
      qualityThresholdUsed = selection.qualityThresholdUsed;
    }

    if (selection.selected.length === 0 && selection.rawCandidateCount > 0) {
      console.log(
        JSON.stringify({
          event: "news_quality_zero_result",
          radio_slot: radioSlot,
          user_id: options?.userId ?? null,
          topic: feed.label,
          topics: feeds.map((f) => f.label),
          raw_candidate_count: selection.rawCandidateCount,
          quality_candidate_count: selection.log.candidateCount,
          selected_news_count: 0,
          rejected_reason_count: selection.log.topRejections.length,
          sample_rejected_titles: selection.log.topRejections.slice(0, 5).map((r) => r.title),
          sample_relevance_scores: articles.slice(0, 5).map((a) => {
            const q = calculateNewsQualityScore(a, feed.label);
            return {
              title: a.title.slice(0, 60),
              topicRelevanceScore: q.topicRelevanceScore,
              finalScore: q.finalScore,
            };
          }),
          zero_reason: selection.zeroResultReason ?? null,
        })
      );
    }

    if (selection.usedEmergencyFallback) {
      console.log(
        JSON.stringify({
          event: "news_quality_emergency_fallback",
          radio_slot: radioSlot,
          user_id: options?.userId ?? null,
          topic: feed.label,
          raw_candidate_count: selection.rawCandidateCount,
          fallback_selected_count: selection.selected.length,
          fallback_titles: selection.selected.map((s) => s.title),
          fallback_topics: [feed.label],
          original_zero_reason: selection.zeroResultReason ?? null,
        })
      );
    }

    perTopicStats.push({
      topic: feed.label,
      rawCount: selection.rawCandidateCount,
      selectedCount: selection.selected.length,
      hardRejectedCount: selection.hardRejectedCount,
      usedEmergencyFallback: selection.usedEmergencyFallback,
      qualityThresholdUsed: selection.qualityThresholdUsed,
      fallbackLevel: selection.fallbackLevel,
    });

    pendingByTopic.push({ label: feed.label, candidates, articles });

    const rowByKey = new Map(
      candidates.map((r) => [newsDedupeKey(r.url, r.title), r])
    );
    let topicMergeMiss = 0;
    for (const picked of selection.selected) {
      const key = newsDedupeKey(picked.url ?? picked.link ?? "", picked.title);
      const base = rowByKey.get(key) ?? rowByKey.get(normalizeNewsKey(picked.title));
      if (!base) {
        topicMergeMiss += 1;
        continue;
      }
      topicBuckets.push(
        fromScoredArticle(
          { ...base, topic: feed.label },
          picked as NewsArticleInput & { quality: { finalScore: number } }
        )
      );
      if (topicBuckets.filter((n) => n.topic === feed.label).length >= perTopicTarget) break;
    }

    if (topicMergeMiss > 0) {
      console.log(
        JSON.stringify({
          event: "radio_topic_merge_miss",
          radio_slot: radioSlot,
          topic: feed.label,
          merge_miss_count: topicMergeMiss,
          selected_count: selection.selected.length,
        })
      );
    }

    console.log(
      JSON.stringify({
        event: "radio_pipeline_topic_compare",
        radio_slot: radioSlot,
        user_id: options?.userId ?? null,
        topic: feed.label,
        rss_window: freshnessWindow(radioSlot),
        raw_count: candidates.length,
        quality_selected_count: selection.selected.length,
        topic_merge_miss_count: topicMergeMiss,
        topic_bucket_count: topicBuckets.filter((n) => n.topic === feed.label).length,
        sample_titles: selection.selected.slice(0, 3).map((s) => s.title.slice(0, 80)),
        sample_topics: selection.selected.slice(0, 3).map(() => feed.label),
        articles_missing_topic_in_input: articles.filter((a) => !a.topic?.trim()).length,
      })
    );
  }

  if (topicBuckets.length === 0 && rawCandidateCount > 0) {
    usedEmergencyFallback = true;
    fallbackLevel = 5;
    qualityThresholdUsed = 0;
    for (const pending of pendingByTopic) {
      const rescue = selectQualityNewsForRadio(pending.articles, pending.label, {
        targetCount: 1,
        minCount: 1,
        maxPerSource: 3,
        maxPerEvent: 2,
        allowRadioFallback: true,
        enableLog: false,
      });
      hardRejectedCount += rescue.hardRejectedCount;
      const rowByKey = new Map(
        pending.candidates.map((r) => [newsDedupeKey(r.url, r.title), r])
      );
      for (const picked of rescue.selected) {
        const key = newsDedupeKey(picked.url ?? picked.link ?? "", picked.title);
        const base = rowByKey.get(key) ?? rowByKey.get(normalizeNewsKey(picked.title));
        if (!base) continue;
        topicBuckets.push(
          fromScoredArticle(
            { ...base, topic: pending.label },
            picked as NewsArticleInput & { quality: { finalScore: number } }
          )
        );
        if (topicBuckets.filter((n) => n.topic === pending.label).length >= 1) break;
      }
    }
    console.log(
      JSON.stringify({
        event: "news_quality_emergency_fallback",
        radio_slot: radioSlot,
        user_id: options?.userId ?? null,
        scope: "global_per_topic_minimum",
        raw_candidate_count: rawCandidateCount,
        fallback_selected_count: topicBuckets.length,
      })
    );
  }

  qualitySelectedCount = topicBuckets.length;

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

  const result = pickNewsForScript(
    merged.map((row) => {
      if (!row.topic?.trim()) {
        console.warn("[News] pickNewsForScript missing topic", {
          title: row.title.slice(0, 80),
          url: row.url?.slice(0, 80),
        });
      }
      const input = toArticleInput({ ...row, topic: row.topic || feeds[0]?.label || "" });
      const quality = calculateNewsQualityScore(input, row.topic || feeds[0]?.label || "");
      return {
        ...input,
        topic: row.topic,
        quality: {
          ...quality,
          finalScore: row.qualityFinalScore ?? quality.finalScore,
        },
      };
    }),
    durationMinutes
  ).map((picked) => {
    const match = merged.find((m) => normalizeNewsKey(m.title) === normalizeNewsKey(picked.title));
    return (
      match ??
      ({
        id: normalizeNewsKey(picked.title).slice(0, 120),
        title: picked.title,
        source: picked.source,
        summary: picked.summary ?? picked.description ?? "",
        url: picked.url ?? picked.link ?? "",
        publishedAt: picked.publishedAt ?? picked.pubDate ?? "",
        fetchedAt: picked.fetchedAt ?? new Date().toISOString(),
        topic: picked.topic ?? feeds[0]?.label ?? "",
      } satisfies NewsItem)
    );
  });

  const publishedTimes = result.map((n) => parseNewsTime(n.publishedAt)).filter((v) => v > 0);
  const fetchedTimes = result.map((n) => parseNewsTime(n.fetchedAt)).filter((v) => v > 0);
  const selectedTimes = result.map(newsSortTime).filter((v) => v > 0);

  console.log("[News] collectNewsForUser", {
    radio_slot: radioSlot,
    feeds: feeds.length,
    exclude_count: excludeKeys.size,
    fetched_count: result.length,
    raw_candidate_count: rawCandidateCount,
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
      raw_candidate_count: rawCandidateCount,
      upserted_count: 0,
      selected_count: result.length,
      used_relaxed_fallback: usedRelaxedFallback,
      used_emergency_fallback: usedEmergencyFallback,
      per_topic_stats: perTopicStats,
      newest_published_at: publishedTimes.length
        ? new Date(Math.max(...publishedTimes)).toISOString()
        : null,
      newest_fetched_at: fetchedTimes.length
        ? new Date(Math.max(...fetchedTimes)).toISOString()
        : null,
      oldest_selected_at: selectedTimes.length
        ? new Date(Math.min(...selectedTimes)).toISOString()
        : null,
      freshness_window_hours: radioSlot === "evening" ? 12 : 48,
      rss_window: freshnessWindow(radioSlot),
      quality_selected_count: qualitySelectedCount,
      script_selected_count: result.length,
      used_cache: false,
      fallback_reason: result.length === 0 ? "no_fresh_rss_items" : null,
    })
  );

  return {
    items: result,
    rawCandidateCount,
    qualitySelectedCount,
    hardRejectedCount,
    usedRelaxedFallback,
    usedEmergencyFallback,
    qualityThresholdUsed,
    fallbackLevel,
    perTopicStats,
  };
}
