import Combine
import Foundation
import WebKit

final class WebViewStore: ObservableObject {
    struct ErrorState: Equatable {
        let title: String
        let message: String
    }

    @Published var isLoading = true
    @Published var estimatedProgress = 0.0
    @Published var hasInitialPageLoaded = false
    @Published var errorState: ErrorState?

    weak var webView: WKWebView?

    var shouldShowTopProgress: Bool {
        isLoading && hasInitialPageLoaded && errorState == nil
    }

    func attach(webView: WKWebView) {
        self.webView = webView
    }

    func reload() {
        errorState = nil

        if let webView {
            webView.reload()
        } else {
            loadInitialRequest()
        }
    }

    func loadInitialRequest() {
        errorState = nil
        isLoading = true
        webView?.load(URLRequest(url: AppConfig.initialURL))
    }

    @MainActor
    func didStartLoading() {
        errorState = nil
        isLoading = true
    }

    @MainActor
    func didUpdateProgress(_ progress: Double) {
        estimatedProgress = progress
    }

    @MainActor
    func didFinishLoading() {
        isLoading = false
        estimatedProgress = 1.0
        hasInitialPageLoaded = true
        errorState = nil
    }

    @MainActor
    func didFailLoading() {
        isLoading = false
        estimatedProgress = 0
        errorState = ErrorState(
            title: "Connection problem",
            message: "Please check your internet and try again."
        )
    }
}
