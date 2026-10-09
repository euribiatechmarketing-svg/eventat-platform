#!/usr/bin/env python3
"""End-to-end check of the client-booking area with real clicks and typing.

Usage: python3 tests/e2e/client-booking.py [--base http://localhost:3203] [--no-reset]

Resets and seeds the database named in .env.local (local only) unless --no-reset,
then drives the running dev server with Playwright: guards, the requests list and
its filters, a package request → partner approval → failed and successful card
payment → confirmation, a bank transfer, the invoice (resend + printable file),
a client cancellation with the exact quote, a review, an open request (brief)
and a quote offer chosen by the client. The partner's side of a flow and the
database checks go through tests/e2e/client-booking-helper.ts.
"""
import json, os, re, struct, subprocess, sys, tempfile, zlib
from urllib.parse import quote, unquote
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE = 'http://localhost:3203'
if '--base' in sys.argv: BASE = sys.argv[sys.argv.index('--base') + 1]
CLIENT = 'maria.dimitrova@gmail.com'
PW = 'eventat-demo'
ENV = dict(os.environ, PATH=os.path.expanduser('~/nodejs22/bin') + ':' + os.environ.get('PATH', ''))

def run(*cmd):
    r = subprocess.run(cmd, cwd=ROOT, env=ENV, capture_output=True, text=True)
    if r.returncode: raise RuntimeError(f'{cmd}: {r.stderr[-2000:]}')
    return r.stdout

def h(*args):
    out = run('npx', 'tsx', '--conditions=react-server', 'tests/e2e/client-booking-helper.ts', *[str(a) for a in args])
    return json.loads(out.strip().splitlines()[-1])

def png(path, rgb):
    raw = b'\x00' + bytes(rgb) * 8
    data = b''.join([raw] * 8)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 8, 8, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(data)) + chunk(b'IEND', b''))

passed = []
def ok(name): passed.append(name); print('  ✓', name)

def sign_in(ctx, email):
    r = ctx.request.post(BASE + '/api/auth/sign-in/email', data={'email': email, 'password': PW}, headers={'Origin': BASE})
    assert r.ok, f'sign-in {email}: {r.status}'

def toast(page, text):
    expect(page.locator('.ui-toast.is-on')).to_contain_text(text, timeout=10000)

def path_of(page): return unquote(page.url.replace(BASE, ''))

