const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_TIMEOUT_MS = 55_000;

/** Vercel Serverless：延長執行時間，降低深度解析逾時 */
export const config = {
  maxDuration: 60,
};

type SummaryItem = { title: string; source: string };
type AiDuration = 1 | 3 | 5;

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
  if (n === 3 || n === 5) return n;
  return 1;
}

function hasFinanceRelatedNews(items: SummaryItem[]): boolean {
  return items.some(
    (it) => FINANCE_KEYWORD_RE.test(it.title) || FINANCE_KEYWORD_RE.test(it.source)
  );
}

function deepDiveCount(duration: AiDuration, newsCount: number): number {
  if (duration === 1) return Math.min(2, newsCount);
  if (duration === 3) return Math.min(3, Math.max(2, newsCount >= 4 ? 3 : 2));
  return Math.min(3, Math.max(2, newsCount >= 4 ? 3 : newsCount));
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

  if (duration === 1) {
    return {
      maxTokens: many ? 950 : 800,
      temperature: 0.4,
      modeLabel: "1 分鐘｜一般整理｜快報",
      scriptGuide: `【定位】快速掌握今天發生什麼事。
【字數】總字數約 250～400 字（寧短勿冗）。
【語氣】新聞主播式、清楚、簡潔；只整理主要重點，不要評論專欄、不要延伸分析、不要預測漲跌。
【結構】簡短開場 → 快速帶過 ${n} 則重點（🔥/⚠️ 可 1～2 句，ℹ️ 1 句）→ 簡短結尾。
【禁止】寫「事件背景／為什麼重要／後續觀察」等分析段落標題；禁止把每則都寫成深度稿。`,
      highlightsGuide: `highlights 共 ${n} 則，與輸入一一對應。
- level：🔥重大 / ⚠️注意 / ℹ️一般（依重要度排序）。
- summary：🔥 1～2 句講清「發生什麼」；⚠️ 1 句；ℹ️ 1 句。
- 禁止寫背景分析、影響預測、投資建議。`,
    };
  }

  if (duration === 3) {
    return {
      maxTokens: many ? 1900 : 1600,
      temperature: 0.42,
      modeLabel: "3 分鐘｜一般整理｜主播稿",
      scriptGuide: `【定位】快速掌握今日重點，像晚間新聞中段。
【字數】總字數約 700～1000 字。
【語氣】新聞主播式、有轉場、清楚好聽；以「發生了什麼」為主。
【結構】開場 → 依重要度播報全部 ${n} 則（🔥 2～3 句；⚠️ 1～2 句；ℹ️ 1 句）→ 結尾。
【允許】極簡短的一句影響或脈絡（嵌入句中即可），但不要展開成分析段落。
【禁止】使用「一、事件背景」等深度解析標題；禁止每則平均寫長；禁止評論專欄語氣。`,
      highlightsGuide: `highlights 共 ${n} 則，與輸入一一對應。
- summary：🔥 2 句（事實＋一句影響）；⚠️ 1～2 句；ℹ️ 1 句。
- 以事實整理為主，勿寫長篇背景或後續觀察清單。`,
    };
  }

  return {
    maxTokens: n >= 4 ? 2200 : 2000,
    temperature: 0.45,
    modeLabel: "5 分鐘｜一般整理｜完整廣播稿",
    scriptGuide: `【定位】較完整的今日新聞廣播稿（仍是一般整理，不是深度解析）。
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

function buildDeepAllocation(
  duration: AiDuration,
  n: number,
  diveCount: number
): Allocation {
  const supplement = Math.max(0, n - diveCount);

  const deepStructure = `【深度解析架構｜僅用於你挑選的 ${diveCount} 則最重要主題】
每個深入主題請依序使用以下段落標題（標題文字需出現在 script 中）：
「一、事件背景」
「二、為什麼重要」
「三、可能影響」
「四、後續觀察」
並在該主題內融入：核心重點、風險或不確定性（勿捏造數據；不確定處用「可能」「尚待觀察」）。
【禁止】把 ${diveCount} 則都寫成相同長度；禁止只是改寫標題或換句話說的摘要。`;

  const supplementGuide =
    supplement > 0
      ? `【快速補充】其餘 ${supplement} 則次要新聞集中放在「快速補充」段落，每則 1～2 句帶過即可，不要套用四段分析標題。`
      : "";

  const antiRewrite = `【硬性要求】深度解析模式不可只是改寫新聞摘要，必須加入背景、影響、後續觀察與不確定性；script 的分析段落必須明顯比一般整理更有「為什麼重要、會怎樣、要看什麼」的資訊量。`;

  if (duration === 1) {
    return {
      maxTokens: 1100,
      temperature: 0.48,
      modeLabel: "1 分鐘｜深度解析 Pro",
      scriptGuide: `【定位】理解為什麼重要、可能影響與後續觀察（不是快報摘要）。
【字數】總字數約 400～600 字。
【策略】從 ${n} 則中挑 1～2 則最重要主題深入；${supplementGuide}
${deepStructure}
${antiRewrite}
【語氣】分析解讀但保持中性；不誇大、不保證漲跌；無來源勿寫死。`,
      highlightsGuide: `highlights 共 ${n} 則，與輸入一一對應（順序不可變）。
- 深入分析的 1～2 則：summary 3～4 句，需含背景＋為何重要＋影響或觀察之一。
- 其餘：summary 1 句快報即可。
- 勿每則都寫滿分析句。`,
    };
  }

  if (duration === 3) {
    return {
      maxTokens: 1800,
      temperature: 0.5,
      modeLabel: "3 分鐘｜深度解析 Pro",
      scriptGuide: `【定位】理解事件為什麼重要、可能影響與後續要觀察什麼。
【字數】總字數約 1000～1400 字。
【策略】挑 ${diveCount} 則最重要主題做完整四段分析；${supplementGuide}
${deepStructure}
${antiRewrite}
【語氣】有分析感、像評論員整理市場與局勢，但非投資叫單；保留不確定性。`,
      highlightsGuide: `highlights 共 ${n} 則，與輸入一一對應。
- 深入 ${diveCount} 則：summary 3～5 句（背景、重要性、影響、觀察、風險至少涵蓋其三）。
- 快速補充則：1～2 句。
- 禁止每則 highlights 都寫相同長度。`,
    };
  }

  return {
    maxTokens: 2600,
    temperature: 0.52,
    modeLabel: "5 分鐘｜深度解析 Pro｜完整深度",
    scriptGuide: `【定位】完整深度解析：背景、影響、後續觀察與不確定性。
【字數】總字數約 1600～2200 字。
【策略】挑 ${diveCount} 則最重要主題，每則完整走四段標題；${supplementGuide}
${deepStructure}
${antiRewrite}
【語氣】層次分明、像深度新聞 Podcast；可適度鋪陳脈絡，但勿捏造數據或過度肯定。`,
    highlightsGuide: `highlights 共 ${n} 則，與輸入一一對應。
- 深入 ${diveCount} 則：summary 4～6 句，結構化涵蓋背景、核心、重要性、影響、後續觀察、風險。
- 快速補充則：1～2 句。
- 深入主題的 highlights 必須明顯比快速補充更長、更有分析感。`,
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

function buildDeepModeSystemBlock(deepMode: boolean, diveCount: number): string {
  if (!deepMode) {
    return `

【一般整理模式｜與深度解析的差異】
你正在撰寫「一般整理」，不是深度解析。
- 任務：讓聽眾快速知道「今天發生什麼事」。
- 禁止：把 script 寫成帶「一、事件背景」等標題的分析稿；禁止與深度解析稿雷同的長篇評論。
- highlights 與 script 都應明顯短於、簡於深度解析模式。`;
  }

  return `

【深度解析 Pro 模式｜與一般整理的差異】
你正在撰寫「深度解析 Pro」，不是一般新聞摘要。
- 任務：讓聽眾理解「為什麼重要、可能影響什麼、後續要觀察什麼」。
- 必須：從 ${diveCount} 則（或時長允許的上限）挑最重要主題深入；其餘放「快速補充」。
- 每個深入主題在 script 中須涵蓋：事件背景、核心重點、為什麼重要、可能影響、後續觀察、風險或不確定性（可融入四段標題內，勿只列標題不寫內容）。
- 硬性禁止：不可只是把一般整理換句話說；不可每則新聞平均展開；不可缺少「可能」「尚待觀察」等不確定性表述（當標題資訊不足時）。
- 深度解析模式不可只是改寫新聞摘要，必須加入背景、影響、後續觀察與不確定性。`;
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

function jsonError(
  res: any,
  error: string,
  code?: string,
  status = 200
) {
  return res.status(status).json({ ok: false, error, code });
}

export default async function handler(req: any, res: any) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  try {
    return await handleSummaryRequest(req, res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "伺服器錯誤";
    return jsonError(res, msg, "SERVER");
  }
}

async function handleSummaryRequest(req: any, res: any) {
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "僅支援 POST" });
  }

  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return res.status(200).json({
      ok: false,
      code: "NO_KEY",
      error: "尚未設定 AI API Key",
    });
  }

  const body = parseBody(req);
  const duration = normalizeDuration(body.duration);
  const deepMode = body.deepMode === true || body.mode === "deep";
  const rawItems = body.items;
  const items: SummaryItem[] = Array.isArray(rawItems)
    ? rawItems
        .slice(0, 5)
        .map((x: unknown) => {
          const o = x as Record<string, unknown>;
          return {
            title: String(o?.title ?? "").slice(0, 500),
            source: String(o?.source ?? "").slice(0, 200),
          };
        })
        .filter((x) => x.title.length > 0)
    : [];

  if (items.length === 0) {
    return res.status(200).json({
      ok: false,
      error: "請至少選擇一則新聞（僅需標題與來源）",
    });
  }

  const n = items.length;
  const diveCount = deepDiveCount(duration, n);
  const alloc = buildDynamicAllocation(duration, n, deepMode);
  const financeDisclaimer = buildFinanceDisclaimerBlock(hasFinanceRelatedNews(items));

  const listText = items
    .map(
      (it, i) =>
        `${i + 1}. 標題：${it.title}\n   來源：${it.source}`
    )
    .join("\n\n");

  const outputKind = deepMode ? "深度解析 Pro 稿" : "一般整理主播稿";

  const system = `你是「AI 個人新聞台」的專業新聞編輯與主播稿撰寫助理。
使用者只會提供新聞「標題」與「來源」，沒有全文；請依標題合理推斷主題並整理，不要捏造具體數據或未被標題暗示的事實。
語氣：繁體中文、中性；有節奏、有轉場。

【本次參數】
- 產稿類型：${outputKind}
- 模式：${alloc.modeLabel}
- 使用者選取新聞：${n} 則
${deepMode ? `- 深度解析：請深入分析 ${diveCount} 則最重要主題，其餘放「快速補充」` : `- 一般整理：快速掌握今日重點，少評論、少延伸"}

【script 篇幅與寫作總則】
${alloc.scriptGuide}

【highlights 總則】
${alloc.highlightsGuide}
${buildDeepModeSystemBlock(deepMode, diveCount)}
${financeDisclaimer}

你必須只輸出一個 JSON 物件（不要 markdown 程式碼區、不要前後說明文字），結構如下：
{
  "highlights": [
    { "level": "🔥重大", "title": "簡短標題", "summary": "依模式與重要度調整" }
  ],
  "script": "完整 AI 主播稿（單一字串，可含換行；深度模式須含指定段落標題）"
}

【共通規則】
- highlights 必須恰好 ${n} 則，與輸入編號一一對應，不可合併或省略任一则。
- level 僅能使用：「🔥重大」「⚠️注意」「ℹ️一般」。
- script 必須讓聽眾聽得出「${deepMode ? "分析解讀" : "今日重點整理"}」；${deepMode ? "深入主題須用四段標題" : "禁止使用深度解析四段標題"}。
- 轉場範例：「首先帶您關注…」「接下來深入看…」「快速補充幾則…」「最後提醒…」
- 字數/句數服務於「聽起來像 ${duration} 分鐘${deepMode ? " 深度解析" : " 一般整理"}」，勿為湊字數重複空話。`;

  const userMsg = `以下為使用者選取的 ${n} 則新聞（僅標題與來源）。
請先判斷每則重要程度（🔥/⚠️/ℹ️），再依「${alloc.modeLabel}」撰寫。
${deepMode ? `請挑 ${diveCount} 則做深度四段分析，其餘放「快速補充」。不可只改寫摘要。` : "請以新聞主播快報整理，不要寫成深度分析。"}
輸出 JSON，highlights 必須 ${n} 則：

${listText}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

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

    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const errObj = data?.error as Record<string, unknown> | undefined;
      const msg =
        (typeof errObj?.message === "string" && errObj.message) ||
        `OpenAI 請求失敗（HTTP ${response.status}）`;
      return res.status(200).json({ ok: false, error: msg });
    }

    const choices = data?.choices as unknown[] | undefined;
    const first = choices?.[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    const content =
      typeof message?.content === "string" ? message.content.trim() : "";

    if (!content) {
      return res.status(200).json({
        ok: false,
        error: "AI 未回傳有效內容，請稍後再試",
      });
    }

    const parsed = safeJsonParse(content);
    if (parsed && typeof parsed.script === "string") {
      const script = parsed.script.trim();
      const highlights = coerceHighlights(parsed.highlights);
      if (!script) {
        return res.status(200).json({
          ok: false,
          error: "AI 回傳的 script 為空",
        });
      }
      return res.status(200).json({
        ok: true,
        duration,
        deepMode,
        highlights,
        script,
        jsonFallback: false,
      });
    }

    return res.status(200).json({
      ok: true,
      duration,
      deepMode,
      highlights: [],
      script: content,
      jsonFallback: true,
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
    return jsonError(res, msg, aborted ? "TIMEOUT" : "OPENAI");
  } finally {
    clearTimeout(timeoutId);
  }
}
