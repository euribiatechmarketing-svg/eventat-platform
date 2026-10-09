#!/usr/bin/env python3
"""Automated accessibility check (axe-core, WCAG 2.2 AA) of the app's routes at desktop and phone widths.

Usage: python3 tools/a11y.py [--base http://localhost:3000] [--area partner] [--only /path-prefix]
                             [--json OUT.json] [--widths 1440,390] [--quiet]
Needs: a running server on the worktree's own database (.env.local), seeded (npm run db:seed);
       axe-core in node_modules (npm i -D axe-core@4).

Each area lists the sessions it signs in as and the routes (and opened states: dialogs, menus,
error messages) to check. It prints the violations per route and width (rule id, impact, target,
help) and a total per rule; the exit code is 1 when anything was found.
To cover another area, add a function to AREAS that returns its Session list.
"""
import json, os, subprocess, sys, time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Callable, Optional
from urllib.parse import quote
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AXE = os.path.join(ROOT, 'node_modules/axe-core/axe.min.js')
TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']
ENV = {**os.environ, 'PATH': os.path.expanduser('~/nodejs22/bin') + ':' + os.environ.get('PATH', '')}
PASSWORD = 'eventat-demo'


@dataclass
class Check:
    path: str
    name: str = ''
    # Puts the page into a state worth checking (opens a dialog, shows errors); runs after load.
    prepare: Optional[Callable] = None
    widths: Optional[list] = None


@dataclass
class Session:
    label: str
    email: Callable[[], str]          # resolved lazily: an area may create its user first
    checks: list = field(default_factory=list)


def node(*cmd):
    r = subprocess.run(cmd, cwd=ROOT, env=ENV, capture_output=True, text=True, timeout=180)
    if r.returncode:
        raise RuntimeError(f'{cmd}: {r.stderr[-800:]}')
    return r.stdout.strip()


def q(sql):
    return json.loads(node('node', 'tests/e2e/query.mjs', sql))


# ── partner area: the sign-up wizard and the partner panel ─────────────────────────────────────
def partner_area():
    stamp = str(int(time.time()))
    made = {}

    def fresh(kind):
        """A partner fresh from sign-up (draft), with steps 1–5 filled in, or submitted (tests/e2e/onboarding-setup.ts)."""
        def get():
            if kind not in made:
                email = f'a11y-{kind}-{stamp}@example.test'
                flag = {'draft': [], 'complete': ['--complete'], 'submitted': ['--submitted']}[kind]
                node('npx', 'tsx', '--conditions=react-server', 'tests/e2e/onboarding-setup.ts', email, 'Студио Тест', 'Иван Петров', '+359887001122', *flag)
                made[kind] = email
            return made[kind]
        return get

    melodia = lambda: 'studio.melodia@gmail.com'
    ids = {}

    def lookup():
        if not ids:
            p = "(select id from partner where slug like '%melod%' limit 1)"
            ids['svc'] = q(f"select id from service where partner_id = {p} order by name, id limit 1")[0]['id']
            ids['conv'] = q(f"select id from conversation where partner_id = {p} order by created_at, id limit 1")[0]['id']
            ids['case'] = q(f"select d.number from dispute d join booking b on b.id = d.booking_id where b.partner_id = {p} order by d.number limit 1")[0]['number']
        return ids

    R = '/partner/registratsiya'

    def wizard_errors(page):
        page.locator('.wiz-footer-actions .btn--primary').click()
        page.locator('.m-form-alert, .field--error').first.wait_for(timeout=10000)

    def click_first(selector):
        def go(page):
            page.locator(selector).first.click()
            page.wait_for_timeout(400)
        return go

    def open_menu(trigger, panel):
        def go(page):
            page.locator(trigger).first.click()
            page.locator(panel).first.wait_for(timeout=5000)
        return go

    panel = [
        Check('/partner'),
        Check('/partner/zayavki'),
        Check('/partner/zayavki/' + quote('2026-0621-ПД')),
        Check('/partner/zayavki/' + quote('2026-0621-ПД'), 'decline dialog', click_first('button:has-text("Откажи")')),
        Check('/partner/kalendar'),
        Check('/partner/kalendar?mesec=2026-06'),
        Check('/partner/uslugi'),
        Check('/partner/uslugi/nova'),
        Check(lambda: '/partner/uslugi/' + lookup()['svc']),
        Check('/partner/rezervacii'),
        Check('/partner/rezervacii/' + quote('2026-0614-ЕА')),
        Check('/partner/rezervacii/' + quote('2026-0905-ПХ')),
        Check('/partner/prihodi'),
        Check('/partner/profil'),
        Check('/partner/revyuta'),
        Check('/partner/nastroyki'),
        Check('/partner/smetka'),
        Check('/partner/saobshteniya'),
        Check(lambda: '/partner/saobshteniya/' + lookup()['conv']),
        Check('/partner/poddrazhka'),
        Check('/partner/poddrazhka/nov'),
        Check(lambda: '/partner/poddrazhka/' + quote(lookup()['case'])),
        Check('/partner/tarsene?q=' + quote('Елена')),
        Check('/partner/ne-sashtestvuva'),
        Check('/partner', 'bell open', open_menu('button[aria-label="Известия"]', '.ui-menu')),
        Check('/partner', 'account menu open', open_menu('.side-user', '.ui-menu'), widths=[1440]),
    ]
    return [
        Session('fresh partner (sign-up)', fresh('draft'), [
            Check(R + '/1'),
            Check(R + '/1', 'errors shown', wizard_errors),
        ]),
        Session('partner with steps 1–5', fresh('complete'), [Check(f'{R}/{n}') for n in range(1, 7)]),
        Session('submitted partner', fresh('submitted'), [Check(R + '/podadeno')]),
        Session('partner (Студио Мелодия)', melodia, panel),
    ]


