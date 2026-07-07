const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_TIMEOUT_MS = 50000;

type SummaryItem = {
  id?: string;
  title: string;
  source: string;
  summary: string;
  url: string;
  publishedAt: string;
  topic: string;
};
type AiDuration = 3 | 5 | 10 | 15;

type HighlightOut = { level: string; title: string; summary: string };

type Allocation = {
  maxTokens: number;
  modeLabel: string;
  scriptGuide: string;
  highlightsGuide: string;
  temperature: number;
};

const FINANCE_KEYWORD_RE =
  /股|ETF|基金|債券|利率|降息|升息|Fed|CPI|台積|台股|美股|道瓊|納斯達克|標普|加密|比特|以太|BTC|ETH|幣圈|虛擬貨幣|外匯|匯率|央行|財報|營收|獲利|市值|漲跌|空頭|多頭|期貨|選擇權|高股息|0050|00919/i;

function parseBody(req: any): Record<string, unknown> {
  const b = req.body;
  if (b == null) return {};
  if (typeof b === "string") {
    try {
      return JSON.parse(b) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof b === "object") return b as Record<string, unknown>;
  return {};
}

function normalizeDuration(raw: unknown): AiDuration {
  const n = Number(raw);
  if (n === 5 || n === 10 || n === 15) return n;
  return 3;
}

function hasFinanceRelatedNews(items: SummaryItem[]): boolean {
  return items.some(
    (it) => FINANCE_KEYWORD_RE.test(it.title) || FINANCE_KEYWORD_RE.test(it.source)
  );
}

const ENTITY_PRESERVATION_RULES = `【實體名稱保留｜硬性規則】
產出新聞稿時，必須保留每則新聞的關鍵實體名稱，不得改寫成模糊代稱。
必須保留（若原始資料有出現）：人名、球隊、公司、幣種（BTC/ETH/Solana 等）、ETF/股票/指數、國家地區、賽事組織、事件名稱。
每一則新聞在 script 中第一次出現時，必須清楚寫出主體名稱（從標題、摘要、來源推得的名稱務必寫出）。
嚴禁在第一次介紹時使用：這位球員、該名球員、某球星、某公司、該幣種、該事件、這項政策、這個市場、某重砲手、104億重砲手（若標題/摘要有姓名卻不寫姓名）等模糊說法。
若標題或摘要真的沒有姓名，才可保守寫「一名球員」等，且不可自行編造姓名。
深度解析須以提供的標題、摘要、來源為基礎，不得補出原資料沒有的細節；分析可保守，不可把推測講成事實。`;

function buildAnchorNamingRules(listenerName: string, anchorName: string): string {
  const listener = listenerName.trim() || "聽眾朋友";
  const anchor = anchorName.trim() || "Emily";
  return `【主播自稱｜硬性規則】
聽眾稱呼（僅稱呼聽眾）：${listener}
主播名稱（主播自稱用）：${anchor}
開場可參考：「${listener}，歡迎收聽，我是主播 ${anchor}。」
禁止主播自稱為聽眾名稱，禁止出現：
- 「我是 ${listener}」
- 「我是主播 ${listener}」
- 「我是主持人 ${listener}」
- 「我是你的 AI 主播 ${listener}」
主播自稱必須使用 ${anchor}，聽眾稱呼只能使用 ${listener}。`;
}

const OUTPUT_SELF_CHECK = (listenerName: string, anchorName: string) => {
  const listener = listenerName.trim() || "聽眾朋友";
  const anchor = anchorName.trim() || "Emily";
  return `【輸出前自我檢查】
輸出 JSON 前請確認：
1. 每則主要新聞是否都明確寫出人名、球隊、公司、幣種或事件名稱？
2. 是否用「這位球員」「某公司」「該幣種」等取代原本應出現的名稱？
3. 是否補充了原新聞沒有的細節（薪資、交易、季後賽等）？
4. 是否保持新聞整理與市場觀察語氣，未把推測講成定論？
5. 主播自稱是否使用主播名稱 ${anchor}，而非聽眾名稱 ${listener}？禁止「我是 ${listener}」「我是主播 ${listener}」「我是主持人 ${listener}」「我是你的 AI 主播 ${listener}」。
若有上述問題，請修正 script 後再輸出。`;
};

function parseSummaryItem(o: Record<string, unknown>): SummaryItem | null {
  const title = String(o?.title ?? "").trim().slice(0, 500);
  if (!title) return null;
  const id = String(o?.id ?? "").trim().slice(0, 120);
  const summary = String(o?.summary ?? o?.description ?? "")
    .trim()
    .slice(0, 800);
  const url = String(o?.url ?? o?.link ?? "").trim().slice(0, 500);
  const publishedAt = String(o?.publishedAt ?? o?.pubDate ?? "")
    .trim()
    .slice(0, 80);
  const topic = String(o?.topic ?? o?.keyword ?? "").trim().slice(0, 120);
  return {
    id: id || undefined,
    title,
    source: String(o?.source ?? "").trim().slice(0, 200),
    summary,
    url,
    publishedAt,
    topic,
  };
}

function formatNewsListForPrompt(items: SummaryItem[]): string {
  return items
    .map((it, i) => {
      const lines = [`新聞 ${i + 1}：`, `標題：${it.title}`, `來源：${it.source}`];
      if (it.summary) lines.push(`摘要：${it.summary}`);
      else lines.push("摘要：（無，請僅依標題與來源保守撰寫，勿捏造姓名或數據）");
      if (it.url) lines.push(`連結：${it.url}`);
      if (it.publishedAt) lines.push(`時間：${it.publishedAt}`);
      if (it.topic) lines.push(`相關主題／關鍵字：${it.topic}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

type DailyInsightReco = { title: string; reason: string };

type DailyInsightOut = {
  attentionLevel: "低" | "中" | "高";
  sentiment: "偏正面" | "偏負面" | "中立" | "分歧";
  hotReason: string;
  keywords: string[];
  controversies: string[];
  recommendedNews: DailyInsightReco[];
};

function coerceDailyInsight(raw: unknown): DailyInsightOut | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const attention = o.attentionLevel;
  const sentiment = o.sentiment;
  const hotReason =
    typeof o.hotReason === "string" ? o.hotReason.trim().slice(0, 60) : "";
  const attentionLevel =
    attention === "低" || attention === "中" || attention === "高" ? attention : null;
  const sentimentLevel =
    sentiment === "偏正面" || sentiment === "偏負面" || sentiment === "中立" || sentiment === "分歧"
      ? sentiment
      : null;

  const keywordsRaw = o.keywords;
  const keywords = Array.isArray(keywordsRaw)
    ? keywordsRaw
        .filter((x) => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const controversiesRaw = o.controversies;
  const controversies = Array.isArray(controversiesRaw)
    ? controversiesRaw
        .filter((x) => typeof x === "string")
        .map((s) => s.trim().replace(/^#+/, ""))
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const recoRaw = o.recommendedNews;
  const recommendedNews: DailyInsightReco[] = [];
  if (Array.isArray(recoRaw)) {
    for (const row of recoRaw.slice(0, 3)) {
      if (typeof row === "string") {
        const text = row.trim();
        if (text.length >= 6) {
          recommendedNews.push({ title: text.slice(0, 300), reason: "值得優先關注" });
        }
        continue;
      }
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const title = typeof r.title === "string" ? r.title.trim() : "";
      const reason =
        typeof r.reason === "string" ? r.reason.trim().slice(0, 40) : "值得優先關注";
      if (title) {
        recommendedNews.push({
          title: title.slice(0, 300),
          reason: reason || "值得優先關注",
        });
      }
    }
  }

  if (!attentionLevel || !sentimentLevel || !hotReason) return null;
  return {
    attentionLevel,
    sentiment: sentimentLevel,
    hotReason,
    keywords,
    controversies,
    recommendedNews,
  };
}

function formatNewsListForInsight(items: SummaryItem[]): string {
  return items
    .map((it, i) => {
      const lines = [
        `新聞 ${i + 1}：`,
        it.id ? `id：${it.id}` : "",
        `標題：${it.title}`,
        `來源：${it.source}`,
      ].filter(Boolean);
      if (it.summary) lines.push(`摘要：${it.summary}`);
      else lines.push("摘要：（無）");
      if (it.url) lines.push(`連結：${it.url}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

function deepDiveCount(duration: AiDuration, newsCount: number): number {
  if (duration === 3) return Math.min(3, Math.max(2, newsCount >= 4 ? 3 : 2));
  if (duration === 5) return Math.min(4, Math.max(2, newsCount >= 4 ? 3 : newsCount));
  if (duration === 10) return Math.min(5, Math.max(3, newsCount >= 4 ? 4 : newsCount));
  return Math.min(5, Math.max(3, newsCount));
}

/** 依時長 × 新聞數量 × 一般/深度 決定 token 上限與篇幅指引 */
function buildDynamicAllocation(
  duration: AiDuration,
  newsCount: number,
  deepMode: boolean
): Allocation {
  const n = newsCount;
  const dive = deepDiveCount(duration, n);

  if (!deepMode) {
    return buildNormalAllocation(duration, n);
  }
  return buildDeepAllocation(duration, n, dive);
}

function buildNormalAllocation(duration: AiDuration, n: number): Allocation {
  const many = n >= 4;

  if (duration === 3) {
    return {
      maxTokens: many ? 1900 : 1600,
      temperature: 0.42,
      modeLabel: "3 分鐘｜一般整理｜每日早報",
      scriptGuide: `【定位】快速掌握今日重點，像每日 AI 早報。
【字數】總字數約 700～1000 字。
【語氣】新聞主播式、有轉場、清楚好聽；以「發生了什麼」為主。
【結構】簡短開場 → 依重要度播報全部 ${n} 則（🔥 2～3 句；⚠️ 1～2 句；ℹ️ 1 句）→ 結尾。
【允許】極簡短的一句影響或脈絡（嵌入句中即可），但不要展開成分析段落。
【禁止】使用「一、事件背景」等深度解析標題；禁止每則平均寫長；禁止評論專欄語氣。`,
      highlightsGuide: `highlights 共 ${n} 則，與輸入一一對應。
- summary：🔥 2 句（事實＋一句影響）；⚠️ 1～2 句；ℹ️ 1 句。
- 以事實整理為主，勿寫長篇背景或後續觀察清單。`,
    };
  }

  if (duration === 5) {
    return {
      maxTokens: n >= 4 ? 2200 : 2000,
      temperature: 0.45,
      modeLabel: "5 分鐘｜一般整理｜推薦完整版",
      scriptGuide: `【定位】推薦收聽長度，較完整的今日新聞廣播稿。
【字數】總字數約 1200～1600 字。
【語氣】Podcast 新聞節目感、有層次與轉場，但仍是「播報重點」而非「分析評論」。
【結構】開場 → 全部 ${n} 則都要出現（🔥 3～4 句；⚠️ 2 句；ℹ️ 1～2 句）→ 結尾。
【允許】🔥 可帶一句背景或影響（簡短），但不要為每則都寫四段分析。
【禁止】「一、事件背景／二、為什麼重要」等深度解析架構；禁止保證性語氣與投資建議。`,
      highlightsGuide: `highlights 共 ${n} 則，與輸入一一對應。
- 🔥：2～3 句（重點＋簡短影響）；⚠️：2 句；ℹ️：1 句。
- 仍偏事實整理，勿寫成分析報告。`,
    };
  }

  if (duration === 10) {
    return {
      maxTokens: n >= 4 ? 3200 : 2800,
      temperature: 0.48,
      modeLabel: "10 分鐘｜深入版｜更多背景",
      scriptGuide: `【定位】深入版每日電台，加入更多新聞背景與脈絡。
【字數】總字數約 2000～2800 字。
【語氣】像 podcast 新聞深度節目前段，仍保持主播口播感。
【結構】儀式感開場 → 全部 ${n} 則依重要度展開（🔥 4～5 句含背景；⚠️ 2～3 句；ℹ️ 1～2 句）→ 今日小結。
【允許】穿插簡短「為何重要」「後續觀察」嵌入句中；可補充輸入摘要中已有的背景。
【禁止】捏造未提供的事實；禁止論文式標題；禁止投資建議。`,
      highlightsGuide: `highlights 共 ${n} 則，與輸入一一對應。
- 🔥：3～4 句（事實＋背景＋影響）；⚠️：2～3 句；ℹ️：1～2 句。`,
    };
  }

  return {
    maxTokens: n >= 4 ? 4000 : 3600,
    temperature: 0.5,
    modeLabel: "15 分鐘｜完整 Podcast｜洞察與觀點",
    scriptGuide: `【定位】完整 Podcast 等級的專屬 AI 電台，不是單純加長。
【字數】總字數約 2800～3800 字。
【語氣】有儀式感、有層次，像每日個人電台完整節目。
【結構】開場問候 → 今日主軸 → 全部 ${n} 則深度播報（🔥 5～6 句含背景/後續/不確定性；⚠️ 3 句；ℹ️ 2 句）→ AI 洞察小結（整合今日趨勢，非新資料）→ 結尾。
【必須】至少 1～2 則加入「不同觀點或爭議點」（僅能基於輸入，保守表述）。
【必須】至少 1 段「後續值得觀察什麼」。
【禁止】把每則都寫成相同長度；禁止補出原資料沒有的數字或交易；禁止投資建議。`,
    highlightsGuide: `highlights 共 ${n} 則，與輸入一一對應。
- 🔥：4～5 句（含背景、影響、後續）；⚠️：2～3 句；ℹ️：1～2 句。`,
  };
}

function buildDeepAllocation(
  duration: AiDuration,
  n: number,
  diveCount: number
): Allocation {
  const supplement = Math.max(0, n - diveCount);
  const supplementGuide =
    supplement > 0
      ? `其餘 ${supplement} 則次要新聞請用「快速補充」一兩句帶過，不要展開分析。`
      : "";

  const antiRewrite =
    "深度解析不可只是改寫一般整理；須回答為什麼重要、影響誰、後續觀察什麼、有哪些不確定性。";

  if (duration === 3) {
    return {
      maxTokens: 2000,
      temperature: 0.5,
      modeLabel: "3 分鐘｜深度解析 Pro",
      scriptGuide: `【定位】新聞台深度口播，挑 2～3 個主題，比一般整理更有分析感。
【字數】script 約 900～1300 字。
【策略】${diveCount} 則主題；${supplementGuide}
【寫法】每段第一句必明確寫出新聞主體全名；先講標題/摘要中的事實，再講為何重要、可能影響、後續觀察。
【禁止】無資料卻寫薪資結構、交易市場、季後賽前景；資訊不足就簡短保守；禁止模糊代稱；${antiRewrite}`,
      highlightsGuide: `highlights 共 ${n} 則，與輸入一一對應。
- 深入主題 summary 2～4 句；其餘 1～2 句。`,
    };
  }

  if (duration === 5) {
    return {
      maxTokens: 2600,
      temperature: 0.52,
      modeLabel: "5 分鐘｜深度解析 Pro｜完整深度",
      scriptGuide: `【定位】完整深度解析約 3～4 個主題，仍保持新聞台口播感。
【字數】script 約 1500～2200 字。
【策略】${diveCount} 則主題可用明確小段開場；${supplementGuide}
【內容】含背景、重要性、影響、後續觀察與不確定性；${antiRewrite}
【禁止】不要像券商研究報告；script 內禁止出現 JSON 或 highlights 資料。`,
      highlightsGuide: `highlights 共 ${n} 則，與輸入一一對應。
- 深入主題 summary 3～5 句；快速補充 1～2 句。`,
    };
  }

  if (duration === 10) {
    return {
      maxTokens: 3400,
      temperature: 0.54,
      modeLabel: "10 分鐘｜深度解析 Pro｜深入電台",
      scriptGuide: `【定位】深入版 Pro 電台，更多背景、後續與不確定性。
【字數】script 約 2200～3000 字。
【策略】${diveCount} 則主題深入；${supplementGuide}
【內容】含事件背景、多方觀點（僅基於輸入）、後續觀察；${antiRewrite}`,
      highlightsGuide: `highlights 共 ${n} 則，與輸入一一對應。
- 深入主題 summary 4～6 句；其餘 2 句。`,
    };
  }

  return {
    maxTokens: 4200,
    temperature: 0.55,
    modeLabel: "15 分鐘｜深度解析 Pro｜完整 Podcast",
    scriptGuide: `【定位】完整 Podcast 等級 Pro 深度電台：洞察、後續、不同觀點，不是單純加長。
【字數】script 約 3000～4000 字。
【策略】${diveCount} 則主題完整深度；${supplementGuide}
【內容】含背景、影響、爭議或不同觀點、後續觀察、AI 整合小結；${antiRewrite}
【禁止】捏造事實；禁止 JSON 出現在 script。`,
    highlightsGuide: `highlights 共 ${n} 則，與輸入一一對應。
- 深入主題 summary 5～7 句；快速補充 2 句。`,
  };
}

function buildFinanceDisclaimerBlock(needsDisclaimer: boolean): string {
  if (!needsDisclaimer) return "";
  return `

【財經相關內容】
本次選取含財經、股市、ETF 或加密貨幣等主題。script 結尾必須獨立一段加入以下句子（逐字）：
「以上內容僅為新聞整理與市場觀察，不構成投資建議。」
並遵守：不保證漲跌、不過度誇張投資語氣、不把無來源內容講得太肯定。`;
}

function buildDeepModeSystemBlock(
  deepMode: boolean,
  diveCount: number,
  duration: AiDuration
): string {
  if (!deepMode) {
    return `

【一般整理模式】
- 快速整理今天發生什麼事，可涵蓋 3～5 則，以摘要為主，少延伸。
- script 只能是口播新聞稿全文，禁止在 script 內輸出 JSON 或 highlights。`;
  }

  const durationNote =
    duration === 3
      ? "\n- 3 分鐘深度：可用輕量小標，900～1300 字，勿像 JSON 或報告。"
      : duration === 5
        ? "\n- 5 分鐘深度：段落可更完整，1500～2200 字，仍保持主播感。"
        : duration === 10
          ? "\n- 10 分鐘深度：2200～3000 字，可加入更多背景與後續觀察。"
          : "\n- 15 分鐘深度：3000～4000 字，完整 Podcast 洞察，禁止單純加長。";

  return `

【深度解析 Pro】
- 挑 ${diveCount} 則最重要主題講深，其餘快速補充；不可只改寫一般整理。
- script 僅放口播稿，highlights 只放在 JSON 的 highlights 陣列，禁止混進 script。
- 須有「為什麼重要／影響誰／後續觀察／不確定性」；深度解析不可只是改寫摘要。${durationNote}`;
}

function safeJsonParse(s: string): Record<string, unknown> | null {
  try {
    const o = JSON.parse(s) as unknown;
    return typeof o === "object" && o !== null && !Array.isArray(o)
      ? (o as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stripMarkdownJsonFence(text: string): string {
  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  return s;
}

function looksLikeSummaryJsonBlob(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("{")) return false;
  return t.includes('"highlights"') && t.includes('"script"');
}

function extractJsonObjectSubstring(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

function extractOpenAiSummary(content: string): {
  script: string;
  highlights: HighlightOut[];
} {
  const cleaned = stripMarkdownJsonFence(content);
  const candidates = [cleaned, extractJsonObjectSubstring(cleaned)].filter(
    Boolean
  ) as string[];

  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate);
    if (!parsed || typeof parsed.script !== "string") continue;
    let script = parsed.script.trim();
    let highlights = coerceHighlights(parsed.highlights);
    if (script && looksLikeSummaryJsonBlob(script)) {
      const nested = safeJsonParse(script);
      if (nested && typeof nested.script === "string") {
        script = nested.script.trim();
        highlights = coerceHighlights(nested.highlights);
      } else {
        continue;
      }
    }
    if (script) return { script, highlights };
  }

  if (looksLikeSummaryJsonBlob(cleaned)) {
    return { script: "", highlights: [] };
  }

  return { script: cleaned, highlights: [] };
}

function coerceHighlights(raw: unknown): HighlightOut[] {
  if (!Array.isArray(raw)) return [];
  const out: HighlightOut[] = [];
  for (const row of raw.slice(0, 8)) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const level = String(o.level ?? "").slice(0, 32);
    const title = String(o.title ?? "").slice(0, 300);
    const summary = String(o.summary ?? "").slice(0, 1200);
    if (!title && !summary) continue;
    out.push({ level: level || "ℹ️一般", title: title || "重點", summary });
  }
  return out;
}

function sendJson(
  res: any,
  payload: Record<string, unknown>,
  status = 200
) {
  return res.status(status).json(payload);
}

export default async function handler(req: any, res: any) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, { ok: false, error: "僅支援 POST" }, 405);
  }

  try {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return sendJson(res, {
      ok: false,
      code: "NO_KEY",
      error: "尚未設定 AI API Key",
    });
  }

  const body = parseBody(req);
  const kind = String(body.kind ?? "").trim();
  const duration = normalizeDuration(body.duration);
  const deepMode = body.deepMode === true || body.mode === "deep";
  const listenerName = String(body.displayName ?? "").trim() || "聽眾朋友";
  const anchorName = String(body.anchorName ?? "").trim() || "Emily";
  const rawItems = body.items;
  const itemLimit =
    kind === "dailyInsight" ? 20 : duration >= 10 ? 8 : 5;
  const items: SummaryItem[] = Array.isArray(rawItems)
    ? rawItems
        .slice(0, itemLimit)
        .map((x: unknown) => parseSummaryItem(x as Record<string, unknown>))
        .filter((x): x is SummaryItem => x !== null)
    : [];

  if (items.length === 0) {
    return sendJson(res, {
      ok: false,
      error: "請至少選擇一則新聞（僅需標題與來源）",
    });
  }

  const n = items.length;

  if (kind === "dailyInsight") {
    const listText = formatNewsListForInsight(items);
    const system = `你是「AI 個人新聞台」的 AI 新聞總編輯。
使用者提供今日新聞（含 id、標題、摘要、來源、連結）。請以總編輯視角整理今日資訊，不只是情緒分析，而要幫讀者判斷「今天該關注什麼、爭議在哪、先看哪幾則」。
輸出必須是 JSON（不要 markdown、不要任何多餘文字），且固定結構如下：
{
  "attentionLevel": "低" | "中" | "高",
  "sentiment": "偏正面" | "偏負面" | "中立" | "分歧",
  "hotReason": "一句 AI 快報",
  "controversies": ["爭議焦點1", "爭議焦點2"],
  "keywords": ["關鍵字1", "關鍵字2", "關鍵字3"],
  "recommendedNews": [
    { "title": "新聞標題（請複製輸入標題原文或極接近版本）", "reason": "一句推薦原因" }
  ]
}

規則：
- attentionLevel：以「事件重要性 + 討論熱度 + 影響範圍」判斷，不要只看新聞數量。
- sentiment：整體風向；若正負並存、意見分裂或爭議大，用「分歧」。
- hotReason：AI 快報風格，45～60 字以內，一句話點出今日主軸；不要小作文、不要口號、不要投資建議。
- controversies：3～5 個，偏「事件／爭論／衝突／風險」標籤（例：監管收緊、裁判判決、關鍵失誤）；不要放人名、公司名、幣種名。
- keywords：3～5 個，偏「名詞／人物／主題／實體」（例：比特幣、Coinbase、NBA）；不要與 controversies 重複。
- recommendedNews：1～3 則物件；title 必須來自輸入新聞標題（勿回傳 id）；reason 為 8～16 字推薦原因（例：影響市場情緒最大、今日爭議度最高）。`;

    const userMsg = `請根據以下新聞，以 AI 新聞總編輯角度分析：
- 今日最值得注意事件
- 今日主要爭議
- 今日熱門關鍵字
- 最值得優先看的新聞（1～3 則）

以下是今日新聞（最多 20 則）：

${listText}`;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
    try {
      const response = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          temperature: 0.35,
          max_tokens: 520,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: userMsg },
          ],
        }),
      });

      const rawOpenAi = await response.text();
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(rawOpenAi) as Record<string, unknown>;
      } catch {
        return sendJson(res, {
          ok: false,
          code: "OPENAI",
          error: "AI 服務回傳異常，請稍後再試",
        });
      }

      if (!response.ok) {
        const errObj = data?.error as Record<string, unknown> | undefined;
        const msg =
          (typeof errObj?.message === "string" && errObj.message) ||
          `OpenAI 請求失敗（HTTP ${response.status}）`;
        return sendJson(res, { ok: false, error: msg });
      }

      const choices = data?.choices as unknown[] | undefined;
      const first = choices?.[0] as Record<string, unknown> | undefined;
      const message = first?.message as Record<string, unknown> | undefined;
      const content =
        typeof message?.content === "string" ? message.content.trim() : "";
      if (!content) {
        return sendJson(res, { ok: false, error: "AI 未回傳有效內容，請稍後再試" });
      }

      let parsed: unknown = null;
      try {
        parsed = JSON.parse(content) as unknown;
      } catch {
        return sendJson(res, { ok: false, error: "AI 回傳格式錯誤，請稍後再試" });
      }

      const insight = coerceDailyInsight(parsed);
      if (!insight) {
        return sendJson(res, { ok: false, error: "AI 回傳內容不完整，請稍後再試" });
      }

      return sendJson(res, { ok: true, kind: "dailyInsight", insight });
    } catch (e) {
      const aborted =
        e instanceof Error &&
        (e.name === "AbortError" || /aborted/i.test(e.message));
      const msg = aborted
        ? "AI 產生逾時，請稍後再試"
        : e instanceof Error
          ? e.message
          : "連線或解析失敗";
      return sendJson(res, {
        ok: false,
        code: aborted ? "TIMEOUT" : "OPENAI",
        error: msg,
      });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  const diveCount = deepDiveCount(duration, n);
  const alloc = buildDynamicAllocation(duration, n, deepMode);
  const financeDisclaimer = buildFinanceDisclaimerBlock(hasFinanceRelatedNews(items));

  const listText = formatNewsListForPrompt(items);

  const outputKind = deepMode ? "深度解析 Pro 稿" : "一般整理主播稿";
  const modeStrategyLine = deepMode
    ? `- 深度解析：請深入分析 ${diveCount} 則最重要主題，其餘放「快速補充」`
    : "- 一般整理：快速掌握今日重點，少評論、少延伸";
  const scriptIntentLine = deepMode
    ? "分析解讀"
    : "今日重點整理";
  const scriptTitleRule = deepMode
    ? duration >= 10
      ? "可用段落小標，禁止 JSON 或報告體"
      : "可用輕量段落，禁止 JSON 或報告體"
    : "禁止使用深度解析報告標題";
  const durationFeel = deepMode ? " 深度解析" : " 一般整理";
  const userWriteHint = deepMode
    ? `請挑 ${diveCount} 則深入分析，其餘快速補充。script 只寫口播稿，不可只改寫摘要。`
    : "請以新聞主播整理今日重點，不要寫成過度分析。";

  const system = `你是「AI 個人新聞台」的專業新聞編輯與主播稿撰寫助理。
使用者提供每則新聞的標題、來源、摘要（若有）、連結與時間；請嚴格依這些資料整理，不要捏造具體數據、姓名或未被資料暗示的事實。
語氣：繁體中文、中性；有節奏、有轉場。

${ENTITY_PRESERVATION_RULES}

${buildAnchorNamingRules(listenerName, anchorName)}

【本次參數】
- 產稿類型：${outputKind}
- 模式：${alloc.modeLabel}
- 使用者選取新聞：${n} 則
${modeStrategyLine}

【script 篇幅與寫作總則】
${alloc.scriptGuide}

【highlights 總則】
${alloc.highlightsGuide}
${buildDeepModeSystemBlock(deepMode, diveCount, duration)}
${financeDisclaimer}

你必須只輸出一個 JSON 物件（不要 markdown 程式碼區、不要前後說明文字），結構如下：
{
  "highlights": [
    { "level": "🔥重大", "title": "簡短標題", "summary": "依模式與重要度調整" }
  ],
  "script": "僅口播新聞稿全文（單一字串，可換行；不可含 JSON、highlights、欄位名）"
}

【共通規則】
- highlights 必須恰好 ${n} 則，與輸入編號一一對應，不可合併或省略任一则。
- level 僅能使用：「🔥重大」「⚠️注意」「ℹ️一般」。
- script 必須讓聽眾聽得出「${scriptIntentLine}」；${scriptTitleRule}。
- 轉場範例：「首先帶您關注…」「接下來深入看…」「快速補充幾則…」「最後提醒…」
- 字數/句數服務於「聽起來像 ${duration} 分鐘${durationFeel}」，勿為湊字數重複空話。

${OUTPUT_SELF_CHECK(listenerName, anchorName)}`;

  const userMsg = `以下為使用者選取的 ${n} 則新聞（含標題、來源、摘要等，請務必保留其中的專有名詞與人名）：
請先判斷每則重要程度（🔥/⚠️/ℹ️），再依「${alloc.modeLabel}」撰寫。
${userWriteHint}
輸出 JSON，highlights 必須 ${n} 則；highlights 的 title 也請使用明確名稱，勿用模糊代稱。

${listText}`;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: alloc.temperature,
        max_tokens: alloc.maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
      }),
    });

    const rawOpenAi = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(rawOpenAi) as Record<string, unknown>;
    } catch {
      return sendJson(res, {
        ok: false,
        code: "OPENAI",
        error: "AI 服務回傳異常，請稍後再試",
      });
    }

    if (!response.ok) {
      const errObj = data?.error as Record<string, unknown> | undefined;
      const msg =
        (typeof errObj?.message === "string" && errObj.message) ||
        `OpenAI 請求失敗（HTTP ${response.status}）`;
      return sendJson(res, { ok: false, error: msg });
    }

    const choices = data?.choices as unknown[] | undefined;
    const first = choices?.[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    const content =
      typeof message?.content === "string" ? message.content.trim() : "";

    if (!content) {
      return sendJson(res, {
        ok: false,
        error: "AI 未回傳有效內容，請稍後再試",
      });
    }

    const { script, highlights } = extractOpenAiSummary(content);
    if (!script) {
      return sendJson(res, {
        ok: false,
        error: "AI 未回傳可讀新聞稿，請稍後再試",
      });
    }

    return sendJson(res, {
      ok: true,
      duration,
      deepMode,
      highlights,
      script,
      jsonFallback: false,
    });
  } catch (e) {
    const aborted =
      e instanceof Error &&
      (e.name === "AbortError" || /aborted/i.test(e.message));
    const msg = aborted
      ? "AI 產生逾時，請改選較短時長或一般整理模式後再試"
      : e instanceof Error
        ? e.message
        : "連線或解析失敗";
    return sendJson(res, {
      ok: false,
      code: aborted ? "TIMEOUT" : "OPENAI",
      error: msg,
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "伺服器錯誤";
    return sendJson(res, { ok: false, code: "SERVER", error: msg });
  }
}
