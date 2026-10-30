#!/usr/bin/env python3
"""彩田公园 3D 高斯 Demo 本地服务器（禁用缓存，避免改动后看到旧版本）

用法：  python3 serve.py [端口]      默认 4173
然后打开 http://127.0.0.1:4173/index.html
"""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4173


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


class Server(socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("", PORT), Handler) as httpd:
        print(f"彩田公园 Demo 已启动： http://127.0.0.1:{PORT}/index.html")
        print("（已禁用缓存，改代码后刷新即可看到最新效果；Ctrl+C 退出）")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已退出")
