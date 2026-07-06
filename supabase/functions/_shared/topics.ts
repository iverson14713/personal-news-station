/** 內建主題 label → Google News RSS query */
export const BUILTIN_TOPIC_QUERIES: Record<string, string> = {
  NBA: "NBA",
  MLB: "MLB",
  Curry: "Stephen Curry OR Curry 勇士",
  大谷翔平: "大谷翔平 OR Shohei Ohtani",
  季後賽: "NBA 季後賽 OR MLB 季後賽",
  幣圈: "加密貨幣 OR 幣圈",
  BTC: "BTC OR 比特幣",
  ETH: "ETH OR 以太坊",
  台股: "台股 OR 台積電",
  ETF: "ETF OR 0050 OR 高股息",
  美股: "美股 OR Nvidia OR Tesla OR Apple",
  財經: "Fed OR 利率 OR CPI OR 降息",
  國際: "國際局勢 OR 全球新聞",
  戰爭: "俄烏戰爭 OR 烏克蘭戰爭 OR 以色列 OR 中東戰爭",
  台灣熱門: "台灣 熱門新聞 OR 台灣 即時",
  影視: "影視 OR 娛樂新聞",
  電影: "電影 OR 票房 OR Netflix",
  動漫: "動漫 OR 動畫 OR 漫畫",
  音樂: "音樂 OR 演唱會 OR 新歌",
  潮流: "潮流 OR 球鞋 OR 穿搭",
  科技: "科技 OR AI OR iPhone OR 半導體",
  遊戲: "遊戲 OR Steam OR Switch OR PS5 OR 電競",
};

export function resolveFeedQueries(
  topics: string[],
  customKeywords: string[]
): { label: string; query: string }[] {
  const seen = new Set<string>();
  const out: { label: string; query: string }[] = [];

  for (const label of topics) {
    const trimmed = label.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push({
      label: trimmed,
      query: BUILTIN_TOPIC_QUERIES[trimmed] ?? trimmed,
    });
  }

  for (const kw of customKeywords) {
    const trimmed = kw.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push({ label: trimmed, query: trimmed });
  }

  return out;
}
