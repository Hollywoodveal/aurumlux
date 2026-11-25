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

/// One page of the curl: just the photo, filling the page.
private final class PageImageController: UIViewController {
    private let image: UIImage

    init(image: UIImage) {
        self.image = image
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func loadView() {
        let imageView = UIImageView(image: image)
        imageView.contentMode = .scaleToFill
        imageView.clipsToBounds = true
        view = imageView
    }
}
