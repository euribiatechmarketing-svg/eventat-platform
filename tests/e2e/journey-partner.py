#!/usr/bin/env python3
"""J4 — a new partner from sign-up to the first booking, across every area it touches.

Usage: python3 tests/e2e/journey-partner.py [--base http://localhost:3304] [--headed] [--shots DIR]

Resets and seeds the database named in .env.local first (a local `eventat_*` database only), then drives
the running server with Playwright, one browser context per person (partner, team member, client, second
partner), with real clicks and typing:

  1. a partner registers on /registratsiya?as=partner, types the email code, completes the six wizard steps
     with real uploads (profile photo, cover, gallery), two packages and an on-request service, availability
     with a blocked date, the ‹Умерена› policy with a 30% deposit, submits and sees the pending page;
  2. the team checks and approves the application; the partner gets the email and the panel; a new service
     goes through /admin/moderatsiya; the partner shows up in /tarsene and /kategorii with the right counts
     and from-price, and its blocked date reads as busy;
  3. a client sends a request, the partner approves it, the client pays: the intro commission (5%) shows on
     the admin booking record and never on a partner screen, which shows ‹Получавате›;
  4. the partner changes a published price: the public page keeps the old one until the team approves it;
  5. a second partner is returned with a note, fixes step 2, resubmits and is approved;
  6. every bell item the journey left opens a live page.

Each step prints one line; the script stops with a non-zero exit at the first failure. Every step checks what
the person sees and the database effect. Screenshots of the key moments (1440 and 390 px) go to --shots
(default .data/journey-partner).
"""
import json, os, re, subprocess, sys, time, traceback
from pathlib import Path
from urllib.parse import quote, unquote
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
ARGS = sys.argv[1:]
BASE = ARGS[ARGS.index('--base') + 1] if '--base' in ARGS else 'http://localhost:3304'
HEADED = '--headed' in ARGS
OUT = Path(ARGS[ARGS.index('--shots') + 1]) if '--shots' in ARGS else ROOT / '.data' / 'journey-partner'
NODE_BIN = Path.home() / 'nodejs22' / 'bin'
PW = 'eventat-demo'
CLIENT = 'maria.dimitrova@gmail.com'
ADMIN = 'monika.kovacheva@eventat.bg'
R = '/partner/registratsiya'


def env_file():
    out = {}
    for line in (ROOT / '.env.local').read_text().splitlines():
        m = re.match(r'^([A-Z0-9_]+)=(.*)$', line.strip())
        if m: out[m.group(1)] = m.group(2).strip().strip('"')
    return out


DB_URL = env_file()['DATABASE_URL']
ENV = {**os.environ, 'PATH': f'{NODE_BIN}:{os.environ["PATH"]}', 'DATABASE_URL': DB_URL}


def sql(query, *params):
    """One query through the repo's postgres client (no Python driver needed); rows as dicts."""
    script = ("const p=require(process.argv[1]);const s=p(process.argv[2],{max:1,onnotice:()=>{}});"
              "s.unsafe(process.argv[3],JSON.parse(process.argv[4])).then(r=>{process.stdout.write(JSON.stringify(r));return s.end()})"
              ".catch(e=>{console.error(e.message);process.exit(1)})")
    r = subprocess.run([str(NODE_BIN / 'node'), '-e', script, str(ROOT / 'node_modules' / 'postgres'), DB_URL, query, json.dumps(list(params))],
                       capture_output=True, text=True)
    if r.returncode: raise RuntimeError(r.stderr)
    return json.loads(r.stdout or '[]')


def one(query, *params):
    rows = sql(query, *params)
    assert rows, f'no row: {query} {params}'
    return rows[0]


def until(fn, what, timeout=15):
    end = time.time() + timeout
    while True:
        v = fn()
        if v: return v
        if time.time() > end: raise AssertionError(f'timed out: {what}')
        time.sleep(0.4)


def reset_db():
    if not re.match(r'^postgres(ql)?://[^@]+@(127\.0\.0\.1|localhost)(:\d+)?/eventat_[a-z0-9_]+$', DB_URL):
        sys.exit(f'refusing to reset {DB_URL}: .env.local must name a local eventat_* database')
    for script in ('db:reset', 'db:seed'):
        r = subprocess.run(['npm', 'run', script], cwd=ROOT, env=ENV, capture_output=True, text=True)
        if r.returncode: sys.exit(r.stdout + r.stderr)
    time.sleep(6)  # the server caches the clock offset for 5 s


def valid_eik(prefix):
    d = [int(c) for c in prefix]
    r = sum(x * w for x, w in zip(d, range(1, 9))) % 11
    if r == 10: r = sum(x * w for x, w in zip(d, range(3, 11))) % 11
    return prefix + str(0 if r == 10 else r)


def photos(folder):
    """Small real JPEGs: a square profile photo (≥ 400 × 400), a 16:9 cover and gallery frames."""
    from PIL import Image, ImageDraw
    folder.mkdir(parents=True, exist_ok=True)
    def make(name, w, h, a, b):
        im = Image.new('RGB', (w, h))
        dr = ImageDraw.Draw(im)
        for y in range(h):
            t = y / h
            dr.line([(0, y), (w, y)], fill=tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)))
        dr.ellipse([w * .3, h * .25, w * .7, h * .75], fill=(250, 240, 225))
        p = folder / name
        im.save(p, 'JPEG', quality=70)
        return str(p)
    return {
        'avatar': make('avatar.jpg', 600, 600, (60, 40, 90), (180, 120, 200)),
        'cover': make('cover.jpg', 1600, 900, (30, 50, 80), (200, 160, 120)),
        'gallery': [make(f'g{i}.jpg', 1200, 800, (20 * i, 60, 120), (220, 180 - 15 * i, 90)) for i in range(7)],
    }


# ── people and pages ─────────────────────────────────────────────────────

ERRORS = []
CONSOLE = []  # console errors: printed at the end (a failed resource load is one)


class Person:
    def __init__(self, browser, name, email=None, password=PW):
        self.browser, self.name, self.email, self.password = browser, name, email, password
        self.ctx = self.context(1440, 900)
        self.page = self.ctx.new_page()
        self.watch(self.page)
        self.phone = None

    def context(self, w, h):
        c = self.browser.new_context(viewport={'width': w, 'height': h}, locale='bg-BG', timezone_id='Europe/Sofia', base_url=BASE)
        c.set_default_timeout(30_000)
        c.set_default_navigation_timeout(120_000)  # a dev server compiles a route on its first visit
        return c

    def watch(self, page):
        page.on('pageerror', lambda e: ERRORS.append(f'{self.name} {page.url}: {e}'))
        page.on('console', lambda m: CONSOLE.append(f'{self.name} {page.url}: {m.text[:300]}') if m.type == 'error' else None)
        page.on('response', lambda r: ERRORS.append(f'{self.name} HTTP {r.status} {r.url}') if r.status >= 500 else None)

    def sign_in(self, ctx=None):
        ctx = ctx or self.ctx
        r = ctx.request.post(BASE + '/api/auth/sign-in/email', data={'email': self.email, 'password': self.password}, headers={'Origin': BASE})
        assert r.ok, f'sign-in {self.email}: {r.status} {r.text()[:200]}'

    def phone_page(self):
        if not self.phone:
            self.phone = self.context(390, 844)
            self.sign_in(self.phone)
            self.phone_pg = self.phone.new_page()
            self.watch(self.phone_pg)
        return self.phone_pg


