/**
 * 全主題共用新聞品質評分與選稿（首頁 / 手動生成 / 早報 / 晚報）
 *
 * 此檔案同時存在於：
 * - shared/newsQuality.ts
 * - supabase/functions/_shared/newsQuality.ts
 *
 * 修改評分、篩選、去重、fallback 或選稿邏輯時，必須同步更新另一份，
 * 避免首頁與早報 / 晚報使用不同規則。不要只改其中一份。
 */

export type NewsArticleInput = {
  title: string;
  source: string;
  summary?: string;
  description?: string;
  url?: string;
  link?: string;
  publishedAt?: string;
  pubDate?: string;
  fetchedAt?: string;
  topic?: string;
};

export type NewsQualityBreakdown = {
  topicRelevanceScore: number;
  freshnessScore: number;
  importanceScore: number;
  sourceQualityScore: number;
  informationDensityScore: number;
  userInterestScore: number;
  duplicatePenalty: number;
  lowQualityPenalty: number;
  clickbaitPenalty: number;
  finalScore: number;
};

export type ScoredNewsArticle = NewsArticleInput & {
  quality: NewsQualityBreakdown;
  rejectedReason?: string;
  /** 0=即時高品質 1=較舊相關 2=背景整理 3=官方補位 */
  fallbackRank?: number;
};

export type QualitySelectionLog = {
  topic: string;
  candidateCount: number;
  selectedCount: number;
  tierUsed: number;
  selected: Array<{
    title: string;
    source: string;
    finalScore: number;
    topicRelevanceScore: number;
  }>;
  lowestSelected?: {
    title: string;
    finalScore: number;
  };
  topRejections: Array<{
    title: string;
    reason: string;
    finalScore: number;
  }>;
};

export type SelectNewsOptions = {
  targetCount: number;
  minCount?: number;
  maxPerSource?: number;
  maxPerEvent?: number;
  scoreTiers?: number[];
  minTopicRelevance?: number;
  maxAgeHoursHard?: number;
  maxAgeHoursSoft?: number;
  /** 首頁不足 minCount 時，允許 48～72h 與背景 / 官方補位 */
  allowExtendedFallback?: boolean;
  maxAgeHoursPrimary?: number;
  maxAgeHoursExtended?: number;
  enableLog?: boolean;
};

type TopicProfile = {
  highKeywords: string[];
  lowKeywords: string[];
  relatedKeywords?: string[];
  excludeKeywords?: string[];
};

const CLICKBAIT_PATTERNS = [
  /震驚/u,
  /必看/u,
  /網友瘋/u,
  /網嚇瘋/u,
  /全網炸鍋/u,
  /趕快買/u,
  /錯過後悔/u,
  /必漲/u,
  /暴富/u,
  /穩賺/u,
  /財富密碼/u,
  /神幣/u,
  /百倍幣/u,
  /無腦買/u,
  /驚人內幕/u,
  /不看後悔/u,
  /嚇傻/u,
  /瘋傳/u,
  /炸裂/u,
];

const LOW_QUALITY_PATTERNS = [
  /散文/u,
  /隨筆/u,
  /抒情/u,
  /回憶錄/u,
  /故園/u,
  /畢業驚喜/u,
  /阿丁走了/u,
  /淚目/u,
  /感動落淚/u,
  /空投/u,
  /白嫖/u,
  /導購/u,
  /業配/u,
  /限時優惠/u,
  /加LINE/u,
  /免費領/u,
];

const IMPORTANCE_HIGH = [
  /戰爭/u,
  /開戰/u,
  /停火/u,
  /制裁/u,
  /降息/u,
  /升息/u,
  /政策/u,
  /總統/u,
  /總理/u,
  /央行/u,
  /地震/u,
  /颱風/u,
  /災害/u,
  /全壘打/u,
  /破紀錄/u,
  /晉級/u,
  /冠軍/u,
  /駭客/u,
  /破產/u,
  /併購/u,
  /ETF/u,
  /監管/u,
];

