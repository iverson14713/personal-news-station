import {
  calculateNewsQualityScore,
  selectQualityNews,
  type NewsArticleInput,
} from "../shared/newsQuality";

export type NewsItem = {
  id: string;
  title: string;
  link: string;
  source: string;
  pubDate: string;
  fetchedAt: string;
  description: string;
  selected: boolean;
  favorite: boolean;
  topic: string;
  matchedTopics: string[];
};

export type NewsFeedSource = {
  label: string;
  query: string;
  icon?: string;
};

export type BuiltInTopicFeedInput = {
  label: string;
  query: string;
  icon?: string;
};

/** 合併內建主題 + 自訂關鍵字（依 label 去重，保留順序） */
export function buildActiveNewsFeedSources(
  selectedBuiltInTopics: BuiltInTopicFeedInput[],
  customKeywords: string[],
  options?: { extraSearch?: string }
): NewsFeedSource[] {
  const seen = new Set<string>();
  const sources: NewsFeedSource[] = [];

  const addSource = (label: string, query: string, icon?: string) => {
    const trimmedLabel = label.trim();
    if (!trimmedLabel || seen.has(trimmedLabel)) return;
    seen.add(trimmedLabel);
    const trimmedQuery = query.trim() || trimmedLabel;
    sources.push({ label: trimmedLabel, query: trimmedQuery, icon });
  };

  for (const topic of selectedBuiltInTopics) {
    addSource(topic.label, topic.query, topic.icon);
  }

  for (const kw of customKeywords) {
    addSource(kw, kw);
  }

  const extraSearch = options?.extraSearch?.trim();
  if (extraSearch) {
    addSource(extraSearch, extraSearch);
  }

  return sources;
}

export function getActiveTopicLabels(
  selectedBuiltInTopics: BuiltInTopicFeedInput[],
  customKeywords: string[],
  options?: { extraSearch?: string }
): string[] {
  return buildActiveNewsFeedSources(selectedBuiltInTopics, customKeywords, options).map(
    (s) => s.label
  );
}

export type TopicNewsSection = {
  label: string;
  icon?: string;
  itemIds: string[];
};

export type MergeNewsFeedResult = {
  news: NewsItem[];
  sections: TopicNewsSection[];
};

/** 每個追蹤主題最多保留幾則（配額上限） */
export const NEWS_PER_TOPIC_MAX = 8;
/** 更新新聞後，每個主題預設自動選取幾則 */
export const DEFAULT_SELECTED_PER_TOPIC = 2;
/** 每個主題先掃描幾則 RSS 再過濾日期 */
export const NEWS_PER_TOPIC_ITEM_SCAN = 130;
/** 只顯示此時間內的新聞（首頁主選池 48h；不足 8 則時品質模組可放寬至 72h） */
export const NEWS_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
export const NEWS_EXTENDED_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export function normalizeNewsKey(title: string): string {
  return title.replace(/[，。！？、\s\-｜|:：]/g, "").slice(0, 28);
}

export function cleanNewsTitle(title: string): string {
  return title.replace(/\s-\s.*$/, "").trim();
}

export function stripHtmlToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function parseNewsPubDate(raw: string | null | undefined): Date | null {
  if (!raw?.trim()) return null;
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isNewsFreshEnough(
  pubDateRaw: string,
  nowMs: number,
  maxAgeMs: number = NEWS_MAX_AGE_MS
): boolean {
  const d = parseNewsPubDate(pubDateRaw);
  if (!d) return false;
  const age = nowMs - d.getTime();
  return age >= 0 && age <= maxAgeMs;
}

type ParsedRow = NewsItem & { sortTime: number };

function itemDedupeKey(link: string, title: string): string {
  const linkKey = link.trim();
  if (linkKey) return linkKey;
  return normalizeNewsKey(title) || title;
}

export function parseNewsRssXml(
  xmlText: string,
  sourceLabel: string,
  nowMs: number,
  favoriteLinks: string[]
): ParsedRow[] {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "text/xml");
  const rawItems = Array.from(xml.querySelectorAll("item")).slice(
    0,
    NEWS_PER_TOPIC_ITEM_SCAN
  );

  return rawItems
    .map((item, index) => {
      const rawTitle = item.querySelector("title")?.textContent || "無標題";
      const title = cleanNewsTitle(rawTitle);
      const link = item.querySelector("link")?.textContent || "";
      const source =
        item.querySelector("source")?.textContent ||
        rawTitle.split(" - ").pop() ||
        "Google News";
      const pubDate = item.querySelector("pubDate")?.textContent || "";
      const fetchedAt = new Date(nowMs).toISOString();
      const description = stripHtmlToText(
        item.querySelector("description")?.textContent || ""
      );
      const sortTime = parseNewsPubDate(pubDate)?.getTime() ?? 0;

      return {
        id: link || `${sourceLabel}-${title}-${index}`,
        title,
        link,
        source,
        pubDate,
        fetchedAt,
        description,
        selected: false,
        favorite: favoriteLinks.includes(link),
        topic: sourceLabel,
        matchedTopics: [sourceLabel],
        sortTime,
      };
    })
    .filter((row) => isNewsFreshEnough(row.pubDate, nowMs, NEWS_EXTENDED_MAX_AGE_MS))
    .sort((a, b) => b.sortTime - a.sortTime);
}

