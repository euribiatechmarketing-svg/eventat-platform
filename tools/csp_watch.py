"""Content-Security-Policy violation watch for Playwright (used by tools/csp_run.py and tools/csp-check.py).

watch(context) makes a browser context report every CSP violation its pages (and their frames) hit:
the page's own `securitypolicyviolation` event, and Chromium's console messages for what never reaches
the page (a frame refused by frame-ancestors / X-Frame-Options). Reports collect in VIOLATIONS and,
when $CSP_LOG is set, are appended to that file as JSON lines.
"""
import json, os

MARK = 'CSP-VIOLATION '
INIT = """(() => {
  if (window.__cspWatch) return; window.__cspWatch = true;
  document.addEventListener('securitypolicyviolation', e => console.error(%r + JSON.stringify({
    directive: e.effectiveDirective || e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile,
    line: e.lineNumber, sample: e.sample, page: location.href })), true);
})();""" % MARK
BROWSER_TEXT = ('Content Security Policy', "'X-Frame-Options'", 'Refused to frame', 'Refused to display')

VIOLATIONS: list[dict] = []


def _record(v: dict):
    VIOLATIONS.append(v)
    path = os.environ.get('CSP_LOG')
    if path:
        with open(path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(v, ensure_ascii=False) + '\n')


def _on_console(msg):
    text = msg.text
    page = msg.page.url if msg.page else ''
    if text.startswith(MARK):
        try:
            v = json.loads(text[len(MARK):])
        except ValueError:
            v = {'raw': text}
        _record({'kind': 'event', **v})
    elif any(t in text for t in BROWSER_TEXT):
        _record({'kind': 'console', 'text': text[:400], 'page': page})


def watch(context):
    """Arm one Playwright (sync) BrowserContext; returns it."""
    context.add_init_script(script=INIT)
    context.on('console', _on_console)
    return context


def patch_playwright():
    """Arm every context any later sync-API code opens (Browser.new_context / new_page, persistent contexts)."""
    from playwright.sync_api._generated import Browser, BrowserType

    new_context, new_page, persistent = Browser.new_context, Browser.new_page, BrowserType.launch_persistent_context

    def _new_context(self, *a, **k):
        return watch(new_context(self, *a, **k))

    def _new_page(self, *a, **k):
        page = new_page(self, *a, **k)
        watch(page.context)
        return page

    def _persistent(self, *a, **k):
        return watch(persistent(self, *a, **k))

    Browser.new_context, Browser.new_page, BrowserType.launch_persistent_context = _new_context, _new_page, _persistent


def summary(limit: int = 8) -> str:
    seen, lines = set(), []
    for v in VIOLATIONS:
        key = (v.get('directive'), v.get('blocked'), v.get('text'))
        if key in seen:
            continue
        seen.add(key)
        lines.append('  ' + (f"{v.get('directive')} blocked {v.get('blocked')!r} on {v.get('page')}" if v.get('kind') == 'event' else f"{v.get('text')} ({v.get('page')})"))
    more = f'\n  … {len(lines) - limit} more' if len(lines) > limit else ''
    return f'{len(VIOLATIONS)} CSP violation(s), {len(lines)} distinct:\n' + '\n'.join(lines[:limit]) + more