const IMPORTANCE_MED = [
  /宣布/u,
  /公布/u,
  /受傷/u,
  /傷勢/u,
  /交易/u,
  /簽約/u,
  /排名/u,
  /調查/u,
  /起訴/u,
  /判決/u,
  /更新/u,
  /進展/u,
];

const DENSITY_POSITIVE = [
  /\d{4}[-/年]/u,
  /\d+[%％]/u,
  /\d+億/u,
  /\d+萬/u,
  /表示/u,
  /指出/u,
  /強調/u,
  /宣布/u,
  /證實/u,
  /否認/u,
  /官方/u,
  /記者會/u,
];

const HIGH_TRUST_SOURCES = [
  "reuters",
  "associated press",
  "ap news",
  "bbc",
  "bloomberg",
  "cnbc",
  "espn",
  "mlb.com",
  "nba.com",
  "fifa",
  "中央社",
  "cna",
  "聯合新聞網",
  "udn",
  "公視",
  "pts",
  "自由時報",
  "ltn",
  "中時",
  "chinatimes",
  "ettoday",
  "tvbs",
  "nownews",
];

const LOW_TRUST_SOURCES = [
  "content farm",
  "部落格",
  "blogspot",
  "medium.com",
  "tistory",
  "導購",
  "推薦購買",
];

const BACKGROUND_PATTERNS = [
  /懶人包/u,
  /完整解析/u,
  /背景/u,
  /事件整理/u,
  /重點整理/u,
  /深度分析/u,
  /一文看懂/u,
  /來龍去脈/u,
  /\bfaq\b/iu,
  /官方說明/u,
];

const OFFICIAL_TEXT_PATTERNS = [
  /官方公告/u,
  /政府機關/u,
  /監管機構/u,
  /國際組織/u,
  /球隊官方/u,
  /聯盟官方/u,
  /公司公告/u,
  /官方聲明/u,
  /新聞稿/u,
];