AREAS = {'partner': partner_area}


def run_axe(page, src):
    if not page.evaluate('() => !!window.axe'):
        page.evaluate(src)
    return page.evaluate("""tags => axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] })
        .then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help,
            nodes: v.nodes.map(n => ({ target: n.target.join(' '), summary: (n.failureSummary || '').split('\\n').slice(1, 3).join(' ').trim() })) })))""", TAGS)


def main():
    args = sys.argv[1:]
    opt = lambda k, d=None: (args[args.index(k) + 1] if k in args else d)
    base = opt('--base', 'http://localhost:3000')
    area = opt('--area', 'partner')
    only = opt('--only')
    out = opt('--json')
    widths = [int(w) for w in opt('--widths', '1440,390').split(',')]
    quiet = '--quiet' in args
    if not os.path.exists(AXE):
        sys.exit('axe-core is missing: npm i -D axe-core@4')
    src = open(AXE, encoding='utf-8').read()
    sessions = AREAS[area]()
    results = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        for s in sessions:
            checks = [c for c in s.checks if not only or (c.path() if callable(c.path) else c.path).startswith(only)]
            if not checks:
                continue
            email = s.email()
            for w in widths:
                ctx = b.new_context(viewport={'width': w, 'height': 900 if w > 640 else 844}, locale='bg-BG', timezone_id='Europe/Sofia')
                page = ctx.new_page()
                r = page.request.post(base + '/api/auth/sign-in/email', data={'email': email, 'password': PASSWORD}, headers={'Origin': base})
                if not r.ok:
                    sys.exit(f'sign-in {email} failed: {r.status} {r.text()[:200]}')
                for c in checks:
                    if c.widths and w not in c.widths:
                        continue
                    path = c.path() if callable(c.path) else c.path
                    page.goto(base + path, wait_until='networkidle')
                    if c.prepare:
                        c.prepare(page)
                    v = run_axe(page, src)
                    results.append({'session': s.label, 'path': path, 'state': c.name, 'width': w, 'final': page.url.replace(base, ''), 'violations': v})
                    label = f'{path}{" [" + c.name + "]" if c.name else ""} @{w}'
                    if not v:
                        print(f'  ok    {label}')
                    else:
                        print(f'  FAIL  {label}: {sum(len(x["nodes"]) for x in v)} nodes, {len(v)} rules')
                        if not quiet:
                            for x in v:
                                print(f'        {x["id"]} ({x["impact"]}) — {x["help"]}')
                                for n in x['nodes'][:8]:
                                    print(f'            {n["target"]}  {n["summary"][:160]}')
                                if len(x['nodes']) > 8:
                                    print(f'            … {len(x["nodes"]) - 8} more')
                ctx.close()
        b.close()
    by_rule, pages = Counter(), defaultdict(set)
    for r in results:
        for x in r['violations']:
            by_rule[x['id']] += len(x['nodes'])
            pages[x['id']].add(f'{r["path"]}{"[" + r["state"] + "]" if r["state"] else ""}@{r["width"]}')
    print(f'\n{len(results)} checks; violations by rule (nodes / route×width):')
    for k, n in by_rule.most_common():
        print(f'  {k:32} {n:4} / {len(pages[k])}')
    if not by_rule:
        print('  none')
    if out:
        with open(out, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=1)
    sys.exit(1 if by_rule else 0)


if __name__ == '__main__':
    main()
