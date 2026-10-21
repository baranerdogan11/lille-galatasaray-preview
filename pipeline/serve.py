"""Static dev server with caching disabled (python pipeline/serve.py [port])."""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    root = Path(__file__).resolve().parent.parent
    ThreadingHTTPServer(("127.0.0.1", port), partial(NoCacheHandler, directory=str(root))).serve_forever()
