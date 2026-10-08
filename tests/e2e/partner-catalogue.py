#!/usr/bin/env python3
"""End-to-end: the partner catalogue & money screens with real clicks and typing.

  /partner/uslugi, /partner/uslugi/nova, /partner/uslugi/[id], /partner/profil, /partner/revyuta,
  /partner/prihodi (+ the report CSV), /partner/smetka, /partner/nastroyki, /partner/nastroyki/iztrivane

Usage:  python3 tests/e2e/partner-catalogue.py [--base http://localhost:3207] [--no-reset] [--headed]
The database in .env.local (DATABASE_URL) is reset and seeded first unless --no-reset is given,
so the run starts from the prototype's demo data (clock: 31 август 2025, 12:00).
"""
import json, os, re, subprocess, sys, tempfile, time, urllib.parse
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ARGS = sys.argv[1:]
BASE = ARGS[ARGS.index('--base') + 1] if '--base' in ARGS else 'http://localhost:3207'
PW = 'eventat-demo'
PARTNER = 'studio.melodia@gmail.com'
NODE_ENV = dict(os.environ, PATH=os.path.expanduser('~/nodejs22/bin') + os.pathsep + os.environ.get('PATH', ''))

def env_url():
    for line in open(os.path.join(ROOT, '.env.local'), encoding='utf-8'):
        if line.startswith('DATABASE_URL='):
            return line.split('=', 1)[1].strip()
    raise SystemExit('DATABASE_URL missing in .env.local')

DB_URL = env_url()
NODE_EVAL = """
import postgres from 'postgres';
const sql = postgres(process.env.E2E_DB, { onnotice: () => {} });
try { const r = await sql.unsafe(process.env.E2E_SQL); process.stdout.write(JSON.stringify(r)); }
finally { await sql.end(); }
"""

def db(query):
    out = subprocess.run(['node', '--input-type=module', '-e', NODE_EVAL], cwd=ROOT, capture_output=True, text=True,
                         env=dict(NODE_ENV, E2E_DB=DB_URL, E2E_SQL=query))
    if out.returncode:
        raise RuntimeError(out.stderr)
    return json.loads(out.stdout or '[]')

def one(query):
    rows = db(query)
    return rows[0] if rows else None

