import { Capacitor, registerPlugin } from "@capacitor/core";

export type PushEnvironment = "sandbox" | "production";

export type PushEnvironmentDiagnostics = {
  environment: PushEnvironment;
  entitlement: "development" | "production" | "unknown";
  usedFallback: boolean;
  source?: "info_plist" | "build_fallback";
  appDistribution:
    | "xcode_debug"
    | "production"
    | "testflight"
    | "app_store"
    | "ad_hoc_or_enterprise"
    | "unknown"
    | "web";
};

export type PushEnvironmentResult = {
  environment: string;
  entitlement: string;
  usedFallback?: boolean;
  source?: string;
  appDistribution?: string;
};

interface PushEnvironmentPlugin {
  getEnvironment(): Promise<PushEnvironmentResult>;
}

export const PushEnvironment = registerPlugin<PushEnvironmentPlugin>("PushEnvironment");

function normalizeEntitlement(
  raw: string | undefined
): PushEnvironmentDiagnostics["entitlement"] {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "development") return "development";
  if (value === "production") return "production";
  return "unknown";
}

function normalizeDistribution(
  raw: string | undefined
): PushEnvironmentDiagnostics["appDistribution"] {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "xcode_debug") return "xcode_debug";
  if (value === "production") return "production";
  if (value === "testflight") return "testflight";
  if (value === "app_store") return "app_store";
  if (value === "ad_hoc_or_enterprise") return "ad_hoc_or_enterprise";
  return "unknown";
}

function normalizeSource(
  raw: string | undefined,
  usedFallback?: boolean
): PushEnvironmentDiagnostics["source"] {
  if (raw === "info_plist" || raw === "build_fallback") return raw;
  return usedFallback ? "build_fallback" : "info_plist";
}

function iosNativeUnavailableFallback(): PushEnvironmentDiagnostics {
  return {
    environment: "sandbox",
    entitlement: "development",
    usedFallback: true,
    source: "build_fallback",
    appDistribution: "xcode_debug",
  };
}

export async function getPushEnvironment(): Promise<PushEnvironmentDiagnostics> {
  if (Capacitor.getPlatform() !== "ios") {
    return {
      environment: "production",
      entitlement: "unknown",
      usedFallback: true,
      appDistribution: "web",
    };
  }

  try {
    const result = await PushEnvironment.getEnvironment();
    const environment: PushEnvironment =
      result.environment === "sandbox" ? "sandbox" : "production";
    const diagnostics: PushEnvironmentDiagnostics = {
      environment,
      entitlement: normalizeEntitlement(result.entitlement),
      usedFallback: result.source === "build_fallback" || result.usedFallback === true,
      source: normalizeSource(result.source, result.usedFallback),
      appDistribution: normalizeDistribution(result.appDistribution),
    };
    if (diagnostics.usedFallback) {
      console.warn("[PushEnvironment] using build fallback", diagnostics);
    } else {
      console.log("[PushEnvironment] resolved from Info.plist", {
        entitlement: diagnostics.entitlement,
        environment: diagnostics.environment,
        appDistribution: diagnostics.appDistribution,
        source: diagnostics.source,
      });
    }
    return diagnostics;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[PushEnvironment] native read failed", message);
    return iosNativeUnavailableFallback();
  }
}

export function formatAppDistributionLabel(
  distribution: PushEnvironmentDiagnostics["appDistribution"]
): string {
  switch (distribution) {
    case "xcode_debug":
      return "Xcode Debug";
    case "production":
      return "Production";
    case "testflight":
      return "TestFlight";
    case "app_store":
      return "App Store";
    case "ad_hoc_or_enterprise":
      return "Ad Hoc / Enterprise";
    case "web":
      return "Web";
    default:
      return "unknown";
  }
}
