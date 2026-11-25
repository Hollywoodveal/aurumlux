import UIKit
import WebKit

/// The one channel between the web app and iOS.
///
/// The page calls `window.webkit.messageHandlers.aurum.postMessage({action, ...})`
/// and gets a Promise back. iOS talks to the page by calling
/// `window.__aurumNative.receive(event)`; events raised before the page is
/// ready (a book opened from Files at launch, a Spotlight tap) wait in a queue
/// until the page says `ready`.
final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let shared = NativeBridge()

    weak var webView: WKWebView?
    /// Presents native screens (the dictionary) over the web view.
    weak var presenter: UIViewController?

    private var pageReady = false
    private var pending: [[String: Any]] = []

    let speech = SpeechController()
    let icloud = ICloudStore()

    private override init() {
        super.init()
        speech.onEvent = { [weak self] event in self?.send(event) }
    }

    // MARK: Page lifecycle

    /// The page is (re)loading: hold events until it says it's ready again.
    func pageWillLoad() {
        pageReady = false
    }

    /// Sends an event to the page now, or once it is ready.
    func send(_ event: [String: Any]) {
        guard pageReady, let webView else {
            pending.append(event)
            return
        }
        guard
            let data = try? JSONSerialization.data(withJSONObject: event),
            let json = String(data: data, encoding: .utf8)
        else { return }
        let script = "window.__aurumNative && window.__aurumNative.receive(\(json));"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    private func flush() {
        let queued = pending
        pending.removeAll()
        queued.forEach(send)
    }

    // MARK: Messages from the page

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard
            let body = message.body as? [String: Any],
            let action = body["action"] as? String
        else {
            replyHandler(nil, "Bad message")
            return
        }

        switch action {
        case "ready":
            pageReady = true
            replyHandler(capabilities(), nil)
            flush()

        case "haptic":
            Haptics.play(body["style"] as? String ?? "light")
            replyHandler(true, nil)

        case "define":
            replyHandler(define(body["term"] as? String ?? ""), nil)

        case "speak":
            speech.speak(body)
            replyHandler(true, nil)
        case "speechPause":
            speech.pause()
            replyHandler(true, nil)
        case "speechResume":
            speech.resume()
            replyHandler(true, nil)
        case "speechStop":
            speech.stop()
            replyHandler(true, nil)

        case "widget":
            SharedStore.saveWidget(body)
            replyHandler(true, nil)

        case "spotlight":
            Spotlight.index(body)
            replyHandler(true, nil)

        case "icloudStatus":
            icloud.status { replyHandler($0, nil) }
        case "icloudRead":
            icloud.read { result in
                switch result {
                case .success(let value): replyHandler(value, nil)
                case .failure(let error): replyHandler(nil, error.localizedDescription)
                }
            }
        case "icloudWrite":
            icloud.write(
                text: body["text"] as? String ?? "",
                ifVersion: body["ifVersion"] as? String
            ) { result in
                switch result {
                case .success(let value): replyHandler(value, nil)
                case .failure(let error): replyHandler(nil, error.localizedDescription)
                }
            }

        case "aiStatus":
            replyHandler(Intelligence.status(), nil)
        case "aiRespond":
            Intelligence.respond(
                instructions: body["instructions"] as? String ?? "",
                prompt: body["prompt"] as? String ?? ""
            ) { result in
                switch result {
                case .success(let text): replyHandler(text, nil)
                case .failure(let error): replyHandler(nil, error.localizedDescription)
                }
            }

        case "translate":
            guard let presenter else {
                replyHandler(false, nil)
                return
            }
            replyHandler(Translator.present(body["text"] as? String ?? "", from: presenter), nil)

        case "diagnostics":
            replyHandler(CrashReports.shared.recent(), nil)
        case "clearDiagnostics":
            CrashReports.shared.clear()
            replyHandler(true, nil)

        case "releaseInbox":
            Inbox.release(body["id"] as? String ?? "")
            replyHandler(true, nil)

        default:
            replyHandler(nil, "Unknown action \(action)")
        }
    }

    /// What this build of the app can do, so the page only offers what works.
    private func capabilities() -> [String: Any] {
        [
            "haptics": true,
            "dictionary": true,
            "speech": true,
            "widgets": true,
            "spotlight": true,
            "icloud": true,
            "ai": true,
            "translate": Translator.isSupported,
            "hinge": true,
            "platform": "ios",
        ]
    }

    // MARK: Dictionary

    /// Shows the iPhone's own dictionary for a word. It works offline and in
    /// every language the reader has downloaded a dictionary for.
    private func define(_ term: String) -> Bool {
        let word = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !word.isEmpty, let presenter else { return false }
        var top: UIViewController = presenter
        while let presented = top.presentedViewController { top = presented }
        let controller = UIReferenceLibraryViewController(term: word)
        top.present(controller, animated: true)
        return true
    }

    // MARK: Opening books and links

    /// Books opened from Files, Mail, Safari or the share sheet.
    func openFiles(_ urls: [URL]) {
        let files = urls.compactMap(Inbox.add)
        guard !files.isEmpty else { return }
        send(["type": "openFiles", "files": files])
    }

    /// `aurumapp://continue`, `aurumapp://book/<id>` and Spotlight results.
    func openAppURL(_ url: URL) {
        let host = url.host ?? ""
        let parts = url.pathComponents.filter { $0 != "/" }
        switch host {
        case "continue":
            send(["type": "continueReading"])
        case "book":
            if let id = parts.first { send(["type": "openBook", "id": id]) }
        default:
            send(["type": "continueReading"])
        }
    }

    func openSpotlightItem(_ identifier: String) {
        // "book:<id>" or "note:<bookId>:<annotationId>"
        let parts = identifier.split(separator: ":", maxSplits: 2).map(String.init)
        guard parts.count >= 2 else { return }
        switch parts[0] {
        case "book":
            send(["type": "openBook", "id": parts[1]])
        case "note":
            var event: [String: Any] = ["type": "openBook", "id": parts[1]]
            if parts.count == 3 { event["annotationId"] = parts[2] }
            send(event)
        default:
            break
        }
    }
}

