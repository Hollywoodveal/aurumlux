import AppIntents
import Foundation

/// "Hey Siri, continue reading in Aurum" — and the same action in Shortcuts,
/// Spotlight and on the Action button. Opens the book you read last at your
/// page.
@available(iOS 16.0, *)
struct ContinueReadingIntent: AppIntent {
    static var title: LocalizedStringResource = "Continue Reading"
    static var description = IntentDescription("Opens the book you were reading, at your page.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        NativeBridge.shared.send(["type": "continueReading"])
        return .result()
    }
}

@available(iOS 16.0, *)
struct OpenLibraryIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Library"
    static var description = IntentDescription("Opens your Aurum bookshelf.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        NativeBridge.shared.send(["type": "navigate", "to": "/"])
        return .result()
    }
}

@available(iOS 16.0, *)
struct AurumShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: ContinueReadingIntent(),
            phrases: [
                "Continue reading in \(.applicationName)",
                "Resume my book in \(.applicationName)",
                "Open my book in \(.applicationName)",
            ]
        )
        AppShortcut(
            intent: OpenLibraryIntent(),
            phrases: [
                "Open my library in \(.applicationName)",
                "Show my books in \(.applicationName)",
            ]
        )
    }
}
