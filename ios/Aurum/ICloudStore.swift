import Foundation

/// Keeps Aurum's sync file in the app's private iCloud Drive folder, so
/// reading positions, highlights and notes follow you between your iPhone and
/// iPad.
///
/// iCloud needs the iCloud capability on the app, which Apple only gives to
/// paid Apple Developer Program members. Until it's added, `status` answers
/// `available: false` and the page hides iCloud sync.
final class ICloudStore {
    private let queue = DispatchQueue(label: "aurum.icloud", qos: .utility)
    private let fileName = "aurum-sync.json"

    enum StoreError: LocalizedError {
        case unavailable
        case conflict
        case notDownloaded

        var errorDescription: String? {
            switch self {
            case .unavailable: return "iCloud isn't available. Check that you're signed in to iCloud and iCloud Drive is on."
            case .conflict: return "conflict"
            case .notDownloaded: return "The sync file is still downloading from iCloud. Try again in a moment."
            }
        }
    }

    private func fileURL() -> URL? {
        // Must not run on the main thread: the first call can take a while.
        guard let container = FileManager.default.url(forUbiquityContainerIdentifier: nil) else { return nil }
        let documents = container.appendingPathComponent("Documents", isDirectory: true)
        try? FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
        return documents.appendingPathComponent(fileName)
    }

    private func reply<T>(_ completion: @escaping (T) -> Void, _ value: T) {
        DispatchQueue.main.async { completion(value) }
    }

    func status(_ completion: @escaping ([String: Any]) -> Void) {
        queue.async {
            let signedIn = FileManager.default.ubiquityIdentityToken != nil
            let available = signedIn && self.fileURL() != nil
            self.reply(completion, ["available": available, "signedIn": signedIn])
        }
    }

    /// `{text, version}`, or `NSNull` when there's no sync file yet.
    func read(_ completion: @escaping (Result<Any, Error>) -> Void) {
        queue.async {
            guard let url = self.fileURL() else {
                self.reply(completion, .failure(StoreError.unavailable))
                return
            }
            guard self.ensureDownloaded(url) else {
                self.reply(completion, .failure(StoreError.notDownloaded))
                return
            }
            var coordinatorError: NSError?
            var result: Result<Any, Error> = .success(NSNull())
            NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinatorError) { readURL in
                guard FileManager.default.fileExists(atPath: readURL.path) else {
                    result = .success(NSNull())
                    return
                }
                do {
                    let text = try String(contentsOf: readURL, encoding: .utf8)
                    result = .success(["text": text, "version": self.version(of: readURL)])
                } catch {
                    result = .failure(error)
                }
            }
            if let coordinatorError { result = .failure(coordinatorError) }
            self.reply(completion, result)
        }
    }

    /// Writes only if the file is still at `ifVersion` (nil: only if there's
    /// no file yet). Fails with "conflict" otherwise, so the page re-merges.
    func write(text: String, ifVersion: String?, _ completion: @escaping (Result<Any, Error>) -> Void) {
        queue.async {
            guard let url = self.fileURL() else {
                self.reply(completion, .failure(StoreError.unavailable))
                return
            }
            var coordinatorError: NSError?
            var result: Result<Any, Error> = .failure(StoreError.conflict)
            NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinatorError) { writeURL in
                let exists = FileManager.default.fileExists(atPath: writeURL.path)
                let current = exists ? self.version(of: writeURL) : nil
                guard current == ifVersion else {
                    result = .failure(StoreError.conflict)
                    return
                }
                do {
                    try Data(text.utf8).write(to: writeURL, options: .atomic)
                    result = .success(["version": self.version(of: writeURL)])
                } catch {
                    result = .failure(error)
                }
            }
            if let coordinatorError { result = .failure(coordinatorError) }
            self.reply(completion, result)
        }
    }

    /// A version tag that changes whenever the file does.
    private func version(of url: URL) -> String {
        let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        let date = values?.contentModificationDate?.timeIntervalSince1970 ?? 0
        let size = values?.fileSize ?? 0
        return "\(Int(date * 1000))-\(size)"
    }

    /// Asks iCloud for the latest copy and waits up to 10 seconds for it.
    private func ensureDownloaded(_ url: URL) -> Bool {
        let fm = FileManager.default
        guard fm.isUbiquitousItem(at: url) else { return true } // no file yet, or local only
        try? fm.startDownloadingUbiquitousItem(at: url)
        for _ in 0..<40 {
            let values = try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey])
            if values?.ubiquitousItemDownloadingStatus == .current { return true }
            Thread.sleep(forTimeInterval: 0.25)
        }
        return fm.fileExists(atPath: url.path)
    }
}
