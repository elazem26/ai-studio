#!/usr/bin/env python3
"""
Run a command inside a GitHub Codespace WITHOUT the ssh binary.

How it works:
  `gh cs ssh -c NAME --stdio` speaks the raw SSH2 protocol on stdin/stdout
  (that is normally wrapped by a local ssh via ProxyCommand). We spawn that
  subprocess and hand its pipes to paramiko as a socket-like transport.

Usage:
  python3 cs-exec.py <codespace-name> <command...>
Exit code mirrors the remote command's exit code.
"""

import os
import subprocess
import sys

import paramiko

GH = "/home/z/my-project/scripts/gh-cli/bin/gh"
KEY = os.path.expanduser("~/.ssh/codespaces.auto")


class ProxyPipe:
    """Minimal socket-like adapter around a subprocess' stdin/stdout."""

    def __init__(self, proc):
        self.proc = proc

    def send(self, data):
        self.proc.stdin.write(data)
        self.proc.stdin.flush()
        return len(data)

    def recv(self, n):
        return self.proc.stdout.read1(n) if hasattr(self.proc.stdout, "read1") else self.proc.stdout.read(n)

    @property
    def closed(self):
        return self.proc.poll() is not None

    def close(self):
        try:
            self.proc.kill()
        except Exception:
            pass

    def settimeout(self, *_):
        pass

    def setsockopt(self, *_):
        pass

    def shutdown(self, *_):
        try:
            self.proc.stdin.close()
        except Exception:
            pass


def main():
    if len(sys.argv) < 3:
        print("usage: cs-exec.py <codespace> <command...>", file=sys.stderr)
        sys.exit(2)
    codespace, command = sys.argv[1], sys.argv[2:]

    proxy = subprocess.Popen(
        [GH, "cs", "ssh", "-c", codespace, "--stdio", "--", "-i", KEY],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    sock = ProxyPipe(proxy)
    transport = paramiko.Transport(sock)
    transport.start_client(timeout=60)
    try:
        transport.auth_publickey("node", paramiko.RSAKey.from_private_key_file(KEY))
    except Exception:
        # key type may differ (ed25519) — retry with auto-detect
        transport.auth_publickey("node", paramiko.Ed25519Key.from_private_key_file(KEY))

    chan = transport.open_session(timeout=60)
    # caller passes the command pre-quoted (args are joined as-is)
    chan.exec_command(" ".join(command))
    out_chunks, err_chunks = [], []
    while True:
        while chan.recv_ready():
            out_chunks.append(chan.recv(65536))
        while chan.recv_stderr_ready():
            err_chunks.append(chan.recv_stderr(65536))
        if chan.exit_status_ready() and not chan.recv_ready() and not chan.recv_stderr_ready():
            break
    code = chan.recv_exit_status()
    sys.stdout.write(b"".join(out_chunks).decode("utf-8", "replace"))
    sys.stderr.write(b"".join(err_chunks).decode("utf-8", "replace"))
    chan.close()
    transport.close()
    proxy.kill()
    sys.exit(code)


if __name__ == "__main__":
    main()