def go(page, path, status=200):
    """Open a route and wait until it is interactive (a person waits for the page before typing)."""
    r = page.goto(BASE + path, wait_until='load')
    assert r is not None and r.status == status, f'{path}: HTTP {r.status if r else None}'
    page.wait_for_load_state('networkidle')
    return r


def path_of(page):
    return unquote(page.url.replace(BASE, ''))


def wait_path(page, pattern):
    page.wait_for_url(re.compile(pattern), timeout=120_000)


def toast(page, text):
    expect(page.locator('.ui-toast.is-on')).to_contain_text(text, timeout=15_000)


def tick(page, label):
    """A drawn checkbox, clicked where a person clicks: on the box at the start of its label."""
    page.locator(label).click(position={'x': 8, 'y': 9})


def last_mail(key, to):
    rows = sql('select * from email_outbox where template_key = $1 and lower(to_email) = lower($2) order by created_at desc limit 1', key, to)
    return rows[0] if rows else None


def mails(key, to=None):
    if to: return sql('select * from email_outbox where template_key = $1 and lower(to_email) = lower($2) order by created_at', key, to)
    return sql('select * from email_outbox where template_key = $1 order by created_at', key)


def bell(user_email, kind):
    return sql('select n.* from notification n join "user" u on u.id = n.user_id where lower(u.email) = lower($1) and n.kind = $2 order by n.created_at desc', user_email, kind)


def partner_row(email):
    return one('select p.* from partner p join partner_member m on m.partner_id = p.id join "user" u on u.id = m.user_id where lower(u.email) = lower($1)', email)


SHOTS = []


def tall_shot(page, file, width, height):
    """The whole page in one image: the viewport is stretched to the page height first, so fixed
    headers, rails and footers sit where a person sees them instead of repeating down the image."""
    page.wait_for_load_state('networkidle')
    h = min(page.evaluate('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)'), 6000)
    page.set_viewport_size({'width': width, 'height': max(h, height)})
    page.wait_for_timeout(300)
    page.screenshot(path=str(file))
    page.set_viewport_size({'width': width, 'height': height})


def shoot(person, name, path=None):
    """The current page at 1440, and the same route at 390 px in the person's phone context."""
    OUT.mkdir(parents=True, exist_ok=True)
    n = len(SHOTS) + 1
    route = path or path_of(person.page)
    if path_of(person.page) != route: go(person.page, route)
    f1 = OUT / f'{n:02d}-{name}-1440.png'
    tall_shot(person.page, f1, 1440, 900)
    ph = person.phone_page()
    ph.goto(BASE + route, wait_until='networkidle')
    sw = ph.evaluate('document.documentElement.scrollWidth')
    assert sw <= 390, f'{route} at 390 px scrolls sideways ({sw})'
    f2 = OUT / f'{n:02d}-{name}-390.png'
    tall_shot(ph, f2, 390, 844)
    SHOTS.append((f1, f2))


def no_commission(page, where):
    text = page.locator('body').inner_text()
    assert not re.search(r'[Кк]омисион', text), f'{where}: a partner screen mentions the commission'
    assert '5%' not in text and '10%' not in text, f'{where}: a partner screen shows a commission rate'


# ── the journey ──────────────────────────────────────────────────────────

S = {}
A = {'business': 'Кадър Видео', 'contact': 'Петър Колев', 'phone': '0888 123 456', 'password': 'Kadar-Video-2025!',
     'category': 'Видеозаснемане', 'cat_slug': 'videozasnemane', 'eik': valid_eik('20512345'), 'social': '@kadar.video',
     'blocked': '2025-10-18', 'event': '2025-10-25'}
B = {'business': 'Фото Светлина', 'contact': 'Ралица Николова', 'phone': '0887 654 321', 'password': 'Foto-Svetlina-2025!',
     'category': 'Фотография', 'cat_slug': 'fotografiya', 'eik': valid_eik('20498765'), 'social': '@foto.svetlina'}
STEPS = []


def step(title):
    def deco(fn):
        STEPS.append((title, fn))
        return fn
    return deco


def sign_up(person, d):
    p = person.page
    go(p, '/registratsiya?as=partner')
    expect(p.locator('button.role[data-role=partner]')).to_have_attribute('aria-checked', 'true')
    expect(p.locator('.auth-side[data-side=partner]')).to_be_visible()
    p.fill('#reg-businessName', d['business'])
    p.fill('#reg-contactName', d['contact'])
    p.fill('#reg-email', person.email)
    p.fill('#reg-phone', d['phone'])
    p.fill('#reg-password', d['password'])
    tick(p, '.reg-consent label.f-item')
    p.click('button:has-text("Създай профил")')
    wait_path(p, r'/potvarzhdenie\?.*as=partner')
    mail = until(lambda: last_mail('vendor-verify-code', person.email), 'vendor-verify-code queued')
    assert mail['vars']['partnerName'] == d['business'], mail['vars']
    u = one('select * from "user" where lower(email) = lower($1)', person.email)
    assert u['role'] == 'partner' and not u['email_verified'], u
    pr = partner_row(person.email)
    assert pr['status'] == 'draft' and pr['business_name'] == d['business'] and pr['contact_name'] == d['contact'], pr
    p.locator('input.ver-cell').first.click()
    p.keyboard.type(mail['vars']['code'])
    p.click('button:has-text("Потвърди")')
    wait_path(p, R + '/1$')
    toast(p, 'Имейлът е потвърден')
    assert one('select email_verified from "user" where id = $1', u['id'])['email_verified']
    assert until(lambda: last_mail('vendor-welcome', person.email), 'vendor-welcome queued')
    return pr


def continue_(page):
    page.locator('.wiz-footer-actions .btn--primary').click()


def wizard_step1(person, d):
    p = person.page
    expect(p.locator('.wiz-step-title')).to_have_text('Да започнем с основите.')
    # what the sign-up form asked is already filled in
    expect(p.locator('#f-businessName')).to_have_value(d['business'])
    expect(p.locator('#f-contactName')).to_have_value(d['contact'])
    expect(p.locator('#f-notificationEmail')).to_have_value(person.email)
    assert re.sub(r'\D', '', p.locator('#f-phone').input_value()).endswith(re.sub(r'\D', '', d['phone'])[1:]), p.locator('#f-phone').input_value()
    p.select_option('#f-legalForm', 'eood')
    p.fill('#f-eik', d['eik'])
    p.select_option('#f-primaryCategoryId', label=d['category'])
    p.select_option('#f-cityId', label='София')
    p.select_option('#f-radius', '150')
    p.select_option('#f-experienceBand', 'y5_10')
    p.fill('#f-languages', 'Български, английски')
    p.fill('#f-socialHandle', d['social'])
    continue_(p)
    wait_path(p, R + '/2$')
    row = partner_row(person.email)
    assert row['eik'] == d['eik'] and row['legal_form'] == 'eood' and row['onboarding_step'] == 2 and row['service_radius_km'] == 150, row
    expect(p.locator('.wiz-step--done').first).to_contain_text(f"{d['business']} · София")


