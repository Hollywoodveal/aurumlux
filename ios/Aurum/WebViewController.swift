import UIKit
import WebKit

/// Full-screen web view that runs the bundled web app and fills in the parts
/// a browser normally provides: alert/confirm/prompt dialogs, file downloads
/// (exports and backups open the share sheet), and opening outside links in
/// Safari.
final class WebViewController: UIViewController {
    private var webView: WKWebView!
    private var themeObservation: NSKeyValueObservation?
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]
    private var statusBarStyle: UIStatusBarStyle = .default

    private static let exportsDirectory = FileManager.default.temporaryDirectory
        .appendingPathComponent("Exports", isDirectory: true)

    override var preferredStatusBarStyle: UIStatusBarStyle { statusBarStyle }

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let webRoot = Bundle.main.bundleURL.appendingPathComponent(AppConfig.webFolder, isDirectory: true)
        configuration.setURLSchemeHandler(
            BundleSchemeHandler(root: webRoot, spaFallback: AppConfig.spaFallback),
            forURLScheme: AppConfig.scheme
        )
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        configuration.defaultWebpagePreferences.preferredContentMode = .mobile
        // Lets the reader's page-turn animation show the real page as it turns.
        let snapshotHandler = SnapshotHandler()
        configuration.userContentController.addScriptMessageHandler(
            snapshotHandler, contentWorld: .page, name: "aurumSnapshot"
        )
        // Widgets, Siri, Spotlight, read-aloud, haptics, the dictionary,
        // iCloud and books opened from other apps (see NativeBridge).
        configuration.userContentController.addScriptMessageHandler(
            NativeBridge.shared, contentWorld: .page, name: "aurum"
        )
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.nativeShim, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )

        let webView = WKWebView(frame: .zero, configuration: configuration)
        snapshotHandler.webView = webView
        NativeBridge.shared.webView = webView
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsLinkPreview = false
        webView.allowsBackForwardNavigationGestures = false
        // The web apps use viewport-fit=cover and env(safe-area-inset-*),
        // so they lay out around the notch and home indicator themselves.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        #if DEBUG
        // Lets you debug the page from Safari > Develop on your Mac.
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        self.webView = webView
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        try? FileManager.default.removeItem(at: Self.exportsDirectory)
        applyTheme(AppConfig.launchBackground)

        // Follow the page's <meta name="theme-color"> so the status bar stays
        // readable when the app switches between light and dark themes.
        themeObservation = webView.observe(\.themeColor, options: [.new]) { [weak self] webView, _ in
            DispatchQueue.main.async {
                guard let self, let color = webView.themeColor else { return }
                self.applyTheme(color)
            }
        }

        NativeBridge.shared.presenter = self
        NativeBridge.shared.pageWillLoad()
        // Half-folded "laptop" reading on iPhone Duo, and crash reports.
        HingeWatcher.attach(to: view) { NativeBridge.shared.send($0) }
        // Drag a page's edge to turn it (see CurlDrag).
        CurlDrag.shared.webView = webView
        CurlDrag.shared.host = self
        CurlDrag.shared.send = { NativeBridge.shared.send($0) }
        CrashReports.shared.start()
        webView.load(URLRequest(url: AppConfig.startURL))
    }

    private func applyTheme(_ color: UIColor) {
        let resolved = color.resolvedColor(with: traitCollection)
        view.backgroundColor = resolved
        webView.backgroundColor = resolved
        webView.scrollView.backgroundColor = resolved
        webView.underPageBackgroundColor = resolved
        statusBarStyle = resolved.isDark ? .lightContent : .darkContent
        setNeedsStatusBarAppearanceUpdate()
    }

    // MARK: - Helpers

    private func openExternally(_ url: URL) {
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    private func topPresenter() -> UIViewController {
        var presenter: UIViewController = self
        while let presented = presenter.presentedViewController { presenter = presented }
        return presenter
    }

    /// Presents a dialog, or runs `fallback` right away if nothing can be shown,
    /// so the page's JavaScript is never left waiting for an answer.
    private func present(_ alert: UIAlertController, fallback: @escaping () -> Void) {
        guard viewIfLoaded?.window != nil else {
            fallback()
            return
        }
        topPresenter().present(alert, animated: true)
    }

    private func showMessage(_ title: String, _ message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, fallback: {})
    }

    private func presentShareSheet(for fileURL: URL) {
        guard viewIfLoaded?.window != nil else { return }
        let sheet = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        topPresenter().present(sheet, animated: true)
    }

    private static func safeFilename(_ name: String) -> String {
        let cleaned = name
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "Export" : cleaned
    }

    /// Runs before the page's own scripts. It tells the web app it is
    /// installed, so it doesn't offer "Add to Home Screen" inside the app.
    private static let nativeShim = """
    (function () {
      try {
        Object.defineProperty(navigator, "standalone", { configurable: true, get: function () { return true; } });
      } catch (e) {}
      try {
        var realMatchMedia = window.matchMedia;
        if (realMatchMedia) {
          window.matchMedia = function (query) {
            if (/display-mode\\s*:\\s*standalone/i.test(String(query))) {
              var noop = function () {};
              return {
                matches: true, media: String(query), onchange: null,
                addEventListener: noop, removeEventListener: noop,
                addListener: noop, removeListener: noop,
                dispatchEvent: function () { return false; }
              };
            }
            return realMatchMedia.call(window, query);
          };
        }
      } catch (e) {}
      window.__NATIVE_APP__ = { platform: "ios" };
    })();
    """
}

