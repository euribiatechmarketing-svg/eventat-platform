#!/usr/bin/env python3
"""Automated accessibility check (axe-core, WCAG 2.2 AA) of app pages at desktop and phone widths.

Usage:
  python3 tools/a11y.py [--base http://localhost:3000] [--set site] [--as guest|client|partner|admin]
                        [--desktop-only|--mobile-only] [--best-practice] [--json OUT.json] [--quiet] [/path ...]

  --set NAME      run a named route set (see SETS below; default `site` when no paths are given).
  --as ROLE       sign in as a seeded demo user for the paths given on the command line (default guest).
  /path ...       check only these paths (as --as).
  --best-practice also run axe's best-practice rules (heading order, landmarks, …), reported apart.
  --json OUT      write every result (route, role, width, violations) to OUT.
  --quiet         print only the per-rule summary.

Needs `npm i -D axe-core@4` (node_modules/axe-core/axe.min.js) and Python Playwright, and the app
running against a freshly seeded database (npm run db:reset && npm run db:seed).
A route may carry steps (click / press / fill / wait) that open a menu, panel or dialog before axe runs,
so the open states are checked too. Exit code: 1 when any WCAG violation is found.
"""
import json, sys
from collections import Counter, defaultdict
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
AXE = ROOT / 'node_modules' / 'axe-core' / 'axe.min.js'
DEMO = {
    'client': ('maria.dimitrova@gmail.com', 'eventat-demo'),
    'partner': ('studio.melodia@gmail.com', 'eventat-demo'),
    'admin': ('monika.kovacheva@eventat.bg', 'eventat-demo'),
}
WIDTHS = [('desktop', 1440, 900), ('mobile', 390, 844)]
WCAG = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']

# A route: (path, role, label, steps). `pick:<list path>|<css>` opens the first matching link of a list page.
# Steps: ('click', css) · ('press', key) · ('fill', css, text) · ('wait', ms).
SETS: dict[str, list[tuple]] = {
    # The public site and the client's account and booking flow: everything under app/(site).
    'site': [
        ('/', 'guest', '', []),
        ('/kategorii', 'guest', '', []),
        ('/kategorii/zali-i-lokatsii', 'guest', '', []),
        ('/tarsene', 'guest', '', []),
        ('/tarsene?q=%D0%B4%D0%B6%D0%B5%D0%B9', 'guest', 'query', []),
        ('/tarsene', 'guest', 'suggestions', [('click', '.searchbar [role="combobox"]'), ('wait', 800)]),
        ('/tarsene', 'guest', 'location menu', [('click', '.searchbar .sb-cell[role="button"]'), ('wait', 200)]),
        ('/tarsene?data=2026-06-14&druga-data=1', 'guest', 'busy cards', []),
        ('/tarsene?data=2026-06-14&druga-data=1', 'guest', 'sort menu', [('click', '.pub-sort [role="button"]'), ('wait', 200)]),
        ('/kategorii', 'guest', 'city menu', [('click', '.h-right [role="button"]'), ('wait', 200)]),
        ('/sabitiya/svatba', 'guest', '', []),
        ('/partnyori/studio-melodiya', 'guest', '', []),
        ('/kak-raboti', 'guest', '', []),
        ('/stani-partnyor', 'guest', '', []),
        ('/pravila', 'guest', '', []),
        ('/vhod', 'guest', '', []),
        ('/vhod', 'guest', 'errors', [('click', 'form button[type=submit]'), ('wait', 400)]),
        ('/vhod/nova-parola', 'guest', '', []),
        ('/vhod/kod', 'guest', '', []),
        ('/registratsiya', 'guest', '', []),
        ('/registratsiya', 'guest', 'errors', [('click', 'form button[type=submit]'), ('wait', 400)]),
        ('/potvarzhdenie', 'guest', '', []),
        ('/nyama-takava-stranitsa', 'guest', '404', []),
        ('/', 'client', '', []),
        ('/', 'client', 'account menu', [('click', '.nav-user'), ('wait', 200)]),
        ('/', 'client', 'bell', [('click', 'button[aria-label="Известия"]'), ('wait', 200)]),
        ('/partnyori/studio-melodiya', 'client', '', []),
        ('/zayavka/studio-melodiya', 'client', '', []),
        ('/zayavka/otvorena', 'client', '', []),
        ('/akaunt/zayavki', 'client', '', []),
        ('/akaunt/zayavki', 'client', 'status filter', [('click', 'button.filter-btn >> nth=1'), ('wait', 200)]),
        ('/akaunt/zayavki/2026-0614-ДК', 'client', 'pending', []),
        ('/akaunt/zayavki/2026-0614-ФТ', 'client', 'declined', []),
        ('/akaunt/zayavki/2026-1219-ДК', 'client', 'approved', []),
        ('/akaunt/rezervacii', 'client', '', []),
        ('/akaunt/rezervacii/2026-0614-МЗ', 'client', 'confirmed', []),
        ('/akaunt/rezervacii/2026-1219-ДК', 'client', 'awaiting payment', []),
        ('/akaunt/rezervacii/2025-0424-СЛ', 'client', 'completed', []),
        ('/akaunt/rezervacii/2026-0614-МЗ/anulirane', 'client', '', []),
        ('/akaunt/rezervacii/2026-0614-МЗ/faktura', 'client', '', []),
        ('/akaunt/rezervacii/2025-0424-СЛ/revyu', 'client', '', []),
        ('/plashtane/2026-1219-ДК', 'client', '', []),
        ('/akaunt/saobshteniya', 'client', '', []),
        ('pick:/akaunt/saobshteniya|a[href^="/akaunt/saobshteniya/"]', 'client', 'thread', []),
        ('/akaunt/poddrazhka', 'client', '', []),
        ('/akaunt/poddrazhka/nov', 'client', '', []),
        ('pick:/akaunt/poddrazhka|a[href^="/akaunt/poddrazhka/"]:not([href$="/nov"])', 'client', 'case', []),
        ('/akaunt/sabitiya', 'client', '', []),
        ('pick:/akaunt/sabitiya|a[href^="/akaunt/sabitiya/"]', 'client', 'event', []),
        ('/akaunt/zapazeni', 'client', '', []),
        ('/akaunt/nastroyki', 'client', '', []),
        ('/akaunt/nastroyki/imeyl', 'client', '', []),
        ('/akaunt/iztrivane', 'client', '', []),
    ],
}


