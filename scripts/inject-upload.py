#!/usr/bin/env python3
"""Inject a local image file into the Nth file input of the page and fire
a native change event (b64 payload via DataTransfer)."""
import base64
import json
import subprocess
import sys

def inject(path: str, nth: int):
    b64 = base64.b64encode(open(path, "rb").read()).decode()
    mime = "image/jpeg" if path.lower().endswith((".jpg", ".jpeg")) else "image/png"
    js = f"""
(async () => {{
  const b64 = "{b64}";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const file = new File([arr], "up_{nth}.jpg", {{ type: "{mime}" }});
  const dt = new DataTransfer();
  dt.items.add(file);
  const inputs = Array.from(document.querySelectorAll('input[type=file]'));
  const inp = inputs[{nth}];
  if (!inp) return "NO_INPUT";
  inp.files = dt.files;
  inp.dispatchEvent(new Event("change", {{ bubbles: true }}));
  return "INJECTED " + dt.files.length + " files -> input {nth}";
}})()
"""
    r = subprocess.run(
        ["agent-browser", "eval", js],
        capture_output=True, text=True, timeout=120,
    )
    return (r.stdout + r.stderr).strip()

if __name__ == "__main__":
    print(inject(sys.argv[1], int(sys.argv[2])))
