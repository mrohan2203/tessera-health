import SwiftUI

/// Tessera Health — native iOS shell for the web prototype.
/// The whole app (HTML, CSS, JS, synthetic data) is bundled in `web/` and served
/// from inside the app, so it runs fully offline. No patient data is real.
@main
struct TesseraHealthApp: App {
    var body: some Scene {
        WindowGroup {
            WebContainer()
                .ignoresSafeArea()   // the web app handles safe areas itself (viewport-fit=cover + env())
                .background(Color(red: 0.008, green: 0.059, blue: 0.035))
        }
    }
}
