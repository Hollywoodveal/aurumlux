import CoreSpotlight
import Foundation
import UniformTypeIdentifiers
#if canImport(WidgetKit)
import WidgetKit
#endif

/// Data the Home Screen and Lock Screen widgets show, shared with the widget
/// extension through an App Group. The widget never opens the library itself.
enum SharedStore {
    static let appGroup = "group.com.hollywoodveal.aurum"
    static let widgetKey = "widget.v1"
    static let coverFile = "widget-cover.jpg"

    static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }
    static var container: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    }

    /// `{book: {id, title, author, progress, minutesLeft} | null, streak,
    /// todayMinutes, dailyGoal, cover: "data:image/jpeg;base64,..." | null}`
    static func saveWidget(_ body: [String: Any]) {
        guard let defaults else { return }
        var snapshot = body
        snapshot.removeValue(forKey: "action")
        let cover = snapshot.removeValue(forKey: "cover") as? String

        if let container {
            let url = container.appendingPathComponent(coverFile)
            if let cover, let data = decodeDataURL(cover) {
                try? data.write(to: url, options: .atomic)
                snapshot["hasCover"] = true
            } else if cover == nil {
                // Unchanged cover: keep the file. An explicit empty string clears it.
                snapshot["hasCover"] = FileManager.default.fileExists(atPath: url.path)
            } else {
                try? FileManager.default.removeItem(at: url)
                snapshot["hasCover"] = false
            }
        }
        snapshot["updatedAt"] = Date().timeIntervalSince1970

        guard let data = try? JSONSerialization.data(withJSONObject: snapshot) else { return }
        defaults.set(data, forKey: widgetKey)
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }

    private static func decodeDataURL(_ string: String) -> Data? {
        guard let comma = string.firstIndex(of: ","), string.hasPrefix("data:") else { return nil }
        return Data(base64Encoded: String(string[string.index(after: comma)...]))
    }
}

/// Puts books, highlights and notes into iPhone search, so typing a title or
/// a line you highlighted finds it from the Home Screen.
enum Spotlight {
    private static let domain = "aurum.library"

    /// `{books: [{id, title, author}], notes: [{id, bookId, bookTitle, text, note}]}`
    /// replaces everything Aurum had in the index.
    static func index(_ body: [String: Any]) {
        let books = body["books"] as? [[String: Any]] ?? []
        let notes = body["notes"] as? [[String: Any]] ?? []
        var items: [CSSearchableItem] = []

        for book in books {
            guard let id = book["id"] as? String else { continue }
            let attributes = CSSearchableItemAttributeSet(contentType: .text)
            attributes.title = book["title"] as? String
            let author = book["author"] as? String ?? ""
            attributes.contentDescription = author.isEmpty ? "Book in Aurum" : "by \(author) · in Aurum"
            if !author.isEmpty { attributes.creator = author }
            items.append(CSSearchableItem(uniqueIdentifier: "book:\(id)", domainIdentifier: domain, attributeSet: attributes))
        }

        for note in notes {
            guard
                let id = note["id"] as? String,
                let bookId = note["bookId"] as? String
            else { continue }
            let text = note["text"] as? String ?? ""
            let comment = note["note"] as? String ?? ""
            let attributes = CSSearchableItemAttributeSet(contentType: .text)
            attributes.title = (note["bookTitle"] as? String) ?? "Highlight"
            attributes.contentDescription = [text, comment].filter { !$0.isEmpty }.joined(separator: " — ")
            items.append(CSSearchableItem(uniqueIdentifier: "note:\(bookId):\(id)", domainIdentifier: domain, attributeSet: attributes))
        }

        let index = CSSearchableIndex.default()
        index.deleteSearchableItems(withDomainIdentifiers: [domain]) { _ in
            guard !items.isEmpty else { return }
            index.indexSearchableItems(items, completionHandler: nil)
        }
    }
}
