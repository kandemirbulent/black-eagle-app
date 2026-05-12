import Foundation

enum AppConfig {
    static let appName = "Black Eagle Staffing"
    static let initialURL = URL(string: "https://www.blackeagleuk.com/login.html")!
    static let allowedHosts: Set<String> = [
        "www.blackeagleuk.com",
        "blackeagleuk.com"
    ]

    static func isAllowed(_ url: URL?) -> Bool {
        guard let host = url?.host?.lowercased() else {
            return false
        }

        return allowedHosts.contains(host)
    }
}
