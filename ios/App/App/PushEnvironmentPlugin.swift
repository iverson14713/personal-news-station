import Foundation
import Capacitor

@objc(PushEnvironmentPlugin)
public class PushEnvironmentPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PushEnvironmentPlugin"
    public let jsName = "PushEnvironment"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getEnvironment", returnType: CAPPluginReturnPromise)
    ]

    public override func load() {
        super.load()
        print("[PushEnvironmentPlugin] loaded")
    }

    @objc func getEnvironment(_ call: CAPPluginCall) {
        print("[PushEnvironmentPlugin] getEnvironment called")

        let info = Bundle.main.infoDictionary
        let rawPushEnvironment = (info?["PushEnvironment"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let rawAppDistribution = (info?["AppDistribution"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        let source: String
        let environment: String
        let entitlement: String
        let appDistribution: String

        if rawPushEnvironment == "sandbox" || rawPushEnvironment == "production" {
            source = "info_plist"
            environment = rawPushEnvironment!
            entitlement = rawPushEnvironment == "sandbox" ? "development" : "production"
            appDistribution = normalizeAppDistribution(rawAppDistribution, pushEnvironment: environment)
        } else {
            source = "build_fallback"
            #if DEBUG
            environment = "sandbox"
            entitlement = "development"
            appDistribution = "xcode_debug"
            #else
            environment = "production"
            entitlement = "production"
            appDistribution = "production"
            #endif
        }

        print("[PushEnvironmentPlugin] getEnvironment result environment=\(environment) entitlement=\(entitlement) appDistribution=\(appDistribution) source=\(source)")

        call.resolve([
            "environment": environment,
            "entitlement": entitlement,
            "appDistribution": appDistribution,
            "source": source,
            "usedFallback": source == "build_fallback"
        ])
    }

    private func normalizeAppDistribution(_ raw: String?, pushEnvironment: String) -> String {
        guard let raw = raw, !raw.isEmpty else {
            return pushEnvironment == "sandbox" ? "xcode_debug" : "production"
        }
        if raw == "xcode_debug" || raw == "production" {
            return raw
        }
        return "unknown"
    }
}
