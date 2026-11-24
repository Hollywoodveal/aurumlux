import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves the web app that is bundled inside the iOS app (the `Web` folder)
/// from a custom origin such as `veyra://localhost/`.
///
/// A real origin (rather than `file://`) is what lets ES modules, `fetch`,
/// IndexedDB, localStorage and Web Crypto behave the same as on the web.
/// Everything is read from the app bundle, so the app works fully offline.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL
    private let spaFallback: Bool
    /// Headers from the `/*` blocks of the site's Cloudflare `_headers` file
    /// (Content-Security-Policy and friends), so the app keeps the same
    /// security policy it has on the web.
    private let siteHeaders: [String: String]

    init(root: URL, spaFallback: Bool) {
        self.root = root.standardizedFileURL
        self.spaFallback = spaFallback
        self.siteHeaders = Self.loadSiteHeaders(from: root.appendingPathComponent("_headers"))
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        guard let fileURL = resolve(url) else {
            respond(urlSchemeTask, url: url, status: 404, mimeType: "text/plain; charset=utf-8", data: Data("Not found".utf8))
            return
        }
        do {
            let data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
            respond(urlSchemeTask, url: url, status: 200, mimeType: Self.mimeType(for: fileURL), data: data)
        } catch {
            respond(urlSchemeTask, url: url, status: 500, mimeType: "text/plain; charset=utf-8", data: Data("Could not read file".utf8))
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Responses are sent synchronously in `start`, so there is nothing to cancel.
    }

    // MARK: - Path resolution

    func resolve(_ url: URL) -> URL? {
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let relative = String(path.drop(while: { $0 == "/" }))
        let candidate = root.appendingPathComponent(relative).standardizedFileURL

        // Never serve anything outside the bundled Web folder.
        guard candidate.path == root.path || candidate.path.hasPrefix(root.path + "/") else { return nil }

        let fileManager = FileManager.default
        var isDirectory: ObjCBool = false
        if fileManager.fileExists(atPath: candidate.path, isDirectory: &isDirectory) {
            if !isDirectory.boolValue { return candidate }
            let index = candidate.appendingPathComponent("index.html")
            if fileManager.fileExists(atPath: index.path) { return index }
        }

        // Client-side routes (e.g. /read/42) load the app shell, like the
        // Cloudflare single-page-app fallback does. Missing files with an
        // extension (a .js or .png) still get a real 404.
        if spaFallback && candidate.pathExtension.isEmpty {
            let index = root.appendingPathComponent("index.html")
            if fileManager.fileExists(atPath: index.path) { return index }
        }
        return nil
    }

    // MARK: - Responses

    private func respond(_ task: WKURLSchemeTask, url: URL, status: Int, mimeType: String, data: Data) {
        var headers = siteHeaders
        headers["Content-Type"] = mimeType
        headers["Content-Length"] = String(data.count)
        headers["Cache-Control"] = "no-cache"
        if let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) {
            task.didReceive(response)
        }
        task.didReceive(data)
        task.didFinish()
    }

    static func mimeType(for url: URL) -> String {
        let ext = url.pathExtension.lowercased()
        switch ext {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "webmanifest": return "application/manifest+json"
        case "svg": return "image/svg+xml"
        case "wasm": return "application/wasm"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        case "otf": return "font/otf"
        case "txt": return "text/plain; charset=utf-8"
        case "xml": return "application/xml"
        default:
            return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
        }
    }

    /// Reads the headers listed under `/*` in a Cloudflare `_headers` file.
    /// Caching headers are left out; the bundle handles that.
    static func loadSiteHeaders(from fileURL: URL) -> [String: String] {
        guard let text = try? String(contentsOf: fileURL, encoding: .utf8) else { return [:] }
        let skipped: Set<String> = ["cache-control", "content-type", "content-length", "service-worker-allowed"]
        var headers: [String: String] = [:]
        var inWildcardBlock = false
        for rawLine in text.components(separatedBy: .newlines) {
            let trimmed = rawLine.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty || trimmed.hasPrefix("#") { continue }
            let isIndented = rawLine.first == " " || rawLine.first == "\t"
            if !isIndented {
                inWildcardBlock = (trimmed == "/*")
                continue
            }
            guard inWildcardBlock, let colon = trimmed.firstIndex(of: ":") else { continue }
            let name = trimmed[..<colon].trimmingCharacters(in: .whitespaces)
            let value = trimmed[trimmed.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            if name.isEmpty || skipped.contains(name.lowercased()) { continue }
            headers[name] = value
        }
        return headers
    }
}
