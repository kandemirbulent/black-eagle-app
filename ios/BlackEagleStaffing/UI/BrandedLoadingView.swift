import SwiftUI

struct BrandedLoadingView: View {
    let progress: Double

    var body: some View {
        VStack(spacing: 22) {
            Spacer()

            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [Color.brandGold, Color.brandGold.opacity(0.75)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .shadow(color: Color.brandGold.opacity(0.2), radius: 24, y: 8)

                Image(systemName: "shield.fill")
                    .font(.system(size: 36, weight: .bold))
                    .foregroundStyle(Color.black)
            }
            .frame(width: 110, height: 110)

            VStack(spacing: 8) {
                Text(AppConfig.appName)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(Color.brandBlack)

                Text("Preparing your staffing dashboard")
                    .font(.subheadline)
                    .foregroundStyle(Color.secondary)
            }

            VStack(spacing: 10) {
                ProgressView(value: max(progress, 0.08), total: 1.0)
                    .progressViewStyle(.linear)
                    .tint(Color.brandGold)
                    .frame(width: 220)

                Text("Loading secure workspace...")
                    .font(.footnote)
                    .foregroundStyle(Color.secondary)
            }

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            LinearGradient(
                colors: [Color.white, Color.appBackground],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }
}
