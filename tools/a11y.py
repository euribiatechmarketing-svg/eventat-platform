#!/usr/bin/env python3
"""Automated accessibility scan (axe-core, WCAG 2.2 AA) of app pages at desktop and phone widths.

Usage: python3 tools/a11y.py [--area admin] [--base http://localhost:3000] [--as client|partner|admin]
       [/path ...] [--json OUT.json] [--widths 1440,390] [--no-overlays] [--keys]

With --area the area's routes are scanned (detail pages are found by following the first matching link
on their list page) as that area's demo user; extra paths may be added. Without --area, pass the paths
and --as. Needs `npm i` (axe-core is a dev dependency) and a running server.
Prints the violations per route and width (rule id, impact, target, help) and a count by rule.
--keys also tabs through each page and reports focus stops without a visible focus indicator, focus that
lands on something invisible, and pointer-only controls (cursor: pointer but not reachable by Tab).
Exits 1 when any violation is found.
"""
import json, os, sys
from collections import Counter, defaultdict
from urllib.parse import quote
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AXE = os.path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js')
TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

DEMO = {
    'client': ('maria.dimitrova@gmail.com', 'eventat-demo'),
    'partner': ('studio.melodia@gmail.com', 'eventat-demo'),
    'admin': ('monika.kovacheva@eventat.bg', 'eventat-demo'),
}

# Each area: the demo user, its fixed routes, detail routes found as (list page, link selector), and
# overlays opened and scanned while open as (route, trigger selector, name); hidden triggers are skipped.
AREAS = {
    'admin': {
        'as': 'admin',
        'routes': ['/admin', '/admin/partnyori', '/admin/moderatsiya', '/admin/rezervacii', '/admin/sporove',
                   '/admin/plashtaniya', '/admin/klienti', '/admin/imeyli', '/admin/nastroyki', '/admin/nastroyki/ekip',
                   '/admin/tarsene?q=' + quote('Мелодия'), '/admin/rezervacii/' + quote('2026-0614-ЕА')],
        'discover': [
            ('/admin/partnyori', 'a[href^="/admin/partnyori/"]'),
            ('/admin/sporove', 'a[href^="/admin/sporove/"]'),
            ('/admin/plashtaniya', 'a[href*="/admin/plashtaniya/partidi/"]:not([href$="/otchet"])'),
            ('/admin/klienti', 'a[href^="/admin/klienti/"]'),
            ('/admin/imeyli', 'a[href^="/admin/imeyli/"]:not([href$="/preview"])'),
        ],
        'overlays': [('/admin', '.topbar .icon-btn[aria-label="Известия"]', 'bell'),
                     ('/admin', '.side-user-menu [aria-haspopup="menu"]', 'account menu'),
                     ('/admin', '.ui-burger', 'rail drawer'),
                     ('/admin/rezervacii', '.toolbar .filter-btn', 'filter menu'),
                     ('/admin/partnyori', '.page-head-right button.btn--primary', 'dialog'),
                     ('/admin/plashtaniya', '.am-acct-acts button.btn--outline', 'dialog')],
    },
}

RUN_AXE = """async (tags) => {
  const r = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
  return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help,
    nodes: v.nodes.map(n => ({ target: n.target.join(' '), summary: (n.failureSummary || '').split('\\n').slice(1, 3).join(' ').trim() })) }));
}"""


def sign_in(page, base, who):
    email, pw = DEMO[who]
    r = page.request.post(base + '/api/auth/sign-in/email', data={'email': email, 'password': pw}, headers={'Origin': base})
    if not r.ok:
        raise SystemExit(f'sign-in {who} failed: {r.status} {r.text()[:200]}')


def scan(page, axe_src):
    if not page.evaluate('() => !!window.axe'):
        page.add_script_tag(content=axe_src)
    return page.evaluate(RUN_AXE, TAGS)


