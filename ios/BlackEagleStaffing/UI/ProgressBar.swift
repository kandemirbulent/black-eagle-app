import SwiftUI

struct ProgressBar: View {
    let progress: Double

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Rectangle()
                    .fill(Color.white.opacity(0.12))

                Rectangle()
                    .fill(Color.brandGold)
                    .frame(width: proxy.size.width * min(max(progress, 0.05), 1.0))
            }
        }
        .frame(height: 3)
    }
}
