import http.server, socketserver, os
import pathlib
# tests/mobile/serve.py -> repository root is two levels up.
REPO=pathlib.Path(__file__).resolve().parents[2]
ROOT=str(REPO.parent)
MAP={'/cand/':REPO.name,'/harness/':REPO.name+'/tests/mobile'}
class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path=path.split('?',1)[0].split('#',1)[0]
        for prefix,folder in MAP.items():
            if path.startswith(prefix):
                return os.path.join(ROOT,folder,path[len(prefix):])
        return os.path.join(ROOT,REPO.name,'tests','mobile',path.lstrip('/'))
    def log_message(self,*a): pass
    def end_headers(self):
        self.send_header('Cache-Control','no-store'); super().end_headers()
socketserver.TCPServer.allow_reuse_address=True
with socketserver.TCPServer(('127.0.0.1',8899),H) as h: h.serve_forever()
