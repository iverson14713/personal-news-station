import { useEffect, useState } from "react";

type NewsItem = {
  id: number;
  title: string;
  link: string;
  source: string;
  pubDate: string;
  selected: boolean;
};

const topics = [
  { label: "全部", query: "NBA OR MLB OR BTC OR ETH OR 台股 OR ETF" },
  { label: "NBA", query: "NBA 勇士 Curry" },
  { label: "MLB", query: "MLB 道奇 大谷翔平" },
  { label: "幣圈", query: "BTC OR ETH OR 加密貨幣 OR 比特幣" },
  { label: "台股", query: "台股 ETF 台積電" },
  { label: "國際", query: "戰爭 國際局勢 Fed 利率" },
];

function cleanTitle(title: string) {
  return title.replace(/\s-\s.*$/, "").trim();
}

export default function App() {
  const [activeTopic, setActiveTopic] = useState(topics[0]);
  const [customKeyword, setCustomKeyword] = useState("");
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [speed, setSpeed] = useState(1.2);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState("");

  useEffect(() => {
    const loadVoices = () => {
      const allVoices = window.speechSynthesis.getVoices();
      setVoices(allVoices);
      if (!voiceName && allVoices.length > 0) {
        const zhVoice =
          allVoices.find((v) => v.lang.includes("zh")) || allVoices[0];
        setVoiceName(zhVoice.name);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const fetchNews = async (query: string) => {
    setLoading(true);

    try {
      const res = await fetch(`/api/news?q=${encodeURIComponent(query)}`);
      const xmlText = await res.text();

      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, "text/xml");
      const items = Array.from(xml.querySelectorAll("item")).slice(0, 40);

      const seen = new Set<string>();

      const parsedNews: NewsItem[] = items
        .map((item, index) => {
          const rawTitle = item.querySelector("title")?.textContent || "無標題";
          const title = cleanTitle(rawTitle);

          return {
            id: index + 1,
            title,
            link: item.querySelector("link")?.textContent || "",
            source:
              item.querySelector("source")?.textContent ||
              rawTitle.split(" - ").pop() ||
              "Google News",
            pubDate: item.querySelector("pubDate")?.textContent || "",
            selected: index < 5,
          };
        })
        .filter((item) => {
          const key = item.title
            .replace(/[，。！？、\s]/g, "")
            .slice(0, 24);

          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 20);

      setNews(parsedNews);
    } catch (error) {
      alert("新聞讀取失敗，請稍後再試");
      console.error(error);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchNews(activeTopic.query);
  }, []);

  const changeTopic = (topic: (typeof topics)[0]) => {
    setActiveTopic(topic);
    fetchNews(topic.query);
  };

  const searchCustomKeyword = () => {
    if (!customKeyword.trim()) {
      alert("請輸入想追蹤的關鍵字");
      return;
    }

    const customTopic = {
      label: customKeyword,
      query: customKeyword,
    };

    setActiveTopic(customTopic);
    fetchNews(customKeyword);
  };

  const toggleNews = (id: number) => {
    setNews((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, selected: !item.selected } : item
      )
    );
  };

  const selectAll = () => {
    setNews((prev) => prev.map((item) => ({ ...item, selected: true })));
  };

  const clearAll = () => {
    setNews((prev) => prev.map((item) => ({ ...item, selected: false })));
  };

  const speakNews = () => {
    window.speechSynthesis.cancel();

    const selectedNews = news.filter((item) => item.selected);

    if (selectedNews.length === 0) {
      alert("請先選擇要播放的新聞");
      return;
    }

    const text = selectedNews
      .map((n, i) => `第 ${i + 1} 則新聞，${n.title}`)
      .join("。");

    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = "zh-TW";
    speech.rate = speed;

    const selectedVoice = voices.find((v) => v.name === voiceName);
    if (selectedVoice) speech.voice = selectedVoice;

    window.speechSynthesis.speak(speech);
  };

  const stopSpeak = () => {
    window.speechSynthesis.cancel();
  };

  const copyGptPrompt = async () => {
    const selectedNews = news.filter((item) => item.selected);

    if (selectedNews.length === 0) {
      alert("請先選擇新聞");
      return;
    }

    const prompt = `
請幫我把以下新聞整理成「個人新聞台」精華版：

要求：
1. 用繁體中文
2. 先列出今日最重要的 5 個重點
3. 每則用 2～3 句話解釋
4. 幫我判斷重要程度：🔥重大 / ⚠️注意 / ℹ️一般
5. 最後給我一段適合語音朗讀的 1 分鐘新聞稿

新聞列表：
${selectedNews
  .map((item, index) => `${index + 1}. ${item.title}\n來源：${item.source}\n連結：${item.link}`)
  .join("\n\n")}
`;

    await navigator.clipboard.writeText(prompt);
    alert("已複製 GPT 精華整理 Prompt，可以貼到 ChatGPT 使用");
  };

  const openChatGPT = () => {
    window.open("https://chatgpt.com/", "_blank");
  };

  return (
    <div
      style={{
        background: "#111827",
        minHeight: "100vh",
        color: "white",
        padding: "18px",
        fontFamily: "sans-serif",
      }}
    >
      <h1 style={{ fontSize: "30px", fontWeight: "bold" }}>個人新聞台</h1>

      <p style={{ color: "#9CA3AF", marginTop: "6px" }}>
        選新聞、播放標題，或一鍵丟給 GPT 變精華
      </p>

      <div style={{ marginTop: "16px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {topics.map((topic) => (
          <button
            key={topic.label}
            onClick={() => changeTopic(topic)}
            style={{
              background: activeTopic.label === topic.label ? "#2563EB" : "#374151",
              color: "white",
              border: "none",
              padding: "8px 12px",
              borderRadius: "999px",
              cursor: "pointer",
            }}
          >
            {topic.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: "14px", display: "flex", gap: "8px" }}>
        <input
          value={customKeyword}
          onChange={(e) => setCustomKeyword(e.target.value)}
          placeholder="自訂關鍵字：大谷、台積電、Solana..."
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: "10px",
            border: "none",
            fontSize: "15px",
          }}
        />

        <button
          onClick={searchCustomKeyword}
          style={{
            background: "#16A34A",
            color: "white",
            border: "none",
            padding: "10px 14px",
            borderRadius: "10px",
            cursor: "pointer",
          }}
        >
          搜尋
        </button>
      </div>

      <div style={{ marginTop: "18px" }}>
        <label>聲音</label>
        <select
          value={voiceName}
          onChange={(e) => setVoiceName(e.target.value)}
          style={{
            width: "100%",
            marginTop: "8px",
            padding: "10px",
            borderRadius: "10px",
          }}
        >
          {voices.map((voice) => (
            <option key={voice.name} value={voice.name}>
              {voice.name}（{voice.lang}）
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: "16px" }}>
        <label>播放速度：{speed.toFixed(1)}x</label>

        <input
          type="range"
          min="0.8"
          max="2"
          step="0.1"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          style={{ width: "100%", marginTop: "8px" }}
        />
      </div>

      <div style={{ marginTop: "16px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button onClick={selectAll} style={smallButton("#4B5563")}>
          全選
        </button>

        <button onClick={clearAll} style={smallButton("#4B5563")}>
          取消全選
        </button>

        <button onClick={speakNews} style={smallButton("#2563EB")}>
          ▶️ 播放
        </button>

        <button onClick={stopSpeak} style={smallButton("#DC2626")}>
          ⏹ 停止
        </button>

        <button onClick={copyGptPrompt} style={smallButton("#7C3AED")}>
          複製 GPT 精華
        </button>

        <button onClick={openChatGPT} style={smallButton("#059669")}>
          開啟 ChatGPT
        </button>
      </div>

      <h2 style={{ marginTop: "22px", fontSize: "20px" }}>
        {activeTopic.label}｜今日新聞
      </h2>

      {loading && <p style={{ color: "#9CA3AF" }}>新聞讀取中...</p>}

      <div style={{ marginTop: "12px" }}>
        {news.map((item) => (
          <div
            key={item.id}
            onClick={() => toggleNews(item.id)}
            style={{
              background: item.selected ? "#1D4ED8" : "#1F2937",
              padding: "11px 12px",
              borderRadius: "12px",
              marginBottom: "10px",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: "15px", fontWeight: "bold", lineHeight: 1.4 }}>
              {item.selected ? "✅ " : "⬜ "}
              {item.title}
            </div>

            <div style={{ color: "#D1D5DB", marginTop: "6px", fontSize: "12px" }}>
              {item.source}
            </div>

            <a
              href={item.link}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: "inline-block",
                color: "#93C5FD",
                marginTop: "6px",
                fontSize: "12px",
              }}
            >
              原文
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

function smallButton(background: string) {
  return {
    background,
    border: "none",
    color: "white",
    padding: "9px 12px",
    borderRadius: "10px",
    cursor: "pointer",
    fontSize: "14px",
  };
}