# What a focus ring can show on: the element itself (unless it draws no box: display: contents, or a visually
# hidden control) and its two nearest ancestors. A ring counts when an outline appears, or a border, background
# or text decoration changes; a box-shadow counts only when it is at least half opaque (a faint halo does not).
SIG_JS = """(el) => {
  const out = [];
  for (let e = el, i = 0; e && e.nodeType === 1 && i < 3; e = e.parentElement, i++) {
    const c = getComputedStyle(e), r = e.getBoundingClientRect();
    if (i === 0 && (c.display === 'contents' || r.width < 4 || r.height < 4)) { out.push('-'); continue; }
    const shadow = (c.boxShadow.match(/rgba?\\([^)]*\\)/g) || []).filter(x => { const a = x.split(',')[3]; return a === undefined || parseFloat(a) >= 0.5; }).join(' ');
    const ring = c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0 ? `${c.outlineStyle} ${c.outlineWidth} ${c.outlineColor}` : '';
    out.push([ring, shadow, c.borderTopColor, c.borderBottomColor, c.backgroundColor, c.textDecorationLine].join('|'));
  }
  return out.join('#');
}"""

FOCUS_JS = """() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const r = el.getBoundingClientRect(), c = getComputedStyle(el);
  const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || el.getAttribute('name') || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
  const box = c.display === 'contents' ? [...el.children].map(x => x.getBoundingClientRect()).find(x => x.width) || r : r;
  const hiddenControl = r.width < 4 && r.height < 4 && el.closest('label');
  const visible = !!hiddenControl || (box.width > 0 && box.height > 0 && c.visibility !== 'hidden' && box.bottom > -1 && box.right > -1 && box.left < innerWidth + 1);
  if (!el.dataset.a11yId) el.dataset.a11yId = String(Math.random()).slice(2);
  return { id: el.dataset.a11yId, desc: `${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[role=' + el.getAttribute('role') + ']' : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''} "${name}"`, visible };
}"""

POINTER_JS = """() => {
  const focusable = 'a[href], button, input, select, textarea, summary, label, iframe, [tabindex], [contenteditable=""], [contenteditable=true]';
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (getComputedStyle(el).cursor !== 'pointer' || el.closest(focusable)) continue;
    const p = el.parentElement;
    if (p && getComputedStyle(p).cursor === 'pointer' && !p.closest(focusable)) continue;  // report the outermost only
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
    if (el.querySelector(focusable)) continue;  // a wrapper whose inner control is the real target
    out.push(`${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\\s+/).slice(0, 2).join('.')} "${(el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 30)}"`);
  }
  return out;
}"""

HEADINGS_JS = """() => {
  const hs = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role=heading]')].filter(h => h.getClientRects().length && !h.closest('[aria-hidden=true]'));
  const out = []; let last = 0;
  const h1 = hs.filter(h => (h.getAttribute('aria-level') || h.tagName.slice(1)) === '1').length;
  if (h1 !== 1) out.push(`${h1} h1 on the page`);
  for (const h of hs) {
    const l = Number(h.getAttribute('aria-level') || h.tagName.slice(1));
    if (last && l > last + 1) out.push(`heading level skips ${last} → ${l}: "${h.innerText.trim().slice(0, 40)}"`);
    last = l;
  }
  return out;
}"""

def keys(page, limit=250):
    """Tab through the page: focus stops without a visible change, invisible focus, pointer-only controls,
    and the heading outline (one h1, no skipped levels)."""
    page.add_style_tag(content='*, *::before, *::after { transition: none !important; animation: none !important; }')
    page.evaluate('() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); }')
    stops, seen, problems = [], set(), []
    for _ in range(limit):
        page.keyboard.press('Tab')
        f = page.evaluate(FOCUS_JS)
        if not f:
            continue
        if f['id'] in seen:
            break
        seen.add(f['id'])
        el = page.locator(f'[data-a11y-id="{f["id"]}"]')
        stops.append((f, el.evaluate(SIG_JS)))
        if not f['visible']:
            problems.append(f'focus on something not visible: {f["desc"]}')
    page.evaluate('() => document.activeElement && document.activeElement.blur()')
    for f, focused in stops:
        el = page.locator(f'[data-a11y-id="{f["id"]}"]')
        if not el.count():
            continue
        if el.evaluate(SIG_JS) == focused and f['visible']:
            problems.append(f'no visible focus indicator: {f["desc"]}')
    problems += [f'pointer-only (not reachable by Tab): {x}' for x in page.evaluate(POINTER_JS)]
    problems += page.evaluate(HEADINGS_JS)
    return len(stops), problems


