export type RadioSlot = "morning" | "evening";

export const MORNING_RADIO_CLOSING =
  "以上就是今天的 AI 早報，祝你今天有美好的一天，我們下午五點再見。";

export const EVENING_RADIO_CLOSING =
  "以上就是今天的 AI 晚報，祝你今晚愉快，我們明天早上七點再見。";

function closingForSlot(slot: RadioSlot): string {
  return slot === "evening" ? EVENING_RADIO_CLOSING : MORNING_RADIO_CLOSING;
}

function hasSimilarClosing(script: string, slot: RadioSlot): boolean {
  const text = script.trim();
  if (!text) return false;

  const canonical = closingForSlot(slot);
  if (text.endsWith(canonical)) return true;

  if (slot === "morning") {
    return (
      /以上就是今天的\s*AI?\s*早報/u.test(text) ||
      /我們下午五點再見/u.test(text) ||
      /祝你今天有美好的一天/u.test(text)
    );
  }

  return (
    /以上就是今天的\s*AI?\s*晚報/u.test(text) ||
    /我們明天早上七點再見/u.test(text) ||
    /祝你今晚愉快/u.test(text)
  );
}

export function appendRadioClosing(
  script: string,
  radioSlot?: RadioSlot | null
): string {
  if (radioSlot !== "morning" && radioSlot !== "evening") {
    return script.trim();
  }

  const trimmed = script.trim();
  const closing = closingForSlot(radioSlot);

  if (!trimmed) return closing;
  if (trimmed.endsWith(closing) || hasSimilarClosing(trimmed, radioSlot)) {
    return trimmed;
  }

  const needsPeriod = !/[。！？!?…]$/u.test(trimmed);
  return `${trimmed}${needsPeriod ? "。" : ""}${closing}`;
}
