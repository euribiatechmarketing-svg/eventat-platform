#!/usr/bin/env python3
"""End-to-end check of the partner operations screens (SCREENS §7) with real clicks.

Usage: python3 tests/e2e/partner-ops.py [--base http://localhost:3206] [--no-reset] [--headed]

Resets and seeds the database named in .env.local first (unless --no-reset), signs in as the
seeded partner (Студио Мелодия) and drives every control of the dashboard, the requests inbox,
the request page, the bookings ledger, the booking page, the calendar and the topbar search,
asserting the visible result (toast, new state, URL) and the database effect.
Needs the dev server for this worktree running against the same database.
"""
import json, os, re, subprocess, sys, time
from urllib.parse import quote
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NODE_PATH = os.path.expanduser('~/nodejs22/bin')
PASSWORD = 'eventat-demo'
PARTNER = 'studio.melodia@gmail.com'
CLIENT = 'maria.dimitrova@gmail.com'
ADMIN = 'monika.kovacheva@eventat.bg'


def env_local():
    out = dict(os.environ)
    out['PATH'] = NODE_PATH + ':' + out.get('PATH', '')
    with open(os.path.join(ROOT, '.env.local')) as f:
        for line in f:
            m = re.match(r'^([A-Z_]+)=(.*)$', line.strip())
            if m: out[m.group(1)] = m.group(2).strip('"')
    return out


ENV = env_local()


def sql(query, *params):
    """Run a query against the worktree database; returns a list of dicts."""
    code = (
        "import postgres from 'postgres';"
        "const s = postgres(process.env.DATABASE_URL, { onnotice: () => {} });"
        "const r = await s.unsafe(process.env.Q, JSON.parse(process.env.P));"
        "console.log(JSON.stringify(r)); await s.end();"
    )
    r = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT, env={**ENV, 'Q': query, 'P': json.dumps(list(params))},
                       capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def one(query, *params):
    rows = sql(query, *params)
    return rows[0] if rows else None


def reset_db():
    for cmd in (['npm', 'run', 'db:reset'], ['npm', 'run', 'db:seed']):
        subprocess.run(cmd, cwd=ROOT, env=ENV, check=True, capture_output=True)
    time.sleep(6)  # the server's clock offset cache lives 5 s


LAYOUT_JS = """() => {
  const W = document.documentElement.clientWidth, out = [];
  if (document.documentElement.scrollWidth > W) out.push('page scrolls sideways: ' + document.documentElement.scrollWidth);
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const name = e => e.tagName + '.' + String(e.className).trim().split(/\\s+/).slice(0, 2).join('.') + ' «' + (e.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 40) + '»';
  for (const e of document.querySelectorAll('.shell *')) {
    if (!vis(e) || !(e.innerText || '').trim()) continue;
    const cs = getComputedStyle(e);
    if ((cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis') && e.scrollWidth > e.clientWidth + 1) out.push('cut: ' + name(e));
    if (e.getBoundingClientRect().right > W + 0.5) out.push('off screen: ' + name(e));
    if (e.matches('.btn, .badge, .tab-bar-item, .filter-btn, .chip, .pill-timer, .kv-label, .req-meta-label, .crumb, .link-more, .topbar-title, .rule-name, .po-pick-n')) {
      const tops = []; const tw = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let n;
      while ((n = tw.nextNode())) { if (!n.nodeValue.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(n);
        for (const rc of rg.getClientRects()) if (rc.width > 0) tops.push(rc.top + rc.height / 2); }
      tops.sort((a, b) => a - b); let lines = tops.length ? 1 : 0;
      for (let i = 1; i < tops.length; i++) if (tops[i] - tops[i - 1] > parseFloat(cs.fontSize) * 0.8) lines++;
      if (lines > 1) out.push('wraps: ' + name(e));
    }
  }
  return [...new Set(out)];
}"""


