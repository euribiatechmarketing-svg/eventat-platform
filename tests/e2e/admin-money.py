#!/usr/bin/env python3
"""End-to-end check of the admin money screens (SCREENS §8): Резервации, Спорове, Плащания, Имейли.

Usage: python3 tests/e2e/admin-money.py [--base http://localhost:3209] [--no-reset] [--headed]

Resets and seeds the database named in .env.local first (unless --no-reset), checks the guards for
guests, clients, partners and team members without the permission, then signs in as the seeded
admin (Моника Ковачева) and drives every control with real clicks and typing, asserting the visible
result (toast, new state, URL) and the database effect. The last block moves the demo clock to the
1st of September to release a payout batch. Needs the dev server for this worktree running against
the same database.
"""
import json, os, re, subprocess, sys, time
from urllib.parse import quote
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NODE_PATH = os.path.expanduser('~/nodejs22/bin')
PASSWORD = 'eventat-demo'
ADMIN = 'monika.kovacheva@eventat.bg'
MODERATOR = 'georgi.petrov@eventat.bg'
SUPPORT = 'daniela.valcheva@eventat.bg'
ACCOUNTING = 'krasimir.yotov@eventat.bg'
CLIENT = 'maria.dimitrova@gmail.com'
PARTNER = 'studio.melodia@gmail.com'


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
                       capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError(f'SQL failed: {query}\n{r.stderr[-800:]}')
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
    expect(page.locator('.ui-toast.is-on')).to_contain_text(text, timeout=15000)


def sign_in(ctx, base, email):
    r = ctx.request.post(base + '/api/auth/sign-in/email', data={'email': email, 'password': PASSWORD}, headers={'Origin': base})
    assert r.ok, f'sign-in failed for {email}: {r.status}'


def booking_url(base, number):
    return base + '/admin/rezervacii/' + quote(number)


def case_url(base, number):
    return base + '/admin/sporove/' + quote(number)


# Business "now" of the demo clock, as SQL (the seed shifts the clock to 31 Aug 2025).
NOW_SQL = "(now() + (select (value::text)::bigint from platform_settings where key = 'clock_offset_ms' order by effective_from desc, created_at desc limit 1) * interval '1 millisecond')"


