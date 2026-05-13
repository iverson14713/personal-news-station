import { useState } from "react";

type NewsItem = {
  id: number;
  title: string;
  category: string;
  selected: boolean;
};

export default function App() {
  const [speed, setSpeed] = useState(1.2);
  const [activeCategory, setActiveCategory] = useState("全部");

  const [news, setNews] = useState<NewsItem[]>([
    { id: 1, title: "🔥 大谷翔平今天雙響砲", category: "MLB", selected: true },
    { id: 2, title: "🏀 Curry 狂砍 38 分", category: "NBA", selected: true },
    { id: 3, title: "⚠️ BTC 跌破重要支撐", category: "幣圈", selected: true },
    { id: 4, title: "🌍 中東局勢升溫", category: "國際", selected: false },
    { id: 5, title: "📈 台股 ETF 買氣升溫", category: "台股", selected: false },
  ]);

  const categories = ["全部", "MLB", "NBA", "幣圈", "國際", "台股"];

  const filteredNews =
    activeCategory === "全部"
      ? news
      : news.filter((item) => item.category === activeCategory);

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

    const text = selectedNews.map((n) => n.title).join("。");

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
        選你想聽的新聞，讓 App 唸給你聽
      </p>

      <div style={{ marginTop: "20px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => setActiveCategory(category)}
            style={{
              background: activeCategory === category ? "#2563EB" : "#374151",
              color: "white",
              border: "none",
              padding: "10px 14px",
              borderRadius: "999px",
              cursor: "pointer",
            }}
          >
            {category}
          </button>
        ))}
      </div>

      <div style={{ marginTop: "24px" }}>
        <label>
          播放速度：{speed.toFixed(1)}x
        </label>

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

      <div style={{ marginTop: "24px" }}>
        {filteredNews.map((item) => (
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
            <div style={{ fontSize: "20px", fontWeight: "bold" }}>
              {item.selected ? "✅ " : "⬜ "}
              {item.title}
            </div>

            <div style={{ color: "#D1D5DB", marginTop: "8px" }}>
              {item.category}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
