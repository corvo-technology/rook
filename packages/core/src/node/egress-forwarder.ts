/**
 * Runs inside a computer, on 127.0.0.1, so Chromium can use an HTTP proxy without credentials.
 * Each CONNECT (or plain HTTP request) becomes one WebSocket to the Rook egress gateway, which
 * carries the bot's capability as a bearer token. The provider's own credential never reaches
 * the computer: the gateway adds it on its side. Standard library only, like the other helpers
 * that ship into a computer.
 *
 * argv: <conf.json> <port-file>. The conf holds {"gateway": "wss://…", "capability": "…"} and is
 * read on every tunnel, so a refreshed capability takes effect without a restart.
 */
export const EGRESS_FORWARDER_PROGRAM = String.raw`import base64, json, os, socket, ssl, struct, sys, threading
from urllib.parse import quote, urlsplit

CONF, PORT_FILE = sys.argv[1], sys.argv[2]
TEXT = {400: "Bad Request", 402: "Payment Required", 403: "Forbidden", 502: "Bad Gateway"}
BODY = {402: "Browser egress credits are used up. Add credits in Billing."}


class Refused(Exception):
    def __init__(self, status, code):
        Exception.__init__(self, status)
        self.status, self.code = status, code


class WS(object):
    def __init__(self, sock, pending):
        self.sock, self.buf, self.lock = sock, bytearray(pending), threading.Lock()

    def take(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise EOFError()
            self.buf += chunk
        out = bytes(self.buf[:n])
        del self.buf[:n]
        return out

    def send(self, opcode, data=b""):
        n = len(data)
        head = bytearray([0x80 | opcode])
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head.append(0x80 | 126)
            head += struct.pack(">H", n)
        else:
            head.append(0x80 | 127)
            head += struct.pack(">Q", n)
        mask = os.urandom(4)
        head += mask
        if n:
            data = (int.from_bytes(data, "big") ^ int.from_bytes((mask * (n // 4 + 1))[:n], "big")).to_bytes(n, "big")
        with self.lock:
            self.sock.sendall(bytes(head) + data)

    def recv(self):
        while True:
            b0, b1 = self.take(2)
            opcode, n = b0 & 0x0F, b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self.take(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self.take(8))[0]
            mask = self.take(4) if b1 & 0x80 else None
            data = self.take(n)
            if mask and n:
                data = (int.from_bytes(data, "big") ^ int.from_bytes((mask * (n // 4 + 1))[:n], "big")).to_bytes(n, "big")
            if opcode in (0, 1, 2):
                return data
            if opcode == 8:
                return None
            if opcode == 9:
                self.send(10, data)


def open_tunnel(host, port):
    with open(CONF) as source:
        conf = json.load(source)
    url = urlsplit(conf["gateway"])
    secure = url.scheme == "wss"
    sock = socket.create_connection((url.hostname, url.port or (443 if secure else 80)), timeout=30)
    if secure:
        sock = ssl.create_default_context().wrap_socket(sock, server_hostname=url.hostname)
    request = "GET %s?host=%s&port=%d HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\nAuthorization: Bearer %s\r\n\r\n" % (
        url.path or "/", quote(host, safe=""), port, url.netloc, base64.b64encode(os.urandom(16)).decode(), conf["capability"])
    sock.sendall(request.encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = sock.recv(4096)
        if not chunk or len(buf) > 16384:
            raise Refused(502, "")
        buf += chunk
    head, _, rest = buf.partition(b"\r\n\r\n")
    lines = head.decode("latin1").split("\r\n")
    status = int(lines[0].split(" ", 2)[1])
    if status != 101:
        code = ""
        for line in lines[1:]:
            if line.lower().startswith("x-corvo-egress-error:"):
                code = line.split(":", 1)[1].strip()
        sock.close()
        raise Refused(status if status in TEXT else 502, code)
    sock.settimeout(None)
    return WS(sock, rest)


def relay(client, ws, early=b""):
    def up():
        try:
            if early:
                ws.send(2, early)
            while True:
                data = client.recv(16384)
                if not data:
                    break
                ws.send(2, data)
        except Exception:
            pass
        try:
            ws.send(8, b"")
        except Exception:
            pass

    threading.Thread(target=up, daemon=True).start()
    try:
        while True:
            data = ws.recv()
            if data is None:
                break
            client.sendall(data)
    except Exception:
        pass
    for sock in (client, ws.sock):
        try:
            sock.close()
        except Exception:
            pass


def reply(client, status, code=""):
    body = BODY.get(status, TEXT.get(status, "Bad Gateway")).encode()
    client.sendall(("HTTP/1.1 %d %s\r\nContent-Type: text/plain\r\nX-Corvo-Egress-Error: %s\r\nConnection: close\r\nContent-Length: %d\r\n\r\n" % (
        status, TEXT.get(status, "Bad Gateway"), code, len(body))).encode() + body)


def handle(client):
    try:
        client.settimeout(30)
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = client.recv(8192)
            if not chunk or len(buf) > 65536:
                return
            buf += chunk
        client.settimeout(None)
        head, _, rest = buf.partition(b"\r\n\r\n")
        lines = head.decode("latin1").split("\r\n")
        method, target, version = lines[0].split(" ", 2)
        if method.upper() == "CONNECT":
            host, _, port = target.rpartition(":")
            ws = open_tunnel(host.strip("[]"), int(port))
            client.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            relay(client, ws, rest)
            return
        url = urlsplit(target)
        if url.scheme != "http" or not url.hostname:
            return reply(client, 400)
        skip = ("proxy-connection", "proxy-authorization", "connection", "keep-alive")
        out = "%s %s%s %s\r\n" % (method, url.path or "/", "?" + url.query if url.query else "", version)
        out += "".join(line + "\r\n" for line in lines[1:] if line.split(":", 1)[0].lower() not in skip)
        out += "Connection: close\r\n\r\n"
        ws = open_tunnel(url.hostname, url.port or 80)
        relay(client, ws, out.encode("latin1") + rest)
    except Refused as refused:
        try:
            reply(client, refused.status, refused.code)
        except Exception:
            pass
    except Exception:
        try:
            reply(client, 502)
        except Exception:
            pass
    finally:
        try:
            client.close()
        except Exception:
            pass


server = socket.socket()
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("127.0.0.1", 0))
server.listen(128)
with open(PORT_FILE + ".tmp", "w") as target:
    target.write(str(server.getsockname()[1]))
os.replace(PORT_FILE + ".tmp", PORT_FILE)
while True:
    connection, _ = server.accept()
    threading.Thread(target=handle, args=(connection,), daemon=True).start()
`;
