import SwiftUI

struct ErrorStateView: View {
    let title: String
    let message: String
    let retryAction: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Spacer()

            ZStack {
                Circle()
                    .fill(Color.brandGold.opacity(0.18))

                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(Color.brandBlack)
            }
            .frame(width: 92, height: 92)

            VStack(spacing: 10) {
                Text(title)
                    .font(.title3.weight(.semibold))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Color.brandBlack)

                Text(message)
                    .font(.body)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Color.secondary)
                    .padding(.horizontal, 26)
            }

            Button(action: retryAction) {
                Text("Retry")
                    .font(.headline)
                    .foregroundStyle(Color.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.brandGold)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 28)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.white)
    }
}