def wizard_step2(person, d, gallery):
    p = person.page
    with p.expect_file_chooser() as fc:
        p.locator('.upload--circle .m-avatar-pick').click()
    fc.value.set_files(S['photos']['avatar'])
    toast(p, 'Снимката е качена')
    expect(p.locator('.upload--circle .avatar img')).to_be_visible()
    with p.expect_file_chooser() as fc:
        p.locator('.upload--cover .upload-preview').click()
    fc.value.set_files(S['photos']['cover'])
    expect(p.locator('.upload--cover .upload-preview--placeholder')).to_have_count(0, timeout=15_000)
    with p.expect_file_chooser() as fc:
        p.locator('.gallery-add').click()
    fc.value.set_files(gallery)
    expect(p.locator('.gallery-item')).to_have_count(len(gallery), timeout=20_000)
    expect(p.locator('.wiz-fieldset-head .badge')).to_have_text(f'{len(gallery)} / 8')
    expect(p.locator('.gallery-item').first.locator('.gallery-tag')).to_have_text('Главна')
    p.fill('#f-shortDescription', d['short'])
    p.fill('#f-description', d['long'])
    for chip in d['types']:
        p.locator('.chips .chip', has_text=re.compile(f'^{chip}$')).click()
        expect(p.locator('.chips .chip', has_text=re.compile(f'^{chip}$'))).to_have_attribute('aria-pressed', 'true')
    continue_(p)
    wait_path(p, R + '/3$')
    row = partner_row(person.email)
    assert row['avatar_media_id'] and row['cover_media_id'] and row['short_description'] == d['short'], row
    n = one('select count(*)::int n from partner_photo where partner_id = $1', row['id'])['n']
    assert n == len(gallery), n
    assert one('select count(*)::int n from partner_event_type where partner_id = $1', row['id'])['n'] == len(d['types'])
    expect(p.locator('.wiz-step--done').nth(1)).to_contain_text(f'Представяне и {len(gallery)} снимки')


def fill_package(card, name, desc, price=None, incs=(), duration=None):
    card.locator('input[name$=".name"]').fill(name)
    card.locator('textarea[name$=".description"]').fill(desc)
    for i, text in enumerate(incs):
        if i: card.locator('.checklist-add').click()
        card.locator('input[name$=".inc"]').nth(i).fill(text)
    if price is not None: card.locator('input[name$=".price"]').fill(price)
    if duration: card.locator('input[name$=".duration"]').fill(duration)


def wizard_step3(person, d):
    p = person.page
    editors = p.locator('.card.m-pkg')
    expect(editors).to_have_count(1)
    fill_package(editors.nth(0), *d['pkg1'])
    p.get_by_role('button', name='Добави пакет').click()
    toast(p, 'Добавен е нов пакет')
    fill_package(editors.nth(1), *d['pkg2'])
    if d.get('onreq'):
        p.get_by_role('button', name='Добави услуга по запитване').click()
        toast(p, 'Добавена е услуга по запитване')
        fill_package(editors.nth(2), *d['onreq'])
        expect(editors.nth(2).locator('input[name$=".price"]')).to_have_count(0)
        # an on-request service means the partner prices ‹По запитване› too (both cards selected, as in the prototype)
        expect(p.locator('.option-card', has_text='По запитване')).to_have_class(re.compile(r'\bis-selected\b'))
    continue_(p)
    wait_path(p, R + '/4$')
    row = partner_row(person.email)
    assert row['offers_fixed_packages'] and row['offers_on_request'] == bool(d.get('onreq')), row
    pid = row['id']
    svcs = sql("select name, kind, status, price_cents, category_id from service where partner_id = $1 and status <> 'archived' order by sort_order", pid)
    want = [d['pkg1'][0], d['pkg2'][0]] + ([d['onreq'][0]] if d.get('onreq') else [])
    assert [s['name'] for s in svcs] == want, svcs
    assert all(s['status'] == 'ready' for s in svcs), svcs
    meta = f"2 пакета · 1 по запитване" if d.get('onreq') else '2 пакета'
    expect(p.locator('.wiz-step--done').nth(2)).to_contain_text(meta)
    return svcs


def wizard_step4(person, block=None):
    p = person.page
    p.locator('.option-card', has_text='Една на ден').click()
    p.select_option('#f-leadTimeDays', '7')
    p.select_option('#f-horizonMonths', '12')
    if block:
        for _ in range(6):
            if p.locator(f'button.calendar-day[data-date="{block}"]').count(): break
            title = p.locator('.calendar-head strong').inner_text()
            p.get_by_role('link', name='Следващ месец').click()
            expect(p.locator('.calendar-head strong')).not_to_have_text(title)
        day = p.locator(f'button.calendar-day[data-date="{block}"]')
        day.click()
        expect(day).to_have_class(re.compile('calendar-day--blocked'))
        pid = partner_row(person.email)['id']
        until(lambda: one('select count(*)::int n from availability_block where partner_id = $1 and start_date <= $2 and end_date >= $2', pid, block)['n'] == 1,
              f'{block} blocked in the database')
    continue_(p)
    wait_path(p, R + '/5$')
    row = partner_row(person.email)
    assert row['bookings_per_day_mode'] == 'one' and row['lead_time_days'] == 7 and row['horizon_months'] == 12, row
    expect(p.locator('.wiz-step--done').nth(3)).to_contain_text('Една резервация на ден')


def wizard_step5(person):
    p = person.page
    p.locator('.option-card', has_text='Умерена').click()
    expect(p.locator('.option-card.is-selected')).to_contain_text('Умерена')
    p.select_option('#f-depositPercent', '30')
    p.select_option('#f-reschedulePolicy', 'free_if_available')
    continue_(p)
    wait_path(p, R + '/6$')
    row = partner_row(person.email)
    assert row['cancellation_policy'] == 'moderate' and row['deposit_percent'] == 30, row


def submit_application(person, d):
    p = person.page
    p.locator('label.check', has_text='Приемам').locator('.check-box').click()
    p.locator('label.check', has_text='Потвърждавам').locator('.check-box').click()
    p.get_by_role('button', name='Подай за одобрение').click()
    wait_path(p, R + '/podadeno$')
    expect(p.locator('.pending-eyebrow')).to_have_text('Профилът ви е подаден')
    expect(p.locator('.pending-title')).to_have_text(f"Благодарим, {d['contact'].split()[0]}.")
    expect(p.get_by_role('link', name='Към таблото')).to_have_count(0)
    row = partner_row(person.email)
    assert row['status'] == 'submitted' and row['submitted_at'], row
    return row


