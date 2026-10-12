#!/usr/bin/env python3
"""Run one e2e suite with every browser context it opens watched for CSP violations (tools/csp_watch.py).

Usage:  python3 tools/csp_run.py tests/e2e/<suite>.py [suite args...]
Exit code: the suite's own; 3 when the suite passed but a page broke the Content-Security-Policy.
Violations are listed at the end and, with $CSP_LOG set, appended there as JSON lines.
tools/e2e-all.sh runs every suite through this.
"""
import runpy, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import csp_watch  # noqa: E402

if len(sys.argv) < 2:
    sys.exit(__doc__)
suite = sys.argv[1]
sys.argv = sys.argv[1:]            # the suite sees its own argv
sys.path[0] = str(Path(suite).resolve().parent)
csp_watch.patch_playwright()

code = 0
try:
    runpy.run_path(suite, run_name='__main__')
except SystemExit as e:
    code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
except BaseException:
    import traceback
    traceback.print_exc()
    code = 1
if csp_watch.VIOLATIONS:
    print('CSP: ' + csp_watch.summary(), flush=True)
    code = code or 3
else:
    print('CSP: no violations', flush=True)
sys.exit(code)