def layout_issues(page):
    """Text cut off, controls/labels wrapping to a second line, or anything past the right edge."""
    return page.evaluate(LAYOUT_JS)


PASSED = []


def step(name):
    PASSED.append(name)
    print('  ✓', name)


def toast(page, text):
    expect(page.locator('.ui-toast.is-on')).to_contain_text(text, timeout=10000)


def sign_in(ctx, base, email):
    r = ctx.request.post(base + '/api/auth/sign-in/email', data={'email': email, 'password': PASSWORD}, headers={'Origin': base})
    assert r.ok, f'sign-in failed for {email}: {r.status}'


def main():
    args = sys.argv[1:]
    base = 'http://localhost:3206'
    if '--base' in args: base = args[args.index('--base') + 1]
    if '--no-reset' not in args:
        print('resetting database…'); reset_db()
    pid = one("select id from partner where slug = 'studio-melodiya'")['id']

    with sync_playwright() as p:
        b = p.chromium.launch(headless='--headed' not in args)

        # ── guards ──────────────────────────────────────────────────────
        guest = b.new_context()
        g = guest.new_page()
        g.goto(base + '/partner/zayavki')
        assert '/vhod' in g.url, g.url
        step('guest is sent to sign-in')
        guest.close()
        for email, home in ((CLIENT, '/akaunt'), (ADMIN, '/admin')):
            c = b.new_context(); sign_in(c, base, email); pg = c.new_page()
            pg.goto(base + '/partner/rezervacii')
            assert '/partner' not in pg.url and home in pg.url, (email, pg.url)
            c.close()
        step('client and admin are redirected away from the partner panel')

        ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='bg-BG', timezone_id='Europe/Sofia')
        sign_in(ctx, base, PARTNER)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('response', lambda r: errors.append(f'{r.status} {r.url}') if r.status >= 500 else None)

        other = one("select b.number from booking b join partner p on p.id = b.partner_id where p.slug <> 'studio-melodiya' limit 1")['number']
        r = page.goto(base + '/partner/rezervacii/' + quote(other))
        assert r.status == 404, r.status
        r = page.goto(base + '/partner/zayavki/' + quote(other))
        assert r.status == 404, r.status
        step("another partner's booking and request are 404")

        # ── layout at phone, laptop and desktop widths (before the flows change the records) ──
        routes = ['/partner', '/partner?mesec=2026-06', '/partner/zayavki', '/partner/zayavki?tab=otkazani',
                  '/partner/zayavki/' + quote('2026-0628-ЛШ'), '/partner/zayavki/' + quote('2026-0621-ПД'), '/partner/zayavki/' + quote('2026-0905-ПХ'),
                  '/partner/rezervacii', '/partner/rezervacii?tab=priklyuchili', '/partner/rezervacii/' + quote('2026-0614-ЕА'),
                  '/partner/kalendar?mesec=2026-06', '/partner/kalendar?mesec=2026-09', '/partner/tarsene', '/partner/tarsene?q=' + quote('Мария')]
        for width in (390, 1024, 1280, 1366, 1440):
            lc = b.new_context(viewport={'width': width, 'height': 900}, locale='bg-BG', timezone_id='Europe/Sofia')
            sign_in(lc, base, PARTNER)
            lp = lc.new_page()
            for path in routes:
                lp.goto(base + path)
                lp.wait_for_load_state('networkidle')
                bad = layout_issues(lp)
                assert not bad, (width, path, bad)
            if width == 390:
                lp.goto(base + '/partner/rezervacii/' + quote('2026-0614-ЕА'))
                expect(lp.locator('.topbar-title')).to_have_text('№\u00a02026-0614-ЕА')
                lp.goto(base + '/partner/zayavki/' + quote('2026-0628-ЛШ'))
                expect(lp.locator('.topbar-title')).to_have_text('№\u00a02026-0628-ЛШ')
                lp.goto(base + '/partner/kalendar?mesec=2026-06')
                small = lp.evaluate("""[...document.querySelectorAll('.po .btn, .po .blk-x, .po .stepper button, .po .month-nav a, .po .filter-btn')]
                    .filter(e => e.offsetParent).map(e => [e.innerText || e.getAttribute('aria-label'), Math.round(e.getBoundingClientRect().height)]).filter(x => x[1] < 34)""")
                assert not small, ('tap targets under 34 px at 390', small)
                lp.goto(base + '/partner/rezervacii')
                tabs = lp.evaluate("[...document.querySelectorAll('.tab-bar-item')].map(t => t.getBoundingClientRect().right <= document.documentElement.clientWidth)")
                assert tabs and all(tabs), tabs
                expect(lp.locator('.po-tbl tbody tr').first.locator('td[data-label="Получавате"]')).to_be_visible()
                for path, label in (('/partner/rezervacii', 'Период'), ('/partner/zayavki', 'Филтри')):
                    lp.goto(base + path)
                    lp.click(f'.filter-btn:has-text("{label}")')
                    box = lp.locator('.ui-menu').bounding_box()
                    assert box['x'] >= 0 and box['x'] + box['width'] <= 390, (label, box)
                lp.goto(base + '/partner/kalendar?mesec=2026-06')
                lp.click('.page-head button:has-text("Блокирай период")')
                widths = [lp.locator(f'.modal input[name="{n}"]').bounding_box()['width'] for n in ('from', 'to')]
                assert min(widths) >= 250, widths
            if width == 1024:
                lp.goto(base + '/partner/rezervacii/' + quote('2026-0614-ЕА'))
                expect(lp.locator('.topbar .po-search')).to_be_hidden()
                lp.click('.topbar .po-search-ico')
                lp.wait_for_url(re.compile(r'/partner/tarsene$'))
                expect(lp.locator('.po .po-search--start input[name="q"]')).to_be_visible()
            lc.close()
        step('390 / 1024 / 1280 / 1366 / 1440 px: nothing cut, wrapped or past the edge on any screen')
        step('390 px: record pages title with their number; every tab and the ledger amounts stay in view; tap targets ≥ 34 px')
        step('390 px: ‹Период› / ‹Филтри› menus open inside the screen; the period dialog stacks its date fields')
        step('1024 px: the topbar search folds into its icon so the record title keeps one line')

        # ── dashboard ───────────────────────────────────────────────────
        page.goto(base + '/partner')
        expect(page.locator('h1.page-title')).to_have_text('Добре дошли, Студио Мелодия')
        expect(page.locator('.kpi').first.locator('.kpi-value')).to_have_text('2')
        expect(page.locator('.mini-req')).to_have_count(2)
        step('dashboard shows the live counts and the two new requests')
        expect(page.locator('.topbar .po-lang b')).to_have_text('BG')
        lang_x = page.locator('.topbar .po-lang').bounding_box()['x']
        bell_x = page.locator('.topbar button[aria-label="Известия"], .topbar [aria-label="Известия"]').first.bounding_box()['x']
        assert lang_x > bell_x, (lang_x, bell_x)
        page.click('.topbar .po-lang [role="button"]:has-text("EN")')
        toast(page, 'Английската версия идва скоро')
        step('topbar ‹BG› / ‹EN› after the bell, as in the prototype; ‹EN› says the English version is coming')

        page.click('.cal-nav a[aria-label="Следващ месец"]')
        expect(page.locator('.cal-month')).to_have_text('Септември 2025')
        page.click('.cal-days button[value="2025-09-10"]')
        toast(page, 'Датата е блокирана')
        assert one("select 1 as x from availability_block where partner_id = $1 and start_date = '2025-09-10'", pid), 'no block'
        expect(page.locator('.cal-days button[value="2025-09-10"]')).to_have_class(re.compile('is-blocked'))
        page.click('.cal-days button[value="2025-09-10"]')
        toast(page, 'Датата е освободена')
        assert not one("select 1 as x from availability_block where partner_id = $1 and start_date = '2025-09-10'", pid), 'block left'
        step('mini calendar: month arrows, block and free a day')

        page.click('.dcard .link-more:has-text("Виж всички")')
        page.wait_for_url(re.compile(r'/partner/zayavki$'))
        step('‹Виж всички› opens the requests')

        # ── requests inbox ──────────────────────────────────────────────
        expect(page.locator('.group--new .req')).to_have_count(2)
        expect(page.locator('.group--pay .req')).to_have_count(1)
        page.click('.tab-bar a:has-text("Нови")')
        page.wait_for_url(re.compile(r'tab=novi'))
        expect(page.locator('.group--pay')).to_have_count(0)
        page.click('.filter-btn:has-text("Филтри")')
        page.click('.ui-menu a:has-text("С изтичащ срок")')
        page.wait_for_url(re.compile(r'filtar=iztichasht'))
        expect(page.locator('.group--new .req')).to_have_count(1)
        expect(page.locator('.group--new .req')).to_contain_text('Технолинк ЕООД')
        step('tabs and ‹Филтри› filter the inbox through the URL')
        page.click('.tab-bar a:has-text("Отказани")')
        page.wait_for_url(re.compile(r'tab=otkazani'))
        expect(page.locator('.ui-empty')).to_have_text('Няма записи в този изглед.')
        step('empty view says ‹Няма записи в този изглед.›')

        page.click('button.filter-btn:has-text("Експорт")')
        toast(page, 'Справката се подготвя — ще я получите по имейл')
        assert one("select 1 as x from report_job where partner_id = $1 and kind = 'partner_requests'", pid)
        assert one("select 1 as x from email_outbox where template_key = 'vendor-report-ready' and to_email = $1", PARTNER), 'no report email'
        rep = one("select id, params from report_job where partner_id = $1 and kind = 'partner_requests' order by created_at desc limit 1", pid)
        assert rep['params'] == {'tab': 'otkazani', 'filtar': 'iztichasht'}, rep
        csv = page.request.get(base + '/partner/eksport/' + rep['id'])
        assert csv.ok and 'text/csv' in csv.headers['content-type'], csv.status
        assert csv.text().splitlines()[0].lstrip('\ufeff').startswith('№;Клиент;Събитие'), csv.text()[:80]
        g2 = b.new_context(); r404 = g2.request.get(base + '/partner/eksport/' + rep['id']); g2.close()
        assert r404.status == 404, r404.status
        step('‹Експорт› queues the report and the email; the file downloads for its partner only')

        # ── request page: ask, approve, remind, withdraw ────────────────
        page.goto(base + '/partner/zayavki')
        page.click('.req:has-text("Технолинк ЕООД") .req-meta')
        page.wait_for_url(re.compile(r'/partner/zayavki/2026-0621'))
        page.go_back()
        step('a new request row opens as a whole, not only through ‹Разгледай›')
        page.click('.req:has-text("Ивелина Тодорова") .btn:has-text("Разгледай")')
        page.wait_for_url(re.compile(r'/partner/zayavki/2026-0628'))
        expect(page.locator('h1.page-title')).to_have_text('Заявка от Ивелина Тодорова')
        expect(page.locator('.page-head .badge')).to_have_text('Нова заявка')
        expect(page.locator('.topbar-title')).to_have_text('Заявка · №\u00a02026-0628-ЛШ')
        step('the topbar names the request, like the prototype')
        page.click('button:has-text("Поискай още информация")')
        page.fill('textarea[name="body"]', 'Колко часа продължава подготовката на техниката? Пишете ми на 0888 123 456.')
        page.click('button[type="submit"]:has-text("Изпрати")')
        toast(page, 'Въпросът е изпратен на клиента')
        m = one("select m.body from message m join conversation c on c.id = m.conversation_id join request r on r.client_id = c.client_id and r.partner_id = c.partner_id where r.number = '2026-0628-ЛШ' and m.sender_role = 'partner' order by m.created_at desc limit 1")
        assert m and '•••' in m['body'] and '0888' not in m['body'], m
        step('‹Поискай още информация› sends a masked message')

        page.click('button:has-text("Одобри заявката")')
        expect(page.locator('.page-head .badge')).to_have_text('Одобрена · чака плащане', timeout=10000)
        expect(page.locator('.countdown-time')).to_have_text(re.compile(r'^\d\d:\d\d$'))
        assert one("select status from booking where number = '2026-0628-ЛШ'")['status'] == 'awaiting_payment'
        step('‹Одобри заявката› creates the booking and shows the countdown')

        page.click('button:has-text("Напомни на клиента")')
        toast(page, 'Напомнянето е изпратено')
        assert one("select 1 as x from email_outbox e join \"user\" u on u.id = e.to_user_id where e.template_key = 'client-payment-reminder' and u.name = 'Ивелина Тодорова'"), 'no reminder email'
        step('‹Напомни на клиента› emails the client')

        page.click('button:has-text("Отмени одобрението")')
        expect(page.locator('.tl-title').last).to_have_text('Оттеглено одобрение', timeout=10000)
        assert one("select status from booking where number = '2026-0628-ЛШ'")['status'] == 'approval_withdrawn'
        step('‹Отмени одобрението› withdraws it')

        # ── request page: decline with another reason ───────────────────
        page.goto(base + '/partner/zayavki/' + quote('2026-0621-ПД'))
        expect(page.locator('.page-head .badge')).to_have_text('Чака оферта')
        expect(page.locator('button:has-text("Одобри заявката")')).to_have_count(0)
        page.click('.panel-actions button:has-text("Откажи")')
        page.click('.po-pick:has-text("Друга причина")')
        page.fill('textarea[name="text"]', 'Нямаме свободен екип за 250 гости.')
        page.click('button[type="submit"]:has-text("Откажи")')
        page.wait_for_url(re.compile(r'/partner/zayavki$'))
        toast(page, 'Заявката е отказана')
        r = one("select status, decline_reason, decline_text from request where number = '2026-0621-ПД'")
        assert r['status'] == 'declined' and r['decline_reason'] == 'other' and r['decline_text'].startswith('Нямаме'), r
        step('‹Откажи› + ‹Друга причина› declines the request')
        expect(page.locator('.topbar-title')).to_have_text('Заявки')
        page.click('.tab-bar a:has-text("Отказани")')
        page.wait_for_url(re.compile(r'tab=otkazani'))
        expect(page.locator('.req')).to_have_count(2)
        expect(page.locator('.req:has-text("Технолинк ЕООД") .badge')).to_have_text('Отказана')
        expect(page.locator('.req:has-text("Ивелина Тодорова") .badge')).to_have_text('Оттеглено одобрение')
        step('the declined request and the withdrawn approval list under ‹Отказани›; the topbar title is back')

        # ── bookings ledger ─────────────────────────────────────────────
        page.click('.side-item:has-text("Резервации")')
        page.wait_for_url(re.compile(r'/partner/rezervacii$'))
        expect(page.locator('.month-div b').first).to_have_text('Юни 2026')
        page.click('.tab-bar a:has-text("Приключили")')
        page.wait_for_url(re.compile(r'tab=priklyuchili'))
        expect(page.locator('.tbl tbody tr')).to_have_count(3)
        page.click('.filter-btn:has-text("Период")')
        page.click('.ui-menu a:has-text("Тази година")')
        page.wait_for_url(re.compile(r'period=godina'))
        expect(page.locator('.filter-btn')).to_contain_text('Тази година')
        page.click('button:has-text("Експорт")')
        toast(page, 'Справката се подготвя — ще я получите по имейл')
        rep = one("select id from report_job where partner_id = $1 and kind = 'partner_bookings' order by created_at desc limit 1", pid)
        rows = page.request.get(base + '/partner/eksport/' + rep['id']).text().lstrip('\ufeff').splitlines()
        assert rows[0].startswith('Дата;№;Събитие') and len(rows) == 4 and any('Стефка Илиева' in r for r in rows), rows
        step('ledger tabs, ‹Период› and ‹Експорт› (the file has the three past bookings)')

        page.click('.tab-bar a:has-text("Предстоящи")')
        page.wait_for_url(re.compile(r'/partner/rezervacii\?period=godina$'))
        expect(page.locator('.ui-empty')).to_have_text('Няма записи в този изглед.')
        page.click('.filter-btn:has-text("Тази година")')
        page.click('.ui-menu a:has-text("Тази година")')
        page.wait_for_url(re.compile(r'/partner/rezervacii$'))
        expect(page.locator('.filter-btn')).to_contain_text('Период')
        page.click('.tbl tbody tr:has-text("Ана и Виктор") td.num.strong')
        page.wait_for_url(re.compile(r'/partner/rezervacii/2026-0719'))
        step('a ledger row opens its booking')

        # ── booking page ────────────────────────────────────────────────
        expect(page.locator('h1.page-title')).to_have_text('Сватба · Ана и Виктор')
        expect(page.locator('.topbar-title')).to_have_text('Резервация\u00a0·\u00a0№\u00a02026-0719-ГП')
        expect(page.locator('.kv-label:has-text("Телефон за деня на събитието")')).to_have_count(1)
        page.click('.panel-actions button:has-text("Анулиране")')
        page.click('.po-confirm button[type="submit"]:has-text("Анулиране")')
        toast(page, 'Изпратихме искането за анулиране — екипът се свързва с клиента')
        expect(page.locator('.page-head .badge').first).to_have_text('Искане за анулиране')
        assert one("select status from booking where number = '2026-0719-ГП'")['status'] == 'cancellation_requested'
        step('‹Анулиране› asks the team to cancel')

        page.click('a:has-text("Виж в календара")')
        page.wait_for_url(re.compile(r'/partner/kalendar\?mesec=2026-07'))
        expect(page.locator('h1.page-title')).to_have_text('Юли 2026')
        step('‹Виж в календара› opens the event month')

        # ── calendar ────────────────────────────────────────────────────
        page.click('.month-nav a[aria-label="Предишен месец"]')
        page.wait_for_url(re.compile(r'mesec=2026-06'))
        cut = page.evaluate("""[...document.querySelectorAll('.mdays [value="2026-06-17"] .chip, .mdays a[href*="2026-0614"] .chip')]
            .map(c => [c.textContent, c.scrollWidth > c.clientWidth + 1])""")
        assert len(cut) == 2 and not any(x[1] for x in cut), ('calendar chips cut at 1440', cut)
        step('1440 px: the calendar chips are readable (‹Сватба · 120 гости›, ‹Блокирана›)')
        expect(page.locator('.mdays a[href*="2026-0630"] .chip')).to_have_text('Бал · 70 гости')
        assert page.evaluate("(() => { const c = document.querySelector('.mdays a[href*=\"2026-0630\"] .chip'); return c.scrollWidth <= c.clientWidth + 1; })()")
        step('1440 px: the prom reads ‹Бал · 70 гости› like the prototype, not ‹Абитуриентски б…›')
        page.click('.page-head button:has-text("Блокирай дата")')
        page.fill('.modal input[name="date"]', '2026-06-23')
        page.fill('.modal input[name="reason"]', 'Ремонт на техниката')
        page.click('.modal button[type="submit"]')
        toast(page, 'Датата е блокирана в календара')
        assert one("select reason from availability_block where partner_id = $1 and start_date = '2026-06-23'", pid)['reason'] == 'Ремонт на техниката'
        expect(page.locator('.blk-date:has-text("23 юни 2026")')).to_have_count(1)
        step('‹Блокирай дата› dialog blocks a date')

        page.click('.page-head button:has-text("Блокирай период")')
        page.fill('.modal input[name="from"]', '2026-06-08')
        page.fill('.modal input[name="to"]', '2026-06-10')
        page.click('.modal button[type="submit"]')
        toast(page, 'Периодът е блокиран в календара')
        assert one("select 1 as x from availability_block where partner_id = $1 and start_date = '2026-06-08' and end_date = '2026-06-10'", pid)
        step('‹Блокирай период› dialog blocks a period')

        page.click('form.blk:has-text("17 – 18 юни 2026") .blk-x')
        toast(page, 'Датата е освободена')
        assert not one("select 1 as x from availability_block where partner_id = $1 and start_date = '2026-06-17'", pid)
        step('× frees a block')

        page.click('.mdays button[value="2026-06-02"]')
        toast(page, 'Датата е блокирана')
        expect(page.locator('.mdays button[value="2026-06-02"] .chip--blocked')).to_have_text('Блокирана')
        page.wait_for_timeout(3500)  # let the toast go, then the same toast must show again
        page.click('.mdays button[value="2026-06-03"]')
        toast(page, 'Датата е блокирана')
        assert one("select 1 as x from availability_block where partner_id = $1 and start_date <= '2026-06-03' and end_date >= '2026-06-03'", pid)
        step('a free day in the month is blocked with a click (the same toast shows again)')

        sw1 = 'button[role="switch"][aria-label="Само едно събитие на ден"]'
        expect(page.locator('.stepper button[aria-label="+"]')).to_be_enabled()
        page.click('.stepper button[aria-label="+"]')
        expect(page.locator(sw1)).to_have_attribute('aria-checked', 'false')
        expect(page.locator('.stepper span')).to_have_text('2')
        r = one("select bookings_per_day_mode, max_bookings_per_date from partner where id = $1", pid)
        assert r['bookings_per_day_mode'] == 'limit' and r['max_bookings_per_date'] == 2, r
        step('‹+› works while ‹Само едно събитие на ден› is on: two a day, the switch turns off')
        page.click('.stepper button[aria-label="+"]')
        expect(page.locator('.stepper span')).to_have_text('3')
        page.click('.stepper button[aria-label="−"]')
        expect(page.locator('.stepper span')).to_have_text('2')
        page.click('.stepper button[aria-label="−"]')
        expect(page.locator(sw1)).to_have_attribute('aria-checked', 'true')
        expect(page.locator('.stepper span')).to_have_text('1')
        expect(page.locator('.stepper button[aria-label="−"]')).to_be_disabled()
        assert one("select bookings_per_day_mode from partner where id = $1", pid)['bookings_per_day_mode'] == 'one'
        page.click(sw1)
        expect(page.locator(sw1)).to_have_attribute('aria-checked', 'false')
        expect(page.locator('.stepper span')).to_have_text('2')
        r = one("select bookings_per_day_mode, max_bookings_per_date from partner where id = $1", pid)
        assert r['bookings_per_day_mode'] == 'limit' and r['max_bookings_per_date'] == 2, r
        page.click(sw1)
        expect(page.locator(sw1)).to_have_attribute('aria-checked', 'true')
        assert one("select bookings_per_day_mode from partner where id = $1", pid)['bookings_per_day_mode'] == 'one'
        step('availability rules: switch and stepper')

        page.click('button[role="switch"][aria-label="Приемам заявки само за избрани дати"]')
        expect(page.locator('button[role="switch"][aria-label="Приемам заявки само за избрани дати"]')).to_have_attribute('aria-checked', 'true')
        page.click('.mdays button.po-closed[value="open:2026-06-25"]')
        expect(page.locator('.mdays button[value="2026-06-25"]')).not_to_have_class(re.compile('po-closed'))
        assert one("select 1 as x from availability_open_date where partner_id = $1 and date = '2026-06-25'", pid)
        page.click('button[role="switch"][aria-label="Приемам заявки само за избрани дати"]')
        expect(page.locator('button[role="switch"][aria-label="Приемам заявки само за избрани дати"]')).to_have_attribute('aria-checked', 'false')
        step('‹Приемам заявки само за избрани дати› and opening a date')

        page.click('.mdays a:has(.chip--booked)')
        page.wait_for_url(re.compile(r'/partner/rezervacii/2026-06'))
        page.go_back()
        page.click('.month-today button:has-text("Днес")')
        toast(page, 'Показваме текущия месец')
        page.wait_for_url(re.compile(r'mesec=2025-08'))
        step('booked day opens the booking; ‹Днес› returns to the current month')
        expect(page.locator('.mdays .mday.po-still')).to_have_count(30)
        assert page.locator('.mdays button[value="2025-08-10"]').count() == 0
        expect(page.locator('.mdays button[value="2025-08-31"]')).to_have_count(1)
        page.goto(base + '/partner')
        expect(page.locator('.cal-days .cal-day.po-still')).to_have_count(30)
        step('past days (they cannot be blocked) are muted in both calendars; today stays clickable')

        # ── topbar search ───────────────────────────────────────────────
        page.goto(base + '/partner/tarsene')
        expect(page.locator('.po .po-search--start input[name="q"]')).to_be_visible()
        page.fill('.po .po-search--start input[name="q"]', 'Технолинк')
        page.press('.po .po-search--start input[name="q"]', 'Enter')
        page.wait_for_url(re.compile(r'/partner/tarsene\?q='))
        expect(page.locator('.req')).to_contain_text('Технолинк ЕООД')
        step('the search page without a query offers its own field')
        page.fill('.topbar input[name="q"]', 'Мария')
        page.press('.topbar input[name="q"]', 'Enter')
        page.wait_for_url(re.compile(r'/partner/tarsene\?q='))
        expect(page.locator('.tbl')).to_contain_text('Сватба · Мария и Стефан')
        page.fill('.topbar input[name="q"]', '14.06.2026')
        page.press('.topbar input[name="q"]', 'Enter')
        expect(page.locator('h1.page-title')).to_contain_text('14.06.2026')
        expect(page.locator('.tbl tbody tr')).to_have_count(1)
        page.fill('.topbar input[name="q"]', 'Ивелина')
        page.press('.topbar input[name="q"]', 'Enter')
        expect(page.locator('.req')).to_contain_text('Ивелина Тодорова')
        page.fill('.topbar input[name="q"]', 'zzzz')
        page.press('.topbar input[name="q"]', 'Enter')
        expect(page.locator('.ui-empty')).to_have_text('Няма записи в този изглед.')
        step('topbar search finds clients, dates and nothing')

        # ── phone width: the mobile search icon and no sideways scroll ──
        m = b.new_context(viewport={'width': 390, 'height': 844}, locale='bg-BG', timezone_id='Europe/Sofia')
        sign_in(m, base, PARTNER)
        mp = m.new_page()
        for path in ('/partner', '/partner/zayavki', '/partner/rezervacii', '/partner/kalendar?mesec=2026-06', '/partner/rezervacii/' + quote('2026-0614-ЕА'), '/partner/zayavki/' + quote('2026-0905-ПХ')):
            mp.goto(base + path)
            w = mp.evaluate('document.documentElement.scrollWidth')
            assert w <= 390, (path, w)
        mp.click('.po-search-ico')
        mp.wait_for_url(re.compile(r'/partner/tarsene'))
        mp.fill('.po-search--page input[name="q"]', 'Колев')
        mp.press('.po-search--page input[name="q"]', 'Enter')
        expect(mp.locator('.req, .tbl')).to_contain_text('Георги Колев')
        m.close()
        step('390 px: no horizontal scroll; the search icon opens the search page')

        assert not errors, errors
        b.close()
    print(f'partner-ops e2e: {len(PASSED)} checks passed')


if __name__ == '__main__':
    main()