export function applyDefaultTopicSelection(
  sections: TopicNewsSection[],
  newsById: Map<string, NewsItem>,
  perTopic = DEFAULT_SELECTED_PER_TOPIC
): void {
  for (const item of newsById.values()) {
    item.selected = false;
  }

  for (const section of sections) {
    let picked = 0;
    for (const id of section.itemIds) {
      if (picked >= perTopic) break;
      const item = newsById.get(id);
      if (!item) continue;
      item.selected = true;
      picked += 1;
    }
  }
}

export function mergeTopicNewsFeeds(
  feeds: Array<{ source: NewsFeedSource; rows: ParsedRow[] }>,
  prevNews: NewsItem[],
  selectedPerTopic = DEFAULT_SELECTED_PER_TOPIC
): MergeNewsFeedResult {
  const prevByKey = new Map<string, NewsItem>();
  for (const row of prevNews) {
    prevByKey.set(itemDedupeKey(row.link, row.title), row);
  }

  const globalByKey = new Map<string, NewsItem>();
  const sections: TopicNewsSection[] = [];

  for (const { source, rows } of feeds) {
    const sectionItemIds: string[] = [];
    const seenInSection = new Set<string>();

    const candidates: NewsArticleInput[] = rows.map((row) => ({
      title: row.title,
      source: row.source,
      description: row.description,
      link: row.link,
      pubDate: row.pubDate,
      fetchedAt: row.fetchedAt,
    }));

    const { selected: qualityRows } = selectQualityNews(candidates, source.label, {
      targetCount: NEWS_PER_TOPIC_MAX,
      minCount: NEWS_PER_TOPIC_MAX,
      maxPerSource: 3,
      maxPerEvent: 2,
      scoreTiers: [8, 6, 4],
      minTopicRelevance: 2,
      maxAgeHoursHard: 72,
      maxAgeHoursSoft: 48,
      allowExtendedFallback: true,
      maxAgeHoursPrimary: 48,
      maxAgeHoursExtended: 72,
      enableLog: true,
    });

    const rowByKey = new Map<string, ParsedRow>();
    for (const row of rows) {
      rowByKey.set(itemDedupeKey(row.link, row.title), row);
    }

    const addRowToSection = (row: ParsedRow) => {
      const key = itemDedupeKey(row.link, row.title);
      if (!key || seenInSection.has(key)) return;
      seenInSection.add(key);

      let item = globalByKey.get(key);
      if (item) {
        if (!item.matchedTopics.includes(source.label)) {
          item.matchedTopics = [...item.matchedTopics, source.label];
        }
      } else {
        const prev = prevByKey.get(key);
        item = {
          id: row.link || row.id,
          title: row.title,
          link: row.link,
          source: row.source,
          pubDate: row.pubDate,
          fetchedAt: row.fetchedAt,
          description: row.description,
          topic: source.label,
          matchedTopics: [source.label],
          selected: prev?.selected ?? false,
          favorite: prev?.favorite ?? row.favorite,
        };
        globalByKey.set(key, item);
      }

      sectionItemIds.push(item.id);
    };

    for (const picked of qualityRows) {
      if (sectionItemIds.length >= NEWS_PER_TOPIC_MAX) break;
      const key = itemDedupeKey(picked.link ?? picked.url ?? "", picked.title);
      const row = rowByKey.get(key);
      if (!row) continue;
      addRowToSection(row);
    }

    sections.push({
      label: source.label,
      icon: source.icon,
      itemIds: sectionItemIds,
    });
  }

  const newsById = new Map<string, NewsItem>();
  for (const item of globalByKey.values()) {
    newsById.set(item.id, item);
  }

  const hasPreservedSelection = Array.from(newsById.values()).some((item) => item.selected);
  if (!hasPreservedSelection) {
    applyDefaultTopicSelection(sections, newsById, selectedPerTopic);
  }

  const news = Array.from(globalByKey.values()).sort((a, b) => {
    const qa = calculateNewsQualityScore(
      {
        title: a.title,
        source: a.source,
        description: a.description,
        link: a.link,
        pubDate: a.pubDate,
        fetchedAt: a.fetchedAt,
      },
      a.topic
    ).finalScore;
    const qb = calculateNewsQualityScore(
      {
        title: b.title,
        source: b.source,
        description: b.description,
        link: b.link,
        pubDate: b.pubDate,
        fetchedAt: b.fetchedAt,
      },
      b.topic
    ).finalScore;
    if (qb !== qa) return qb - qa;
    const ta = parseNewsPubDate(a.pubDate)?.getTime() ?? (Date.parse(a.fetchedAt) || 0);
    const tb = parseNewsPubDate(b.pubDate)?.getTime() ?? (Date.parse(b.fetchedAt) || 0);
    return tb - ta;
  });

  return { news, sections };
}

export function buildSelectedTopicSummary(
  sections: TopicNewsSection[],
  news: NewsItem[]
): string {
  const newsById = new Map(news.map((n) => [n.id, n]));
  const selectedIds = new Set(news.filter((n) => n.selected).map((n) => n.id));
  const parts = sections
    .map((section) => {
      const count = section.itemIds.filter(
        (id) => selectedIds.has(id) && newsById.has(id)
      ).length;
      return count > 0 ? `${section.label} ${count}` : null;
    })
    .filter((x): x is string => x != null);
  return parts.join("｜");
}