# 1 ── sign-up and the wizard ─────────────────────────────────────────────

@step('J4.1a partner registers on /registratsiya?as=partner and confirms the email code')
def s1a():
    pa = S['pa']
    S['a_id'] = sign_up(pa, A)['id']


@step('J4.1b wizard step 1: business details prefilled from the sign-up, completed and saved')
def s1b():
    wizard_step1(S['pa'], A)


@step('J4.1c wizard step 2: profile photo, cover, 5 gallery photos, descriptions, event types')
def s1c():
    A.update(short='Сватбено и корпоративно видео в София и страната.',
             long='Снимаме сватби, кръщенета и фирмени събития от 2016 г. Предаваме филм и кратък клип до 30 дни след събитието.',
             types=['Сватби', 'Фирмени събития'])
    wizard_step2(S['pa'], A, S['photos']['gallery'][:5])
    shoot(S['pa'], 'wizard-step2', R + '/2')
    go(S['pa'].page, R + '/3')


@step('J4.1d wizard step 3: two packages and one ‹По запитване› service')
def s1d():
    A.update(pkg1=('Пакет „Сватбен ден“', 'Видеозаснемане от подготовката до първия танц, филм и клип.', '1 200',
                   ['Двама оператори', 'Филм до 60 минути'], 'До 12 часа'),
             pkg2=('Пакет „Церемония“', 'Видео от церемонията и кратък клип.', '800', ['Един оператор'], 'До 4 часа'),
             onreq=('Корпоративно видео', 'Видео от конференции и фирмени партита по индивидуална оферта.'))
    svcs = wizard_step3(S['pa'], A)
    assert [s['price_cents'] for s in svcs] == [120000, 80000, None], svcs


@step('J4.1e wizard step 4: one booking a day, lead time, horizon and a blocked date')
def s1e():
    wizard_step4(S['pa'], A['blocked'])
    shoot(S['pa'], 'wizard-step3', R + '/3')
    shoot(S['pa'], 'wizard-step4', R + '/4?mesec=2025-10')
    go(S['pa'].page, R + '/5')


@step('J4.1f wizard step 5: ‹Умерена› policy with a 30% deposit')
def s1f():
    wizard_step5(S['pa'])


@step('J4.1g wizard step 6: the summary, both consents, submit → the pending page; emails to partner and team')
def s1g():
    p = S['pa'].page
    expect(p.locator('.preview-card .t-h3')).to_have_text(A['business'])
    expect(p.locator('.review-section', has_text='Политика за анулиране')).to_contain_text('Умерена · безплатно анулиране до 30 дни преди събитието')
    expect(p.locator('.review-section', has_text='Пакети и услуги').locator('.badge--success')).to_have_count(3)
    shoot(S['pa'], 'wizard-step6')
    row = submit_application(S['pa'], A)
    checks = sql('select kind, state from partner_check where partner_id = $1', row['id'])
    assert len(checks) == 6, checks
    st = {c['kind']: c['state'] for c in checks}
    assert st['services'] == 'ok' and st['cancellation_policy'] == 'ok' and st['company'] == 'waiting' and st['bank_account'] == 'waiting', st
    assert last_mail('vendor-application-received', S['pa'].email)
    team = mails('team-vendor-application')
    assert any(m['vars']['partnerName'] == A['business'] for m in team) and any(m['to_email'] == ADMIN for m in team), team
    shoot(S['pa'], 'pending')
    # ‹Виж профила като клиент›: the owner's preview of the not yet public profile
    S['a_slug'] = row['slug']
    p.get_by_role('link', name='Виж профила като клиент').click()
    wait_path(p, rf"/partnyori/{row['slug']}\?preview=1$")
    expect(p.locator('h1.pv-name')).to_have_text(A['business'])
    for name in ('Пакет „Сватбен ден“', 'Пакет „Церемония“', 'Корпоративно видео'):
        expect(p.locator('#main')).to_contain_text(name)
    shoot(S['pa'], 'owner-preview')
    go(p, R + '/podadeno')


# 2 ── the team approves; the partner goes live ──────────────────────────

@step('J4.2a team: the application is in the queue and on /admin/partnyori/[id]')
def s2a():
    # before the decision the partner is nowhere public
    g = S['guest'].page
    go(g, f"/partnyori/{S['a_slug']}", status=404)
    go(g, f"/tarsene?kategoriya={A['cat_slug']}")
    expect(g.locator('a.v-card')).to_have_count(0)
    go(g, '/kategorii')
    card = g.locator('a.feat', has=g.locator('.feat-t', has_text=re.compile(f"^{A['category']}$")))
    expect(card.locator('.feat-free')).to_have_text('Няма партньори')
    p = S['admin'].page
    go(p, '/admin/partnyori')
    waiting = one("select count(*)::int n from partner where status = 'submitted'")['n']
    expect(p.locator('aside.side')).to_contain_text(re.compile(f'Изпълнители\\s*{waiting}'))
    p.locator('.topbar button[aria-label="Известия"]').click()
    expect(p.locator('.ui-menu .ui-note').first).to_contain_text(f'{waiting} изпълнители чакат одобрение')
    p.keyboard.press('Escape')
    rec = p.locator('a.rec', has_text=A['business'])
    expect(rec).to_be_visible()
    expect(rec.locator('.rec-col', has_text='Профил')).to_contain_text('2 от 6')
    rec.click()
    wait_path(p, f"/admin/partnyori/{S['a_id']}$")
    expect(p.locator('h1.page-title')).to_have_text('Профил на изпълнител')
    expect(p.locator('.page-sub')).to_contain_text('профил 2 от 6')
    expect(p.locator('.vrev-pk')).to_have_count(3)
    # onboarding packages go live with the profile, so nothing of theirs waits in moderation: plain rows
    expect(p.locator('a.vrev-pk')).to_have_count(0)
    expect(p.locator('.vrev-gi')).to_have_count(5)


@step('J4.2b team: company, contacts and gallery checks → ‹профил 5 от 6›')
def s2b():
    p = S['admin'].page
    for label in ('ЕИК проверен', 'Контакти потвърдени', 'Собствени снимки'):
        row = p.locator('.chk', has_text=label)
        row.locator('button:has-text("Провери")').click()
        toast(p, 'Промените са запазени')
        expect(p.locator('.ui-toast.is-on')).to_have_count(0, timeout=10_000)
    st = {c['kind']: c['state'] for c in sql('select kind, state from partner_check where partner_id = $1', S['a_id'])}
    assert st['company'] == st['contacts'] == st['gallery'] == 'ok', st
    expect(p.locator('.page-sub')).to_contain_text('профил 5 от 6')
    assert one('select is_verified from partner where id = $1', S['a_id'])['is_verified']
    shoot(S['admin'], 'admin-application')


