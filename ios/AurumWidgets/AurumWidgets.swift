import SwiftUI
import UIKit
import WidgetKit

// Home Screen and Lock Screen widgets: the book you're reading, how far in you
// are, and your reading streak. The app writes a snapshot to the shared App
// Group whenever you leave it (see SharedStore in the app).

private let appGroup = "group.com.hollywoodveal.aurum"
private let widgetKey = "widget.v1"
private let coverFile = "widget-cover.jpg"

private let gold = Color(red: 0.84, green: 0.69, blue: 0.36)
private let ink = Color(red: 0.043, green: 0.043, blue: 0.039)
private let ivory = Color(red: 0.95, green: 0.92, blue: 0.86)

struct ReadingSnapshot {
    var bookId: String?
    var title: String?
    var author: String?
    var progress: Double // 0–100
    var minutesLeft: Int?
    var streak: Int
    var todayMinutes: Int
    var dailyGoal: Int
    var cover: UIImage?

    static let placeholder = ReadingSnapshot(
        bookId: nil, title: "Your next great book", author: "Aurum",
        progress: 42, minutesLeft: 95, streak: 7, todayMinutes: 12, dailyGoal: 20, cover: nil
    )

    static func load() -> ReadingSnapshot {
        let defaults = UserDefaults(suiteName: appGroup)
        guard
            let data = defaults?.data(forKey: widgetKey),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return ReadingSnapshot(
                bookId: nil, title: nil, author: nil, progress: 0, minutesLeft: nil,
                streak: 0, todayMinutes: 0, dailyGoal: 20, cover: nil
            )
        }
        let book = json["book"] as? [String: Any]
        var cover: UIImage?
        if (json["hasCover"] as? Bool) == true,
           let folder = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) {
            cover = UIImage(contentsOfFile: folder.appendingPathComponent(coverFile).path)
        }
        return ReadingSnapshot(
            bookId: book?["id"] as? String,
            title: book?["title"] as? String,
            author: book?["author"] as? String,
            progress: (book?["progress"] as? NSNumber)?.doubleValue ?? 0,
            minutesLeft: (book?["minutesLeft"] as? NSNumber)?.intValue,
            streak: (json["streak"] as? NSNumber)?.intValue ?? 0,
            todayMinutes: (json["todayMinutes"] as? NSNumber)?.intValue ?? 0,
            dailyGoal: max(1, (json["dailyGoal"] as? NSNumber)?.intValue ?? 20),
            cover: cover
        )
    }

    var link: URL {
        if let bookId { return URL(string: "aurumapp://book/\(bookId)")! }
        return URL(string: "aurumapp://continue")!
    }
}

struct ReadingEntry: TimelineEntry {
    let date: Date
    let snapshot: ReadingSnapshot
}

struct ReadingProvider: TimelineProvider {
    func placeholder(in context: Context) -> ReadingEntry {
        ReadingEntry(date: Date(), snapshot: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (ReadingEntry) -> Void) {
        completion(ReadingEntry(date: Date(), snapshot: context.isPreview ? .placeholder : .load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ReadingEntry>) -> Void) {
        // The app reloads the widgets when you read; refresh at midnight too,
        // when "today" resets.
        let entry = ReadingEntry(date: Date(), snapshot: .load())
        let midnight = Calendar.current.startOfDay(for: Date()).addingTimeInterval(86_400 + 60)
        completion(Timeline(entries: [entry], policy: .after(midnight)))
    }
}

// MARK: - Views

private struct Cover: View {
    let image: UIImage?
    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
            } else {
                ZStack {
                    LinearGradient(colors: [gold.opacity(0.35), ink], startPoint: .top, endPoint: .bottom)
                    Image(systemName: "book.closed.fill").foregroundStyle(gold)
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

private struct ProgressBar: View {
    let value: Double // 0–100
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(ivory.opacity(0.15))
                Capsule().fill(gold).frame(width: geo.size.width * min(1, max(0, value / 100)))
            }
        }
        .frame(height: 4)
    }
}

private struct StreakLabel: View {
    let snapshot: ReadingSnapshot
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "flame.fill").foregroundStyle(snapshot.streak > 0 ? gold : ivory.opacity(0.4))
            Text(snapshot.streak > 0 ? "\(snapshot.streak)-day streak" : "Start a streak")
            Text("· \(snapshot.todayMinutes)/\(snapshot.dailyGoal) min").foregroundStyle(ivory.opacity(0.6))
        }
        .font(.caption2)
        .foregroundStyle(ivory)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }
}