const TOPIC_PROFILES: Record<string, TopicProfile> = {
  大谷翔平: {
    highKeywords: [
      "大谷",
      "翔平",
      "ohtani",
      "道奇",
      "全壘打",
      "投手",
      "打者",
      "mlb",
      "二刀流",
      "50-50",
      "mvp",
    ],
    lowKeywords: ["受到大谷啟發", "像大谷", "大谷效應", "非棒球", "籃球", "足球"],
    relatedKeywords: ["道奇", "mlb", "美國職棒", "世界一棒"],
  },
  幣圈: {
    highKeywords: [
      "比特幣",
      "bitcoin",
      "btc",
      "以太坊",
      "ethereum",
      "eth",
      "加密",
      "虛擬貨幣",
      "區塊鏈",
      "stablecoin",
      "穩定幣",
      "交易所",
      "etf",
      "駭客",
      "挖礦",
    ],
    lowKeywords: ["百倍", "暴富", "穩賺", "空投", "土狗", "meme幣", "不知名幣"],
    excludeKeywords: ["房地產", "健康", "減肥"],
  },
  BTC: {
    highKeywords: ["比特幣", "bitcoin", "btc", "中本聰", "halving", "減半"],
    lowKeywords: ["百倍", "暴富", "穩賺"],
    relatedKeywords: ["加密", "虛擬貨幣", "etf"],
  },
  ETH: {
    highKeywords: ["以太坊", "ethereum", "eth", "vitalik", "智能合約", "layer2"],
    lowKeywords: ["百倍", "暴富", "穩賺"],
    relatedKeywords: ["加密", "虛擬貨幣", "defi"],
  },
  國際: {
    highKeywords: [
      "國際",
      "外交",
      "地緣",
      "聯合國",
      "北約",
      "natо",
      "g7",
      "g20",
      "白宮",
      "克里姆林",
      "歐盟",
      "中東",
      "烏克蘭",
      "俄羅斯",
      "以巴",
    ],
    lowKeywords: ["散文", "健康", "養生", "減肥", "癌症", "里長", "社區", "鄰里"],
    excludeKeywords: ["健康飲食", "養生秘訣", "抒情"],
  },
  戰爭: {
    highKeywords: [
      "戰爭",
      "衝突",
      "開戰",
      "停火",
      "俄烏",
      "烏克蘭",
      "以色列",
      "哈瑪斯",
      "中東",
      "軍事",
      "轟炸",
      "空襲",
    ],
    lowKeywords: ["健康", "散文", "娛樂"],
  },
  台灣熱門: {
    highKeywords: [
      "台灣",
      "臺灣",
      "立法院",
      "行政院",
      "總統",
      "內閣",
      "健保",
      "國道",
      "停電",
      "地震",
      "颱風",
      "選舉",
      "政策",
      "全台",
      "全國",
    ],
    lowKeywords: ["里民", "鄰里", "社區活動", "商家優惠", "開幕", "摸彩"],
  },
  NBA: {
    highKeywords: ["nba", "湖人", "勇士", "塞爾提克", "快艇", "尼克", "總冠軍", "mvp"],
    lowKeywords: ["非籃球", "足球", "棒球"],
    relatedKeywords: ["籃球", "季後賽"],
  },
  MLB: {
    highKeywords: ["mlb", "美國職棒", "世界大賽", "全壘打", "先發", "牛棚"],
    lowKeywords: ["非棒球", "籃球", "足球"],
    relatedKeywords: ["棒球", "大聯盟"],
  },
  Curry: {
    highKeywords: ["curry", "柯瑞", "勇士", "stephen", "三分球", "splash"],
    lowKeywords: ["咖哩飯", "料理"],
    relatedKeywords: ["nba", "勇士"],
  },
  季後賽: {
    highKeywords: ["季後賽", "playoff", "淘汰", "晉級", "冠軍賽"],
    lowKeywords: [],
    relatedKeywords: ["nba", "mlb"],
  },
  台股: {
    highKeywords: ["台股", "加權", "櫃買", "台積電", "2330", "法人", "投信", "外資"],
    lowKeywords: ["美股", "加密"],
  },
  美股: {
    highKeywords: ["美股", "道瓊", "nasdaq", "標普", "s&p", "nvidia", "tesla", "apple"],
    lowKeywords: ["台股", "加密"],
  },
  財經: {
    highKeywords: ["fed", "利率", "cpi", "通膨", "降息", "升息", "央行", "就業", "gdp"],
    lowKeywords: ["百倍幣", "空投"],
  },
  科技: {
    highKeywords: ["ai", "人工智慧", "半導體", "iphone", "nvidia", "台積電", "晶片", "openai"],
    lowKeywords: ["散文", "健康"],
  },
  遊戲: {
    highKeywords: ["遊戲", "steam", "switch", "ps5", "xbox", "電競", "任天堂", "暴雪"],
    lowKeywords: ["博弈", "賭場"],
  },
  影視: {
    highKeywords: ["電影", "影集", "票房", "netflix", "演員", "導演", "上映"],
    lowKeywords: [],
  },
  電影: {
    highKeywords: ["電影", "票房", "首映", "奧斯卡", "金馬", "netflix", "院線"],
    lowKeywords: [],
  },
  動漫: {
    highKeywords: ["動漫", "動畫", "漫畫", "anime", "manga", "聲優", "jump"],
    lowKeywords: [],
  },
  音樂: {
    highKeywords: ["音樂", "演唱會", "專輯", "單曲", "spotify", "榜單"],
    lowKeywords: [],
  },
  潮流: {
    highKeywords: ["潮流", "球鞋", "穿搭", "時尚", "聯名", "品牌"],
    lowKeywords: [],
  },
  ETF: {
    highKeywords: ["etf", "0050", "0056", "高股息", "指數股票型基金"],
    lowKeywords: ["百倍幣"],
  },
};

