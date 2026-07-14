import type { NewsItem } from "./news.ts";
import type { RadioSlot } from "./news.ts";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function formatNewsList(items: NewsItem[]): string {
  return items
    .map((it, i) => {
      const lines = [
        `新聞 ${i + 1}：`,
        `標題：${it.title}`,
        `來源：${it.source}`,
      ];
      if (it.summary) lines.push(`摘要：${it.summary}`);
      if (it.url) lines.push(`連結：${it.url}`);
      if (it.topic) lines.push(`相關主題：${it.topic}`);
      if (it.publishedAt) lines.push(`發布時間：${it.publishedAt}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export type GenerateRadioScriptOptions = {
  radioSlot?: RadioSlot;
  /** 聽眾稱呼（開場稱呼聽眾用，不可當主播自稱） */
  displayName?: string | null;
  /** AI 主播名稱（主播自稱用，例如 Emily / Sage） */
  anchorName?: string | null;
  /** 早報已報導標題，晚報時避免重複 */
  morningHeadlines?: string[];
  durationMinutes?: number;
  /** 新聞少於該時長最低則數：每則簡短精準 */
  limitedNews?: boolean;
  /** 10 分鐘且新聞達最低但少於理想：深化報導但不編造 */
  enrichedCoverage?: boolean;
};

function durationWordTarget(duration: number): string {
  if (duration >= 10) return "約 2200～3000 字";
  if (duration >= 5) return "約 1200～1700 字";
  return "約 700～1000 字";
}

/**
 * 軟性內容偏好：僅引導敘事優先級與可聽性，非必填、非驗證條件。
 * 資料不足時維持正常摘要即可，不得因此拒絕生成或刪除新聞。
 */
function softStorytellingPreferences(): string {
  return `【內容偏好｜軟性，非必填】
針對每一則新聞，先理解這則事件本身最有新聞價值、最可能引起一般聽眾興趣的資訊，再自然組織口播。不要只重述標題或濃縮背景。
若原始資料中已有較具體的結果、數字、人物表現、最新變化、原因或影響，優先保留並使用；來源沒有的資訊請直接略過，不得猜測、推論成既定事實、補造數字／原因／影響／結果。
不要要求每則新聞包含相同內容、回答相同問題、使用相同句子順序或固定模板。依新聞本身決定敘事重點：有的先講結果，有的先講最新變化，有的先講影響、人物說法、背景原因；僅有初步消息時就用現有內容自然完成即可。
避免每段使用相同開頭或固定套話（例如「最新結果是」「這件事的重要性在於」「對一般民眾的影響是」「值得持續關注」「未來發展備受期待」）。語氣與節奏應隨事件自然變化，像真人主播、好聽可聽。
在不破壞自然度的前提下，盡量讓聽眾得到比標題更多的資訊；優先減少重複標題、空泛形容、沒有新增內容的結語、過多背景鋪陳。不要為了資訊密度變成數字清單或制式報告；兼顧資訊量、自然度、可聽性與主播語感。
以上皆為軟性偏好。資料不足、內容類型特殊或難以套用時，維持正常摘要即可，不要強迫符合規則，也不要因此降低生成成功率。`;
}

function buildMorningSystemPrompt(anchorName: string, listenerName: string, duration: number): string {
  return `你是「AI 個人新聞台」的專業新聞編輯與主播稿撰寫助理。
請依提供的新聞整理 ${duration} 分鐘「今日早報」口播稿（${durationWordTarget(duration)}），繁體中文、新聞主播語氣。
主播名稱：${anchorName}（主播自稱時只能使用此名稱，例如「我是主播 ${anchorName}」）
聽眾稱呼：${listenerName}（僅用於稱呼聽眾，例如「${listenerName}，早安…」）
必須保留人名、球隊、公司、幣種等專有名詞，禁止模糊代稱。
禁止主播自稱為聽眾名稱；禁止「我是 ${listenerName}」「我是主播 ${listenerName}」「我是主持人 ${listenerName}」「我是你的 AI 主播 ${listenerName}」。
不可編造來源沒有的細節；不可為了拉長時長加入臆測；不可重複同一新聞。每則新聞只能根據 title / summary / source / publishedAt 撰寫。
${softStorytellingPreferences()}
請勿自行撰寫「以上就是今天的…」類結尾，系統會統一加上節目結尾。
只輸出 JSON：{"title":"今日 AI 早報","script":"口播稿全文"}`;
}

function buildEveningSystemPrompt(anchorName: string, listenerName: string, duration: number): string {
  return `你是「AI 個人新聞台」的專業新聞編輯與主播稿撰寫助理。
請依提供的新聞整理 ${duration} 分鐘「今日晚報」口播稿（${durationWordTarget(duration)}），繁體中文、新聞主播語氣。
主播名稱：${anchorName}（主播自稱時只能使用此名稱，例如「我是主播 ${anchorName}」）
聽眾稱呼：${listenerName}（僅用於稱呼聽眾，例如「${listenerName}，晚安…」）
重點：整理下午前後的最新更新、今日後續發展與新動態；不要重複早報已報導過的同一則新聞或同一事件。
若新聞是早報事件的後續進展，可簡短帶出「延續早報…」再說新進展，但不可整段重複早報內容。
必須保留人名、球隊、公司、幣種等專有名詞，禁止模糊代稱。
禁止主播自稱為聽眾名稱；禁止「我是 ${listenerName}」「我是主播 ${listenerName}」「我是主持人 ${listenerName}」「我是你的 AI 主播 ${listenerName}」。
不可編造來源沒有的細節；不可為了拉長時長加入臆測；不可重複同一新聞。每則新聞只能根據 title / summary / source / publishedAt 撰寫。
${softStorytellingPreferences()}
請勿自行撰寫「以上就是今天的…」類結尾，系統會統一加上節目結尾。
只輸出 JSON：{"title":"今日 AI 晚報","script":"口播稿全文"}`;
}

function buildUserMessage(
  items: NewsItem[],
  options: GenerateRadioScriptOptions
): string {
  const n = items.length;
  const listenerName = options.displayName?.trim() || "聽眾朋友";
  const anchorName = options.anchorName?.trim() || "Emily";
  const listText = formatNewsList(items);
  const slot = options.radioSlot ?? "morning";
  const duration = options.durationMinutes ?? 3;
  const limitedNewsNote = options.limitedNews
    ? "\n新聞量略少，請每則簡短精準，不要硬拉長、不要補不存在的背景或臆測。"
    : "";
  const enrichedCoverageNote = options.enrichedCoverage
    ? "\n新聞則數略少於理想目標，但請維持完整時長篇幅。每則新聞在忠於來源的前提下，可適度補充：事件背景、影響分析、各方反應、對台灣或聽眾的可能影響、後續值得觀察的重點。禁止重複內容、硬灌字數、編造資訊、加入來源未提供的事實。"
    : "";

  if (slot === "evening") {
    const morningBlock =
      options.morningHeadlines && options.morningHeadlines.length > 0
        ? `\n\n早報已報導過的新聞標題（請避免重複報導同一事件，優先選擇新新聞或後續更新）：\n${options.morningHeadlines.map((t) => `- ${t}`).join("\n")}`
        : "\n\n（無早報稿件紀錄，請依新聞列表撰寫晚報。）";

    return `聽眾稱呼（僅稱呼聽眾，不可當主播自稱）：${listenerName}
主播名稱（主播自稱用）：${anchorName}
請為以下 ${n} 則「新抓取」的新聞撰寫 ${duration} 分鐘今日晚報口播稿。${limitedNewsNote}${enrichedCoverageNote}
開場可參考：「${listenerName}，歡迎收聽今天的 AI 晚報，我是 ${anchorName}。」
結尾自稱請使用主播名稱 ${anchorName}，不可使用 ${listenerName}。
${morningBlock}

${listText}`;
  }

  return `聽眾稱呼（僅稱呼聽眾，不可當主播自稱）：${listenerName}
主播名稱（主播自稱用）：${anchorName}
請為以下 ${n} 則「新抓取」的新聞撰寫 ${duration} 分鐘今日早報口播稿。${limitedNewsNote}${enrichedCoverageNote}
開場可參考：「${listenerName}，早安，我是 ${anchorName}。」
結尾自稱請使用主播名稱 ${anchorName}，不可使用 ${listenerName}。

${listText}`;
}

export async function generateRadioScript(
  apiKey: string,
  items: NewsItem[],
  options: GenerateRadioScriptOptions = {}
): Promise<{ script: string; title: string }> {
  const slot = options.radioSlot ?? "morning";
  const duration = options.durationMinutes ?? 3;
  const anchorName = options.anchorName?.trim() || "Emily";
  const listenerName = options.displayName?.trim() || "聽眾朋友";
  const system =
    slot === "evening"
      ? buildEveningSystemPrompt(anchorName, listenerName, duration)
      : buildMorningSystemPrompt(anchorName, listenerName, duration);
  const userMsg = buildUserMessage(items, options);
  const defaultTitle = slot === "evening" ? "今日 AI 晚報" : "今日 AI 早報";

  console.log("[AI] generateRadioScript", {
    radio_slot: slot,
    duration_minutes: duration,
    news_count: items.length,
    morning_headlines_excluded: options.morningHeadlines?.length ?? 0,
  });

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(55_000),
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature: slot === "evening" ? 0.45 : 0.42,
      max_tokens: duration >= 10 ? 4200 : duration >= 5 ? 2800 : 1900,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMsg },
      ],
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI error ${res.status}: ${raw.slice(0, 200)}`);
  }

  const data = JSON.parse(raw) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) throw new Error("OpenAI empty response");

  const parsed = JSON.parse(content) as { title?: string; script?: string };
  const script = String(parsed.script ?? "").trim();
  if (!script) throw new Error("OpenAI missing script");
  const title = String(parsed.title ?? defaultTitle).trim();
  return { script, title };
}

/** @deprecated 使用 generateRadioScript */
export async function generateThreeMinuteScript(
  apiKey: string,
  items: NewsItem[],
  displayName?: string | null
): Promise<{ script: string; title: string }> {
  return generateRadioScript(apiKey, items, {
    radioSlot: "morning",
    displayName,
  });
}