// MARK: - Inbox

/// Files handed to Aurum by other apps. Each is copied into a temporary
/// folder and served to the page at `aurum://localhost/__inbox/<id>/<name>`,
/// so large books don't have to squeeze through a message.
enum Inbox {
    static let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("AurumInbox", isDirectory: true)

    static func add(_ url: URL) -> [String: Any]? {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let id = UUID().uuidString
        let folder = directory.appendingPathComponent(id, isDirectory: true)
        let name = url.lastPathComponent.isEmpty ? "Book" : url.lastPathComponent
        let destination = folder.appendingPathComponent(name)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: url, to: destination)
        } catch {
            return nil
        }
        let encoded = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
        return [
            "id": id,
            "name": name,
            "url": "\(AppConfig.scheme)://\(AppConfig.host)/__inbox/\(id)/\(encoded)",
        ]
    }

    /// The page has imported the file: delete the copy.
    static func release(_ id: String) {
        guard !id.isEmpty, !id.contains("/"), !id.contains("..") else { return }
        try? FileManager.default.removeItem(at: directory.appendingPathComponent(id, isDirectory: true))
    }

    /// The file for an `/__inbox/<id>/<name>` request, if it exists.
    static func file(forPath path: String) -> URL? {
        let prefix = "/__inbox/"
        guard path.hasPrefix(prefix) else { return nil }
        let relative = String(path.dropFirst(prefix.count))
        let candidate = directory.appendingPathComponent(relative).standardizedFileURL
        let root = directory.standardizedFileURL.path + "/"
        guard candidate.path.hasPrefix(root) else { return nil }
        return FileManager.default.fileExists(atPath: candidate.path) ? candidate : nil
    }
}

// MARK: - Haptics

enum Haptics {
    static func play(_ style: String) {
        switch style {
        case "selection":
            UISelectionFeedbackGenerator().selectionChanged()
        case "success":
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "medium":
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        default:
            // A page turn: a soft tap, like paper.
            UIImpactFeedbackGenerator(style: .soft).impactOccurred(intensity: 0.6)
        }
    }
}
