import UIKit
import WebKit

/// The real iOS page curl (UIPageViewController's `.pageCurl`), the same
/// animation Apple uses: the corner lifts, the page rolls over like paper
/// and you see its back as it turns.
///
/// The web page can't draw this itself, so the app does it over the web view:
///   1. `begin` photographs the page and lays a page view controller showing
///      that photo exactly on top, so nothing appears to change.
///   2. The web page moves to the next page underneath.
///   3. `finish` photographs the new page (a web view snapshot never includes
///      views on top of it) and curls from the old photo to the new one, then
///      removes itself, revealing the live page.
///
/// With two pages showing (`spread`), the spine sits in the middle and the
/// right page turns over onto the left, its back showing the new left page.
final class PageCurl: NSObject {
    static let shared = PageCurl()

    private var controller: UIPageViewController?
    /// A tapped turn is on screen.
    var isActive: Bool { controller != nil }
    private var rect: CGRect = .zero
    private var spread = false
    private var watchdog: DispatchWorkItem?

    /// Photographs `rect` (web view points) and covers it with the photo.
    func begin(
        in webView: WKWebView,
        host: UIViewController,
        rect: CGRect,
        spread: Bool,
        completion: @escaping (Bool) -> Void
    ) {
        cancel()
        guard rect.width >= 2, rect.height >= 2 else {
            completion(false)
            return
        }
        snapshot(webView, rect: rect, fresh: false) { [weak self] image in
            guard let self, let image else {
                completion(false)
                return
            }
            self.rect = rect
            self.spread = spread
            let location: UIPageViewController.SpineLocation = spread ? .mid : .min
            let pages = UIPageViewController(
                transitionStyle: .pageCurl,
                navigationOrientation: .horizontal,
                options: [.spineLocation: NSNumber(value: location.rawValue)]
            )
            pages.isDoubleSided = spread
            // Only the web page handles taps and swipes.
            pages.view.isUserInteractionEnabled = false
            pages.gestureRecognizers.forEach { $0.isEnabled = false }
            pages.setViewControllers(self.pageControllers(image), direction: .forward, animated: false)
            pages.view.frame = rect
            pages.view.backgroundColor = .clear
            host.addChild(pages)
            webView.addSubview(pages.view)
            pages.didMove(toParent: host)
            self.controller = pages

            // Never leave a photo stuck over the page.
            let watchdog = DispatchWorkItem { [weak self] in self?.cancel() }
            self.watchdog = watchdog
            DispatchQueue.main.asyncAfter(deadline: .now() + 4, execute: watchdog)
            completion(true)
        }
    }

    /// Curls to the page now showing in the web view, then gets out of the way.
    func finish(in webView: WKWebView, forward: Bool, completion: @escaping (Bool) -> Void) {
        guard let pages = controller else {
            completion(false)
            return
        }
        snapshot(webView, rect: rect, fresh: true) { [weak self] image in
            guard let strong = self else {
                completion(false)
                return
            }
            guard let image, strong.controller === pages else {
                strong.cancel()
                completion(false)
                return
            }
            strong.watchdog?.cancel()
            pages.setViewControllers(
                strong.pageControllers(image),
                direction: forward ? .forward : .reverse,
                animated: true
            ) { [weak self] _ in
                self?.cancel()
                completion(true)
            }
        }
    }

    /// Removes the overlay at once.
    func cancel() {
        watchdog?.cancel()
        watchdog = nil
        guard let pages = controller else { return }
        controller = nil
        pages.willMove(toParent: nil)
        pages.view.removeFromSuperview()
        pages.removeFromParent()
    }

    // MARK: Helpers

    private func pageControllers(_ image: UIImage) -> [UIViewController] {
        guard spread, let cg = image.cgImage else { return [PageImageController(image: image)] }
        // Split the photo down the spine into left and right pages.
        let w = cg.width / 2
        let left = cg.cropping(to: CGRect(x: 0, y: 0, width: w, height: cg.height))
        let right = cg.cropping(to: CGRect(x: w, y: 0, width: cg.width - w, height: cg.height))
        let make = { (part: CGImage?) -> UIViewController in
            PageImageController(image: part.map {
                UIImage(cgImage: $0, scale: image.scale, orientation: image.imageOrientation)
            } ?? image)
        }
        return [make(left), make(right)]
    }

    private func snapshot(
        _ webView: WKWebView,
        rect: CGRect,
        fresh: Bool,
        completion: @escaping (UIImage?) -> Void
    ) {
        let config = WKSnapshotConfiguration()
        config.rect = rect
        // After the page changes, wait for it to be drawn before photographing.
        config.afterScreenUpdates = fresh
        webView.takeSnapshot(with: config) { image, _ in completion(image) }
    }
}

