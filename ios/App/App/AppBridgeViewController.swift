import UIKit
import Capacitor

class AppBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PushEnvironmentPlugin())
        print("[PushEnvironmentPlugin] registered with Capacitor bridge")
    }
}
