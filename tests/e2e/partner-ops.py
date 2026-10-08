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

        # ── dashboard ───────────────────────────────────────────────────
        page.goto(base + '/partner')
        expect(page.locator('h1.page-title')).to_have_text('Добре дошли, Студио Мелодия')
        expect(page.locator('.kpi').first.locator('.kpi-value')).to_have_text('2')
        expect(page.locator('.mini-req')).to_have_count(2)
        step('dashboard shows the live counts and the two new requests')

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
        step('‹Експорт› queues the report and the email')

        # ── request page: ask, approve, remind, withdraw ────────────────
        page.goto(base + '/partner/zayavki')
        page.click('.req:has-text("Ивелина Тодорова") a:has-text("Разгледай")')
        page.wait_for_url(re.compile(r'/partner/zayavki/2026-0628'))
        expect(page.locator('h1.page-title')).to_have_text('Заявка от Ивелина Тодорова')
        expect(page.locator('.page-head .badge')).to_have_text('Нова заявка')
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
        page.click('.tab-bar a:has-text("Отказани")')
        page.wait_for_url(re.compile(r'tab=otkazani'))
        expect(page.locator('.req')).to_have_count(1)
        expect(page.locator('.req')).to_contain_text('Технолинк ЕООД')
        step('the declined request moves to ‹Отказани›')

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
        assert one("select 1 as x from report_job where partner_id = $1 and kind = 'partner_bookings'", pid)
        step('ledger tabs, ‹Период› and ‹Експорт›')

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

        page.click('button[role="switch"][aria-label="Само едно събитие на ден"]')
        expect(page.locator('button[role="switch"][aria-label="Само едно събитие на ден"]')).to_have_attribute('aria-checked', 'false')
        page.click('.stepper button[aria-label="+"]')
        expect(page.locator('.stepper span')).to_have_text('2')
        r = one("select bookings_per_day_mode, max_bookings_per_date from partner where id = $1", pid)
        assert r['bookings_per_day_mode'] == 'limit' and r['max_bookings_per_date'] == 2, r
        page.click('button[role="switch"][aria-label="Само едно събитие на ден"]')
        expect(page.locator('button[role="switch"][aria-label="Само едно събитие на ден"]')).to_have_attribute('aria-checked', 'true')
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

        # ── topbar search ───────────────────────────────────────────────
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