/// One page of the curl: just the photo, filling the page. The photo can
/// arrive late (the next page while you're already dragging); until then the
/// page shows plain paper.
final class PageImageController: UIViewController {
    var image: UIImage? {
        didSet { imageView?.image = image }
    }
    var paper: UIColor = .black
    private weak var imageView: UIImageView?

    init(image: UIImage?) {
        self.image = image
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func loadView() {
        let imageView = UIImageView(image: image)
        imageView.contentMode = .scaleToFill
        imageView.clipsToBounds = true
        imageView.backgroundColor = paper
        self.imageView = imageView
        view = imageView
    }
}

// MARK: - Drag to turn

/// Drag a page by its edge and it follows your finger, curling exactly as in
/// Apple Books (UIPageViewController's own gesture). The outer fifth of each
/// side of the page is a turning zone: a drag there turns the page, a tap
/// turns it with the same curl, and touches anywhere else go to the book.
///
/// The next page doesn't exist until the web page moves to it, so when a drag
/// starts the app asks the page to move underneath, photographs it and fills
/// in the revealed page (plain paper for the first instant). If you let go
/// without turning, the page moves back.
final class CurlDrag: NSObject, UIPageViewControllerDataSource, UIPageViewControllerDelegate {
    static let shared = CurlDrag()

    weak var webView: WKWebView?
    weak var host: UIViewController?
    var send: (([String: Any]) -> Void)?

    private var zone: EdgeZoneView?
    private var pages: UIPageViewController?
    private var rect: CGRect = .zero
    private var spread = false
    private var atStart = false
    private var atEnd = false
    private var paper: UIColor = .black
    private var current: [PageImageController] = []
    private var incoming: [PageImageController] = []
    private var movedTo: String?
    private var watchdog: DispatchWorkItem?

    /// From the page: where the book is drawn and whether turning is allowed.
    func configure(_ body: [String: Any]) {
        guard let webView, let host else { return }
        let enabled = (body["enabled"] as? Bool) ?? false
        guard enabled else {
            if movedTo == nil { tearDown() }
            return
        }
        let newRect = CGRect(
            x: (body["x"] as? NSNumber)?.doubleValue ?? 0,
            y: (body["y"] as? NSNumber)?.doubleValue ?? 0,
            width: (body["width"] as? NSNumber)?.doubleValue ?? 0,
            height: (body["height"] as? NSNumber)?.doubleValue ?? 0
        )
        let newSpread = (body["spread"] as? Bool) ?? false
        atStart = (body["atStart"] as? Bool) ?? false
        atEnd = (body["atEnd"] as? Bool) ?? false
        if let hex = body["paper"] as? String { paper = UIColor(hex: hex) ?? paper }
        guard newRect.width > 40, newRect.height > 40 else { return }
        if movedTo != nil { return } // mid-turn: keep the current setup

        if pages == nil || newSpread != spread || newRect.size != rect.size {
            tearDown()
            spread = newSpread
            let location: UIPageViewController.SpineLocation = spread ? .mid : .min
            let controller = UIPageViewController(
                transitionStyle: .pageCurl,
                navigationOrientation: .horizontal,
                options: [.spineLocation: NSNumber(value: location.rawValue)]
            )
            controller.isDoubleSided = spread
            controller.dataSource = self
            controller.delegate = self
            controller.view.isHidden = true
            controller.view.isUserInteractionEnabled = false
            current = placeholders(count: spread ? 2 : 1)
            controller.setViewControllers(current, direction: .forward, animated: false)
            host.addChild(controller)
            webView.addSubview(controller.view)
            controller.didMove(toParent: host)
            pages = controller

            let zone = EdgeZoneView()
            zone.onTouchDown = { [weak self] in self?.photographCurrent() }
            zone.onTap = { [weak self] dir in self?.send?(["type": "edgeTap", "dir": dir]) }
            // Hand the page view controller's own drag gesture to the zones.
            for recognizer in controller.gestureRecognizers where recognizer is UIPanGestureRecognizer {
                zone.addGestureRecognizer(recognizer)
            }
            webView.addSubview(zone)
            self.zone = zone
        }
        rect = newRect
        pages?.view.frame = newRect
        zone?.frame = newRect
    }

    /// The page has moved to the next (or previous) page under the photo.
    func pageMoved() {
        guard let webView, movedTo != nil else { return }
        let config = WKSnapshotConfiguration()
        config.rect = rect
        config.afterScreenUpdates = true
        webView.takeSnapshot(with: config) { [weak self] image, _ in
            guard let self, let image else { return }
            let parts = self.split(image)
            for (vc, part) in zip(self.incoming, parts) { vc.image = part }
        }
    }

    /// After a cancelled drag the page has moved back: show the live page.
    func pageRestored() {
        finishTurn()
    }

    private func tearDown() {
        watchdog?.cancel()
        zone?.removeFromSuperview()
        zone = nil
        if let pages {
            pages.willMove(toParent: nil)
            pages.view.removeFromSuperview()
            pages.removeFromParent()
        }
        pages = nil
        movedTo = nil
        incoming = []
    }

