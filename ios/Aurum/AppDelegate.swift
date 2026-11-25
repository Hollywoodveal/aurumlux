import CoreSpotlight
import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        true
    }

    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.backgroundColor = AppConfig.launchBackground
        window.rootViewController = WebViewController()
        window.makeKeyAndVisible()
        self.window = window

        // Opened by tapping a book in Files, a widget or a search result.
        handle(urlContexts: connectionOptions.urlContexts)
        connectionOptions.userActivities.forEach(handle(activity:))
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        handle(urlContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        handle(activity: userActivity)
    }

    private func handle(urlContexts: Set<UIOpenURLContext>) {
        var files: [URL] = []
        for context in urlContexts {
            let url = context.url
            if url.isFileURL {
                files.append(url)
            } else if url.scheme?.lowercased() == AppConfig.appLinkScheme {
                NativeBridge.shared.openAppURL(url)
            }
        }
        if !files.isEmpty { NativeBridge.shared.openFiles(files) }
    }

    private func handle(activity: NSUserActivity) {
        if activity.activityType == CSSearchableItemActionType,
           let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String {
            NativeBridge.shared.openSpotlightItem(id)
        }
    }
}
