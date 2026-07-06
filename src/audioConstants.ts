export { DEFAULT_TTS_VOICE } from "./aiAnchorSettings";

const SCRIPT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isScriptUuid(id: string | null | undefined): boolean {
  return Boolean(id && SCRIPT_UUID_RE.test(id));
}