def main():
    args = sys.argv[1:]
    def opt(name, default=None):
        if name in args:
            i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
        return default
    base = opt('--base', 'http://localhost:3000')
    area_name = opt('--area')
    who = opt('--as')
    out_json = opt('--json')
    widths = [int(w) for w in opt('--widths', '1440,390').split(',')]
    overlays_on = '--no-overlays' not in args
    if not overlays_on: args.remove('--no-overlays')
    keys_on = '--keys' in args
    if keys_on: args.remove('--keys')
    area = AREAS.get(area_name) if area_name else None
    if area_name and not area:
        raise SystemExit(f'unknown area {area_name}; known: {", ".join(AREAS)}')
    who = who or (area and area['as'])
    routes = list(area['routes']) if area else []
    routes += [a for a in args if a.startswith('/')]
    if not routes:
        raise SystemExit(__doc__)
    if not os.path.exists(AXE):
        raise SystemExit('axe-core missing: run npm i')
    axe_src = open(AXE).read()

    results = []  # (route, width, violations)
    key_results = []  # (route, width, tab stops, problems)
    with sync_playwright() as p:
        b = p.chromium.launch()
        for wi, w in enumerate(widths):
            ctx = b.new_context(viewport={'width': w, 'height': 900 if w > 700 else 844}, locale='bg-BG', timezone_id='Europe/Sofia')
            page = ctx.new_page()
            if who:
                sign_in(page, base, who)
            if area and wi == 0:
                for list_page, sel in area.get('discover', []):
                    page.goto(base + list_page, wait_until='networkidle')
                    href = page.eval_on_selector_all(sel, 'els => els.map(e => e.getAttribute("href"))')
                    href = [h for h in href if h and h.split('?')[0].rstrip('/') != list_page]
                    if href and href[0] not in routes:
                        routes.append(href[0])
                    elif not href:
                        print(f'! no detail link on {list_page} for {sel}')
            for path in routes:
                page.goto(base + path, wait_until='networkidle')
                final = page.url.replace(base, '')
                if final.split('?')[0] != path.split('?')[0] and quote(final.split('?')[0], safe='/%') != quote(path.split('?')[0], safe='/%'):
                    print(f'! {path} ended on {final}')
                results.append((path, w, scan(page, axe_src)))
                if keys_on:
                    n, problems = keys(page)
                    key_results.append((path, w, n, problems))
                    page.goto(base + path, wait_until='networkidle')
                for route, trigger, what in (area.get('overlays', []) if area and overlays_on else []):
                    if route != path:
                        continue
                    t = page.locator(trigger).first
                    if not t.count() or not t.is_visible() or not t.is_enabled():
                        continue
                    t.click(); page.wait_for_timeout(400)
                    results.append((f'{path} [{what} open]', w, scan(page, axe_src)))
                    page.goto(base + path, wait_until='networkidle')
            ctx.close()
        b.close()

    total = Counter(); routes_hit = defaultdict(set)
    for path, w, vs in results:
        head = f'── {path} @ {w}px'
        if not vs:
            print(f'{head}: no violations'); continue
        print(f'{head}: {sum(len(v["nodes"]) for v in vs)} node(s) in {len(vs)} rule(s)')
        for v in vs:
            total[v['id']] += len(v['nodes']); routes_hit[v['id']].add(path.split(' [')[0])
            print(f'   {v["id"]} [{v["impact"]}] {v["help"]}')
            for n in v['nodes'][:12]:
                print(f'      - {n["target"]}' + (f'  ({n["summary"]})' if n['summary'] else ''))
            if len(v['nodes']) > 12:
                print(f'      … {len(v["nodes"]) - 12} more')
    kp = 0
    for path, w, n, problems in key_results:
        print(f'── keys {path} @ {w}px: {n} tab stops' + (f', {len(problems)} problem(s)' if problems else ', ok'))
        for x in problems:
            print(f'      - {x}')
        kp += len(problems)
    print('\n== violations by rule (nodes, routes) ==')
    if not total:
        print('none')
    for rule, n in total.most_common():
        print(f'{rule:32s} {n:4d} nodes  {len(routes_hit[rule]):2d} routes')
    if out_json:
        with open(out_json, 'w') as f:
            json.dump([{'route': r, 'width': w, 'violations': vs} for r, w, vs in results], f, ensure_ascii=False, indent=1)
    if keys_on:
        print(f'keyboard problems: {kp}')
    sys.exit(1 if total or kp else 0)


if __name__ == '__main__':
    main()