    private func finishTurn() {
        watchdog?.cancel()
        movedTo = nil
        incoming = []
        pages?.view.isHidden = true
    }

    // MARK: Photos

    private func placeholders(count: Int) -> [PageImageController] {
        (0..<count).map { _ in
            let vc = PageImageController(image: nil)
            vc.paper = paper
            return vc
        }
    }

    private func split(_ image: UIImage) -> [UIImage] {
        guard spread, let cg = image.cgImage else { return [image] }
        let w = cg.width / 2
        let halves = [
            cg.cropping(to: CGRect(x: 0, y: 0, width: w, height: cg.height)),
            cg.cropping(to: CGRect(x: w, y: 0, width: cg.width - w, height: cg.height)),
        ]
        return halves.map { part in
            part.map { UIImage(cgImage: $0, scale: image.scale, orientation: image.imageOrientation) } ?? image
        }
    }

    /// A finger touched a turning zone: photograph the page now, so a drag
    /// can start from an exact copy of it.
    private func photographCurrent() {
        guard let webView, let pages, movedTo == nil else { return }
        let config = WKSnapshotConfiguration()
        config.rect = rect
        config.afterScreenUpdates = false
        webView.takeSnapshot(with: config) { [weak self] image, _ in
            guard let self, let image, self.movedTo == nil else { return }
            let fresh = self.placeholders(count: self.spread ? 2 : 1)
            for (vc, part) in zip(fresh, self.split(image)) { vc.image = part }
            self.current = fresh
            pages.setViewControllers(fresh, direction: .forward, animated: false)
        }
    }

    // MARK: UIPageViewControllerDataSource

    private func start(_ dir: String) -> Bool {
        guard movedTo == nil, !PageCurl.shared.isActive,
              current.first?.image != nil else { return false }
        if dir == "next" && atEnd { return false }
        if dir == "prev" && atStart { return false }
        movedTo = dir
        incoming = placeholders(count: spread ? 2 : 1)
        pages?.view.isHidden = false
        send?(["type": "curlDrag", "dir": dir])
        // Never leave a photo stuck over the page.
        let watchdog = DispatchWorkItem { [weak self] in self?.finishTurn() }
        self.watchdog = watchdog
        DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: watchdog)
        return true
    }

    func pageViewController(
        _ pageViewController: UIPageViewController,
        viewControllerAfter viewController: UIViewController
    ) -> UIViewController? {
        if spread {
            // Turning the right page: its back is the new left page, then the
            // new right page underneath.
            if viewController === current.last { return start("next") ? incoming.first : nil }
            if movedTo == "next", viewController === incoming.first { return incoming.last }
            return nil
        }
        guard viewController === current.first else { return nil }
        return start("next") ? incoming.first : nil
    }

    func pageViewController(
        _ pageViewController: UIPageViewController,
        viewControllerBefore viewController: UIViewController
    ) -> UIViewController? {
        if spread {
            if viewController === current.first { return start("prev") ? incoming.last : nil }
            if movedTo == "prev", viewController === incoming.last { return incoming.first }
            return nil
        }
        guard viewController === current.first else { return nil }
        return start("prev") ? incoming.first : nil
    }

    // MARK: UIPageViewControllerDelegate

    func pageViewController(
        _ pageViewController: UIPageViewController,
        didFinishAnimating finished: Bool,
        previousViewControllers: [UIViewController],
        transitionCompleted completed: Bool
    ) {
        guard let dir = movedTo else { return }
        if completed {
            current = incoming
            finishTurn()
            send?(["type": "curlDragDone", "dir": dir])
        } else {
            // Let go without turning: put the page back, then reveal it.
            send?(["type": "curlDragCancel", "dir": dir])
        }
    }
}

/// The two turning zones along the outer edges of the page. Everything in
/// between passes straight through to the book.
final class EdgeZoneView: UIView {
    var onTouchDown: (() -> Void)?
    var onTap: ((String) -> Void)?
    private let edge: CGFloat = 0.2

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        addGestureRecognizer(tap)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    private func side(of point: CGPoint) -> String? {
        if point.x <= bounds.width * edge { return "prev" }
        if point.x >= bounds.width * (1 - edge) { return "next" }
        return nil
    }

    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        bounds.contains(point) && side(of: point) != nil
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        onTouchDown?()
        super.touchesBegan(touches, with: event)
    }

    @objc private func tapped(_ recognizer: UITapGestureRecognizer) {
        if let dir = side(of: recognizer.location(in: self)) { onTap?(dir) }
    }
}

private extension UIColor {
    /// "#rrggbb"
    convenience init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(
            red: CGFloat((v >> 16) & 0xFF) / 255,
            green: CGFloat((v >> 8) & 0xFF) / 255,
            blue: CGFloat(v & 0xFF) / 255,
            alpha: 1
        )
    }
}