def reset():
    env = dict(NODE_ENV, DATABASE_URL=DB_URL)
    for script in ('db:reset', 'db:seed'):
        r = subprocess.run(['npm', 'run', script], cwd=ROOT, env=env, capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(r.stdout + r.stderr)
    time.sleep(6)  # the app caches the clock offset for 5 s

checks = 0
def ok(cond, what):
    global checks
    if not cond:
        raise AssertionError(what)
    checks += 1
    print('  ✓', what)

def toast(page, text):
    expect(page.locator('.ui-toast.is-on')).to_contain_text(text, timeout=15000)
    ok(True, f'toast «{text}»')
    # blank the toast so the next check waits for a new one
    page.evaluate("() => window.dispatchEvent(new CustomEvent('eventat:toast', { detail: { message: '', kind: 'ok' } }))")

def until(fn, what, timeout=10):
    end = time.time() + timeout
    while True:
        try:
            if fn():
                return ok(True, what)
        except (TypeError, KeyError, IndexError):
            pass
        if time.time() > end:
            return ok(False, what)
        time.sleep(0.25)

def sign_in(ctx, email):
    r = ctx.request.post(BASE + '/api/auth/sign-in/email', data={'email': email, 'password': PW}, headers={'Origin': BASE})
    assert r.ok, f'sign-in failed for {email}: {r.status} {r.text()[:200]}'

def path(page):
    u = urllib.parse.urlparse(page.url)
    return urllib.parse.unquote(u.path) + (('?' + urllib.parse.unquote(u.query)) if u.query else '')

def no_hscroll(page, route):
    w = page.evaluate('() => [document.documentElement.scrollWidth, window.innerWidth]')
    ok(w[0] <= w[1], f'{route}: no horizontal page scroll at {w[1]} px ({w[0]})')

PID = None
def partner_id():
    global PID
    if not PID:
        PID = one("select p.id from partner p join partner_member m on m.partner_id = p.id join \"user\" u on u.id = m.user_id where u.email = '%s'" % PARTNER)['id']
    return PID

def emails(key, since):
    return db("select vars from email_outbox where template_key = '%s' and created_at >= '%s'::timestamptz order by created_at desc" % (key, since))

def main():
    if '--no-reset' not in ARGS:
        print('reset + seed …'); reset()
    start = one("select now()::text as t")['t']
    tmp = tempfile.mkdtemp(prefix='e2e-pc-')
    photo = os.path.join(ROOT, 'public', 'photos', 'booth.jpg')
    pdf = os.path.join(tmp, 'izvlechenie.pdf')
    with open(pdf, 'wb') as f:
        f.write(b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
    pid = partner_id()

    with sync_playwright() as p:
        b = p.chromium.launch(headless='--headed' not in ARGS)

        # ── guards ──
        print('guards')
        ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='bg-BG', timezone_id='Europe/Sofia')
        page = ctx.new_page()
        for route in ['/partner/uslugi', '/partner/profil', '/partner/prihodi', '/partner/nastroyki']:
            page.goto(BASE + route)
            ok(path(page).startswith('/vhod'), f'guest {route} → sign-in ({path(page)})')
        sign_in(ctx, 'maria.dimitrova@gmail.com')
        page.goto(BASE + '/partner/uslugi')
        ok(path(page).startswith('/akaunt'), f'client /partner/uslugi → own home ({path(page)})')
        ctx.close()
        ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='bg-BG', timezone_id='Europe/Sofia')
        sign_in(ctx, 'monika.kovacheva@eventat.bg')
        page = ctx.new_page()
        page.goto(BASE + '/partner/smetka')
        ok(path(page).startswith('/admin'), f'admin /partner/smetka → own home ({path(page)})')
        ctx.close()

        ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='bg-BG', timezone_id='Europe/Sofia',
                            permissions=['clipboard-read', 'clipboard-write'])
        sign_in(ctx, PARTNER)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))

        # another partner's service is not found
        other = one("select s.id from service s where s.partner_id <> '%s' limit 1" % pid)['id']
        r = page.goto(BASE + '/partner/uslugi/' + other)
        ok(r.status == 404, "another partner's service → 404")

        # ── /partner/uslugi ──
        print('/partner/uslugi')
        page.goto(BASE + '/partner/uslugi')
        expect(page.locator('.page-sub')).to_contain_text('3 активни услуги · 1 чернова')
        ok(page.locator('.svc-card:not(.svc-add)').count() == 3, 'three active services')
        page.click('.tab-bar-item:has-text("Чернови")')
        page.wait_for_url(re.compile(r'tab=chernovi'))
        expect(page.locator('.svc-title')).to_have_text(['Фотокабина 360°'])
        ok(True, 'tab Чернови lists the draft')
        page.click('.filter-btn')
        page.click('.ui-menu a:has-text("DJ и озвучаване")')
        page.wait_for_url(re.compile(r'kategoriya=dj-i-ozvuchavane'))
        ok('tab=chernovi' in page.url, 'category filter keeps the tab in the URL')
        page.click('.tab-bar-item:has-text("Активни")')
        page.wait_for_url(re.compile(r'/partner/uslugi\?kategoriya=dj-i-ozvuchavane$'))
        page.click('button:has-text("Подреди")')
        page.locator('.svc-card').first.locator('button[aria-label="Премести надясно"]').click()
        expect(page.locator('.svc-title').first).to_have_text('Пакет „Вечер“')
        page.click('button:has-text("Запази промените")')
        toast(page, 'Подредбата е запазена')
        first = one("select name from service where partner_id = '%s' order by sort_order limit 1" % pid)['name']
        ok(first == 'Пакет „Вечер“', 'DB: new order saved (Пакет „Вечер“ first)')

        # ── /partner/uslugi/nova: draft ──
        print('/partner/uslugi/nova')
        page.click('a.btn:has-text("Добави услуга")')
        page.wait_for_url('**/partner/uslugi/nova')
        page.fill('input[name="name"]', 'Пакет „Церемония“')
        page.fill('textarea[name="description"]', 'Озвучаване за изнесена церемония на открито — дискретна колона и два безжични микрофона.')
        expect(page.locator('.svc-card .svc-title')).to_have_text('Пакет „Церемония“')
        ok(True, 'preview card follows the typing')
        page.click('.chip-add:has-text("+ Добави")')
        page.click('.ui-menu button:has-text("Сватби")')
        expect(page.locator('.chip-tag:has-text("Сватби")')).to_have_count(1)
        page.click('button:has-text("Добави точка")')
        page.fill('input[aria-label="Нова точка"]', 'Два безжични микрофона')
        page.keyboard.press('Enter')
        toast(page, 'Добавена е нова точка')
        page.click('button:has-text("Добави точка")')
        page.fill('input[aria-label="Нова точка"]', 'Ненужна точка')
        page.keyboard.press('Enter')
        page.click('button[aria-label="Премахни Ненужна точка"]')
        toast(page, 'Точката е премахната')
        page.fill('input[name="price"]', '420')
        page.fill('input[name="durationLabel"]', 'До 3 часа')
        page.fill('input[aria-label="Цена за допълнителен час"]', '150')
        page.click('label.check:has-text("Пътуване извън")')
        page.click('button:has-text("Избери от галерията")')
        toast(page, 'Изберете снимка от галерията си')
        page.locator('.pc-pick-item').nth(1).click()
        page.locator('button:has-text("Запази като чернова")').first.click()
        toast(page, 'Черновата е запазена')
        page.wait_for_url(re.compile(r'tab=chernovi'))
        s = one("select id, status, price_cents, extra_hour_enabled, extra_hour_price_cents, travel_fee_enabled, duration_label, cover_media_id, "
                "(select count(*) from service_inclusion i where i.service_id = s.id)::int as inc, "
                "(select count(*) from service_event_type e where e.service_id = s.id)::int as ets from service s where partner_id = '%s' and name = 'Пакет „Церемония“'" % pid)
        ok(s and s['status'] == 'draft' and s['price_cents'] == 42000 and s['extra_hour_enabled'] and s['extra_hour_price_cents'] == 15000
           and s['travel_fee_enabled'] and s['duration_label'] == 'До 3 часа' and s['cover_media_id'] and s['inc'] == 1 and s['ets'] == 1,
           'DB: draft saved with price, extra hour, travel, cover, 1 inclusion, 1 event type')
        draft_id = s['id']

        # ── /partner/uslugi/nova: submit, with an uploaded cover and validation ──
        page.goto(BASE + '/partner/uslugi/nova')
        page.click('.pol-opt:has-text("По запитване")')
        page.fill('input[name="name"]', 'Абитуриентски балове')
        page.locator('button:has-text("Изпрати за преглед")').first.click()
        expect(page.locator('.form-error').first).to_be_visible()
        ok(page.locator('.form-error:has-text("Въведете кратко описание.")').count() == 1, 'missing description is shown under the field')
        page.fill('textarea[name="description"]', 'Музика и озвучаване за абитуриентски балове, по индивидуална оферта.')
        page.click('.chip-add:has-text("+ Добави")')
        page.click('.ui-menu button:has-text("Абитуриентски балове")')
        with page.expect_file_chooser() as fc:
            page.click('button:has-text("Качи снимка")')
        fc.value.set_files(photo)
        toast(page, 'Снимката е качена')
        page.locator('button:has-text("Изпрати за преглед")').first.click()
        toast(page, 'Услугата е изпратена за преглед')
        page.wait_for_url(re.compile(r'tab=v-pregled'))
        s = one("select s.status, s.kind, s.price_cents, m.kind as cover_kind from service s left join media m on m.id = s.cover_media_id where s.partner_id = '%s' and s.name = 'Абитуриентски балове'" % pid)
        ok(s['status'] == 'pending_review' and s['kind'] == 'on_request' and s['price_cents'] is None and s['cover_kind'] == 'service_cover',
           'DB: on-request service in review with an uploaded cover')
        until(lambda: len(emails('vendor-service-submitted', start)) >= 1, 'email vendor-service-submitted queued')
        expect(page.locator('.svc-card .badge')).to_have_text(['В преглед'])

        # ── /partner/uslugi/[id]: a draft goes to review ──
        print('/partner/uslugi/[id]')
        page.goto(BASE + '/partner/uslugi?tab=chernovi')
        page.locator('.svc-card:has-text("Пакет „Церемония“") a:has-text("Редактирай")').click()
        page.wait_for_url('**/partner/uslugi/' + draft_id)
        expect(page.locator('input[name="price"]')).to_have_value('420')
        page.locator('button:has-text("Изпрати за преглед")').first.click()
        toast(page, 'Услугата е изпратена за преглед')
        until(lambda: one("select status from service where id = '%s'" % draft_id)['status'] == 'pending_review', 'DB: the draft is in review')

        # ── an active service: moderated change, visibility, archive ──
        page.goto(BASE + '/partner/uslugi')
        page.locator('.svc-card:has-text("Пакет „Вечер“") a:has-text("Редактирай")').click()
        page.wait_for_url(re.compile(r'/partner/uslugi/[0-9a-f-]{36}$'))
        vecher = page.url.rsplit('/', 1)[1]
        page.fill('input[name="price"]', '700')
        page.locator('button:has-text("Запази промените")').first.click()
        toast(page, 'Промените са изпратени за преглед')
        s = one("select price_cents from service where id = '%s'" % vecher)
        rev = one("select status, type, payload from service_revision where service_id = '%s' order by submitted_at desc limit 1" % vecher)
        ok(s['price_cents'] == 64000 and rev['status'] == 'pending' and rev['type'] == 'edit' and rev['payload']['priceCents'][1] == 70000,
           'DB: live price unchanged, edit revision pending with 700 €')
        until(lambda: len(emails('vendor-service-change-submitted', start)) >= 1, 'email vendor-service-change-submitted queued')
        page.goto(BASE + '/partner/uslugi/' + vecher)
        expect(page.locator('.se-live .badge')).to_have_text('Активна · промените чакат преглед')
        expect(page.locator('input[name="price"]')).to_have_value('700')
        ok(True, 'the editor shows the pending change')
        page.click('.se-status .pol-opt:has-text("Чернова")')
        toast(page, 'Промените са запазени')
        until(lambda: one("select status from service where id = '%s'" % vecher)['status'] == 'draft', 'DB: hidden (draft)')
        page.click('.se-status .pol-opt:has-text("Активна")')
        toast(page, 'Промените са запазени')
        until(lambda: one("select status from service where id = '%s'" % vecher)['status'] == 'active', 'DB: active again')

        page.goto(BASE + '/partner/uslugi')
        page.locator('.svc-card:has-text("Фирмени събития") a:has-text("Редактирай")').click()
        page.wait_for_url(re.compile(r'/partner/uslugi/[0-9a-f-]{36}$'))
        firm = page.url.rsplit('/', 1)[1]
        page.locator('button:has-text("Архивирай")').first.click()
        toast(page, 'Услугата е архивирана')
        page.wait_for_url(re.compile(r'tab=arhiv'))
        until(lambda: one("select status from service where id = '%s'" % firm)['status'] == 'archived', 'DB: archived')
        expect(page.locator('.svc-card .svc-title')).to_have_text(['Фирмени събития'])

        # ── /partner/profil ──
        print('/partner/profil')
        page.goto(BASE + '/partner/profil')
        page.fill('textarea[name="description"]', 'Над 12 години озвучаваме сватби, рождени дни и фирмени събития в София и страната.')
        page.fill('input[name="socialHandle"]', '@studio.melodia.bg')
        page.select_option('select[name="cityId"]', label='Пловдив')
        page.select_option('select[name="radius"]', label='до 100 км')
        expect(page.locator('.svc-card .svc-text')).to_have_text('DJ и озвучаване · Пловдив')
        page.click('button[aria-label="Премахни Годежи"]')
        page.click('.chip-add:has-text("+ Добави")')
        page.click('.pc-add-menu button:has-text("Кръщенета")')
        page.click('.chip-add:has-text("+ Добави")')
        page.fill('.pc-add-menu input[aria-label="Друго"]', 'Караоке')
        page.click('.pc-add-menu button:has-text("Добави")')
        page.click('.pol-opt:has-text("Гъвкава")')
        page.locator('button:has-text("Запази промените")').click()
        toast(page, 'Промените са запазени')
        pr = one("select p.description, p.social_handle, c.name as city, p.service_radius_km, p.cancellation_policy from partner p join city c on c.id = p.city_id where p.id = '%s'" % pid)
        tags = sorted(t['label'] for t in db("select label from partner_tag where partner_id = '%s'" % pid))
        ok(pr['city'] == 'Пловдив' and pr['service_radius_km'] == 100 and pr['cancellation_policy'] == 'flexible' and pr['social_handle'] == '@studio.melodia.bg'
           and pr['description'].startswith('Над 12 години'), 'DB: profile saved (city, radius, policy, social, description)')
        ok('Годежи' not in tags and 'Кръщенета' in tags and 'Караоке' in tags, f'DB: skills updated {tags}')

        n0 = one("select count(*)::int as n from partner_photo where partner_id = '%s'" % pid)['n']
        with page.expect_file_chooser() as fc:
            page.click('button[aria-label="Добави снимка"]')
        fc.value.set_files(photo)
        toast(page, 'Снимката е добавена')
        until(lambda: one("select count(*)::int as n from partner_photo where partner_id = '%s'" % pid)['n'] == n0 + 1, 'DB: photo added to the gallery')
        expect(page.locator('.dcard-head .badge')).to_have_text(f'{n0 + 1} снимки')
        first_before = one("select id from partner_photo where partner_id = '%s' and position = 0" % pid)['id']
        item = page.locator('.gal .gal-item').first
        item.hover()
        item.locator('button[aria-label="Премести надясно"]').click()
        toast(page, 'Подредбата е запазена')
        until(lambda: one("select position from partner_photo where id = '%s'" % first_before)['position'] == 1, 'DB: the main photo moved to second place')
        last = page.locator('.gal .gal-item').last
        last.hover()
        last.locator('button[aria-label="Премахни"]').click()
        toast(page, 'Снимката е премахната')
        until(lambda: one("select count(*)::int as n from partner_photo where partner_id = '%s'" % pid)['n'] == n0, 'DB: photo removed')

        page.click('button[role="switch"][aria-label="Приемам нови заявки"]')
        toast(page, 'Промените са запазени')
        until(lambda: one("select accepting_requests from partner where id = '%s'" % pid)['accepting_requests'] is False, 'DB: not accepting requests')
        page.click('button[role="switch"][aria-label="Приемам нови заявки"]')
        toast(page, 'Промените са запазени')
        until(lambda: one("select accepting_requests from partner where id = '%s'" % pid)['accepting_requests'] is True, 'DB: accepting requests again')
        with page.expect_navigation():
            page.click('a:has-text("Виж като клиент")')
        ok(path(page).startswith('/partnyori/studio-melodiya'), 'Виж като клиент → public profile')

        # ── /partner/revyuta ──
        print('/partner/revyuta')
        page.goto(BASE + '/partner/revyuta')
        page.click('button:has-text("Сподели профила")')
        toast(page, 'Линкът към профила е копиран')
        page.click('.tab-bar-item:has-text("Без отговор")')
        page.wait_for_url(re.compile(r'tab=bez-otgovor'))
        expect(page.locator('.rev')).to_have_count(1)
        page.click('.rev button:has-text("Отговори")')
        page.fill('.pc-reply textarea', 'Благодарим ви — радваме се, че гостите танцуваха до края.')
        page.click('.pc-reply button[type="submit"]')
        toast(page, 'Отговорът е публикуван под ревюто')
        rv = one("select reply_text from review where partner_id = '%s' and author_display_name = 'Стефка Илиева'" % pid)
        ok(rv['reply_text'].startswith('Благодарим ви'), 'DB: reply published')
        until(lambda: len(emails('client-review-reply', start)) >= 1, 'email client-review-reply queued')
        page.click('.tab-bar-item:has-text("Всички")')
        expect(page.locator('.rev-reply-h')).to_have_count(3)

        # ── /partner/prihodi ──
        print('/partner/prihodi')
        page.goto(BASE + '/partner/prihodi')
        expect(page.locator('.eh-label').first).to_have_text('Приходи · август 2025')
        ok(page.locator('text=Комисиона').count() == 0, 'no commission on the partner screen')
        page.click('button:has-text("Изтегли справка")')
        toast(page, 'Справката се подготвя — ще я получите по имейл')
        until(lambda: len(emails('vendor-report-ready', start)) >= 1, 'email vendor-report-ready queued')
        link = page.locator('a:has-text("Изтегли справката")')
        expect(link).to_be_visible()
        with page.expect_download() as dl:
            link.click()
        csv = open(dl.value.path(), encoding='utf-8-sig').read()
        ok('Получавате' in csv and '2026-0614-ЕА' in csv, 'report CSV downloads with the payout lines')
        page.click('.tbl tbody tr:has-text("19.12.2026")')
        page.wait_for_url(re.compile(r'/partner/rezervacii/'))
        ok(path(page) == '/partner/rezervacii/2026-1219-ЕА', 'payout row → the booking')
        page.goto(BASE + '/partner/prihodi')
        page.click('a:has-text("Промени сметката")')
        page.wait_for_url('**/partner/smetka')

        # ── /partner/smetka ──
        print('/partner/smetka')
        page.fill('input[name="iban"]', 'BG00 0000 0000 0000 0000 00')
        page.fill('input[name="holderName"]', 'Студио Мелодия ЕООД')
        page.select_option('select[name="bankName"]', label='УниКредит Булбанк')
        page.locator('.pa-foot button:has-text("Запази сметката")').click()
        expect(page.locator('.form-error:has-text("Качете документ от банката.")')).to_be_visible()
        ok(True, 'a missing bank document is required')
        with page.expect_file_chooser() as fc:
            page.click('button:has-text("Качи документ")')
        fc.value.set_files(pdf)
        toast(page, 'Документът е качен и чака проверка')
        expect(page.locator('.pa-up-d.is-file')).to_have_text('izvlechenie.pdf')
        page.locator('.page-head button:has-text("Запази сметката")').click()
        expect(page.locator('.form-error:has-text("IBAN")')).to_be_visible()
        ok(True, 'an invalid IBAN is refused under the field')
        page.fill('input[name="iban"]', 'BG80 BNBG 9661 1020 3456 78')
        page.locator('.pa-foot button:has-text("Запази сметката")').click()
        toast(page, 'Сметката е изпратена за проверка')
        page.wait_for_url('**/partner/prihodi')
        acc = one("select status, iban_last4, bank_name from payout_account where partner_id = '%s' and status = 'pending_verification'" % pid)
        ok(acc and acc['iban_last4'] == '5678' and acc['bank_name'] == 'УниКредит Булбанк', 'DB: new account waiting for the check')
        until(lambda: one("select payouts_paused from partner where id = '%s'" % pid)['payouts_paused'] is True, 'DB: payouts paused until the check')
        until(lambda: len(emails('vendor-payout-account-submitted', start)) >= 1 and len(emails('team-payout-account', start)) >= 1,
           'emails vendor-payout-account-submitted and team-payout-account queued')
        expect(page.locator('.badge:has-text("Новата сметка чака проверка")')).to_be_visible()

        # ── /partner/nastroyki ──
        print('/partner/nastroyki')
        page.goto(BASE + '/partner/nastroyki')
        ok(page.locator('button:has-text("Смени името")').is_disabled(), 'Смени името is disabled until 12 септември')
        ok(page.locator('button:has-text("Изтрий")').is_disabled(), 'Изтрий is disabled with upcoming bookings')
        page.fill('input[name="contactName"]', 'Мартин Стоянов-Петров')
        page.click('button[role="switch"][aria-label="Новини от EventAT"]')
        page.locator('.page-head button:has-text("Запази промените")').click()
        toast(page, 'Промените са запазени')
        until(lambda: one("select contact_name from partner where id = '%s'" % pid)['contact_name'] == 'Мартин Стоянов-Петров', 'DB: contact name saved')
        uid = one("select id from \"user\" where email = '%s'" % PARTNER)['id']
        until(lambda: one("select enabled from notification_preference where user_id = '%s' and key = 'partner.news'" % uid)['enabled'] is True, 'DB: news switch on')
        page.fill('input[name="phone"]', '12')
        page.locator('.page-head button:has-text("Запази промените")').click()
        expect(page.locator('.form-error:has-text("телефон")')).to_be_visible()
        ok(True, 'an invalid phone is refused under the field')
        page.fill('input[name="phone"]', '+359 88 123 4567')
        page.click('button:has-text("Смени паролата")')
        toast(page, 'Изпратихме линк за нова парола на имейла ви')
        until(lambda: len(emails('vendor-password-reset', start)) >= 1, 'email vendor-password-reset queued')
        page.click('.lang button:has-text("EN")')
        toast(page, 'Английската версия идва скоро')
        page.click('.lang button:has-text("BG")')
        toast(page, 'Езикът е сменен на български')
        page.click('button:has-text("Деактивирай")')
        toast(page, 'Профилът е деактивиран — можете да го върнете по всяко време')
        until(lambda: one("select status from partner where id = '%s'" % pid)['status'] == 'deactivated', 'DB: deactivated')
        until(lambda: len(emails('vendor-deactivated', start)) >= 1, 'email vendor-deactivated queued')
        page.click('button:has-text("Активирай")')
        toast(page, 'Промените са запазени')
        until(lambda: one("select status from partner where id = '%s'" % pid)['status'] == 'approved', 'DB: active again')
        page.click('a:has-text("Виж приходите")')
        page.wait_for_url('**/partner/prihodi')

        ok(not errors, f'no page errors ({errors[:2]})')
        ctx.close()

        # ── deletion (a partner without upcoming bookings) ──
        print('/partner/nastroyki/iztrivane')
        ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='bg-BG', timezone_id='Europe/Sofia')
        sign_in(ctx, 'folklorna-trapeza@example.invalid')
        page = ctx.new_page()
        page.goto(BASE + '/partner/nastroyki')
        page.click('button:has-text("Изтрий")')
        toast(page, 'Изпратихме имейл за потвърждение на изтриването')
        url = emails('vendor-delete-confirm', start)[0]['vars']['url']
        page.goto(BASE + '/partner/nastroyki/iztrivane?token=wrong')
        page.click('button:has-text("Потвърди изтриването")')
        expect(page.locator('.form-alert')).to_have_text('Линкът е невалиден или е изтекъл.')
        ok(True, 'a wrong token is refused')
        page.goto(BASE + url)
        page.click('button:has-text("Потвърди изтриването")')
        page.wait_for_url(BASE + '/')
        st = one("select p.status from partner p where p.slug like 'deleted-%' and p.business_name = 'Изтрит профил'")
        ok(st and st['status'] == 'deleted', 'DB: partner deleted and anonymised')
        page.goto(BASE + '/partner/nastroyki')
        ok(path(page).startswith('/vhod'), 'signed out after deletion')
        ctx.close()

        # ── 390 px: every route fits ──
        print('390 px')
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, locale='bg-BG', timezone_id='Europe/Sofia', is_mobile=True, has_touch=True)
        sign_in(ctx, PARTNER)
        page = ctx.new_page()
        for route in ['/partner/uslugi', '/partner/uslugi/nova', '/partner/uslugi/' + vecher, '/partner/profil', '/partner/revyuta',
                      '/partner/prihodi', '/partner/smetka', '/partner/nastroyki', '/partner/nastroyki/iztrivane?token=x']:
            page.goto(BASE + route)
            no_hscroll(page, route)
        ctx.close()
        b.close()
    print(f'\nPASS — {checks} checks')

if __name__ == '__main__':
    try:
        main()
    except AssertionError as e:
        print('\nFAIL —', e)
        sys.exit(1)