@step('J4.2c team approves: services go live; vendor-application-approved; the pending page follows')
def s2c():
    p = S['admin'].page
    p.locator('aside button:has-text("Одобри")').click()
    toast(p, 'Профилът е одобрен')
    wait_path(p, r'/admin/partnyori$')
    row = one('select * from partner where id = $1', S['a_id'])
    assert row['status'] == 'approved' and row['approved_at'], row
    svcs = sql("select name, status, published_at from service where partner_id = $1 and status <> 'archived'", S['a_id'])
    assert all(s['status'] == 'active' and s['published_at'] for s in svcs), svcs
    m = until(lambda: last_mail('vendor-application-approved', S['pa'].email), 'vendor-application-approved')
    assert m['vars']['packages'] == 2 and m['vars']['onRequest'] == 1, m['vars']
    assert bell(S['pa'].email, 'vendor-application-approved'), 'no bell item for the approval'
    pa = S['pa'].page
    expect(pa.locator('.pending-eyebrow')).to_have_text('Профилът ви е одобрен', timeout=30_000)
    pa.get_by_role('link', name='Към таблото').click()
    wait_path(pa, r'/partner$')
    expect(pa.locator('.side')).to_contain_text(A['business'])
    shoot(S['pa'], 'partner-dashboard', '/partner')


@step('J4.2d partner: the bell carries the approval and opens a live page')
def s2d():
    p = S['pa'].page
    go(p, '/partner')
    title = bell(S['pa'].email, 'vendor-application-approved')[0]['title']
    p.locator('.topbar button[aria-label="Известия"]').click()
    note = p.locator('.ui-menu .ui-note').first
    expect(note).to_contain_text(title)
    note.click()
    wait_path(p, r'/partner$')
    expect(p.locator('h1.page-title')).to_contain_text(f"Добре дошли, {A['business']}")


@step('J4.2e a new service goes through /admin/moderatsiya: submitted, published, shown on the profile')
def s2e():
    p = S['pa'].page
    go(p, '/partner/uslugi')
    expect(p.locator('.svc-card .svc-title')).to_have_count(3)
    p.click('a.btn:has-text("Добави услуга")')
    wait_path(p, r'/partner/uslugi/nova$')
    p.fill('input[name="name"]', 'Пакет „Годеж“')
    p.fill('textarea[name="description"]', 'Кратко видео от годежа или предложението, с монтаж до 7 дни.')
    p.click('.chip-add:has-text("+ Добави")')
    p.click('.ui-menu button:has-text("Сватби")')
    p.fill('input[name="price"]', '950')
    p.fill('input[name="durationLabel"]', 'До 3 часа')
    p.locator('button:has-text("Изпрати за преглед")').first.click()
    toast(p, 'Услугата е изпратена за преглед')
    s = until(lambda: sql("select * from service where partner_id = $1 and name = 'Пакет „Годеж“'", S['a_id']), 'service saved')[0]
    assert s['status'] == 'pending_review' and s['price_cents'] == 95000, s
    assert until(lambda: last_mail('vendor-service-submitted', S['pa'].email), 'vendor-service-submitted')
    revisions = one("select count(*)::int n from service_revision where status = 'pending'")['n']
    g = S['guest'].page
    go(g, f"/partnyori/{S['a_slug']}")
    expect(g.locator('body')).not_to_contain_text('Пакет „Годеж“')
    a = S['admin'].page
    go(a, f"/admin/partnyori/{S['a_id']}")
    expect(a.locator('aside.side')).to_contain_text(re.compile(f'Модерация\\s*{revisions}'))
    expect(a.locator('a.vrev-pk')).to_have_count(1)
    a.locator('a.vrev-pk', has_text='Пакет „Годеж“').click()
    wait_path(a, r'/admin/moderatsiya\?partnyor=')
    expect(a.locator('.mod')).to_have_count(1)
    expect(a.locator('.mod')).to_contain_text('Пакет „Годеж“')
    go(a, '/admin/moderatsiya')
    a.click('.seg a:has-text("Нови")')
    wait_path(a, r'filter=novi')
    row = a.locator('.mod', has_text='Пакет „Годеж“')
    expect(row).to_contain_text(A['business'])
    row.locator('button:has-text("Публикувай")').click()
    toast(a, 'Обявата е публикувана')
    expect(a.locator('aside.side')).to_contain_text(re.compile(f'Модерация\\s*{revisions - 1}'))
    assert one('select status from service where id = $1', s['id'])['status'] == 'active'
    assert until(lambda: last_mail('vendor-service-published', S['pa'].email), 'vendor-service-published')
    go(g, f"/partnyori/{S['a_slug']}")
    expect(g.locator('body')).to_contain_text('Пакет „Годеж“')


@step('J4.2f public: /tarsene and /kategorii/[slug] list the partner with the right counts and from-price')
def s2f():
    g = S['guest'].page
    go(g, f"/tarsene?kategoriya={A['cat_slug']}")
    cards = g.locator('a.v-card')
    expect(cards).to_have_count(1)
    expect(cards.first).to_contain_text(A['business'])
    expect(cards.first).to_contain_text('от 800 €')
    expect(cards.first.locator('.v-tag', has_text='Проверен')).to_have_count(1)
    expect(g.locator('.results-n').first).to_have_text(f"1 изпълнител · {A['category']}")
    # facet counts: the other active groups plus the item (D43)
    facet = lambda group, label: g.locator('.f-group', has=g.locator('.f-title', has_text=group)).locator('a.f-item', has_text=label).locator('.f-count')
    expect(facet('Тип събитие', 'Сватба')).to_have_text('1')
    expect(facet('Тип събитие', 'Фирмено събитие')).to_have_text('1')
    expect(facet('Тип събитие', 'Рожден ден')).to_have_text('0')
    expect(facet('Град', 'София')).to_have_text('1')
    expect(facet('Политика за анулиране', 'Умерена')).to_have_text('1')
    expect(facet('Политика за анулиране', 'Гъвкава')).to_have_text('0')
    go(g, '/tarsene?q=' + quote('Кадър'))
    expect(g.locator('a.v-card', has_text=A['business'])).to_have_count(1)
    go(g, '/tarsene?q=' + quote('видеозаснемане') + '&sabitie=svatba&grad=sofia')
    expect(g.locator('a.v-card', has_text=A['business'])).to_have_count(1)
    go(g, f"/kategorii/{A['cat_slug']}")
    expect(g.locator('a.v-card', has_text=A['business'])).to_have_count(1)
    expect(g.locator('#main')).to_contain_text('1 проверен изпълнител в цялата страна')
    shoot(S['guest'], 'category-page')
    go(g, '/kategorii')
    card = g.locator('a.feat', has=g.locator('.feat-t', has_text=re.compile(f"^{A['category']}$")))
    expect(card.locator('.feat-free')).to_have_text('1 партньор')
    expect(card.locator('.feat-from')).to_have_text('от 800 €')
    row = one('select min_price_cents, min_price_unit from partner where id = $1', S['a_id'])
    assert row['min_price_cents'] == 80000 and row['min_price_unit'] == 'per_event', row
    go(g, f"/partnyori/{S['a_slug']}")
    expect(g.locator('h1.pv-name')).to_have_text(A['business'])
    for name, price in (('Пакет „Сватбен ден“', '1 200 €'), ('Пакет „Церемония“', '800 €'), ('Пакет „Годеж“', '950 €')):
        expect(g.locator('#main')).to_contain_text(name)
        expect(g.locator('#main')).to_contain_text(price)
    expect(g.locator('#main')).to_contain_text('Корпоративно видео')
    shoot(S['guest'], 'public-profile')