def main():
    if '--no-reset' not in sys.argv:
        print('resetting the database…')
        run('npm', 'run', 'db:reset'); run('npm', 'run', 'db:seed', '--', '--force')
    tmp = tempfile.mkdtemp()
    shots = [os.path.join(tmp, f'p{i}.png') for i in range(3)]
    for i, p in enumerate(shots): png(p, (40 * i + 80, 90, 160))

    with sync_playwright() as p:
        b = p.chromium.launch()

        # ── guards ──────────────────────────────────────────────────────
        guest = b.new_context(viewport={'width': 1440, 'height': 900})
        g = guest.new_page()
        g.goto(BASE + '/akaunt/zayavki?status=odobreni')
        assert path_of(g).startswith('/vhod?next=/akaunt/zayavki?status=odobreni'), path_of(g)
        g.goto(BASE + '/zayavka/studio-melodiya?data=2026-09-12&gosti=80')
        assert path_of(g).startswith('/registratsiya?next=/zayavka/studio-melodiya?data=2026-09-12&gosti=80'), path_of(g)
        g.goto(BASE + '/plashtane/2026-1219-ДК')
        assert path_of(g).startswith('/registratsiya?next=/plashtane/'), path_of(g)
        guest.close()
        for email, home in (('studio.melodia@gmail.com', '/partner'), ('monika.kovacheva@eventat.bg', '/admin')):
            c = b.new_context(); sign_in(c, email); pg = c.new_page()
            for route in ('/akaunt/zayavki', '/akaunt/rezervacii/2026-0614-ЕА', '/zayavka/otvorena', '/plashtane/2026-1219-ДК'):
                pg.goto(BASE + route)
                assert path_of(pg).startswith(home), (email, route, path_of(pg))
            c.close()
        ok('guests sign in / register and come back; partners and admins go home')

        ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='bg-BG', timezone_id='Europe/Sofia')
        sign_in(ctx, CLIENT)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))

        foreign = h('foreign-request', CLIENT)
        f = h('foreign-records', CLIENT)
        assert all(f.values()), f
        for route in ('/akaunt/zayavki/' + quote(foreign), '/akaunt/zayavki/' + quote(f['unpaid']), '/akaunt/rezervacii/' + quote(f['confirmed']),
                      '/akaunt/rezervacii/' + quote(f['confirmed']) + '/anulirane', '/akaunt/rezervacii/' + quote(f['confirmed']) + '/faktura',
                      '/akaunt/rezervacii/' + quote(f['completed']) + '/revyu', '/plashtane/' + quote(f['unpaid']),
                      '/plashtane/' + quote(f['confirmed']) + '/potvardena', '/plashtane/test/' + f['chargeId'], '/api/invoices/' + f['invoiceId']):
            r = page.goto(BASE + route)
            assert r.status == 404, (route, r.status)
        ok("another client's requests, bookings, invoice file and checkout answer 404")

        # ── /akaunt/zayavki: groups, countdown, filters, tabs ───────────
        page.goto(BASE + '/akaunt/zayavki')
        expect(page.locator('.mine-t')).to_have_text(['Одобрени · чакат плащане', 'Чакат отговор', 'Приключени'])
        expect(page.locator('.mrow')).to_have_count(6)
        badge = ' '.join(page.locator('.mine--pay .badge').first.text_content().split())
        assert re.fullmatch(r'Остават \d\d:\d\d ч', badge), badge
        expect(page.locator('.tab-bar-item.is-active')).to_contain_text('Заявки6')
        page.click('button.filter-btn:has-text("Всички статуси")')
        page.click('.cb-filter-menu a:has-text("Отказани")')
        page.wait_for_url(re.compile(r'status=otkazani'))
        expect(page.locator('.mrow')).to_have_count(2)
        expect(page.locator('.mrow .badge')).to_have_text(['Датата е заета', 'Датата е заета'])
        page.click('button.filter-btn:has-text("Всички събития")')
        page.click('.cb-filter-menu a:has-text("Коледно парти")')
        page.wait_for_url(re.compile(r'sabitie-id=.*status=otkazani|status=otkazani.*sabitie-id='))
        expect(page.locator('.mrow')).to_have_count(1)
        expect(page.locator('.mrow-n')).to_have_text('Snap360')
        expect(page.locator('button.filter-btn').first).to_contain_text('Коледно парти · 19 декември 2026')
        page.click('.tab-bar-item:has-text("Резервации")')
        page.wait_for_url(re.compile(r'/akaunt/rezervacii\?sabitie-id='))
        expect(page.locator('.nx-t')).to_contain_text('Студио Мелодия · Парти програма, 5 часа')
        ok('requests list: groups, live countdown, status and event filters in the URL, tabs')

        page.goto(BASE + '/akaunt/zayavki')
        page.click('.mrow:has-text("2026-0614-ДК")')
        page.wait_for_url(re.compile(r'/akaunt/zayavki/2026-0614-'))
        expect(page.locator('.sh-t')).to_have_text('Запитването е изпратено')
        expect(page.locator('.clock-v')).to_have_text(re.compile(r'^\d\d:\d\d$'))
        page.click('button:has-text("Пиши на изпълнителя")')
        page.wait_for_url(re.compile(r'/akaunt/saobshteniya/[0-9a-f-]{36}$'))
        page.goto(BASE + '/akaunt/zayavki')
        page.click('.mrow:has-text("Ана Петрова") >> text=Виж подобни')
        page.wait_for_url(re.compile(r'/tarsene\?kategoriya=fotografiya&data=2026-06-14&grad=sofia&gosti=120'))
        ok('row → request page (countdown), ‹Пиши на изпълнителя› → thread, ‹Виж подобни› → search')

        # ── a declined request: watch the taken date ────────────────────
        assert h('remove-watch', CLIENT, 'snap360', '2026-12-19') == 0
        page.goto(BASE + '/akaunt/zayavki/' + quote('2026-1219-ФК'))
        expect(page.locator('.sh-t')).to_have_text('Заявката ви е отказана')
        page.click('button:has-text("Уведоми ме, ако се освободи")')
        toast(page, 'Ще ви известим, ако датата се освободи')
        expect(page.locator('button:has-text("Уведоми ме, ако се освободи")')).to_have_count(0)
        assert h('watching', CLIENT, 'snap360', '2026-12-19') == 1
        ok('declined request: ‹Уведоми ме, ако се освободи› → date watch')

        # ── a package request: form, photos, send ───────────────────────
        d1 = h('free-date', 'studio-melodiya')
        page.goto(BASE + '/zayavka/studio-melodiya')
        page.select_option('select[name=eventTypeId]', label='Рожден ден')
        page.fill('input[name=eventDate]', d1)
        page.fill('input[name=startTime]', '19:00')
        page.fill('input[name=endTime]', '23:30')
        page.fill('input[name=guests]', '80')
        page.fill('input[name=venueName]', 'Ресторант „Тест“')
        page.fill('input[name=locality]', 'София')
        page.click('label.opt:has-text("Закрита зала")')
        page.click('label.opt:has-text("Пакет „Вечер“")')
        expect(page.locator('.sum-row:has-text("Пакет") b')).to_have_text('„Вечер“')
        expect(page.locator('.sum-total b')).to_have_text('640 €')
        page.fill('textarea[name=note]', 'Здравейте, търсим DJ за рожден ден с музика от 90-те.')
        page.set_input_files('.cb-drop input[type=file]', shots[:2])
        expect(page.locator('input[type=hidden][name=photo]')).to_have_count(2, timeout=15000)
        expect(page.locator('.sum-row:has-text("Прикачени") b')).to_have_text('2 снимки за вдъхновение')
        page.click('.rw-shot >> nth=0 >> button[aria-label="Премахни снимката"]')
        toast(page, 'Снимката е премахната')
        expect(page.locator('input[type=hidden][name=photo]')).to_have_count(1)
        page.click('button:has-text("Изпрати заявката")')
        page.wait_for_url(re.compile(r'/akaunt/zayavki/\d{4}-\d{4}-'))
        n1 = path_of(page).rsplit('/', 1)[1]
        expect(page.locator('.sh-t')).to_have_text('Запитването е изпратено')
        expect(page.locator('.sh-badge')).to_have_text('Чака отговор')
        rq = h('request', n1)
        assert rq['status'] == 'pending' and rq['photos'] == 1 and rq['space_type'] == 'indoor' and rq['amount_cents'] == 64000 and rq['guests'] == 80, rq
        ok(f'request form → {n1} pending with 1 photo, ‹Закрита зала›, 640 €')

        # ── partner approves; card payment fails, then succeeds ─────────
        h('approve', 'studio-melodiya', n1)
        page.reload()
        expect(page.locator('.sh-t')).to_have_text('Студио Мелодия одобри заявката ви')
        page.click('a.btn:has-text("Плати 640 €")')
        page.wait_for_url(re.compile(r'/plashtane/' + re.escape(quote(n1)) + '$'))
        expect(page.locator('input[name=method][value=card]')).to_be_checked()
        expect(page.locator('.h-sub')).to_contain_text(re.compile(r'Остават \d\d:\d\d часа'))
        page.click('button:has-text("Плати 640 €")')
        page.wait_for_url(re.compile(r'/plashtane/test/[0-9a-f-]{36}$'))
        page.click('button:has-text("Откажи плащането")')
        page.wait_for_url(re.compile(r'/plashtane/' + re.escape(quote(n1)) + '$'))
        expect(page.locator('.form-alert')).to_be_visible()
        page.click('button:has-text("Плати 640 €")')
        page.wait_for_url(re.compile(r'/plashtane/test/'))
        page.click('button:has-text("Плати")')
        page.wait_for_url(re.compile(r'/potvardena$'))
        expect(page.locator('.done-t')).to_have_text('Резервацията е потвърдена')
        expect(page.locator('.done-d')).to_contain_text(CLIENT)
        bk = h('booking', n1)
        assert bk['status'] == 'confirmed' and [c['status'] for c in bk['charges']] == ['failed', 'succeeded'], bk
        page.click('a:has-text("Виж резервацията")')
        page.wait_for_url(re.compile(r'/akaunt/rezervacii/'))
        expect(page.locator('.h-right .badge')).to_have_text('Потвърдена')
        ok('approval → ‹Плати› → failed checkout → paid → confirmation → booking page')

        # ── bank transfer on the seeded approved request ────────────────
        page.goto(BASE + '/akaunt/zayavki')
        page.click('.mrow:has-text("2026-1219-ДК") >> text=Плати')
        page.wait_for_url(re.compile(r'/plashtane/2026-1219-'))
        before = h('outbox', 'client-bank-transfer', CLIENT)
        page.click('label.pay-method:has-text("Банков превод")')
        page.click('button:has-text("Плати 460 €")')
        expect(page.locator('.cb-transfer')).to_contain_text('BG80 BNBG 9661 1020 3456 78')
        expect(page.locator('.cb-transfer')).to_contain_text('2026-1219-ДК')
        bk = h('booking', '2026-1219-ДК')
        assert bk['status'] == 'awaiting_payment' and bk['charges'][-1]['method'] == 'bank_transfer' and bk['charges'][-1]['status'] == 'awaiting_transfer', bk
        assert h('outbox', 'client-bank-transfer', CLIENT) == before + 1
        ok('‹Банков превод› → provider instructions on the page + client-bank-transfer email')

        # ── invoice: resend and the printable file ──────────────────────
        page.goto(BASE + '/akaunt/rezervacii')
        # The next event is now the booking paid above: its invoice was issued with the payment.
        expect(page.locator('.nx')).to_contain_text(n1)
        page.click('.nx a:has-text("Свали фактура")')
        page.wait_for_url(re.compile(r'/faktura$'))
        inv_no = page.locator('.inv-no').text_content().strip()
        assert re.fullmatch(r'№ \d{10}', inv_no), inv_no
        before = h('outbox', 'client-invoice', CLIENT)
        page.click('button:has-text("Изпрати по имейл")')
        toast(page, 'Изпратихме документа на имейла ви')
        assert h('outbox', 'client-invoice', CLIENT) == before + 1
        with page.expect_popup() as pop:
            page.click('a:has-text("Свали PDF")')
        toast(page, 'Файлът се изтегля')
        doc = pop.value
        doc.wait_for_load_state()
        assert '/api/invoices/' in doc.url
        expect(doc.locator('.inv-no')).to_have_text(inv_no)
        expect(doc.locator('.inv-foot')).to_contain_text('валидна без подпис и печат')
        doc.close()
        ok('invoice page: ‹Изпрати по имейл› queues client-invoice; ‹Свали PDF› opens the printable invoice')

        # ── cancel a booking with the exact quote ───────────────────────
        page.goto(BASE + '/akaunt/rezervacii')
        page.click('.mrow:has-text("Коледна торта за 40 гости") >> text=Детайли')
        page.wait_for_url(re.compile(r'/akaunt/rezervacii/2026-1219-'))
        page.click('a:has-text("Анулиране")')
        page.wait_for_url(re.compile(r'/anulirane$'))
        expect(page.locator('.cx-cell--back .cx-cell-v')).to_have_text('420 €')
        expect(page.locator('.cx-cell--back .cx-cell-n')).to_have_text('пълната сума')
        expect(page.locator('.h-sub')).to_contain_text('сумата се възстановява изцяло')
        expect(page.locator('textarea[name=reasonText]')).to_be_hidden()
        page.click('label.cx-pick:has-text("Друга причина")')
        page.fill('textarea[name=reasonText]', 'Променихме програмата на партито.')
        page.click('button:has-text("Анулирай резервацията")')
        page.wait_for_url(BASE + '/akaunt/rezervacii')
        toast(page, 'Резервацията е анулирана — изпратихме ви потвърждение по имейл')
        bk = h('booking', '2026-1219-ТД')
        assert bk['status'] == 'cancelled' and bk['cancelled_by'] == 'client' and bk['cancellation']['reason'] == 'other' \
            and bk['cancellation']['refund_cents'] == 42000 and bk['cancellation']['reason_text'] == 'Променихме програмата на партито.', bk
        expect(page.locator('.mrow:has-text("2026-1219-ТД") .badge, .mrow:has-text("Коледна торта") .badge')).to_have_text('Анулирана')
        ok('cancel page: quote 420 € back, ‹Друга причина› + text → cancelled, full refund')

        # ── review ──────────────────────────────────────────────────────
        page.click('a:has-text("Остави ревю")')
        page.wait_for_url(re.compile(r'/revyu$'))
        expect(page.locator('button:has-text("Публикувай ревюто")')).to_be_disabled()
        page.click('.rw-stars button[aria-label="5 звезди"]')
        expect(page.locator('.rw-verdict')).to_have_text('Отлично — бих ги препоръчала')
        for label, n in (('Комуникация', 5), ('Точност', 5), ('Качество', 4), ('Съотношение цена', 4)):
            page.click(f'.rw-mini button[aria-label="{label}: {n}"]')
        page.fill('textarea[name=body]', 'Тортата беше точно каквато я описахме, донесоха я навреме и всичко мина чудесно.')
        page.click('label.rw-chip:has-text("+ Спазиха часа")')
        page.set_input_files('.cb-drop input[type=file]', shots[2:3])
        expect(page.locator('input[type=hidden][name=photo]')).to_have_count(1, timeout=15000)
        page.click('button:has-text("Публикувай ревюто")')
        page.wait_for_url(BASE + '/akaunt/rezervacii')
        toast(page, 'Ревюто е публикувано')
        bk = h('booking', '2025-0424-СЛ')
        assert bk['review'] and bk['review']['rating'] == 5 and bk['review']['tags'] == ['+ Спазиха часа'] and bk['review']['photos'] == 1, bk
        expect(page.locator('a:has-text("Остави ревю")')).to_have_count(0)
        ok('review: stars, criteria, comment, tag, photo → published')

        # ── open request (brief) ────────────────────────────────────────
        page.goto(BASE + '/zayavka/otvorena')
        expect(page.locator('button:has-text("Изпрати запитването")')).to_be_disabled()
        expect(page.locator('.bf-s-cats')).to_have_text('изберете поне една')
        page.click('label.rw-chip:has-text("DJ и озвучаване")')
        page.click('label.rw-chip:has-text("Фотография")')
        expect(page.locator('.bf-s-cats')).to_have_text('DJ и озвучаване, Фотография')
        page.click('label.opt:has-text("Сватба")')
        page.fill('input[name=eventDate]', d1)
        page.fill('input[name=guests]', '100')
        page.select_option('select[name=city]', label='София')
        page.click('label.opt:has-text("1 000 – 2 000 €")')
        page.fill('textarea[name=description]', 'Сватба в градина, искаме спокойна музика на вечерята и много танци след това.')
        page.set_input_files('.cb-drop input[type=file]', shots[:1])
        expect(page.locator('input[type=hidden][name=photo]')).to_have_count(1, timeout=15000)
        expect(page.locator('.bf-s-city')).to_have_text('София')
        page.click('button:has-text("Изпрати запитването")')
        page.wait_for_url(BASE + '/akaunt/zayavki')
        toast(page, 'Запитването е изпратено — потвърждението е на имейла ви, а офертите идват в „Моите заявки“')
        br = h('latest-brief', CLIENT)
        assert br and br['categories'] == 2 and br['photos'] == 1 and br['budget_band'] == 'b1000_2000' and br['city'] == 'sofia' \
            and br['guests'] == 100 and br['invited'] >= 1 and br['jobs'] == br['invited'], br
        assert h('outbox', 'client-brief-sent', CLIENT) == 1
        ok(f"brief: 2 categories, budget, photo → sent to {br['invited']} partner(s), T3 jobs scheduled")

        # ── quote request → the partner's offer → the client chooses ────
        d2 = h('free-date', 'studio-melodiya')
        page.goto(BASE + '/zayavka/studio-melodiya')
        page.select_option('select[name=eventTypeId]', label='Фирмено събитие')
        page.fill('input[name=eventDate]', d2)
        page.fill('input[name=guests]', '60')
        page.click('label.opt:has-text("По запитване")')
        expect(page.locator('.sum-total b')).to_have_text('По оферта')
        page.click('button:has-text("Изпрати заявката")')
        page.wait_for_url(re.compile(r'/akaunt/zayavki/\d{4}-\d{4}-'))
        n2 = path_of(page).rsplit('/', 1)[1]
        assert h('request', n2)['kind'] == 'quote'
        h('quote', 'studio-melodiya', n2, 'Парти програма, 4 часа', 90000)
        page.goto(BASE + '/akaunt/zayavki')
        expect(page.locator('.mine-t')).to_have_text(['Одобрени · чакат плащане', 'Нова оферта', 'Чакат отговор', 'Приключени'])
        expect(page.locator('.mine:has(.mine-t:text-is("Нова оферта")) .mrow')).to_contain_text(n2)
        page.click(f'.mrow:has-text("{n2}") >> text=Виж офертата')
        page.wait_for_url(re.compile(r'/akaunt/zayavki/'))
        expect(page.locator('.sh-t')).to_have_text('Получихте оферта от Студио Мелодия')
        expect(page.locator('.sum-total b')).to_have_text('900 €')
        page.click('button:has-text("Избери")')
        expect(page.locator('.sh-badge')).to_have_text('Избрана оферта')
        assert h('request', n2)['status'] == 'awaiting_confirmation'
        ok('quote request → offer shown under ‹Нова оферта› → ‹Избери› → awaiting the partner')

        # ── back links ──────────────────────────────────────────────────
        page.goto(BASE + '/zayavka/studio-melodiya')
        page.click('a.btn:has-text("Назад")')
        page.wait_for_url(re.compile(r'/partnyori/studio-melodiya$'))
        page.goto(BASE + '/akaunt/rezervacii/2026-0614-ЕА/anulirane')
        page.click('a.btn:has-text("Назад")')
        page.wait_for_url(BASE + '/akaunt/rezervacii')
        ok('‹Назад› links')

        assert not errors, errors
        ctx.close()

        # ── 390 px: no page-wide horizontal scroll on any screen ────────
        phone = b.new_context(viewport={'width': 390, 'height': 844}, locale='bg-BG', timezone_id='Europe/Sofia')
        sign_in(phone, CLIENT)
        pg = phone.new_page()
        for route in ('/akaunt/zayavki', '/akaunt/zayavki/' + quote(n2), '/akaunt/zayavki/' + quote('2026-0614-ДК'),
                      '/akaunt/zayavki/' + quote('2026-0614-ФТ'), '/akaunt/rezervacii',
                      '/akaunt/rezervacii/' + quote(n1), '/akaunt/rezervacii/' + quote(n1) + '/anulirane', '/akaunt/rezervacii/' + quote(n1) + '/faktura',
                      '/zayavka/studio-melodiya', '/zayavka/otvorena', '/plashtane/' + quote('2026-1219-ДК'), '/plashtane/' + quote(n1) + '/potvardena'):
            pg.goto(BASE + route, wait_until='networkidle')
            assert path_of(pg) == unquote(route), (route, path_of(pg))
            wide = pg.evaluate('document.documentElement.scrollWidth')
            assert wide <= 390, (route, wide)
        phone.close()
        ok('every screen fits 390 px without horizontal scroll')

        # ── the simulated provider reports the bank transfer received ───
        ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='bg-BG', timezone_id='Europe/Sofia')
        sign_in(ctx, CLIENT)
        page = ctx.new_page()
        transfer = h('booking', '2026-1219-ДК')['charges'][-1]
        page.goto(BASE + '/plashtane/test/' + transfer['id'])
        expect(page.locator('.pay-method')).to_contain_text('Банков превод')
        page.click('button:has-text("Плати")')
        page.wait_for_url(re.compile(r'/plashtane/2026-1219-.*/potvardena$'))
        expect(page.locator('.done-t')).to_have_text('Резервацията е потвърдена')
        bk = h('booking', '2026-1219-ДК')
        assert bk['status'] == 'confirmed' and bk['charges'][-1]['status'] == 'succeeded', bk
        ctx.close()
        ok('simulated provider: bank transfer received → booking confirmed')
        b.close()
    print(f'\nall {len(passed)} checks passed')

if __name__ == '__main__':
    main()
