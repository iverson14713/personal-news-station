import { Capacitor } from "@capacitor/core";

let keyboardSetupDone = false;

/** 防止 iOS WebView 因鍵盤縮放整頁；僅允許 ScrollView 自然捲動 */
export async function setupNativeKeyboard(): Promise<void> {
  if (!Capacitor.isNativePlatform() || keyboardSetupDone) return;
  keyboardSetupDone = true;

  try {
    const { Keyboard, KeyboardResize } = await import("@capacitor/keyboard");
    await Keyboard.setResizeMode({ mode: KeyboardResize.None });
    await Keyboard.setScroll({ isDisabled: true });
    console.log("[Keyboard] resize disabled, native scroll unchanged");
  } catch (e) {
    console.warn("[Keyboard] setup failed", e);
  }
}

/** 收起鍵盤並等待動畫結束，再顯示 Toast 等 UI */
export async function dismissKeyboardAfterInput(
  input?: HTMLInputElement | null
): Promise<void> {
  input?.blur();
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }

  if (Capacitor.isNativePlatform()) {
    try {
      const { Keyboard } = await import("@capacitor/keyboard");
      await Keyboard.hide();
    } catch {
      /* ignore */
    }
  }

  await new Promise((resolve) => window.setTimeout(resolve, 300));
}