struct SmallReadingView: View {
    let snapshot: ReadingSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                Cover(image: snapshot.cover).frame(width: 44, height: 64)
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Image(systemName: "flame.fill").foregroundStyle(snapshot.streak > 0 ? gold : ivory.opacity(0.4))
                    Text("\(snapshot.streak)").font(.headline).foregroundStyle(ivory)
                }
            }
            Spacer(minLength: 0)
            Text(snapshot.title ?? "Open Aurum to start reading")
                .font(.system(.footnote, design: .serif).weight(.semibold))
                .foregroundStyle(ivory)
                .lineLimit(2)
            if snapshot.title != nil {
                ProgressBar(value: snapshot.progress)
                Text("\(Int(snapshot.progress.rounded()))%")
                    .font(.caption2).foregroundStyle(gold)
            }
        }
    }
}

struct MediumReadingView: View {
    let snapshot: ReadingSnapshot
    var body: some View {
        HStack(spacing: 12) {
            Cover(image: snapshot.cover).frame(width: 74, height: 108)
            VStack(alignment: .leading, spacing: 6) {
                Text("CONTINUE READING")
                    .font(.caption2.weight(.medium)).tracking(1.2).foregroundStyle(gold)
                Text(snapshot.title ?? "Open Aurum to start reading")
                    .font(.system(.headline, design: .serif))
                    .foregroundStyle(ivory)
                    .lineLimit(2)
                if let author = snapshot.author, !author.isEmpty {
                    Text(author).font(.caption).foregroundStyle(ivory.opacity(0.7)).lineLimit(1)
                }
                Spacer(minLength: 0)
                if snapshot.title != nil {
                    ProgressBar(value: snapshot.progress)
                    HStack {
                        Text("\(Int(snapshot.progress.rounded()))%").foregroundStyle(gold)
                        if let left = snapshot.minutesLeft, left > 0 {
                            Text("· \(left >= 60 ? "\(left / 60)h \(left % 60)m" : "\(left)m") left")
                                .foregroundStyle(ivory.opacity(0.6))
                        }
                    }
                    .font(.caption2)
                }
                StreakLabel(snapshot: snapshot)
            }
        }
    }
}

struct CircularReadingView: View {
    let snapshot: ReadingSnapshot
    var body: some View {
        Gauge(value: min(100, max(0, snapshot.progress)), in: 0...100) {
            Image(systemName: "book.fill")
        } currentValueLabel: {
            Text("\(Int(snapshot.progress.rounded()))")
        }
        .gaugeStyle(.accessoryCircular)
    }
}

struct RectangularReadingView: View {
    let snapshot: ReadingSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(snapshot.title ?? "Aurum").font(.headline).lineLimit(1)
            Gauge(value: min(100, max(0, snapshot.progress)), in: 0...100) { EmptyView() }
                .gaugeStyle(.accessoryLinearCapacity)
            Text("\(Int(snapshot.progress.rounded()))% · \(snapshot.streak)-day streak")
                .font(.caption2)
        }
    }
}

struct ReadingWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ReadingEntry

    var body: some View {
        content.widgetURL(entry.snapshot.link)
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryCircular:
            CircularReadingView(snapshot: entry.snapshot).widgetBackground(nil)
        case .accessoryRectangular:
            RectangularReadingView(snapshot: entry.snapshot).widgetBackground(nil)
        case .accessoryInline:
            Text(entry.snapshot.title.map { "\($0) · \(Int(entry.snapshot.progress.rounded()))%" } ?? "Aurum")
                .widgetBackground(nil)
        case .systemMedium:
            MediumReadingView(snapshot: entry.snapshot).widgetBackground(ink)
        default:
            SmallReadingView(snapshot: entry.snapshot).widgetBackground(ink)
        }
    }
}

private extension View {
    /// iOS 17 wants widgets to declare their background; older versions
    /// just paint it.
    @ViewBuilder func widgetBackground(_ color: Color?) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(for: .widget) { color ?? Color.clear }
        } else if let color {
            padding().background(color)
        } else {
            self
        }
    }
}

struct ReadingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "AurumReading", provider: ReadingProvider()) { entry in
            ReadingWidgetView(entry: entry)
        }
        .configurationDisplayName("Continue Reading")
        .description("Your current book, progress and reading streak.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct AurumWidgetBundle: WidgetBundle {
    var body: some Widget {
        ReadingWidget()
    }
}