const WORLD_CUP_PROFILE: TopicProfile = {
  highKeywords: [
    "世界盃",
    "世足",
    "world cup",
    "fifa",
    "國家隊",
    "小組賽",
    "淘汰賽",
    "進球",
    "晉級",
    "對戰",
  ],
  lowKeywords: ["非足球", "籃球", "廣告", "優惠"],
};

function getTopicProfile(topic: string): TopicProfile {
  if (TOPIC_PROFILES[topic]) return TOPIC_PROFILES[topic];
  if (/世界盃|世足|world cup/i.test(topic)) return WORLD_CUP_PROFILE;

  const parts = topic
    .split(/\s+|OR|或|、/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);

  return {
    highKeywords: parts.length > 0 ? parts : [topic],
    lowKeywords: [],
    relatedKeywords: [],
  };
}

function articleText(article: NewsArticleInput): string {
  const summary = (article.summary ?? article.description ?? "").trim();
  return `${article.title} ${summary}`.trim();
}

function publishedMs(article: NewsArticleInput): number {
  const raw = article.publishedAt ?? article.pubDate ?? "";
  const ts = Date.parse(raw);
  if (Number.isFinite(ts) && ts > 0) return ts;
  const fetched = article.fetchedAt ? Date.parse(article.fetchedAt) : 0;
  return Number.isFinite(fetched) ? fetched : 0;
}

function countKeywordHits(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    if (!kw) continue;
    if (lower.includes(kw.toLowerCase())) hits += 1;
  }
  return hits;
}

function scoreTopicRelevance(article: NewsArticleInput, topic: string): number {
  const profile = getTopicProfile(topic);
  const title = article.title.toLowerCase();
  const body = articleText(article).toLowerCase();

  if (profile.excludeKeywords?.some((kw) => title.includes(kw.toLowerCase()) || body.includes(kw.toLowerCase()))) {
    return -3;
  }

  const highTitle = countKeywordHits(article.title, profile.highKeywords);
  const highBody = countKeywordHits(article.summary ?? article.description ?? "", profile.highKeywords);
  const lowHits = countKeywordHits(articleText(article), profile.lowKeywords);
  const relatedHits = countKeywordHits(articleText(article), profile.relatedKeywords ?? []);

  let score = 0;
  score += Math.min(highTitle * 3, 9);
  score += Math.min(highBody, 4);
  score += Math.min(relatedHits, 2);
  score -= Math.min(lowHits * 2, 6);

  const topicLower = topic.toLowerCase();
  const titleHasTopic = title.includes(topicLower);
  const bodyHasTopic = body.includes(topicLower);
  if (titleHasTopic && bodyHasTopic) score += 2;
  else if (titleHasTopic && !bodyHasTopic && highBody === 0) score -= 2;

  if (highTitle === 0 && highBody === 0 && relatedHits === 0 && !titleHasTopic && !bodyHasTopic) {
    return -2;
  }

  return score;
}

function scoreFreshness(article: NewsArticleInput, nowMs = Date.now()): number {
  const ts = publishedMs(article);
  if (!ts) return 1;
  const ageHours = (nowMs - ts) / (60 * 60 * 1000);
  if (ageHours < 0) return 2;
  if (ageHours <= 3) return 5;
  if (ageHours <= 8) return 4;
  if (ageHours <= 18) return 3;
  if (ageHours <= 24) return 2;
  if (ageHours <= 36) return 1;
  return 0;
}

function scoreImportance(text: string): number {
  let score = 0;
  for (const re of IMPORTANCE_HIGH) {
    if (re.test(text)) {
      score += 5;
      break;
    }
  }
  if (score === 0) {
    for (const re of IMPORTANCE_MED) {
      if (re.test(text)) {
        score += 3;
        break;
      }
    }
  }
  if (score === 0 && text.length > 40) score += 1;
  return Math.min(score, 5);
}

