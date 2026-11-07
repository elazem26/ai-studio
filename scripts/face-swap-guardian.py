#!/home/z/.venv/bin/python3
"""
Project guardian — keeps BOTH services alive (v2, 2026-11-02).

Why v2: the sandbox/platform can silently kill the Next.js web server
(port 3000) between sessions or on OOM. The user then opens the preview
from the phone and sees a blank screen (المعاينة لا تعمل) with no way to
recover, because /repair itself needs the web server up. This guardian is
a long-lived Python process that survives session recycles, so it watches:

  1. face-swap micro-service (port 3030) — spawn server.py if dead
  2. Next.js web server (port 3000)      — run scripts/start-production.sh
                                           (guard + build-integrity + standalone)
                                           if dead

It never touches a healthy service: it only acts when the port is closed,
so restarts are safe while the user is working.

Run: nohup python3 scripts/face-swap-guardian.py &  (spawned automatically
by src/instrumentation-node.ts when the web server boots.)
"""

import fcntl
import json
import os
import socket
import subprocess
import sys
import time

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG_FILE = os.path.join(PROJECT, "data", "guardian.log")
STATE_FILE = os.path.join(PROJECT, "data", "guardian-state.json")
LOCK_FILE = os.path.join(PROJECT, "data", "guardian.lock")
PYTHON = "/home/z/.venv/bin/python3" if os.path.exists("/home/z/.venv/bin/python3") else "python3"
CHECK_INTERVAL = 15          # seconds between health checks
RESTART_COOLDOWN = 60        # min seconds between two restarts of the same target

MAX_LOG_BYTES = 512 * 1024


def log(msg: str) -> None:
    line = time.strftime("%Y-%m-%d %H:%M:%S ") + msg
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) > MAX_LOG_BYTES:
            os.replace(LOG_FILE, LOG_FILE + ".old")
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass
    print(line, flush=True)


def port_open(port: int, host: str = "127.0.0.1", timeout: float = 2.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def acquire_single_instance():
    """Exclusive flock on data/guardian.lock — atomic, no pgrep guessing.
    Returns a lock fd (truthy) if we own the single instance, None if another
    guardian already runs. On fs failure we run anyway (better two guardians
    than zero) and return -1."""
    try:
        os.makedirs(os.path.dirname(LOCK_FILE), exist_ok=True)
        fd = os.open(LOCK_FILE, os.O_CREAT | os.O_RDWR, 0o644)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(fd)
            return None
        os.truncate(fd, 0)
        os.write(fd, str(os.getpid()).encode())
        return fd  # keep open for the process lifetime = lock held
    except Exception:
        return -1


def save_state(target: str, action: str) -> None:
    try:
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        state = {"time": time.time(), "target": target, "action": action}
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f)
    except Exception:
        pass


def spawn_detached(cmd, cwd: str = PROJECT, log_path: str | None = None):
    kwargs = dict(
        cwd=cwd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        start_new_session=True,  # setsid — survive parent death
    )
    if log_path:
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        lf = open(log_path, "ab", buffering=0)
        kwargs["stdout"] = lf
        kwargs["stderr"] = lf
    proc = subprocess.Popen(cmd, **kwargs)
    try:
        proc.wait(timeout=0.1)
    except subprocess.TimeoutExpired:
        pass
    return proc.pid


def restart_face_swap(reason: str) -> None:
    script = os.path.join(PROJECT, "mini-services", "face-swap-pro", "server.py")
    log(f"[face-swap] down ({reason}) — spawning server.py")
    spawn_detached([PYTHON, script], log_path="/tmp/face-swap-pro.log")
    save_state("face-swap", "restart")


def restart_object_remover(reason: str) -> None:
    script = os.path.join(PROJECT, "mini-services", "object-remover", "server.py")
    log(f"[object-remover] down ({reason}) — spawning server.py")
    spawn_detached([PYTHON, script], log_path="/tmp/object-remover.log")
    save_state("object-remover", "restart")


def restart_web(reason: str) -> None:
    script = os.path.join(PROJECT, "scripts", "start-production.sh")
    if not os.path.exists(script):
        log(f"[web] start-production.sh missing! ({reason})")
        return
    log(f"[web] down ({reason}) — running start-production.sh")
    # start-production.sh ends with `exec bun server.js`, so it keeps running
    # as the web server itself. Logs go to data/web-restart.log.
    spawn_detached(
        ["bash", script],
        log_path=os.path.join(PROJECT, "data", "web-restart.log"),
    )
    save_state("web", "restart")


def wait_for_port(port: int, timeout_s: int, label: str) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if port_open(port):
            log(f"[{label}] back up ✓ (port {port})")
            return
        time.sleep(2)
    log(f"[{label}] still down after {timeout_s}s — will retry next cycle")


def main() -> None:
    lock = acquire_single_instance()
    if lock is None:
        log("another guardian holds the lock — exiting")
        sys.exit(0)

    log(f"guardian v3 started (pid {os.getpid()}, lock={'flock' if lock > 0 else 'unlocked-fallback'}) — watching :3000, :3030 and :3031 every {CHECK_INTERVAL}s")

    last_restart = {"web": 0.0, "face-swap": 0.0, "object-remover": 0.0}

    while True:
        try:
            now = time.time()

            # ---- 1. Next.js web server (the preview itself) ----
            if not port_open(3000):
                if now - last_restart["web"] >= RESTART_COOLDOWN:
                    last_restart["web"] = now
                    restart_web("port 3000 closed")
                    wait_for_port(3000, 180, "web")
            else:
                last_restart["web"] = 0.0  # healthy → reset cooldown lock

            # ---- 2. face-swap micro-service ----
            if not port_open(3030):
                if now - last_restart["face-swap"] >= RESTART_COOLDOWN:
                    last_restart["face-swap"] = now
                    restart_face_swap("port 3030 closed")
                    wait_for_port(3030, 90, "face-swap")
            else:
                last_restart["face-swap"] = 0.0

            # ---- 3. object-remover micro-service (LaMa inpainting) ----
            if not port_open(3031):
                if now - last_restart["object-remover"] >= RESTART_COOLDOWN:
                    last_restart["object-remover"] = now
                    restart_object_remover("port 3031 closed")
                    wait_for_port(3031, 90, "object-remover")
            else:
                last_restart["object-remover"] = 0.0

        except Exception as e:  # never die
            try:
                log(f"guardian loop error: {e}")
            except Exception:
                pass

        time.sleep(CHECK_INTERVAL)


if __name__ == "__main__":
    main()