@step('J4.2g the blocked date reads as busy in search and on the profile; a free date is requestable')
def s2g():
    g = S['guest'].page
    d = A['blocked']
    go(g, f"/tarsene?kategoriya={A['cat_slug']}&data={d}")
    expect(g.locator('a.v-card', has_text=A['business'])).to_have_count(0)
    go(g, f"/tarsene?kategoriya={A['cat_slug']}&data={d}&druga-data=1")
    card = g.locator('a.v-card', has_text=A['business'])
    expect(card).to_have_count(1)
    expect(card.locator('.badge')).to_have_text('Зает на 18 октомври')
    go(g, f"/partnyori/{S['a_slug']}?data={d}")
    expect(g.locator('.book')).to_contain_text('Заета дата')
    go(g, f"/partnyori/{S['a_slug']}?data={A['event']}")
    expect(g.locator('.book')).not_to_contain_text('Заета дата')
    expect(g.locator('.book a:has-text("Изпрати запитване")')).to_be_visible()


# 3 ── the first booking ──────────────────────────────────────────────────

@step('J4.3a client sends a request for ‹Пакет „Сватбен ден“›; the partner gets the email and the bell item')
def s3a():
    c = S['client'].page
    go(c, f"/partnyori/{S['a_slug']}?data={A['event']}")
    c.click('.book a:has-text("Изпрати запитване")')
    wait_path(c, rf"/zayavka/{S['a_slug']}")
    c.select_option('select[name=eventTypeId]', label='Сватба')
    c.fill('input[name=eventDate]', A['event'])
    c.fill('input[name=startTime]', '14:00')
    c.fill('input[name=guests]', '120')
    c.fill('input[name=venueName]', 'Ресторант „Езерото“')
    c.fill('input[name=locality]', 'София')
    c.click('label.opt:has-text("Закрита зала")')
    c.click('label.opt:has-text("Пакет „Сватбен ден“")')
    expect(c.locator('.sum-total b')).to_have_text('1 200 €')
    c.fill('textarea[name=note]', 'Здравейте, търсим видео за цялия ден, включително подготовката.')
    c.click('button:has-text("Изпрати заявката")')
    wait_path(c, r'/akaunt/zayavki/\d{4}-\d{4}-')
    n = path_of(c).rsplit('/', 1)[1]
    S['nomer'] = n
    expect(c.locator('.sh-t')).to_have_text('Запитването е изпратено')
    rq = one('select r.*, s.name as service_name from request r left join service s on s.id = r.service_id where r.number = $1', n)
    assert rq['status'] == 'pending' and rq['partner_id'] == S['a_id'] and rq['amount_cents'] == 120000 and rq['guests'] == 120, rq
    m = until(lambda: last_mail('vendor-new-request', S['pa'].email), 'vendor-new-request')
    assert 'Комисион' not in (m['html'] or '') and 'омисион' not in (m['text'] or ''), 'the partner email mentions the commission'
    body = re.sub(r'[\u00a0\u202f]', ' ', m['text'] or '')
    assert 'Получавате: 1 140,00 €' in body, 'vendor-new-request shows the projected ‹Получавате› at the intro rate (5%)'
    assert bell(S['pa'].email, 'vendor-new-request'), 'no bell item for the new request'


@step('J4.3b partner: dashboard and rail count the request; the request page shows ‹Получавате›; approve')
def s3b():
    p = S['pa'].page
    go(p, '/partner')
    expect(p.locator('.side')).to_contain_text(re.compile(r'Заявки\s*1'))
    no_commission(p, '/partner')
    go(p, '/partner/zayavki')
    no_commission(p, '/partner/zayavki')
    p.locator('.req', has_text='Мария Димитрова').locator('.btn:has-text("Разгледай")').click()
    wait_path(p, r'/partner/zayavki/' + re.escape(quote(S['nomer'])))
    expect(p.locator('.rule', has_text='След събитието получавате')).to_contain_text('1 140 €')
    no_commission(p, 'request page')
    expect(p.locator('#main')).not_to_contain_text('412 7730')  # the client's phone waits for a paid booking
    p.click('button:has-text("Одобри заявката")')
    expect(p.locator('.page-head .badge')).to_have_text('Одобрена · чака плащане', timeout=15_000)
    b = one('select * from booking where number = $1', S['nomer'])
    assert b['status'] == 'awaiting_payment' and b['amount_cents'] == 120000 and b['commission_bp'] is None, b
    assert until(lambda: last_mail('client-request-approved', CLIENT), 'client-request-approved')
    shoot(S['pa'], 'partner-request-approved')


@step('J4.3c client pays through the checkout; the booking is confirmed at the intro rate (5%)')
def s3c():
    c = S['client'].page
    go(c, '/akaunt/zayavki/' + quote(S['nomer']))
    expect(c.locator('.sh-t')).to_have_text(f"{A['business']} одобри заявката ви")
    c.click('a.btn:has-text("Плати 1 200 €")')
    wait_path(c, r'/plashtane/' + re.escape(quote(S['nomer'])) + '$')
    c.click('button:has-text("Плати 1 200 €")')
    wait_path(c, r'/plashtane/test/[0-9a-f-]{36}$')
    c.click('button:has-text("Плати")')
    wait_path(c, r'/potvardena$')
    expect(c.locator('.done-t')).to_have_text('Резервацията е потвърдена')
    b = one('select * from booking where number = $1', S['nomer'])
    assert b['status'] == 'confirmed' and b['commission_bp'] == 500 and b['paid_at'], b
    ch = sql("select * from charge where booking_id = $1 and status = 'succeeded'", b['id'])
    assert len(ch) == 1 and ch[0]['amount_cents'] == 120000, ch
    S['booking_id'] = b['id']
    # the money reconciles: the provider fee is the commission, the payout line is what the partner keeps
    assert ch[0]['application_fee_cents'] == 6000, ch[0]
    pl = sql('select * from payout_line where booking_id = $1', b['id'])
    assert len(pl) == 1 and pl[0]['base_cents'] == 120000 and pl[0]['commission_cents'] == 6000 and pl[0]['amount_cents'] == 114000, pl
    led = one('select coalesce(sum(debit_cents), 0)::int d, coalesce(sum(credit_cents), 0)::int c from ledger_entry where booking_id = $1', b['id'])
    assert led['d'] == led['c'] and led['d'] > 0, led
    m = until(lambda: last_mail('vendor-booking-confirmed', S['pa'].email), 'vendor-booking-confirmed')
    assert m['vars']['partnerAmount'].replace('\u00a0', ' ') == '1 140,00 €', m['vars']
    n = bell(S['pa'].email, 'vendor-booking-confirmed')
    assert n and n[0]['title'].replace('\u00a0', ' ') == 'Плащане получено · 1 140 €', n
    assert until(lambda: last_mail('client-booking-confirmed', CLIENT), 'client-booking-confirmed')
    shoot(S['client'], 'client-confirmed')


