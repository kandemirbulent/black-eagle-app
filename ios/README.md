# Black Eagle Staffing iOS

SwiftUI + `WKWebView` iOS shell for Black Eagle Staffing.

## Open In Xcode

Open this file on a Mac:

- [BlackEagleStaffing.xcodeproj](/C:/Users/Kande/Documents/Codex/2026-04-18-bu-benim-mevcut-full-stack-projem-2/black-eagle-app/ios/BlackEagleStaffing.xcodeproj)

Then:

1. Open the project in Xcode.
2. Select the `BlackEagleStaffing` scheme.
3. Select the `BlackEagleStaffing` target.
4. In `Signing & Capabilities`, choose your Apple Developer Team.
5. Confirm the bundle identifier is `com.blackeagle.staffing`.
6. Build with an iPhone simulator first.

## Key Project Values

- App name: `Black Eagle Staffing`
- Bundle ID: `com.blackeagle.staffing`
- Scheme: `BlackEagleStaffing`
- Xcode project path: `ios/BlackEagleStaffing.xcodeproj`
- Deployment target: `iOS 16.0`
- Start URL: `https://www.blackeagleuk.com/login.html`

## Change Website URL

Edit:

- [AppConfig.swift](/C:/Users/Kande/Documents/Codex/2026-04-18-bu-benim-mevcut-full-stack-projem-2/black-eagle-app/ios/BlackEagleStaffing/App/AppConfig.swift)

Update both:

- `initialURL`
- `allowedHosts`

## Codemagic

There is currently no `codemagic.yaml` in the repo root.

If you want Codemagic later, add a root-level `codemagic.yaml` that points to:

- project: `ios/BlackEagleStaffing.xcodeproj`
- scheme: `BlackEagleStaffing`

## App Review Notes

See:

- [AppReviewNotes.txt](/C:/Users/Kande/Documents/Codex/2026-04-18-bu-benim-mevcut-full-stack-projem-2/black-eagle-app/ios/docs/AppReviewNotes.txt)

Suggested note:

> This app is used by Black Eagle Staffing customers and staff to manage event bookings, staff applications, payments, verification and work assignments. It provides a mobile-optimised app experience and is not intended as a general website browser.

## Before Release

- Replace placeholder app icons with final branded artwork.
- Test login, uploads, permissions, redirects, and payment-related flows on a real iPhone.
- Add signing credentials before archive/TestFlight submission.