function scoreSourceQuality(source: string): number {
  const lower = source.toLowerCase();
  if (LOW_TRUST_SOURCES.some((s) => lower.includes(s))) return -4;
  if (HIGH_TRUST_SOURCES.some((s) => lower.includes(s))) return 3;
  if (lower.includes("news") || lower.includes("新聞") || lower.includes("時報")) return 1;
  return 0;
}

function scoreInformationDensity(text: string, title: string): number {
  let score = 0;
  for (const re of DENSITY_POSITIVE) {
    if (re.test(text)) score += 1;
  }
  if (text.length < 30) score -= 2;
  if (title.length < 8) score -= 1;
  if (/^[「『].{2,8}[」』]$/.test(title)) score -= 2;
  return Math.max(-3, Math.min(score, 3));
}

function scoreClickbait(title: string): number {
  let penalty = 0;
  for (const re of CLICKBAIT_PATTERNS) {
    if (re.test(title)) penalty += 3;
  }
  if (/！{2,}/u.test(title) || /!{2,}/.test(title)) penalty += 1;
  if (/[？?]{2,}/u.test(title)) penalty += 1;
  return penalty;
}

function scoreLowQuality(text: string, topic: string): number {
  let penalty = 0;
  for (const re of LOW_QUALITY_PATTERNS) {
    if (re.test(text)) penalty += 3;
  }

  const profile = getTopicProfile(topic);
  if (profile.excludeKeywords) {
    for (const kw of profile.excludeKeywords) {
      if (text.toLowerCase().includes(kw.toLowerCase())) penalty += 4;
    }
  }

  if (/價格預測|目標價|必漲|穩賺/u.test(text)) penalty += 3;
  if (/如何購買|購買教學|懶人包投資/u.test(text)) penalty += 2;

  return penalty;
}

export function calculateNewsQualityScore(
  article: NewsArticleInput,
  topic: string,
  nowMs = Date.now()
): NewsQualityBreakdown {
  const text = articleText(article);
  const topicRelevanceScore = scoreTopicRelevance(article, topic);
  const freshnessScore = scoreFreshness(article, nowMs);
  const importanceScore = scoreImportance(text);
  const sourceQualityScore = scoreSourceQuality(article.source);
  const informationDensityScore = scoreInformationDensity(text, article.title);
  const userInterestScore = 0;
  const duplicatePenalty = 0;
  const clickbaitPenalty = scoreClickbait(article.title);
  const lowQualityPenalty = scoreLowQuality(text, topic);

  const finalScore =
    topicRelevanceScore +
    freshnessScore +
    importanceScore +
    sourceQualityScore +
    informationDensityScore +
    userInterestScore -
    duplicatePenalty -
    lowQualityPenalty -
    clickbaitPenalty;

  return {
    topicRelevanceScore,
    freshnessScore,
    importanceScore,
    sourceQualityScore,
    informationDensityScore,
    userInterestScore,
    duplicatePenalty,
    lowQualityPenalty,
    clickbaitPenalty,
    finalScore,
  };
}

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[，。！？、\s\-｜|:："'「」『』【】]/g, "")
    .slice(0, 40);
}

function titleSimilarity(a: string, b: string): number {
  const wa = new Set(
    normalizeTitleKey(a)
      .split("")
      .filter((c) => c.trim())
  );
  const wb = new Set(
    normalizeTitleKey(b)
      .split("")
      .filter((c) => c.trim())
  );
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const c of wa) {
    if (wb.has(c)) inter += 1;
  }
  return inter / Math.max(wa.size, wb.size);
}

function articleUrl(article: NewsArticleInput): string {
  return (article.url ?? article.link ?? "").trim().toLowerCase();
}