@step('J4.3d admin booking record: ‹Комисиона (5%)› 60,00 €, partner 1 140,00 €, sums reconcile')
def s3d():
    a = S['admin'].page
    go(a, '/admin/rezervacii/' + quote(S['nomer']))
    fee = a.locator('.bkg-money .split.is-fee')
    expect(fee).to_contain_text('Комисиона (5%)')
    expect(fee).to_contain_text('60,00 €')
    expect(a.locator('.bkg-money .split.is-total')).to_contain_text('1 140,00 €')
    expect(a.locator('.bkg-money')).to_contain_text('1 200,00 €')
    shoot(S['admin'], 'admin-booking')


@step('J4.3e partner screens never show the commission, only ‹Получавате› 1 140,00 €')
def s3e():
    p = S['pa'].page
    n = quote(S['nomer'])
    for route in ['/partner', '/partner/zayavki', f'/partner/zayavki/{n}', '/partner/rezervacii', f'/partner/rezervacii/{n}',
                  '/partner/prihodi', '/partner/kalendar?mesec=2025-10', '/partner/saobshteniya']:
        go(p, route)
        p.wait_for_load_state('networkidle')
        no_commission(p, route)
    go(p, f'/partner/rezervacii/{n}')
    expect(p.locator('.split.is-total', has_text='Получавате')).to_contain_text('1 140,00 €')
    expect(p.locator('#main')).to_contain_text('+359 88 412 7730')  # paid: the phone for the day of the event
    shoot(S['pa'], 'partner-booking')
    go(p, '/partner/prihodi')
    expect(p.locator('#main')).to_contain_text('1 140')
    # the calendar: the wizard's blocked day and the paid booking
    go(p, '/partner/kalendar?mesec=2025-10')
    day = lambda n: p.locator('.mdays .mday:not(.is-out)', has=p.locator('.mday-n', has_text=re.compile(f'^{n}$')))
    expect(day(18)).to_have_class(re.compile(r'\bis-blocked\b'))
    expect(day(25).locator('.chip--booked')).to_have_count(1)
    shoot(S['pa'], 'partner-calendar')
    for m in sql("select template_key, html, text from email_outbox where lower(to_email) = lower($1)", S['pa'].email):
        assert not re.search(r'[Кк]омисион', (m['html'] or '') + (m['text'] or '')), f"{m['template_key']} mentions the commission"


# 4 ── a moderated price change ───────────────────────────────────────────

@step('J4.4 partner changes a published price → moderation; the public page keeps the old price until approval')
def s4():
    p = S['pa'].page
    go(p, '/partner/uslugi')
    p.locator('.svc-card:has-text("Пакет „Церемония“") a:has-text("Редактирай")').click()
    wait_path(p, r'/partner/uslugi/[0-9a-f-]{36}$')
    sid = p.url.rsplit('/', 1)[1]
    p.fill('input[name="price"]', '750')
    p.locator('button:has-text("Запази промените")').first.click()
    toast(p, 'Промените са изпратени за преглед')
    rev = until(lambda: sql("select * from service_revision where service_id = $1 and status = 'pending'", sid), 'edit revision')[0]
    assert rev['type'] == 'edit' and rev['payload']['priceCents'] == [80000, 75000], rev
    assert one('select price_cents from service where id = $1', sid)['price_cents'] == 80000
    go(p, '/partner/uslugi/' + sid)
    expect(p.locator('.se-live .badge')).to_have_text('Активна · промените чакат преглед')
    g = S['guest'].page
    go(g, f"/partnyori/{S['a_slug']}")
    expect(g.locator('.book')).to_contain_text('от 800 €')
    expect(g.locator('#main')).not_to_contain_text('750 €')
    go(g, f"/tarsene?kategoriya={A['cat_slug']}")
    expect(g.locator('a.v-card').first).to_contain_text('от 800 €')
    a = S['admin'].page
    go(a, '/admin/moderatsiya')
    a.click('.seg a:has-text("Редакции")')
    wait_path(a, r'filter=redakcii')
    row = a.locator('.mod', has_text='Пакет „Церемония“')
    expect(row).to_contain_text('800')
    expect(row).to_contain_text('750')
    row.locator('button:has-text("Одобри")').click()
    toast(a, 'Промяната е одобрена')
    assert one('select price_cents from service where id = $1', sid)['price_cents'] == 75000
    assert one('select min_price_cents from partner where id = $1', S['a_id'])['min_price_cents'] == 75000
    assert until(lambda: last_mail('vendor-service-change-approved', S['pa'].email), 'vendor-service-change-approved')
    go(g, f"/partnyori/{S['a_slug']}")
    expect(g.locator('.book')).to_contain_text('от 750 €')
    expect(g.locator('#main')).to_contain_text('750 €')
    expect(g.locator('#main')).not_to_contain_text('800 €')
    go(g, f"/tarsene?kategoriya={A['cat_slug']}")
    expect(g.locator('a.v-card').first).to_contain_text('от 750 €')
    go(p, '/partner/uslugi/' + sid)
    expect(p.locator('.se-live .badge')).to_have_text('Активна')


# 5 ── returned for fixes ─────────────────────────────────────────────────

@step('J4.5a second partner signs up and submits the wizard')
def s5a():
    pb = S['pb']
    S['b_id'] = sign_up(pb, B)['id']
    wizard_step1(pb, B)
    B.update(short='Сватбена и семейна фотография в София.', long='Снимаме сватби и семейни събития с естествена светлина.',
             types=['Сватби'])
    wizard_step2(pb, B, S['photos']['gallery'][:4])
    B.update(pkg1=('Пакет „Цял ден“', 'Фотография от подготовката до тортата.', '1 100', ['400 обработени снимки'], 'До 10 часа'),
             pkg2=('Пакет „Церемония“', 'Фотография на церемонията.', '600', [], 'До 3 часа'))
    wizard_step3(pb, B)
    wizard_step4(pb)
    wizard_step5(pb)
    submit_application(pb, B)
    # the photography listings before the decision
    g = S['guest'].page
    go(g, f"/tarsene?kategoriya={B['cat_slug']}")
    S['b_before'] = g.locator('a.v-card').count()
    expect(g.locator('a.v-card', has_text=B['business'])).to_have_count(0)
    go(g, '/kategorii')
    card = g.locator('a.feat', has=g.locator('.feat-t', has_text=re.compile(f"^{B['category']}$")))
    m = re.match(r'^(\d+)', card.locator('.feat-free').inner_text())  # ‹N партньори› / ‹1 партньор› / ‹Няма партньори›
    S['b_card_before'] = int(m.group(1)) if m else 0


