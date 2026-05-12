import AVFoundation
import SwiftUI
import UIKit
import WebKit

struct WebViewContainer: UIViewRepresentable {
    @ObservedObject var store: WebViewStore

    func makeCoordinator() -> Coordinator {
        Coordinator(store: store)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true

        if #available(iOS 14.0, *) {
            configuration.defaultWebpagePreferences.allowsContentJavaScript = true
            configuration.defaultWebpagePreferences.preferredContentMode = .mobile
        }

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
        webView.isOpaque = false
        webView.backgroundColor = .white
        webView.scrollView.backgroundColor = .white
        webView.customUserAgent = "BlackEagleStaffing/1.0 (iOS App Shell)"

        context.coordinator.attach(to: webView)
        store.attach(webView: webView)
        store.loadInitialRequest()

        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.store = store
    }
}

final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
    var store: WebViewStore

    private weak var webView: WKWebView?
    private var progressObservation: NSKeyValueObservation?

    init(store: WebViewStore) {
        self.store = store
    }

    deinit {
        progressObservation?.invalidate()
    }

    func attach(to webView: WKWebView) {
        self.webView = webView
        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] webView, _ in
            Task { @MainActor in
                self?.store.didUpdateProgress(webView.estimatedProgress)
            }
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        Task { @MainActor in
            store.didStartLoading()
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in
            store.didFinishLoading()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard !isBenignCancellation(error) else {
            return
        }

        Task { @MainActor in
            store.didFailLoading()
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard !isBenignCancellation(error) else {
            return
        }

        Task { @MainActor in
            store.didFailLoading()
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Task { @MainActor in
            store.didFailLoading()
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        if shouldAllowInternalNavigation(to: url) {
            if navigationAction.targetFrame == nil {
                webView.load(URLRequest(url: url))
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
            return
        }

        if shouldOpenExternally(url) {
            openExternally(url)
        }

        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard navigationAction.targetFrame == nil else {
            return nil
        }

        if let url = navigationAction.request.url {
            if shouldAllowInternalNavigation(to: url) {
                webView.load(URLRequest(url: url))
            } else if shouldOpenExternally(url) {
                openExternally(url)
            }
        }

        return nil
    }

    @available(iOS 15.0, *)
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        guard AppConfig.allowedHosts.contains(origin.host.lowercased()) else {
            decisionHandler(.deny)
            return
        }

        switch type {
        case .camera:
            requestAccess(for: .video) { granted in
                decisionHandler(granted ? .grant : .deny)
            }
        case .microphone:
            requestAccess(for: .audio) { granted in
                decisionHandler(granted ? .grant : .deny)
            }
        case .cameraAndMicrophone:
            requestAccess(for: .video) { [weak self] cameraGranted in
                guard cameraGranted else {
                    decisionHandler(.deny)
                    return
                }

                self?.requestAccess(for: .audio) { microphoneGranted in
                    decisionHandler(microphoneGranted ? .grant : .deny)
                }
            }
        @unknown default:
            decisionHandler(.prompt)
        }
    }

    private func requestAccess(for mediaType: AVMediaType, completion: @escaping (Bool) -> Void) {
        switch AVCaptureDevice.authorizationStatus(for: mediaType) {
        case .authorized:
            completion(true)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: mediaType, completionHandler: completion)
        default:
            completion(false)
        }
    }

    private func topViewController(
        from controller: UIViewController? = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first(where: { $0.activationState == .foregroundActive })?
            .windows
            .first(where: \.isKeyWindow)?
            .rootViewController
    ) -> UIViewController? {
        if let navigationController = controller as? UINavigationController {
            return topViewController(from: navigationController.visibleViewController)
        }

        if let tabBarController = controller as? UITabBarController {
            return topViewController(from: tabBarController.selectedViewController)
        }

        if let presentedViewController = controller?.presentedViewController {
            return topViewController(from: presentedViewController)
        }

        return controller
    }

    private func isBenignCancellation(_ error: Error) -> Bool {
        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
    }

    private func shouldAllowInternalNavigation(to url: URL) -> Bool {
        if AppConfig.isAllowed(url) {
            return true
        }

        guard let scheme = url.scheme?.lowercased() else {
            return false
        }

        return ["about", "blob", "data", "javascript"].contains(scheme)
    }

    private func shouldOpenExternally(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else {
            return false
        }

        return ["http", "https", "mailto", "tel"].contains(scheme)
    }

    private func openExternally(_ url: URL) {
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }
}
