"""Private LAN-only HTTPS preview. No system trust changes or public tunnel.
Only static landing assets are served; TLS keys stay outside the repository.
"""
import argparse,ipaddress,os,ssl,subprocess,tempfile,shutil
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlsplit,unquote
ROOT=Path(__file__).resolve().parent
OPENSSL=Path(r"C:\Program Files\Git\usr\bin\openssl.exe")
STATE=Path(os.environ["LOCALAPPDATA"])/"LetsCelebrateDevTLS"
PUBLIC=ROOT/"letscelebrate-dev-ca.crt"
def certs(ip):
    STATE.mkdir(exist_ok=True)
    ca=STATE/"ca.crt";cert=STATE/"server.crt";key=STATE/"server.key"
    marker=STATE/"host.txt"
    if not (ca.is_file() and cert.is_file() and key.is_file() and marker.is_file() and marker.read_text()==ip):
        if any(x.exists() for x in (ca,cert,key,marker)):raise RuntimeError("Existing development TLS state differs; do not overwrite trusted certificates")
        with tempfile.TemporaryDirectory(dir=STATE) as tmp:
            p=Path(tmp)
            def run(*args):subprocess.run([str(OPENSSL),*args],cwd=p,check=True,capture_output=True,creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
            run("req","-x509","-newkey","rsa:2048","-nodes","-days","7","-subj","/CN=LetsCelebrate temporary LAN preview CA","-addext","basicConstraints=critical,CA:TRUE,pathlen:0","-addext","keyUsage=critical,keyCertSign,cRLSign","-keyout","ca.key","-out","ca.crt")
            run("req","-new","-newkey","rsa:2048","-nodes","-subj","/CN="+ip,"-keyout","server.key","-out","server.csr")
            (p/"server.ext").write_text("basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:"+ip+"\n")
            run("x509","-req","-in","server.csr","-CA","ca.crt","-CAkey","ca.key","-CAcreateserial","-days","7","-sha256","-extfile","server.ext","-out","server.crt")
            for f in ("ca.crt","server.crt","server.key"):shutil.copyfile(p/f,STATE/f)
        # The CA private signing key is never retained or served.
        marker.write_text(ip)
    subprocess.run([str(OPENSSL),"verify","-CAfile",str(ca),"-verify_ip",ip,str(cert)],check=True)
    subprocess.run([str(OPENSSL),"x509","-in",str(ca),"-noout","-fingerprint","-sha256"],check=True)
    if PUBLIC.exists() and PUBLIC.read_bytes()!=ca.read_bytes():raise RuntimeError("Public certificate mismatch")
    if not PUBLIC.exists():PUBLIC.write_bytes(ca.read_bytes())
    return cert,key
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def allowed(self):
        parts=unquote(urlsplit(self.path).path).split("/")
        if any(x in {".",".."} or x.startswith(".") or "\\" in x for x in parts):return False
        p=ROOT.joinpath(*[x for x in parts if x])
        if p==ROOT:return True
        if not p.resolve().is_relative_to(ROOT.resolve()):return False
        return p.is_file() and (p==ROOT/"index.html" or parts[1] in {"assets","css","fonts","js"})
    def do_GET(self):
        if not self.allowed():self.send_error(404);return
        super().do_GET()
    def do_HEAD(self):
        if not self.allowed():self.send_error(404);return
        super().do_HEAD()
    def list_directory(self,path):self.send_error(404);return None
    def end_headers(self):
        self.send_header("Cache-Control","no-store")
        self.send_header("Permissions-Policy","accelerometer=(self), gyroscope=(self), magnetometer=(self)")
        super().end_headers()
def main():
    ap=argparse.ArgumentParser();ap.add_argument("--host",required=True);ap.add_argument("--port",type=int,default=8443);a=ap.parse_args()
    ip=ipaddress.ip_address(a.host)
    if ip.version!=4 or not ip.is_private or ip.is_loopback:raise ValueError("A private LAN IPv4 address is required")
    cert,key=certs(str(ip));ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.minimum_version=ssl.TLSVersion.TLSv1_2;ctx.load_cert_chain(cert,key)
    with ThreadingHTTPServer((str(ip),a.port),Handler) as server:
        server.socket=ctx.wrap_socket(server.socket,server_side=True)
        print(f"LAN HTTPS preview https://{ip}:{a.port}/",flush=True)
        server.serve_forever()
if __name__=="__main__":main()
