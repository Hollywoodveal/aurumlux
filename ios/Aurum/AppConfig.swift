import UIKit

/// Per-app settings for the native shell.
enum AppConfig {
    /// The web app is served from aurum://localhost/. Do not change this
    /// after release: the web data (IndexedDB, localStorage) belongs to this
    /// origin, and a new scheme would start with an empty app.
    static let scheme = "aurum"
    static let host = "localhost"
    /// Folder inside the app bundle that holds the web app (copied in by copy-web.sh).
    static let webFolder = "Web"
    /// Unknown paths without a file extension load index.html (client-side routes).
    static let spaFallback = true
    /// Shown before the page draws; matches the web app's background_color.
    static let launchBackground = UIColor(red: 0.043, green: 0.043, blue: 0.039, alpha: 1)

    /// Links into the app from widgets and Shortcuts: aurumapp://continue,
    /// aurumapp://book/<id>. Separate from `scheme`, which the web view owns.
    static let appLinkScheme = "aurumapp"

    static var startURL: URL { URL(string: "\(scheme)://\(host)/")! }
}