function isHardRejected(
  article: NewsArticleInput,
  topic: string,
  quality: NewsQualityBreakdown,
  nowMs: number,
  maxAgeHoursHard: number
): string | null {
  if (quality.topicRelevanceScore < 0) return "low_topic_relevance";
  if (quality.lowQualityPenalty >= 8) return "low_quality_content";
  if (quality.clickbaitPenalty >= 6 && quality.informationDensityScore <= 0) {
    return "clickbait_low_density";
  }

  const ts = publishedMs(article);
  if (ts > 0) {
    const ageHours = (nowMs - ts) / (60 * 60 * 1000);
    if (ageHours > maxAgeHoursHard && quality.importanceScore < 3) {
      return "too_old";
    }
  }

  const profile = getTopicProfile(topic);
  const text = articleText(article).toLowerCase();
  if (profile.excludeKeywords?.some((kw) => text.includes(kw.toLowerCase()))) {
    return "topic_excluded_keyword";
  }

  return null;
}

function articleAgeHours(article: NewsArticleInput, nowMs: number): number | null {
  const ts = publishedMs(article);
  if (!ts) return null;
  return (nowMs - ts) / (60 * 60 * 1000);
}

function isSafeFallbackCandidate(item: ScoredNewsArticle, minTopicRelevance: number): boolean {
  if (item.quality.topicRelevanceScore < minTopicRelevance) return false;
  if (item.quality.lowQualityPenalty >= 6) return false;
  if (item.quality.clickbaitPenalty >= 6) return false;
  return true;
}

function isBackgroundContent(article: NewsArticleInput): boolean {
  const text = articleText(article);
  return BACKGROUND_PATTERNS.some((re) => re.test(text));
}

function isOfficialContent(article: NewsArticleInput): boolean {
  const text = articleText(article);
  const source = article.source.toLowerCase();
  if (HIGH_TRUST_SOURCES.some((s) => source.includes(s))) return true;
  return OFFICIAL_TEXT_PATTERNS.some((re) => re.test(text));
}

function backgroundSortScore(item: ScoredNewsArticle): number {
  return item.quality.finalScore + (isBackgroundContent(item) ? 1 : 0);
}

function isAlreadySelected(item: ScoredNewsArticle, selected: ScoredNewsArticle[]): boolean {
  return selected.some(
    (s) =>
      (articleUrl(s) && articleUrl(s) === articleUrl(item)) ||
      normalizeTitleKey(s.title) === normalizeTitleKey(item.title)
  );
}

function canSelectWithTier(
  quality: NewsQualityBreakdown,
  tier: number,
  minTopicRelevance: number
): boolean {
  if (quality.topicRelevanceScore < minTopicRelevance) return false;
  if (quality.finalScore >= tier) return true;
  if (tier <= 6 && quality.finalScore >= tier - 1 && quality.topicRelevanceScore >= 4) {
    return true;
  }
  return false;
}

