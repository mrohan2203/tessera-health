import SwiftUI
import WebKit
import UniformTypeIdentifiers

/// Serves the bundled `web/` folder under `tessera://app/…`.
/// A custom scheme (rather than file://) gives the page a stable origin, so
/// localStorage persists between launches and fetch() of bundled files works.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL

    init(root: URL) { self.root = root.standardizedFileURL }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        // Never serve anything outside the bundled web folder.
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let textual = mime.hasPrefix("text/") || mime.contains("javascript") || mime.contains("json")
        let headers = [
            "Content-Type": textual ? "\(mime); charset=utf-8" : mime,
            "Cache-Control": "no-store"
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.badServerResponse))
            return
        }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

struct WebContainer: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        if let root = Bundle.main.url(forResource: "web", withExtension: nil) {
            config.setURLSchemeHandler(BundleSchemeHandler(root: root), forURLScheme: "tessera")
        }
        config.websiteDataStore = .default()   // keeps demo data between launches
        config.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.008, green: 0.059, blue: 0.035, alpha: 1)  // entry green #020f09
        webView.scrollView.backgroundColor = webView.backgroundColor
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }   // Safari › Develop › Simulator
        #endif
        if let url = URL(string: "tessera://app/index.html") {
            webView.load(URLRequest(url: url))
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        /// Links to real websites open in Safari; everything else stays in the app.
        func webView(_ webView: WKWebView,
                     decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if let url = action.request.url,
               ["http", "https", "mailto", "tel"].contains(url.scheme ?? ""),
               action.navigationType == .linkActivated {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}
