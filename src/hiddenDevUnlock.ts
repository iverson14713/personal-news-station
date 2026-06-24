/**
 * 隱藏內部測試解鎖（僅透過首頁標題連點 7 次進入，不對一般使用者顯示）
 * Apple IAP 購買狀態優先於本機覆蓋。
 */

export const INTERNAL_ACCESS_STORAGE_KEY = "pns_internal_access_v2";

/** 內部代碼 → 有效天數（0 = 永久直到手動關閉） */
const INTERNAL_ACCESS_CODES: Record<string, number> = {
  A126452345: 0,
  "Ａ126452345": 0,
  WAYNEINTERNAL: 365,
  WAYNEQA2026: 30,
};

export type InternalAccessRecord = {
  enabled: boolean;
  enabledAt: string;
  expiresAt: string | null;
};

function endOfLocalDayIso(d: Date): string {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
}

export function readInternalAccess(): InternalAccessRecord | null {
  try {
    const raw = localStorage.getItem(INTERNAL_ACCESS_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<InternalAccessRecord>;
    if (o.enabled !== true) return null;
    if (typeof o.enabledAt !== "string") return null;
    const expiresAt =
      o.expiresAt === null || typeof o.expiresAt === "string" ? o.expiresAt ?? null : null;
    return { enabled: true, enabledAt: o.enabledAt, expiresAt };
  } catch {
    return null;
  }
}

function writeInternalAccess(record: InternalAccessRecord | null) {
  try {
    if (!record) {
      localStorage.removeItem(INTERNAL_ACCESS_STORAGE_KEY);
      return;
    }
    localStorage.setItem(INTERNAL_ACCESS_STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* ignore */
  }
}

export function isInternalAccessActive(record?: InternalAccessRecord | null): boolean {
  const r = record ?? readInternalAccess();
  if (!r?.enabled) return false;
  if (!r.expiresAt) return true;
  return new Date(r.expiresAt).getTime() > Date.now();
}

export function enableInternalAccess(days: number): InternalAccessRecord {
  const enabledAt = new Date().toISOString();
  const expiresAt =
    days > 0 ? endOfLocalDayIso(new Date(Date.now() + days * 86400000)) : null;
  const record: InternalAccessRecord = { enabled: true, enabledAt, expiresAt };
  writeInternalAccess(record);
  return record;
}

export function clearInternalAccess(): void {
  writeInternalAccess(null);
}

export type VerifyInternalCodeResult =
  | { ok: true; message: string; record: InternalAccessRecord }
  | { ok: false; message: string };

export function verifyAndEnableInternalCode(input: string): VerifyInternalCodeResult {
  const normalized = input.trim();
  if (!normalized) {
    return { ok: false, message: "請輸入代碼" };
  }

  const days = INTERNAL_ACCESS_CODES[normalized] ?? INTERNAL_ACCESS_CODES[normalized.toUpperCase()];
  if (days == null) {
    return { ok: false, message: "代碼無效" };
  }

  const record = enableInternalAccess(days);
  const until = record.expiresAt
    ? new Date(record.expiresAt).toLocaleDateString("zh-TW")
    : "手動關閉前";
  return {
    ok: true,
    message: `已啟用（有效至 ${until}）`,
    record,
  };
}