export function selectQualityNews(
  articles: NewsArticleInput[],
  topic: string,
  options: SelectNewsOptions
): { selected: ScoredNewsArticle[]; log: QualitySelectionLog } {
  const nowMs = Date.now();
  const targetCount = options.targetCount;
  const minCount = options.minCount ?? targetCount;
  const maxPerSource = options.maxPerSource ?? 3;
  const maxPerEvent = options.maxPerEvent ?? 2;
  const tiers = options.scoreTiers ?? [8, 6, 4];
  const minTopicRelevance = options.minTopicRelevance ?? 2;
  const allowExtendedFallback = options.allowExtendedFallback ?? false;
  const maxAgeHoursHard = options.maxAgeHoursHard ?? 72;
  const maxAgeHoursSoft = options.maxAgeHoursSoft ?? (allowExtendedFallback ? 48 : 36);
  const maxAgeHoursPrimary = options.maxAgeHoursPrimary ?? (allowExtendedFallback ? 48 : maxAgeHoursHard);
  const maxAgeHoursExtended = options.maxAgeHoursExtended ?? 72;

  const scored: ScoredNewsArticle[] = [];
  const extendedAgePool: ScoredNewsArticle[] = [];
  const rejections: Array<{ title: string; reason: string; finalScore: number }> = [];

  const seenUrls = new Set<string>();
  for (const article of articles) {
    const url = articleUrl(article);
    if (url && seenUrls.has(url)) continue;
    if (url) seenUrls.add(url);

    const quality = calculateNewsQualityScore(article, topic, nowMs);
    const hardReason = isHardRejected(article, topic, quality, nowMs, maxAgeHoursHard);
    if (hardReason) {
      rejections.push({ title: article.title, reason: hardReason, finalScore: quality.finalScore });
      continue;
    }

    const scoredItem: ScoredNewsArticle = { ...article, quality };
    const ageHours = articleAgeHours(article, nowMs);

    if (allowExtendedFallback && ageHours != null && ageHours > maxAgeHoursPrimary) {
      if (ageHours <= maxAgeHoursExtended && isSafeFallbackCandidate(scoredItem, minTopicRelevance)) {
        extendedAgePool.push(scoredItem);
      }
      continue;
    }

    if (
      ageHours != null &&
      ageHours > maxAgeHoursSoft &&
      quality.freshnessScore === 0 &&
      quality.importanceScore < 3
    ) {
      rejections.push({ title: article.title, reason: "stale_low_importance", finalScore: quality.finalScore });
      continue;
    }

    scored.push(scoredItem);
  }

  scored.sort((a, b) => b.quality.finalScore - a.quality.finalScore);
  extendedAgePool.sort((a, b) => b.quality.finalScore - a.quality.finalScore);

  const selected: ScoredNewsArticle[] = [];
  let tierUsed = tiers[0] ?? 8;

  const tryPick = (tier: number, limit: number) => {
    const sourceCount = new Map<string, number>();
    const eventKeys: string[] = [];

    for (const item of scored) {
      if (selected.length >= limit) break;
      if (isAlreadySelected(item, selected)) continue;
      if (!canSelectWithTier(item.quality, tier, minTopicRelevance)) continue;

      const sourceKey = item.source.toLowerCase();
      if ((sourceCount.get(sourceKey) ?? 0) >= maxPerSource) continue;

      const eventKey = normalizeTitleKey(item.title);
      let sameEvent = 0;
      for (const ek of eventKeys) {
        if (titleSimilarity(ek, eventKey) >= 0.72) sameEvent += 1;
      }
      if (sameEvent >= maxPerEvent) continue;

      selected.push({ ...item, fallbackRank: 0 });
      sourceCount.set(sourceKey, (sourceCount.get(sourceKey) ?? 0) + 1);
      eventKeys.push(eventKey);
    }
  };

  const tryPickFallbackPool = (
    pool: ScoredNewsArticle[],
    limit: number,
    fallbackRank: number,
    compare: (a: ScoredNewsArticle, b: ScoredNewsArticle) => number
  ) => {
    const sourceCount = new Map<string, number>();
    for (const item of selected) {
      const key = item.source.toLowerCase();
      sourceCount.set(key, (sourceCount.get(key) ?? 0) + 1);
    }

    const sorted = [...pool].sort(compare);
    for (const item of sorted) {
      if (selected.length >= limit) break;
      if (isAlreadySelected(item, selected)) continue;
      if (!isSafeFallbackCandidate(item, minTopicRelevance)) continue;

      const sourceKey = item.source.toLowerCase();
      if ((sourceCount.get(sourceKey) ?? 0) >= maxPerSource) continue;

      selected.push({ ...item, fallbackRank });
      sourceCount.set(sourceKey, (sourceCount.get(sourceKey) ?? 0) + 1);
    }
  };

  for (const tier of tiers) {
    tierUsed = tier;
    tryPick(tier, targetCount);
    if (selected.length >= minCount) break;
  }

  if (selected.length < minCount) {
    tierUsed = tiers[tiers.length - 1] ?? 4;
    for (const item of scored) {
      if (selected.length >= minCount) break;
      if (isAlreadySelected(item, selected)) continue;
      if (item.quality.topicRelevanceScore < minTopicRelevance) continue;
      if (item.quality.lowQualityPenalty >= 6) continue;
      if (item.quality.clickbaitPenalty >= 6) continue;
      selected.push({ ...item, fallbackRank: 0 });
    }
  }

  if (allowExtendedFallback && selected.length < minCount) {
    tryPickFallbackPool(
      extendedAgePool,
      minCount,
      1,
      (a, b) => b.quality.finalScore - a.quality.finalScore
    );
  }

  if (allowExtendedFallback && selected.length < minCount) {
    const backgroundPool = [...scored, ...extendedAgePool].filter(
      (item) =>
        !isAlreadySelected(item, selected) &&
        isBackgroundContent(item) &&
        isSafeFallbackCandidate(item, minTopicRelevance)
    );
    tryPickFallbackPool(backgroundPool, minCount, 2, (a, b) => backgroundSortScore(b) - backgroundSortScore(a));
  }

  if (allowExtendedFallback && selected.length < minCount) {
    const officialPool = [...scored, ...extendedAgePool].filter(
      (item) =>
        !isAlreadySelected(item, selected) &&
        isOfficialContent(item) &&
        isSafeFallbackCandidate(item, minTopicRelevance)
    );
    tryPickFallbackPool(officialPool, minCount, 3, (a, b) => {
      const scoreA = a.quality.finalScore + a.quality.sourceQualityScore;
      const scoreB = b.quality.finalScore + b.quality.sourceQualityScore;
      return scoreB - scoreA;
    });
  }

  selected.sort((a, b) => {
    const rankA = a.fallbackRank ?? 0;
    const rankB = b.fallbackRank ?? 0;
    if (rankA !== rankB) return rankA - rankB;
    if (b.quality.finalScore !== a.quality.finalScore) {
      return b.quality.finalScore - a.quality.finalScore;
    }
    return b.quality.freshnessScore - a.quality.freshnessScore;
  });

  const log: QualitySelectionLog = {
    topic,
    candidateCount: articles.length,
    selectedCount: selected.length,
    tierUsed,
    selected: selected.map((s) => ({
      title: s.title,
      source: s.source,
      finalScore: s.quality.finalScore,
      topicRelevanceScore: s.quality.topicRelevanceScore,
    })),
    lowestSelected:
      selected.length > 0
        ? {
            title: selected[selected.length - 1]!.title,
            finalScore: selected[selected.length - 1]!.quality.finalScore,
          }
        : undefined,
    topRejections: rejections
      .sort((a, b) => a.finalScore - b.finalScore)
      .slice(0, 5),
  };

  if (options.enableLog) {
    console.log(
      JSON.stringify({
        event: "news_quality_selection",
        ...log,
      })
    );
  }

  return { selected, log };
}

export function pickNewsForScript<T extends NewsArticleInput & { quality?: NewsQualityBreakdown }>(
  articles: T[],
  durationMinutes: number
): T[] {
  const targets: Record<number, { min: number; max: number }> = {
    3: { min: 5, max: 8 },
    5: { min: 8, max: 12 },
    10: { min: 12, max: 20 },
    15: { min: 15, max: 25 },
  };
  const target = targets[durationMinutes] ?? targets[3]!;

  const scored = articles.map((a) => ({
    article: a,
    score:
      a.quality?.finalScore ??
      calculateNewsQualityScore(a, a.topic ?? a.title).finalScore,
  }));
  scored.sort((a, b) => b.score - a.score);

  const picked = scored.slice(0, target.max).map((s) => s.article);
  if (picked.length >= target.min) return picked;

  return scored.slice(0, Math.min(target.min, scored.length)).map((s) => s.article);
}
