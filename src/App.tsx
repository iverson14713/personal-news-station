export default function App() {
  const news = [
    {
      title: "🔥 大谷翔平今天雙響砲",
      category: "MLB",
    },
    {
      title: "🏀 Curry 狂砍 38 分",
      category: "NBA",
    },
    {
      title: "⚠️ BTC 跌破重要支撐",
      category: "Crypto",
    },
    {
      title: "🌍 中東局勢升溫",
      category: "World",
    },
  ];

  const speakNews = () => {
    const text = news.map((n) => n.title).join("。");

    const speech = new SpeechSynthesisUtterance(text);

    speech.lang = "zh-TW";
    speech.rate = 1.2;

    window.speechSynthesis.speak(speech);
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
      <h1 style={{ fontSize: "32px", fontWeight: "bold" }}>
        個人新聞台
      </h1>

      <p style={{ color: "#9CA3AF", marginTop: "8px" }}>
        今日值得關注的重點
      </p>

      <button
        onClick={speakNews}
        style={{
          marginTop: "20px",
          background: "#2563EB",
          border: "none",
          color: "white",
          padding: "12px 20px",
          borderRadius: "12px",
          cursor: "pointer",
          fontSize: "16px",
        }}
      >
        ▶️ 播放今日新聞
      </button>

      <div style={{ marginTop: "24px" }}>
        {news.map((item, index) => (
          <div
            key={index}
            style={{
              background: "#1F2937",
              padding: "16px",
              borderRadius: "16px",
              marginBottom: "16px",
            }}
          >
            <div style={{ fontSize: "20px", fontWeight: "bold" }}>
              {item.title}
            </div>

            <div
              style={{
                color: "#9CA3AF",
                marginTop: "8px",
              }}
            >
              {item.category}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