@step('J4.5b team returns it with a note; the partner gets vendor-application-returned and sees the note')
def s5b():
    a = S['admin'].page
    go(a, f"/admin/partnyori/{S['b_id']}")
    note = 'Моля, добавете още снимки от ваши сватби.'
    a.fill('aside textarea[name=note]', note)
    a.locator('aside button:has-text("Върни за поправка")').click()
    toast(a, 'Профилът е върнат за поправка')
    row = one('select * from partner where id = $1', S['b_id'])
    assert row['status'] == 'returned' and row['last_decision_note'] == note, row
    m = until(lambda: last_mail('vendor-application-returned', S['pb'].email), 'vendor-application-returned')
    assert m['vars']['note'] == note
    assert bell(S['pb'].email, 'vendor-application-returned'), 'no bell item for the return'
    p = S['pb'].page
    go(p, R)
    wait_path(p, R + '/6$')
    expect(p.locator('.alert--warning')).to_contain_text(note)
    shoot(S['pb'], 'returned-step6')


@step('J4.5c partner fixes step 2 (two more photos), resubmits; the team approves')
def s5c():
    p = S['pb'].page
    p.locator('.wiz-step:nth-child(2) .m-step-btn').click()
    wait_path(p, R + '/2$')
    with p.expect_file_chooser() as fc:
        p.locator('.gallery-add').click()
    fc.value.set_files(S['photos']['gallery'][4:6])
    expect(p.locator('.gallery-item')).to_have_count(6, timeout=20_000)
    continue_(p)
    wait_path(p, R + '/3$')
    p.locator('.wiz-step:nth-child(6) .m-step-btn').click()
    wait_path(p, R + '/6$')
    expect(p.locator('.wiz-step--done').nth(1)).to_contain_text('Представяне и 6 снимки')
    row = submit_application(S['pb'], B)
    assert one('select count(*)::int n from partner_photo where partner_id = $1', row['id'])['n'] == 6
    assert len(mails('vendor-application-received', S['pb'].email)) == 2
    a = S['admin'].page
    go(a, f"/admin/partnyori/{S['b_id']}")
    a.locator('aside button:has-text("Одобри")').click()
    toast(a, 'Профилът е одобрен')
    assert one('select status from partner where id = $1', S['b_id'])['status'] == 'approved'
    decisions = [d['decision'] for d in sql('select decision from partner_decision where partner_id = $1 order by decided_at', S['b_id'])]
    assert decisions == ['returned', 'approved'], decisions
    assert until(lambda: last_mail('vendor-application-approved', S['pb'].email), 'vendor-application-approved')
    assert bell(S['pb'].email, 'vendor-application-approved'), 'no bell item for the approval'
    expect(p.locator('.pending-eyebrow')).to_have_text('Профилът ви е одобрен', timeout=30_000)
    p.get_by_role('link', name='Към таблото').click()
    wait_path(p, r'/partner$')
    # live in the catalogue: one more photographer, from 600 €
    g = S['guest'].page
    go(g, f"/tarsene?kategoriya={B['cat_slug']}")
    expect(g.locator('a.v-card')).to_have_count(S['b_before'] + 1)
    expect(g.locator('a.v-card', has_text=B['business'])).to_contain_text('от 600 €')
    go(g, '/kategorii')
    card = g.locator('a.feat', has=g.locator('.feat-t', has_text=re.compile(f"^{B['category']}$")))
    n = S['b_card_before'] + 1
    expect(card.locator('.feat-free')).to_have_text('1 партньор' if n == 1 else f'{n} партньори')


@step('J4.6 every bell item the journey left (partners, client) opens a live page, not a 404')
def s6():
    for key, who in (('pa', S['pa']), ('pb', S['pb']), ('client', S['client'])):
        rows = sql('select n.kind, n.title, n.href from notification n join "user" u on u.id = n.user_id where lower(u.email) = lower($1) order by n.created_at', who.email)
        if key != 'client': assert len(rows) >= 3, (key, rows)
        for n in rows:
            if not n['href']: continue
            path = re.sub(r'^https?://[^/]+', '', n['href'])
            r = who.page.goto(BASE + path, wait_until='load')
            assert r.status == 200 and 'Страницата не е намерена' not in who.page.locator('body').inner_text(), (key, n['kind'], path, r.status)
        # the bell itself lists them
        go(who.page, '/partner' if key != 'client' else '/akaunt/zayavki')
        who.page.locator('button[aria-label="Известия"]').first.click()
        expect(who.page.locator('.ui-menu .ui-note').first).to_be_visible()
        who.page.keyboard.press('Escape')


def main():
    print(f'J4 journey against {BASE} · database {DB_URL.rsplit("/", 1)[1]}', flush=True)
    reset_db()
    stamp = str(int(time.time()))[-6:]
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('*.png'): old.unlink()
    S['photos'] = photos(OUT / 'photos')
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not HEADED)
        S['pa'] = Person(browser, 'partner A', f'kadar.video.{stamp}@example.com', A['password'])
        S['pb'] = Person(browser, 'partner B', f'foto.svetlina.{stamp}@example.com', B['password'])
        S['admin'] = Person(browser, 'admin', ADMIN); S['admin'].sign_in()
        S['client'] = Person(browser, 'client', CLIENT); S['client'].sign_in()
        S['guest'] = Person(browser, 'guest')
        S['guest'].phone_page = lambda: _guest_phone(S['guest'])
        current = None
        try:
            for title, fn in STEPS:
                current = title
                before = len(ERRORS)
                fn()
                assert len(ERRORS) == before, ERRORS[before:]
                print(f'ok    {title}', flush=True)
        except Exception as e:
            for c in CONSOLE: print(f'console  {c}')
            print(f'FAIL  {current}\n      {type(e).__name__}: {str(e)[:1500]}', flush=True)
            traceback.print_exc(limit=3)
            OUT.mkdir(parents=True, exist_ok=True)
            for key in ('pa', 'pb', 'admin', 'client', 'guest'):
                try: S[key].page.screenshot(path=str(OUT / f'FAIL-{key}.png'), full_page=True)
                except Exception: pass
            sys.exit(1)
        browser.close()
    for c in CONSOLE: print(f'console  {c}')
    print(f'PASS  J4 — {len(STEPS)} steps, {len(SHOTS) * 2} screenshots in {OUT}')


def _guest_phone(person):
    if not person.phone:
        person.phone = person.context(390, 844)
        person.phone_pg = person.phone.new_page()
        person.watch(person.phone_pg)
    return person.phone_pg


if __name__ == '__main__':
    main()
