#!/usr/bin/env python3
"""Screenshot app pages at desktop and phone widths.

Usage: python3 tools/shoot.py OUTDIR /path [/path ...] [--base http://localhost:3000]
       [--as client|partner|admin] [--full] [--mobile-only|--desktop-only]
Signs in as a seeded demo user first when --as is given (see scripts/seed.ts).
Prints console errors and failed requests for each page.
--bypass adds Vercel's protection-bypass header for a protected staging site (secret from $VERCEL_BYPASS or
~/.vercel-euribia/staging-bypass; never stored in the repo).
"""
import os, sys
from playwright.sync_api import sync_playwright

DEMO = {
    'client': ('maria.dimitrova@gmail.com', 'eventat-demo'),
    'partner': ('studio.melodia@gmail.com', 'eventat-demo'),
    'admin': ('monika.kovacheva@eventat.bg', 'eventat-demo'),
}

def main():
    args = sys.argv[1:]
    base = 'http://localhost:3000'
    who = None; full = False; sizes = [('desktop', 1440, 900), ('mobile', 390, 844)]
    if '--base' in args: i = args.index('--base'); base = args[i + 1]; del args[i:i + 2]
    if '--as' in args: i = args.index('--as'); who = args[i + 1]; del args[i:i + 2]
    if '--full' in args: args.remove('--full'); full = True
    if '--mobile-only' in args: args.remove('--mobile-only'); sizes = sizes[1:]
    if '--desktop-only' in args: args.remove('--desktop-only'); sizes = sizes[:1]
    headers = {}
    if '--bypass' in args:
        args.remove('--bypass')
        secret = os.environ.get('VERCEL_BYPASS') or open(os.path.expanduser('~/.vercel-euribia/staging-bypass')).read().strip()
        headers = {'x-vercel-protection-bypass': secret, 'x-vercel-set-bypass-cookie': 'true'}
    out, paths = args[0], args[1:]
    os.makedirs(out, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, w, h in sizes:
            ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, locale='bg-BG', timezone_id='Europe/Sofia', extra_http_headers=headers)
            page = ctx.new_page()
            errs = []
            page.on('console', lambda m: errs.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
            page.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
            page.on('response', lambda r: errs.append(f'HTTP {r.status} {r.url}') if r.status >= 400 else None)
            if who:
                email, pw = DEMO[who]
                r = page.request.post(base + '/api/auth/sign-in/email', data={'email': email, 'password': pw}, headers={'Origin': base})
                if not r.ok: print('sign-in failed', r.status, r.text()[:200])
            for path in paths:
                errs.clear()
                page.goto(base + path, wait_until='networkidle')
                fn = os.path.join(out, f"{name}-{path.strip('/').replace('/', '_').replace('?', '_') or 'home'}.png")
                page.screenshot(path=fn, full_page=full)
                print(fn, '| final URL', page.url.replace(base, ''), '|', '; '.join(errs) or 'no errors')
            ctx.close()
        b.close()

if __name__ == '__main__':
    main()
