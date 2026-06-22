const PRODUCTION_API_ORIGIN = "https://personal-news-station.vercel.app";

function isNativeCapacitorApp(): boolean {
  if (typeof window === "undefined") return false;
  if (window.location.protocol === "capacitor:") return true;
  try {
    const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor;
    return cap?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

export function getApiBaseUrl(): string {
  if (isNativeCapacitorApp()) {
    return `${PRODUCTION_API_ORIGIN}/api`;
  }
  return "/api";
}

export const API_BASE_URL = getApiBaseUrl();

export function apiUrl(pathAndQuery: string): string {
  const normalized = pathAndQuery.startsWith("/") ? pathAndQuery.slice(1) : pathAndQuery;
  return `${getApiBaseUrl().replace(/\/$/, "")}/${normalized}`;
}
