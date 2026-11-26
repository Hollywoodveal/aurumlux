import AVFoundation
import SwiftUI
import UIKit

/// The book's cover on the iPhone Duo's front screen while you read on the
/// inner screen, like the cover of a real book facing outward.
///
/// iOS only lets an app use the front screen while the phone is open through
/// a camera capture accessory (UISceneAccessory.cameraCapture), which shows
/// only while the app's camera is running. So when this is switched on in
/// Reading settings, Aurum runs the rear camera at its lowest quality, shows a
/// small live preview in a corner of the cover (iOS requires a preview), and
/// records nothing. The camera stops when the phone is folded, when you leave
/// the book, and when the app goes to the background.
final class FrontCover: NSObject {
    static let shared = FrontCover()

    weak var host: UIViewController?

    /// The front-screen accessory exists from iOS 27.1 (iPhone Duo).
    static var isSupported: Bool {
        if #available(iOS 27.1, *) { return true }
        return false
    }
    let model = FrontCoverModel()
    let session = AVCaptureSession()

    private var enabled = false
    private var folded = false
    private var registrationBox: AnyObject?
    private let queue = DispatchQueue(label: "aurum.frontcover.camera")
    private var configured = false

    override init() {
        super.init()
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(appBackgrounded),
                           name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(appActive),
                           name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    /// From the page: `{enabled, title, author, progress, cover}` (cover is a
    /// data URL, sent only when it changes).
    func update(_ body: [String: Any]) {
        model.title = body["title"] as? String ?? model.title
        model.author = body["author"] as? String ?? model.author
        if let progress = (body["progress"] as? NSNumber)?.doubleValue { model.progress = progress }
        if let cover = body["cover"] as? String {
            model.cover = Self.image(fromDataURL: cover)
        }
        enabled = (body["enabled"] as? Bool) ?? false
        apply()
    }

    /// iPhone Duo hinge: no point running the camera with the phone folded.
    func hingeChanged(_ status: String) {
        folded = status == "closed"
        apply()
    }

    @objc private func appBackgrounded() { stopCamera() }
    @objc private func appActive() { apply() }

    private func apply() {
        guard enabled else {
            setAccessoryEnabled(false)
            stopCamera()
            return
        }
        registerIfNeeded()
        setAccessoryEnabled(true)
        if folded { stopCamera() } else { startCamera() }
    }

    // MARK: Scene accessory

    private func registerIfNeeded() {
        guard registrationBox == nil, let host else { return }
        if #available(iOS 27.1, *) {
            let configuration = UISceneConfiguration(name: "Front Cover", sessionRole: .windowCameraCaptureAccessory)
            configuration.delegateClass = FrontCoverSceneDelegate.self
            let accessory = UISceneAccessory.cameraCapture(sceneConfiguration: configuration, userInfo: model)
            let registration: UISceneAccessoryRegistration? = host.registerSceneAccessory(accessory)
            if let registration { registrationBox = AccessoryBox(registration) }
        }
    }

    private func setAccessoryEnabled(_ on: Bool) {
        if #available(iOS 27.1, *), let box = registrationBox as? AccessoryBox {
            box.registration.isEnabled = on
        }
    }

    // MARK: Camera

    private func startCamera() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            break
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                if granted { DispatchQueue.main.async { self.apply() } }
            }
            return
        default:
            return
        }
        queue.async {
            if !self.configured {
                self.session.beginConfiguration()
                self.session.sessionPreset = .low
                if let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
                   let input = try? AVCaptureDeviceInput(device: camera),
                   self.session.canAddInput(input) {
                    self.session.addInput(input)
                }
                self.session.commitConfiguration()
                self.configured = true
            }
            if !self.session.isRunning { self.session.startRunning() }
        }
    }

    private func stopCamera() {
        queue.async {
            if self.session.isRunning { self.session.stopRunning() }
        }
    }

    private static func image(fromDataURL string: String) -> UIImage? {
        guard let comma = string.firstIndex(of: ","), string.hasPrefix("data:") else { return nil }
        guard let data = Data(base64Encoded: String(string[string.index(after: comma)...])) else { return nil }
        return UIImage(data: data)
    }
}

@available(iOS 27.1, *)
private final class AccessoryBox {
    var registration: UISceneAccessoryRegistration
    init(_ registration: UISceneAccessoryRegistration) { self.registration = registration }
}

/// What the front screen shows.
final class FrontCoverModel: ObservableObject {
    @Published var title = ""
    @Published var author = ""
    @Published var progress: Double = 0
    @Published var cover: UIImage?
}

/// Runs the front-screen scene: the cover, title and how far you've read.
final class FrontCoverSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = UIHostingController(
            rootView: FrontCoverView(model: FrontCover.shared.model, session: FrontCover.shared.session)
        )
        window.makeKeyAndVisible()
        self.window = window
    }
}

struct FrontCoverView: View {
    @ObservedObject var model: FrontCoverModel
    let session: AVCaptureSession

    private let gold = Color(red: 0.84, green: 0.69, blue: 0.36)

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Color.black.ignoresSafeArea()
            VStack(spacing: 14) {
                Spacer(minLength: 0)
                if let cover = model.cover {
                    Image(uiImage: cover)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .shadow(color: .black.opacity(0.6), radius: 18, y: 8)
                } else {
                    VStack(spacing: 10) {
                        Text(model.title)
                            .font(.system(.largeTitle, design: .serif))
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.white)
                        if !model.author.isEmpty {
                            Text(model.author.uppercased())
                                .font(.footnote)
                                .tracking(2)
                                .foregroundStyle(gold)
                        }
                    }
                    .padding(32)
                }
                Spacer(minLength: 0)
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.15))
                        Capsule().fill(gold).frame(width: geo.size.width * min(1, max(0, model.progress / 100)))
                    }
                }
                .frame(height: 3)
                .padding(.horizontal, 48)
                .padding(.bottom, 28)
            }
            .padding(.horizontal, 24)

            // iOS requires the camera's picture to be shown somewhere.
            CameraPreview(session: session)
                .frame(width: 44, height: 44)
                .clipShape(Circle())
                .overlay(Circle().stroke(gold.opacity(0.5), lineWidth: 1))
                .padding(16)
        }
    }
}

private struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer {
            // swiftlint:disable:next force_cast
            layer as! AVCaptureVideoPreviewLayer
        }
    }
}
