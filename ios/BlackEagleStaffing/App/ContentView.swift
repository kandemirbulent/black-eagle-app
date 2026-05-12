import SwiftUI

struct ContentView: View {
    @StateObject private var webViewStore = WebViewStore()

    var body: some View {
        ZStack {
            Color.appBackground
                .ignoresSafeArea()

            VStack(spacing: 0) {
                AppChromeHeader(
                    isLoading: webViewStore.isLoading,
                    showsProgress: webViewStore.shouldShowTopProgress,
                    progress: webViewStore.estimatedProgress
                )

                ZStack {
                    WebViewContainer(store: webViewStore)
                        .opacity(webViewStore.hasInitialPageLoaded ? 1 : 0.01)

                    if let errorState = webViewStore.errorState {
                        ErrorStateView(
                            title: errorState.title,
                            message: errorState.message,
                            retryAction: webViewStore.reload
                        )
                        .transition(.opacity)
                    }

                    if !webViewStore.hasInitialPageLoaded && webViewStore.errorState == nil {
                        BrandedLoadingView(progress: webViewStore.estimatedProgress)
                            .transition(.opacity)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.white)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: webViewStore.errorState != nil)
        .animation(.easeInOut(duration: 0.25), value: webViewStore.hasInitialPageLoaded)
        .animation(.easeInOut(duration: 0.2), value: webViewStore.shouldShowTopProgress)
    }
}