def main():
    args = sys.argv[1:]
    base = 'http://localhost:3209'
    if '--base' in args: base = args[args.index('--base') + 1]
    if '--no-reset' not in args:
        print('resetting database…'); reset_db()

    routes = ['/admin/rezervacii', '/admin/rezervacii/' + quote('2026-0614-ЕА'), '/admin/sporove', '/admin/sporove/' + quote('2026-0607-СВ'),
              '/admin/plashtaniya', '/admin/imeyli', '/admin/imeyli/client-welcome']
    batch_id = one("select id from payout_batch where status = 'paid' order by batch_date desc limit 1")['id']
    routes.append('/admin/plashtaniya/partidi/' + batch_id)

    with sync_playwright() as p:
        b = p.chromium.launch(headless='--headed' not in args)

        # ── guards ──────────────────────────────────────────────────────
        guest = b.new_context(); g = guest.new_page()
        for r in routes:
            g.goto(base + r)
            assert '/vhod' in g.url, (r, g.url)
        r404 = guest.request.get(base + '/admin/imeyli/client-welcome/preview', max_redirects=0)
        assert r404.status in (302, 303, 307, 308), r404.status
        guest.close()
        step('a guest is sent to sign-in from every route')
        for email, home in ((CLIENT, '/akaunt'), (PARTNER, '/partner')):
            c = b.new_context(); sign_in(c, base, email); pg = c.new_page()
            for r in routes:
                pg.goto(base + r)
                assert '/admin' not in pg.url and home in pg.url, (email, r, pg.url)
            c.close()
        step('clients and partners are sent to their own home')
        c = b.new_context(); sign_in(c, base, SUPPORT); pg = c.new_page()
        for r in ('/admin/sporove', '/admin/sporove/' + quote('2026-0607-СВ'), '/admin/plashtaniya', '/admin/plashtaniya/partidi/' + batch_id):
            pg.goto(base + r)
            assert pg.url.rstrip('/').endswith('/admin'), (r, pg.url)
        pg.goto(base + '/admin/rezervacii')
        assert '/admin/rezervacii' in pg.url
        expect(pg.locator('.am-reg thead')).not_to_contain_text('Комисиона')
        c.close()
        step('support: no Спорове or Плащания (redirected), bookings without the commission column')
        c = b.new_context(); sign_in(c, base, ACCOUNTING); pg = c.new_page()
        pg.goto(base + '/admin/plashtaniya')
        expect(pg.locator('h1.page-title')).to_have_text('Плащания')
        expect(pg.locator('button:has-text("Пусни")')).to_have_count(0)
        pg.goto(base + '/admin/sporove')
        assert pg.url.rstrip('/').endswith('/admin'), pg.url
        c.close()
        step('accounting: sees Плащания without the release buttons, no Спорове')

        ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='bg-BG', timezone_id='Europe/Sofia', accept_downloads=True)
        sign_in(ctx, base, ADMIN)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('response', lambda r: errors.append(f'{r.status} {r.url}') if r.status >= 500 else None)

        for r in routes:
            resp = page.goto(base + r)
            assert resp.status == 200, (r, resp.status)
        r = page.goto(booking_url(base, '2099-0101-ЯЯ'))
        assert r.status == 404, r.status
        r = page.goto(case_url(base, '2099-0101-ЯЯ'))
        assert r.status == 404, r.status
        step('every route loads for the admin; unknown numbers are 404')

        # ── Резервации: the register ────────────────────────────────────
        page.goto(base + '/admin/rezervacii')
        expect(page.locator('.topbar-title')).to_have_text('Резервации')
        expect(page.locator('.am-att tbody tr')).to_have_count(4)
        page.click('.filter-btn:has-text("2026")')
        page.click('.ui-menu a:has-text("Юни 2026")')
        page.wait_for_url(re.compile(r'mesec=2026-06'))
        expect(page.locator('.month-div b')).to_have_text('Юни 2026')
        expect(page.locator('.am-reg tbody')).to_contain_text('2026-0614-ЕА')
        expect(page.locator('.am-reg tbody tr')).to_have_count(8)
        step('the month dropdown shows June 2026')
        page.click('.filter-btn:has-text("Категория")')
        page.click('.ui-menu a:has-text("DJ и озвучаване")')
        page.wait_for_url(re.compile(r'kategoriya='))
        expect(page.locator('.am-reg tbody tr')).to_have_count(2)
        expect(page.locator('.am-reg tbody')).not_to_contain_text('Snap360')
        page.click('.filter-btn:has-text("DJ и озвучаване")')
        page.click('.ui-menu a:has-text("Всички категории")')
        page.wait_for_url(lambda u: 'kategoriya' not in u)
        step('the category dropdown filters the register through the URL')
        page.click('.tab-bar a:has-text("Чакат плащане")')
        page.wait_for_url(re.compile(r'tab=chakat-plashtane'))
        expect(page.locator('.am-reg tbody tr')).to_have_count(1)
        expect(page.locator('.am-reg tbody')).to_contain_text('2026-0621-ТЛ')
        page.click('.tab-bar a:has-text("Анулирани")')
        page.wait_for_url(re.compile(r'tab=anulirani'))
        expect(page.locator('.ui-empty')).to_have_text('Няма записи в този изглед.')
        page.click('.tab-bar a:has-text("Изискват намеса")')
        page.wait_for_url(re.compile(r'tab=namesa'))
        expect(page.locator('.am-reg tbody tr')).to_have_count(4)
        step('tabs filter the month (awaiting payment, cancelled, needing attention)')
        page.click('button:has-text("Експорт")')
        toast(page, 'Справката се подготвя — ще я получите по имейл')
        rep = one("select params from report_job where kind = 'admin_bookings' order by created_at desc limit 1")
        assert rep and rep['params']['month'] == '2026-06', rep
        step('‹Експорт› records the report request')
        page.click('.am-reg tbody tr:has-text("2026-0621-ТЛ") td.c-main')
        page.wait_for_url(re.compile(r'/admin/rezervacii/2026-0621'))
        expect(page.locator('.topbar-title')).to_have_text('Резервация · № 2026-0621-ТЛ')
        step('a register row opens the booking')

        # ‹Удължи срока› from the attention card: a deadline within 4 hours.
        sql(f"update booking set payment_due_at = {NOW_SQL} + interval '3 hours' where number = '2026-0905-ПХ'")
        page.goto(base + '/admin/rezervacii')
        row = page.locator('.am-att tbody tr:has-text("2026-0905-ПХ")')
        expect(row).to_contain_text('Срокът изтича след 3 ч')
        row.locator('button:has-text("Удължи срока")').click()
        toast(page, 'Срокът е удължен с 24 часа')
        assert one("select payment_extensions from booking where number = '2026-0905-ПХ'")['payment_extensions'] == 1
        assert one("select 1 as x from email_outbox where template_key = 'client-payment-extended'"), 'no client email'
        assert one("select 1 as x from email_outbox where template_key = 'vendor-payment-deadline-extended'"), 'no partner email'
        expect(page.locator('.am-att tbody tr:has-text("2026-0905-ПХ")')).to_have_count(0)
        step('‹Удължи срока› in the attention card extends the deadline and emails both sides')
        page.locator('.am-att tbody tr:has-text("2026-0607-СВ") a:has-text("Виж спора")').click()
        page.wait_for_url(re.compile(r'/admin/sporove/2026-0607'))
        step('‹Виж спора› opens the case')

        # ── Резервация: the record ──────────────────────────────────────
        page.goto(booking_url(base, '2026-0614-ЕА'))
        expect(page.locator('.page-sub')).to_contain_text('№ 2026-0614-ЕА · сватба на 14 юни 2026')
        expect(page.locator('.bkg-party').first).to_contain_text('+359 88 412 7730')
        expect(page.locator('.bkg-money .split.is-fee')).to_contain_text('Комисиона (10%)')
        expect(page.locator('.bkg-money .split.is-total')).to_contain_text('1 305,00 €')
        mailto = page.locator('a:has-text("Свържи се с двете страни")').get_attribute('href')
        assert mailto.startswith('mailto:') and 'maria.dimitrova%40gmail.com' in mailto and 'studio.melodia%40gmail.com' in mailto, mailto
        assert '/admin/klienti/' in page.locator('a:has-text("Профил")').get_attribute('href')
        assert '/admin/partnyori/' in page.locator('a.bkg-party').get_attribute('href')
        with ctx.expect_page() as pdf_info:
            page.click('a:has-text("Свали PDF")')
        pdf = pdf_info.value
        pdf.wait_for_load_state()
        expect(pdf.locator('h1')).to_contain_text('Сватба на 14 юни 2026')
        assert pdf.title() == 'Резервация 2026-0614-ЕА', pdf.title()
        pdf.close()
        step('booking: parties, money split, ‹Свържи се› mailto, ‹Свали PDF› print view')
        notes0 = one("select count(*)::int as n from admin_note where subject_type = 'booking'")['n']
        page.fill('textarea[name="body"]', 'Клиентът потвърди часа по телефона.')
        page.keyboard.press('Tab')
        expect(page.locator('.rev-text').first).to_have_text('Клиентът потвърди часа по телефона.', timeout=15000)
        assert one("select count(*)::int as n from admin_note where subject_type = 'booking'")['n'] == notes0 + 1
        step('‹Вътрешна бележка› saves on blur and shows at the top')

        page.goto(booking_url(base, '2026-1219-ДК'))
        page.click('button:has-text("Удължи срока")')
        toast(page, 'Срокът е удължен с 24 часа')
        assert one("select payment_extensions from booking where number = '2026-1219-ДК'")['payment_extensions'] == 1
        expect(page.locator('.tl-title:has-text("Срокът е удължен с 24 часа")')).to_have_count(1)
        step('‹Удължи срока› on the record (awaiting payment)')

        page.goto(booking_url(base, '2026-0719-ГП'))
        page.click('button:has-text("Анулирай резервацията")')
        dlg = page.locator('dialog[open]')
        expect(dlg.locator('.split').first).to_contain_text('1 450,00 €')
        dlg.locator('input[name="refund"]').fill('1000')
        dlg.locator('textarea[name="reason"]').fill('Изпълнителят не може да осигури техниката за датата.')
        dlg.locator('button[type="submit"]').click()
        toast(page, 'Резервацията е анулирана')
        bk = one("select status, cancelled_by from booking where number = '2026-0719-ГП'")
        assert bk == {'status': 'cancelled', 'cancelled_by': 'team'}, bk
        assert one("select sum(r.amount_cents)::int as s from refund r join booking b on b.id = r.booking_id where b.number = '2026-0719-ГП'")['s'] == 100000
        assert one("select 1 as x from email_outbox where template_key = 'client-vendor-cancelled'"), 'no client email'
        expect(page.locator('.page-head .badge').first).to_have_text('Анулирана')
        step('‹Анулирай резервацията› (team, K11) with the reason and a chosen refund')

        # A partner's cancellation request: decline it (K10), then complete another (K9).
        for n in ('2026-1219-ЕА', '2026-1219-ТД'):
            sql("update booking set status = 'cancellation_requested' where number = $1", n)
            sql("insert into partner_cancellation_request (booking_id, requested_by) select b.id, m.user_id from booking b join partner_member m on m.partner_id = b.partner_id where b.number = $1 limit 1", n)
        page.goto(booking_url(base, '2026-1219-ЕА'))
        expect(page.locator('.page-head .badge').first).to_have_text('Искане за анулиране')
        page.click('button:has-text("Откажи анулирането")')
        toast(page, 'Искането за анулиране е отказано')
        assert one("select status from booking where number = '2026-1219-ЕА'")['status'] == 'confirmed'
        page.goto(booking_url(base, '2026-1219-ТД'))
        page.click('button:has-text("Анулирай резервацията")')
        dlg = page.locator('dialog[open]')
        expect(dlg).to_contain_text('Връща се')
        dlg.locator('button[type="submit"]').click()
        toast(page, 'Резервацията е анулирана')
        bk = one("select status, cancelled_by from booking where number = '2026-1219-ТД'")
        assert bk == {'status': 'cancelled', 'cancelled_by': 'partner'}, bk
        step('a partner\'s cancellation request: declined (K10) and completed with a full refund (K9)')

        page.goto(booking_url(base, '2026-0614-МЗ'))
        page.click('button:has-text("Отвори спор")')
        dlg = page.locator('dialog[open]')
        dlg.locator('select[name="reason"]').select_option('not_as_described')
        dlg.locator('textarea[name="description"]').fill('Квартетът иска да промени програмата на церемонията.')
        dlg.locator('button[type="submit"]').click()
        page.wait_for_url(re.compile(r'/admin/sporove/2026-0614-'))
        toast(page, 'Спорът е отворен')
        d = one("select opened_by, title, holds_payout from dispute where number = '2026-0614-МЗ'")
        assert d == {'opened_by': 'team', 'title': 'Услугата не беше по описание', 'holds_payout': True}, d
        expect(page.locator('.tl-title').first).to_have_text('Екипът отвори спор')
        step('‹Отвори спор› opens a team case and lands on it')

        # ── Спорове: the queue ──────────────────────────────────────────
        page.goto(base + '/admin/sporove')
        expect(page.locator('.topbar-title')).to_have_text('Спорове и възстановявания')
        expect(page.locator('.page-sub')).to_contain_text('5 отворени')
        page.click('.seg a:has-text("Отворени")')
        page.wait_for_url(re.compile(r'filter=otvoreni'))
        expect(page.locator('.case')).to_have_count(5)
        expect(page.locator('.case.is-done')).to_have_count(0)
        page.click('.seg a:has-text("Решени")')
        page.wait_for_url(re.compile(r'filter=resheni'))
        expect(page.locator('.case')).to_have_count(3)
        expect(page.locator('.case.is-done')).to_have_count(3)
        page.click('.seg a:has-text("Всички")')
        page.wait_for_url(lambda u: 'filter=' not in u)
        expect(page.locator('.case')).to_have_count(8)
        step('‹Отворени› / ‹Решени› / ‹Всички› filter the cases')
        page.click('a:has-text("Отвори кейса")')
        page.wait_for_url(re.compile(r'/admin/sporove/2026-0607-'))
        expect(page.locator('.topbar-title')).to_have_text('Кейс · № 2026-0607-СВ')
        expect(page.locator('.cs-party').first).to_contain_text('Подадоха сигнала')
        page.click('a:has-text("Назад към споровете")')
        page.wait_for_url(re.compile(r'/admin/sporove$'))
        page.click('.case:has-text("2025-0517-РД")')
        page.wait_for_url(re.compile(r'/admin/sporove/2025-0517-'))
        expect(page.locator('.cs-done-n')).to_have_text('Частично възстановяване — 30%')
        step('‹Отвори кейса›, ‹Назад към споровете›, a decided case shows its decision')

        # ── Кейс: the case page ─────────────────────────────────────────
        page.goto(case_url(base, '2026-0614-ФК'))
        page.click('button:has-text("Напомни на изпълнителя")')
        toast(page, 'Напомнянето е изпратено на Snap360')
        assert one("select 1 as x from dispute_message m join dispute d on d.id = m.dispute_id where d.number = '2026-0614-ФК' and m.kind = 'reminder'")
        assert one("select 1 as x from email_outbox where template_key = 'vendor-ticket-reminder'"), 'no reminder email'
        expect(page.locator('.tl-title:has-text("Писахме на Snap360")')).to_have_count(1)
        step('‹Напомни на изпълнителя› emails the partner and joins the timeline')
        page.click('button:has-text("Поискай още информация")')
        dlg = page.locator('dialog[open]')
        dlg.locator('textarea[name="question"]').fill('Можете ли да изпратите писменото потвърждение за часовете?')
        dlg.locator('button[type="submit"]').click()
        toast(page, 'Въпросът е изпратен до двете страни')
        assert one("select count(*)::int as n from email_outbox where template_key in ('client-dispute-info-request', 'vendor-ticket-info-request')")['n'] == 2
        step('‹Поискай още информация› asks both sides')
        page.click('button[role="switch"]')
        toast(page, 'Изплащането следва обичайния график')
        assert one("select holds_payout from dispute where number = '2026-0614-ФК'")['holds_payout'] is False
        assert one("select payout_hold from booking where number = '2026-0614-ФК'")['payout_hold'] is False
        page.click('button[role="switch"]')
        toast(page, 'Изплащането към Snap360 е спряно до решението')
        assert one("select holds_payout from dispute where number = '2026-0614-ФК'")['holds_payout'] is True
        step('the payout-hold switch (D13) turns the hold off and on')
        page.click('.res-opt:has-text("Върни разликата")')
        expect(page.locator('.res-opt.is-on')).to_contain_text('Върни разликата')
        page.click('button:has-text("Приложи решението")')
        expect(page.locator('textarea[name="motive"]:invalid')).to_have_count(1)
        page.fill('textarea[name="motive"]', 'Платени са 4 часа, а Snap360 може да осигури 3. Връщаме разликата до цената на пакета за 3 часа.')
        page.click('button:has-text("Приложи решението")')
        page.wait_for_url(re.compile(r'/admin/sporove$'))
        toast(page, 'Решението е изпратено до двете страни')
        d = one("select status, decision_kind, refund_cents from dispute where number = '2026-0614-ФК'")
        assert d == {'status': 'resolved', 'decision_kind': 'partial_refund', 'refund_cents': 14000}, d
        assert one("select 1 as x from email_outbox where template_key = 'client-dispute-decision'") and one("select 1 as x from email_outbox where template_key = 'vendor-ticket-decision'")
        step('‹Приложи решението› needs the motive, applies the option and emails both sides')

        page.goto(case_url(base, '2026-0630-АБ'))
        page.click('button:has-text("Напомни на клиента")')
        dlg = page.locator('dialog[open]')
        dlg.locator('textarea[name="need"]').fill('Студио Мелодия има нужда от контакт с отговорното лице за програмата.')
        dlg.locator('button[type="submit"]').click()
        toast(page, 'Напомнянето е изпратено на СУ „Христо Ботев“')
        assert one("select 1 as x from email_outbox where template_key = 'client-ticket-reminder'"), 'no client reminder'
        step('‹Напомни на клиента› asks what is needed and emails the client')

        page.goto(case_url(base, '2026-0621-ТЛ'))
        expect(page.locator('.cs-warn')).to_contain_text('Срокът за плащане изтича след')
        page.click('button:has-text("Удължи срока с 24 часа")')
        toast(page, 'Срокът за плащане е удължен с 24 часа')
        assert one("select payment_extensions from booking where number = '2026-0621-ТЛ'")['payment_extensions'] == 1
        assert one("select 1 as x from payment_extension e join dispute d on d.id = e.dispute_id where d.number = '2026-0621-ТЛ'"), 'extension not linked to the case'
        page.click('a:has-text("Виж редакцията")')
        page.wait_for_url(re.compile(r'/admin/moderatsiya\?usluga='))
        page.goto(case_url(base, '2026-0621-ТЛ'))
        page.fill('textarea[name="motive"]', 'Новата цена още не е одобрена в Модерация. Технолинк плаща одобрените 3 200 €.')
        page.click('button:has-text("Приложи решението")')
        page.wait_for_url(re.compile(r'/admin/sporove$'))
        toast(page, 'Решението е изпратено до двете страни')
        assert one("select amount_cents from booking where number = '2026-0621-ТЛ'")['amount_cents'] == 320000
        step('case 2026-0621-ТЛ: ‹Удължи срока с 24 часа›, ‹Виж редакцията →›, ‹Върни одобрената цена›')

        page.goto(case_url(base, '2026-0614-МЗ'))
        expect(page.locator('.res-opt')).to_have_count(3)
        page.click('.res-opt:has-text("Затвори сигнала")')
        page.fill('textarea[name="motive"]', 'Програмата е уточнена с квартета.')
        page.click('button:has-text("Приложи решението")')
        page.wait_for_url(re.compile(r'/admin/sporove$'))
        toast(page, 'Решението е изпратено до двете страни')
        assert one("select status, decision_kind from dispute where number = '2026-0614-МЗ'") == {'status': 'resolved', 'decision_kind': 'close'}
        step('a team case without composed options decides with the §4.11 defaults')

        # ── Плащания ────────────────────────────────────────────────────
        page.goto(base + '/admin/plashtaniya')
        expect(page.locator('.topbar-title')).to_have_text('Плащания и изплащания')
        page.click('button:has-text("Счетоводна справка")')
        toast(page, 'Справката се подготвя — ще я получите по имейл')
        assert one("select 1 as x from report_job where kind = 'accounting'"), 'no accounting report'
        step('‹Счетоводна справка› records the request')
        page.click('.am-hist tbody tr:has-text("15.05.2025") td.c-date')
        toast(page, 'Отчетът за партидата се подготвя — ще го получите по имейл')
        assert one("select 1 as x from email_outbox where template_key = 'team-batch-report' and to_email = $1", ADMIN), 'no batch report email'
        step('a history row requests the batch report (team-batch-report)')
        page.click('.am-hist a:has-text("Партида май · първа половина")')
        page.wait_for_url(re.compile(r'/admin/plashtaniya/partidi/'))
        expect(page.locator('.am-lines tbody')).to_contain_text('2025-0509-СВ')
        with page.expect_download() as dl:
            page.click('a:has-text("Свали отчета")')
        path = dl.value.path()
        with open(path, encoding='utf-8-sig') as f:
            head = f.readline()
        assert head.startswith('Партида;Дата на партидата;Изпълнител'), head
        page.click('.am-lines tbody tr td.c-main')
        page.wait_for_url(re.compile(r'/admin/rezervacii/2025-0509-'))
        step('a batch page: items and lines, ‹Свали отчета› CSV, a line opens its booking')

        page.goto(base + '/admin/plashtaniya')
        page.click('.am-acct button:has-text("Откажи")')
        dlg = page.locator('dialog[open]')
        dlg.locator('textarea[name="reason"]').fill('Титулярят в документа е друго лице.')
        dlg.locator('button[type="submit"]').click()
        toast(page, 'Сметката е отказана')
        assert one("select status from payout_account where status = 'rejected'"), 'not rejected'
        sql("insert into payout_account (partner_id, iban_last4, holder_name, bank_name, status) select partner_id, '4411', holder_name, bank_name, 'pending_verification' from payout_account where status = 'rejected' limit 1")
        page.goto(base + '/admin/plashtaniya')
        page.click('.am-acct button:has-text("Потвърди")')
        toast(page, 'Сметката е потвърдена')
        assert one("select 1 as x from payout_account where iban_last4 = '4411' and status = 'confirmed'"), 'not confirmed'
        assert one("select 1 as x from email_outbox where template_key = 'vendor-payout-account-confirmed'"), 'no confirmation email'
        expect(page.locator('.am-acct')).to_have_count(0)
        step('pending payout account: ‹Откажи› with a reason, ‹Потвърди›')

        expect(page.locator('button.btn--block:has-text("Пусни партидата")')).to_be_disabled()
        # Move the demo clock to Monday 1 September 2025, 10:00 (Sofia): the batch day.
        sql("insert into platform_settings (key, value) values ('clock_offset_ms', to_jsonb((extract(epoch from (timestamptz '2025-09-01 10:00 Europe/Sofia' - now())) * 1000)::bigint))")
        time.sleep(6)
        page.goto(base + '/admin/plashtaniya')
        expect(page.locator('button.btn--block:has-text("Пусни партидата")')).to_be_enabled()
        page.click('button.btn--block:has-text("Пусни партидата")')
        dlg = page.locator('dialog[open]')
        expect(dlg).to_contain_text('Партида август · втора половина')
        dlg.locator('button[type="submit"]').click()
        toast(page, 'Партидата е пусната')
        st = one("select status, released_by is not null as rel from payout_batch where batch_date = '2025-09-01'")
        assert st['status'] in ('released', 'paid') and st['rel'], st
        assert one("select 1 as x from audit_log where action = 'payout.batch_released'"), 'no audit'
        step('‹Пусни партидата›: confirm dialog, the batch is released on its day')

        # ── Имейли ──────────────────────────────────────────────────────
        page.goto(base + '/admin/imeyli')
        expect(page.locator('.topbar-title')).to_have_text('Автоматични имейли')
        expect(page.locator('.em-row')).to_have_count(90)
        page.click('.seg a:has-text("Екип")')
        page.wait_for_url(re.compile(r'audience=team'))
        expect(page.locator('.em-row')).to_have_count(13)
        expect(page.locator('.em-g')).to_have_text('Към екипа')
        page.click('.seg a:has-text("Всички")')
        page.wait_for_url(lambda u: 'audience' not in u)
        page.fill('.am-search input', 'партида')
        page.keyboard.press('Enter')
        page.wait_for_url(re.compile(r'q='))
        n = page.locator('.em-row').count()
        assert 0 < n < 10, n
        step('‹Всички› / ‹Екип› and the search filter the catalogue')
        page.click('.em-row:has-text("Отчет за партида")')
        page.wait_for_url(re.compile(r'/admin/imeyli/team-batch-report'))
        expect(page.locator('.em-row.is-sel')).to_contain_text('Отчет за партида')
        expect(page.locator('.em-sent').first).to_contain_text('1 изпратен')
        frame = page.frame_locator('iframe.em-frame')
        expect(frame.locator('.env-subj')).to_contain_text('Отчетът за партида')
        expect(frame.locator('.mail-h')).to_contain_text('Отчетът е готов')
        page.click('.em-meta a:has-text("Плащания →")')
        page.wait_for_url(re.compile(r'/admin/plashtaniya$'))
        step('a row selects the email: preview with sample values, sends count, ‹Плащания →›')
        page.goto(base + '/admin/imeyli')
        page.click('.am-mail-tabs a:has-text("Изпратени")')
        page.wait_for_url(re.compile(r'izgled=izprateni'))
        sent = one("select count(*)::int as n from email_outbox")['n']
        assert page.locator('.em-row').count() == min(sent, 60)
        page.click('.em-row:has-text("vendor-ticket-reminder"), .em-row:has-text("Напомняне")')
        page.wait_for_url(re.compile(r'msg='))
        msg_id = re.search(r'msg=([0-9a-f-]+)', page.url).group(1)
        expect(page.locator('iframe.em-frame')).to_have_attribute('src', re.compile(msg_id))
        expect(page.frame_locator('iframe.em-frame').locator('.env-row').nth(1)).to_contain_text('@')
        step('‹Изпратени› lists the outbox; a message previews what went out')

        assert not errors, errors
        b.close()
    print(f'\nALL PASSED ({len(PASSED)} checks)')


if __name__ == '__main__':
    main()
