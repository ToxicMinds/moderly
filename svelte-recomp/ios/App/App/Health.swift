import Capacitor
import HealthKit

/// Weigh-ins from Apple Health, read only, so the trend can start on day one
/// from what a smart scale or another app already saved there. Each comes back
/// shaped like a Health Connect weight record, so scaleDays() in
/// src/lib/health/scaleWeights.ts reads both phones' alike.
@objc(AppleHealthPlugin)
public class AppleHealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleHealthPlugin"
    public let jsName = "AppleHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "weights", returnType: CAPPluginReturnPromise),
    ]

    private let store = HKHealthStore()

    /// { since: ISO time } → { records: [{ time, weight: { value, unit }, metadata: { dataOrigin } }] }.
    /// Asks to read weight the first time. Apple never tells an app whether it
    /// was allowed, so a refusal reads as no weigh-ins.
    @objc func weights(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable(), let type = HKObjectType.quantityType(forIdentifier: .bodyMass) else {
            return call.resolve(["records": [Any]()])
        }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let since = call.getString("since").flatMap { iso.date(from: $0) } ?? Date(timeIntervalSinceNow: -365 * 86_400)
        store.requestAuthorization(toShare: nil, read: [type]) { _, _ in
            let query = HKSampleQuery(sampleType: type, predicate: HKQuery.predicateForSamples(withStart: since, end: nil),
                                      limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
                let records: [[String: Any]] = (samples as? [HKQuantitySample] ?? []).map { s in
                    ["time": iso.string(from: s.startDate),
                     "weight": ["value": s.quantity.doubleValue(for: .gramUnit(with: .kilo)), "unit": "kilogram"],
                     "metadata": ["dataOrigin": s.sourceRevision.source.bundleIdentifier]]
                }
                call.resolve(["records": records])
            }
            self.store.execute(query)
        }
    }
}