def sign_in(ctx, base: str, role: str):
    if role == 'guest':
        return
    email, pw = DEMO[role]
    r = ctx.request.post(base + '/api/auth/sign-in/email', data={'email': email, 'password': pw}, headers={'Origin': base})
    if not r.ok:
        raise SystemExit(f'sign-in {role} failed: {r.status} {r.text()[:200]}')


def run_steps(page, steps):
    for s in steps:
        if s[0] == 'click':
            page.locator(s[1]).first.click()
        elif s[0] == 'press':
            page.keyboard.press(s[1])
        elif s[0] == 'fill':
            page.locator(s[1]).first.fill(s[2])
        elif s[0] == 'wait':
            page.wait_for_timeout(s[1])


def axe(page, src: str, tags: list[str]):
    if not page.evaluate('() => !!window.axe'):
        page.add_script_tag(content=src)
    return page.evaluate(
        """async (tags) => {
            const r = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
            return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, tags: v.tags,
                nodes: v.nodes.map(n => ({ target: n.target.join(' '), summary: n.failureSummary, html: n.html.slice(0, 160) })) }));
        }""", tags)


def main():
    args = sys.argv[1:]
    base, role, set_name, out_json = 'http://localhost:3000', 'guest', None, None
    widths, best, quiet = WIDTHS, False, False
    def opt(name):
        i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    if '--base' in args: base = opt('--base').rstrip('/')
    if '--as' in args: role = opt('--as')
    if '--set' in args: set_name = opt('--set')
    if '--json' in args: out_json = opt('--json')
    if '--desktop-only' in args: args.remove('--desktop-only'); widths = WIDTHS[:1]
    if '--mobile-only' in args: args.remove('--mobile-only'); widths = WIDTHS[1:]
    if '--best-practice' in args: args.remove('--best-practice'); best = True
    if '--quiet' in args: args.remove('--quiet'); quiet = True
    routes = [(p, role, '', []) for p in args] if args else SETS[set_name or 'site']
    if not AXE.exists():
        raise SystemExit('axe-core missing: npm i -D axe-core@4')
    src = AXE.read_text()
    tags = WCAG + (['best-practice'] if best else [])

    results = []
    by_rule: dict[str, Counter] = defaultdict(Counter)   # rule → {'nodes': n, 'pages': n}
    impact: dict[str, str] = {}
    helps: dict[str, str] = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for wname, w, h in widths:
            ctxs = {}
            for path, who, label, steps in routes:
                if who not in ctxs:
                    ctxs[who] = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1,
                                                    locale='bg-BG', timezone_id='Europe/Sofia', bypass_csp=True)
                    sign_in(ctxs[who], base, who)
                page = ctxs[who].new_page()
                try:
                    if path.startswith('pick:'):
                        lst, css = path[5:].split('|', 1)
                        page.goto(base + lst, wait_until='networkidle')
                        href = page.locator(css).first.get_attribute('href')
                        path = href
                    page.goto(base + path, wait_until='networkidle')
                    run_steps(page, steps)
                    vs = axe(page, src, tags)
                except Exception as e:  # a broken route is a finding too
                    print(f'!! [{who} {w}] {path} {label}: {e}'.strip())
                    page.close(); continue
                final = page.url.replace(base, '')
                page.close()
                results.append({'path': path, 'final': final, 'role': who, 'width': w, 'label': label, 'violations': vs})
                head = f"== [{who} {w}] {path}{' · ' + label if label else ''}{'  → ' + final if final != path and final.split('?')[0] != path.split('?')[0] else ''}"
                if not quiet:
                    print(head + ('' if vs else '  — no violations'))
                for v in vs:
                    bp = 'best-practice' in v['tags'] and not any(t in v['tags'] for t in WCAG)
                    key = ('bp:' if bp else '') + v['id']
                    by_rule[key]['nodes'] += len(v['nodes']); by_rule[key]['pages'] += 1
                    impact[key] = v['impact'] or ''; helps[key] = v['help']
                    if quiet:
                        continue
                    print(f"   {'(bp) ' if bp else ''}{v['id']} [{v['impact']}] — {v['help']}")
                    for n in v['nodes'][:8]:
                        print(f"      {n['target']}")
                    if len(v['nodes']) > 8:
                        print(f"      … {len(v['nodes']) - 8} more")
            for c in ctxs.values():
                c.close()
        browser.close()

    print('\n=== summary (rule: nodes / page-states) ===')
    wcag_total = 0
    for key in sorted(by_rule, key=lambda k: (k.startswith('bp:'), -by_rule[k]['nodes'])):
        c = by_rule[key]
        if not key.startswith('bp:'):
            wcag_total += c['nodes']
        print(f"{key:32} {impact[key]:9} {c['nodes']:5} / {c['pages']:3}  {helps[key]}")
    print(f'WCAG violations: {wcag_total} nodes over {len(results)} page states')
    if out_json:
        Path(out_json).write_text(json.dumps(results, ensure_ascii=False, indent=1))
    sys.exit(1 if wcag_total else 0)


if __name__ == '__main__':
    main()
