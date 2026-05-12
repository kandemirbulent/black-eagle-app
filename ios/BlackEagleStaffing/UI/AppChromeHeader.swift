import SwiftUI

struct AppChromeHeader: View {
    let isLoading: Bool
    let showsProgress: Bool
    let progress: Double

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(Color.brandGold)

                    Image(systemName: "shield.fill")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Color.black.opacity(0.9))
                }
                .frame(width: 36, height: 36)

                VStack(alignment: .leading, spacing: 2) {
                    Text(AppConfig.appName)
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(Color.white)

                    Text(isLoading ? "Updating staffing workspace" : "Staffing platform")
                        .font(.caption)
                        .foregroundStyle(Color.white.opacity(0.72))
                }

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 14)

            if showsProgress {
                ProgressBar(progress: progress)
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity)
        .background(
            LinearGradient(
                colors: [Color.brandBlack, Color.brandBlack.opacity(0.96)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
    }
}
