"""Serve the extension folder for dev/mock-youtube.html, with caching turned off.

Run from the project folder:  py dev/serve.py   (then open http://localhost:8765/dev/mock-youtube.html?v=demo123)
"""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"Serving on http://localhost:{port}/dev/mock-youtube.html?v=demo123")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
