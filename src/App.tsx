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

export default function App() {
  const [activeTopic, setActiveTopic] = useState(topics[0]);
  const [customKeyword, setCustomKeyword] = useState("");
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [speed, setSpeed] = useState(1.2);

  const fetchNews = async (query: string) => {
    setLoading(true);

    try {
      const res = await fetch(`/api/news?q=${encodeURIComponent(query)}`);
      const xmlText = await res.text();

      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, "text/xml");
      const items = Array.from(xml.querySelectorAll("item")).slice(0, 20);

      const parsedNews: NewsItem[] = items.map((item, index) => ({
        id: index + 1,
        title: item.querySelector("title")?.textContent || "無標題",
        link: item.querySelector("link")?.textContent || "",
        source:
          item.querySelector("source")?.textContent ||
          item.querySelector("title")?.textContent?.split(" - ").pop() ||
          "Google News",
        pubDate: item.querySelector("pubDate")?.textContent || "",
        selected: index < 5,
      }));

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

  const speakNews = () => {
    window.speechSynthesis.cancel();

    const selectedNews = news.filter((item) => item.selected);

    if (selectedNews.length === 0) {
      alert("請先選擇要播放的新聞");
      return;
    }

    const text = selectedNews.map((n, i) => `第 ${i + 1} 則，${n.title}`).join("。");

    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = "zh-TW";
    speech.rate = speed;

    window.speechSynthesis.speak(speech);
  };

  const stopSpeak = () => {
    window.speechSynthesis.cancel();
  };

  return (
    <div
      style={{
        background: "#111827",
        minHeight: "100vh",
        color: "white",
        padding: "24px",
        fontFamily: "sans-serif",
      }}
    >
      <h1 style={{ fontSize: "32px", fontWeight: "bold" }}>個人新聞台</h1>

      <p style={{ color: "#9CA3AF", marginTop: "8px" }}>
        選主題、抓真實新聞、勾選後讓 App 唸給你聽
      </p>

      <div style={{ marginTop: "20px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {topics.map((topic) => (
          <button
            key={topic.label}
            onClick={() => changeTopic(topic)}
            style={{
              background: activeTopic.label === topic.label ? "#2563EB" : "#374151",
              color: "white",
              border: "none",
              padding: "10px 14px",
              borderRadius: "999px",
              cursor: "pointer",
            }}
          >
            {topic.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: "20px", display: "flex", gap: "8px" }}>
        <input
          value={customKeyword}
          onChange={(e) => setCustomKeyword(e.target.value)}
          placeholder="輸入自訂關鍵字，例如：大谷翔平、台積電、Solana"
          style={{
            flex: 1,
            padding: "12px",
            borderRadius: "12px",
            border: "none",
            fontSize: "16px",
          }}
        />

        <button
          onClick={searchCustomKeyword}
          style={{
            background: "#16A34A",
            color: "white",
            border: "none",
            padding: "12px 16px",
            borderRadius: "12px",
            cursor: "pointer",
          }}
        >
          搜尋
        </button>
      </div>

      <div style={{ marginTop: "24px" }}>
        <label>播放速度：{speed.toFixed(1)}x</label>

        <input
          type="range"
          min="0.8"
          max="2"
          step="0.1"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          style={{ width: "100%", marginTop: "10px" }}
        />
      </div>

      <div style={{ marginTop: "20px", display: "flex", gap: "12px" }}>
        <button
          onClick={speakNews}
          style={{
            background: "#2563EB",
            border: "none",
            color: "white",
            padding: "12px 20px",
            borderRadius: "12px",
            cursor: "pointer",
            fontSize: "16px",
          }}
        >
          ▶️ 播放選取新聞
        </button>

        <button
          onClick={stopSpeak}
          style={{
            background: "#DC2626",
            border: "none",
            color: "white",
            padding: "12px 20px",
            borderRadius: "12px",
            cursor: "pointer",
            fontSize: "16px",
          }}
        >
          ⏹ 停止
        </button>
      </div>

      <h2 style={{ marginTop: "28px" }}>
        {activeTopic.label}｜今日新聞
      </h2>

      {loading && <p style={{ color: "#9CA3AF" }}>新聞讀取中...</p>}

      <div style={{ marginTop: "16px" }}>
        {news.map((item) => (
          <div
            key={item.id}
            onClick={() => toggleNews(item.id)}
            style={{
              background: item.selected ? "#1D4ED8" : "#1F2937",
              padding: "16px",
              borderRadius: "16px",
              marginBottom: "16px",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: "18px", fontWeight: "bold" }}>
              {item.selected ? "✅ " : "⬜ "}
              {item.title}
            </div>

            <div style={{ color: "#D1D5DB", marginTop: "8px", fontSize: "14px" }}>
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
                marginTop: "10px",
                fontSize: "14px",
              }}
            >
              打開原文
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
