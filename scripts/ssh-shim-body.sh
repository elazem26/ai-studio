#!/bin/bash
# passthrough ssh shim: forward to gh cs ssh when used interactively
echo "ssh shim: use cs-exec.py (scripts/cs-exec.py)" >&2
exit 127
