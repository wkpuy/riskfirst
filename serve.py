import http.server

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Strip conditional GET headers so server always returns 200 (never 304)
        if 'If-Modified-Since' in self.headers:
            del self.headers['If-Modified-Since']
        if 'If-None-Match' in self.headers:
            del self.headers['If-None-Match']
        super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *a): pass

http.server.test(HandlerClass=NoCacheHandler, port=3456, bind='127.0.0.1')
