# Tessera Health — iOS app

A native iPhone/iPad shell (SwiftUI + WKWebView) around the Tessera Health web prototype.
Everything is bundled inside the app, so it runs offline. All patient data is synthetic.

## Open and run

1. Open `TesseraHealth.xcodeproj` in Xcode.
2. Pick an iPhone simulator (for example "iPhone 17 Pro") in the toolbar.
3. Press Run (⌘R).

The **Sync web app** build phase copies `../tessera` into `TesseraHealth/web` on every build,
so changes to the web app show up the next time you run. You can also run `./sync-web.sh` by hand.

Command-line build for the simulator:

```bash
xcodebuild -project TesseraHealth.xcodeproj -target TesseraHealth -sdk iphonesimulator -configuration Debug SYMROOT="$PWD/build" CODE_SIGNING_ALLOWED=NO build
```

## On a real iPhone (e.g. iPhone 15 Pro)

1. Xcode › Settings › Accounts: add your Apple ID.
2. iPhone: Settings › Privacy & Security › **Developer Mode** on (restarts the phone).
3. Connect the iPhone by USB-C, unlock it and tap **Trust**.
4. Open `TesseraHealth.xcodeproj`, select the **TesseraHealth** target › **Signing & Capabilities**:
   keep "Automatically manage signing", pick your **Team**, and if Xcode says the bundle ID is
   taken, change it to something unique such as `com.<yourname>.tessera`.
5. Choose your iPhone as the run destination and press Run (⌘R).
6. First launch only: iPhone Settings › General › VPN & Device Management › your Apple ID › **Trust**,
   then open Tessera from the home screen.

A free Apple ID's install lasts 7 days (run again from Xcode to renew). TestFlight or the
App Store needs a paid Apple Developer account ($99/year): Product › Archive, then
Distribute App › TestFlight & App Store.

## How it works

- `WebContainer.swift` serves the bundled files under `tessera://app/…` through a
  `WKURLSchemeHandler`. A real origin (instead of `file://`) keeps demo data in
  localStorage between launches.
- Links to real websites open in Safari.
- In Debug builds the web view is inspectable: Safari › Develop › Simulator › Tessera.
- Fonts load from Google Fonts when online and fall back to the system font offline.

## Differences from the published web link

- **Ambient Doctor:** live dictation and the Claude-written draft use claude.ai capabilities,
  which aren't available inside the app. The app falls back to the typed/sample conversation
  and the rule-based draft.
- **Document intelligence:** extraction uses the built-in rules (text records); image
  extraction needs Claude, so use the published link for that.
