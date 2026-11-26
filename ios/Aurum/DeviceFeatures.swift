import MetricKit
import SwiftUI
import UIKit
#if canImport(FoundationModels)
import FoundationModels
#endif
#if canImport(Translation)
import Translation
#endif

// MARK: - Apple Intelligence (on device)

/// Runs Apple's on-device language model for recaps, "who's who" and
/// questions about the book. Nothing leaves the phone. Needs iOS 26 and an
/// iPhone with Apple Intelligence turned on.
enum Intelligence {
    /// `{available, reason}` where reason is a short, plain explanation.
    static func status() -> [String: Any] {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                return ["available": true]
            case .unavailable(let reason):
                return ["available": false, "reason": describe(reason)]
            @unknown default:
                return ["available": false, "reason": "Apple Intelligence isn't available right now."]
            }
        }
        #endif
        return ["available": false, "reason": "Needs iOS 26 or later with Apple Intelligence."]
    }

    #if canImport(FoundationModels)
    @available(iOS 26.0, *)
    private static func describe(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
        switch reason {
        case .deviceNotEligible:
            return "This iPhone doesn't support Apple Intelligence."
        case .appleIntelligenceNotEnabled:
            return "Turn on Apple Intelligence in the Settings app to use this."
        case .modelNotReady:
            return "Apple Intelligence is still getting ready (downloading). Try again later."
        @unknown default:
            return "Apple Intelligence isn't available right now."
        }
    }
    #endif

    /// Answers `prompt` following `instructions`. Calls back on the main thread.
    static func respond(
        instructions: String,
        prompt: String,
        completion: @escaping (Result<String, Error>) -> Void
    ) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            Task {
                do {
                    let session = LanguageModelSession(instructions: instructions)
                    let response = try await session.respond(to: prompt)
                    let text = response.content
                    await MainActor.run { completion(.success(text)) }
                } catch {
                    await MainActor.run { completion(.failure(error)) }
                }
            }
            return
        }
        #endif
        completion(.failure(NSError(
            domain: "Aurum", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Needs iOS 26 or later with Apple Intelligence."]
        )))
    }
}

// MARK: - Translation

/// Shows Apple's own translation sheet for a passage. It works offline for
/// languages the reader has downloaded in the Translate app.
enum Translator {
    static var isSupported: Bool {
        #if canImport(Translation)
        if #available(iOS 17.4, *) { return true }
        #endif
        return false
    }

    static func present(_ text: String, from presenter: UIViewController) -> Bool {
        #if canImport(Translation)
        if #available(iOS 17.4, *) {
            let host = UIHostingController(rootView: TranslationHost(text: text, onDone: {}))
            host.rootView = TranslationHost(text: text, onDone: { [weak host] in
                host?.dismiss(animated: false)
            })
            host.view.backgroundColor = .clear
            host.modalPresentationStyle = .overFullScreen
            host.modalTransitionStyle = .crossDissolve
            var top: UIViewController = presenter
            while let presented = top.presentedViewController { top = presented }
            top.present(host, animated: false)
            return true
        }
        #endif
        return false
    }
}

#if canImport(Translation)
/// An invisible screen that opens the system translation sheet and closes
/// itself when the sheet goes away.
@available(iOS 17.4, *)
private struct TranslationHost: View {
    let text: String
    let onDone: () -> Void
    @State private var showing = false
    @State private var shown = false

    var body: some View {
        Color.clear
            .ignoresSafeArea()
            .contentShape(Rectangle())
            .onTapGesture { onDone() }
            .translationPresentation(isPresented: $showing, text: text)
            .onAppear {
                showing = true
                shown = true
            }
            .onChange(of: showing) { isShowing in
                if !isShowing && shown { onDone() }
            }
    }
}
#endif

// MARK: - Hinge (iPhone Duo)

/// Tells the page how far the iPhone Duo is open, so the reader can switch to
/// a "laptop" layout when it's half-folded on a table: the page on the top
/// half, big controls on the bottom half.
enum HingeWatcher {
    private static var lastStatus: String?

    static func attach(to view: UIView, send: @escaping ([String: Any]) -> Void) {
        if #available(iOS 27.1, *) {
            let interaction = UIHingeInteraction { _, update in
                guard let hinge = update.hinge else {
                    report("none", angle: 0, send: send)
                    return
                }
                let status: String
                switch hinge.status {
                case .closed: status = "closed"
                case .partiallyOpen: status = "partiallyOpen"
                case .fullyOpen: status = "fullyOpen"
                default: status = "unknown"
                }
                report(status, angle: Double(hinge.angle) * 180 / .pi, send: send)
            }
            view.addInteraction(interaction)
        }
    }

    /// Only status changes go to the page; the angle rides along.
    private static func report(_ status: String, angle: Double, send: ([String: Any]) -> Void) {
        guard status != lastStatus else { return }
        lastStatus = status
        FrontCover.shared.hingeChanged(status)
        send(["type": "hinge", "status": status, "angle": angle.rounded()])
    }
}

// MARK: - Crash reports

/// Collects crash and hang reports from iOS (MetricKit) on the device, so
/// they can be included when the reader shares a problem report from
/// Settings. Nothing is uploaded automatically.
final class CrashReports: NSObject, MXMetricManagerSubscriber {
    static let shared = CrashReports()

    private var folder: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Diagnostics", isDirectory: true)
    }

    func start() {
        MXMetricManager.shared.add(self)
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        for payload in payloads {
            let name = "diagnostic-\(Int(Date().timeIntervalSince1970 * 1000)).json"
            try? payload.jsonRepresentation().write(to: folder.appendingPathComponent(name))
        }
        prune()
    }

    /// The most recent reports, newest first, as JSON text.
    func recent(limit: Int = 5) -> [String] {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        return files
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
            .prefix(limit)
            .compactMap { try? String(contentsOf: $0, encoding: .utf8) }
            .map { String($0.prefix(20_000)) }
    }

    func clear() {
        try? FileManager.default.removeItem(at: folder)
    }

    private func prune() {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        for old in files.sorted(by: { $0.lastPathComponent > $1.lastPathComponent }).dropFirst(20) {
            try? FileManager.default.removeItem(at: old)
        }
    }
}
