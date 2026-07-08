export function isChineseVoice(voice: SpeechSynthesisVoice | null | undefined): boolean {
  return voice?.lang?.toLowerCase().startsWith("zh") === true;
}

export function filterChineseVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return voices.filter(isChineseVoice);
}

function includesAny(value: string, words: string[]): boolean {
  const lower = value.toLowerCase();
  return words.some((word) => lower.includes(word.toLowerCase()));
}

export function pickDefaultChineseVoice(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  const chineseVoices = filterChineseVoices(voices);
  return (
    chineseVoices.find((v) => includesAny(v.name, ["Meijia", "美佳"]) && v.lang === "zh-TW") ||
    chineseVoices.find((v) => v.lang === "zh-TW") ||
    chineseVoices.find((v) => includesAny(v.name, ["Tingting", "婷婷"]) && v.lang === "zh-CN") ||
    chineseVoices.find((v) => v.lang === "zh-CN") ||
    chineseVoices.find((v) => v.lang === "zh-HK") ||
    chineseVoices[0] ||
    null
  );
}

export function resolveChineseVoice(
  voices: SpeechSynthesisVoice[],
  voiceName: string
): SpeechSynthesisVoice | null {
  const selected = voices.find((v) => v.name === voiceName);
  if (isChineseVoice(selected)) return selected ?? null;
  return pickDefaultChineseVoice(voices);
}

export function chineseVoiceOptionLabel(voice: SpeechSynthesisVoice): string {
  const lang = voice.lang || "zh";
  if (includesAny(voice.name, ["Meijia", "美佳"])) return `美佳｜繁中女聲・${lang}`;
  if (includesAny(voice.name, ["Tingting", "婷婷"])) return `婷婷｜中文女聲・${lang}`;
  if (lang === "zh-TW") return `繁體中文語音・${lang}`;
  if (lang === "zh-CN") return `中文語音・${lang}`;
  if (lang === "zh-HK") return `香港中文語音・${lang}`;
  return `中文語音・${lang}`;
}
