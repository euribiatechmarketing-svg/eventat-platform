#!/usr/bin/env python3
"""Content-Security-Policy check: visit the app as each role and fail on any CSP violation.

Usage:  python3 tools/csp-check.py [--base http://localhost:3602] [--as guest,client,partner,admin] [--max 200] [-v]

As each role (the seeded demo users) it opens that role's start pages and follows every same-origin
link it finds, breadth first (at most two addresses per route shape, --max pages per role), with
every frame watched by tools/csp_watch.py. It also fails on a 5xx answer, a page error, or an HTML
page served without the Content-Security-Policy header. Read-only: it only follows links, never
submits a form. Run it against a production build (`next build && next start`) on a seeded database;
tools/e2e-all.sh covers the clicks and forms (every suite runs under the same watch).
"""
import re, sys, urllib.parse
from collections import Counter, deque
from pathlib import Path
from playwright.sync_api import Error as PwError, sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
import csp_watch  # noqa: E402

args = sys.argv[1:]
opt = lambda name, default: args[args.index(name) + 1] if name in args else default
BASE = opt('--base', 'http://localhost:3602').rstrip('/')
ROLES = opt('--as', 'guest,client,partner,admin').split(',')
MAX = int(opt('--max', '200'))
VERBOSE = '-v' in args
DEMO = {'client': 'maria.dimitrova@gmail.com', 'partner': 'studio.melodia@gmail.com', 'admin': 'monika.kovacheva@eventat.bg'}
START = {
    'guest': ['/', '/tarsene', '/vhod', '/registratsiya', '/registratsiya?as=partner', '/stani-partnyor', '/zayavka/otvorena', '/nyama-takava'],
    'client': ['/tarsene', '/akaunt', '/akaunt/zayavki', '/akaunt/rezervacii', '/akaunt/saobshteniya', '/akaunt/poddrazhka', '/akaunt/nastroyki', '/akaunt/zapazeni'],
    'partner': ['/partner'],
    'admin': ['/admin', '/admin/imeyli'],
}
# Addresses that are files, not pages, or belong to another area's sign-in flow.
SKIP = re.compile(r'^/(_next|assets|photos|uploads|api/(?!invoices/))|/(eksport|spravka|otchet)/|\.(csv|pdf|png|jpe?g|webp|svg|ico)$')


def shape(path: str) -> str:
    """/akaunt/rezervacii/B-1042 and /akaunt/rezervacii/B-1043 share a shape."""
    return '/'.join(':x' if re.search(r'\d|^[0-9a-f-]{20,}$', seg) else seg for seg in path.split('/'))


def crawl(browser, role: str) -> dict:
    ctx = csp_watch.watch(browser.new_context(viewport={'width': 1440, 'height': 900}, locale='bg-BG', timezone_id='Europe/Sofia'))
    if role != 'guest':
        r = ctx.request.post(BASE + '/api/auth/sign-in/email', data={'email': DEMO[role], 'password': 'eventat-demo'}, headers={'Origin': BASE})
        assert r.ok, f'sign-in as {role} failed: {r.status}'
    page = ctx.new_page()
    errors: list[str] = []
    page.on('pageerror', lambda e: errors.append(f'{page.url}: {e}'))
    queue, seen, shapes, out = deque(START[role]), set(), Counter(), {'pages': 0, 'bad': []}
    before = len(csp_watch.VIOLATIONS)
    while queue and out['pages'] < MAX:
        url = queue.popleft()
        path = urllib.parse.urlsplit(url).path
        if url in seen or shapes[shape(path)] >= 2:
            continue
        seen.add(url); shapes[shape(path)] += 1
        try:
            res = page.goto(BASE + url, wait_until='networkidle', timeout=30000)
        except PwError as e:
            if 'Download is starting' not in str(e):
                out['bad'].append(f'{url}: {str(e).splitlines()[0]}')
            continue
        out['pages'] += 1
        status = res.status if res else 0
        html = res and 'text/html' in (res.headers.get('content-type') or '')
        if status >= 500:
            out['bad'].append(f'{url}: HTTP {status}')
        if html and not (res.headers.get('content-security-policy') or '').startswith("default-src 'self'"):
            out['bad'].append(f'{url}: no Content-Security-Policy header')
        if VERBOSE:
            print(f'    {status} {url}')
        here = urllib.parse.urlsplit(page.url)
        if here.netloc != urllib.parse.urlsplit(BASE).netloc:
            continue
        for href in page.eval_on_selector_all('a[href]', 'as => as.map(a => a.getAttribute("href"))'):
            u = urllib.parse.urlsplit(urllib.parse.urljoin(page.url, href))
            if u.scheme not in ('http', 'https') or u.netloc != here.netloc or SKIP.search(u.path):
                continue
            nxt = u.path + (f'?{u.query}' if u.query else '')
            if nxt not in seen:
                queue.append(nxt)
    out['csp'] = len(csp_watch.VIOLATIONS) - before
    out['bad'] += errors
    ctx.close()
    return out


def main():
    failed = False
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for role in ROLES:
            r = crawl(browser, role)
            failed |= bool(r['csp'] or r['bad'])
            print(f"{'FAIL' if r['csp'] or r['bad'] else 'ok  '} {role:8} {r['pages']:4} pages · {r['csp']} CSP violations · {len(r['bad'])} other problems")
            for b in r['bad'][:10]:
                print('      ' + b)
        browser.close()
    if csp_watch.VIOLATIONS:
        print(csp_watch.summary(20))
    print('DONE: ' + ('problems found' if failed else 'no CSP violations'))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