// MARK: - Navigation

extension WebViewController: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else {
            decisionHandler(.allow)
            return
        }
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true

        if scheme == AppConfig.scheme || scheme == "about" || scheme == "javascript" {
            decisionHandler(.allow)
        } else if scheme == "blob" || scheme == "data" {
            // Opening a file in the main frame would replace the app with it,
            // so save it and offer the share sheet instead.
            decisionHandler(isMainFrame ? .download : .allow)
        } else if scheme == "http" || scheme == "https" {
            if isMainFrame {
                openExternally(url)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        } else {
            // mailto:, tel:, sms:, maps and other apps.
            openExternally(url)
            decisionHandler(.cancel)
        }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    /// iOS can stop the page's process under memory pressure (large books do
    /// this). Reload so the user isn't left with a blank screen. Data lives in
    /// IndexedDB, so nothing saved is lost.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        NativeBridge.shared.pageWillLoad()
        if webView.url != nil {
            webView.reload()
        } else {
            webView.load(URLRequest(url: AppConfig.startURL))
        }
    }
}

// MARK: - Downloads (exports, backups)

extension WebViewController: WKDownloadDelegate {
    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let folder = Self.exportsDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            completionHandler(nil)
            return
        }
        let destination = folder.appendingPathComponent(Self.safeFilename(suggestedFilename))
        downloadDestinations[ObjectIdentifier(download)] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let fileURL = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        presentShareSheet(for: fileURL)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
        showMessage("Couldn't save the file", error.localizedDescription)
    }
}

// MARK: - Dialogs and windows

extension WebViewController: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // window.open / target="_blank": there are no tabs in the app.
        guard let url = navigationAction.request.url else { return nil }
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == AppConfig.scheme {
            webView.load(navigationAction.request)
        } else if scheme == "blob" || scheme == "data" {
            webView.startDownload(using: navigationAction.request) { [weak self] download in
                download.delegate = self
            }
        } else {
            openExternally(url)
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, fallback: completionHandler)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, fallback: { completionHandler(false) })
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        let lowered = prompt.lowercased()
        let isSecret = lowered.contains("passphrase") || lowered.contains("password") || lowered.contains("passcode")
        alert.addTextField { field in
            field.text = defaultText
            field.isSecureTextEntry = isSecret
            field.autocorrectionType = isSecret ? .no : .default
        }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text ?? "")
        })
        present(alert, fallback: { completionHandler(nil) })
    }

    /// Camera and microphone requests from the app's own pages go straight to
    /// the normal iOS permission prompt instead of a second web prompt.
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(origin.protocol.lowercased() == AppConfig.scheme ? .grant : .prompt)
    }
}

private extension UIColor {
    var isDark: Bool {
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        guard getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return false }
        return (0.299 * red + 0.587 * green + 0.114 * blue) < 0.5
    }
}

// MARK: - Page snapshots

/// Answers `window.webkit.messageHandlers.aurumSnapshot.postMessage({x, y,
/// width, height})` with a JPEG data URL of that part of the screen (CSS
/// pixels). The reader draws it on the page leaf while the page turns.
final class SnapshotHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var webView: WKWebView?

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard
            let webView,
            let body = message.body as? [String: Any],
            let x = (body["x"] as? NSNumber)?.doubleValue,
            let y = (body["y"] as? NSNumber)?.doubleValue,
            let width = (body["width"] as? NSNumber)?.doubleValue,
            let height = (body["height"] as? NSNumber)?.doubleValue,
            width >= 1, height >= 1
        else {
            replyHandler(nil, "Bad snapshot request")
            return
        }
        let config = WKSnapshotConfiguration()
        config.rect = CGRect(x: x, y: y, width: width, height: height)
        config.afterScreenUpdates = false
        webView.takeSnapshot(with: config) { image, error in
            guard let image else {
                replyHandler(nil, error?.localizedDescription ?? "Snapshot failed")
                return
            }
            // Encode off the main thread; reply back on it.
            DispatchQueue.global(qos: .userInitiated).async {
                let data = image.jpegData(compressionQuality: 0.82)
                DispatchQueue.main.async {
                    guard let data else {
                        replyHandler(nil, "Snapshot failed")
                        return
                    }
                    replyHandler("data:image/jpeg;base64," + data.base64EncodedString(), nil)
                }
            }
        }
    }
}
