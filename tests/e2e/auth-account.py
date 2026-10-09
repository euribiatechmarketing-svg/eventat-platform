#!/usr/bin/env python3
"""End-to-end: auth and the client's own account pages (SCREENS §3 Auth; §4 /akaunt, /akaunt/nastroyki,
/akaunt/zapazeni, /akaunt/sabitiya, /akaunt/sabitiya/[id]), driven with real clicks and typing against a
running dev server.

Usage: python3 tests/e2e/auth-account.py [--base http://localhost:3202] [--no-reseed]

Reseeds the database named in .env.local first (the platform clock restarts at 31 Aug 2025 12:00), then checks
guards, sign-up (client and partner) with the email code, sign-in (errors, ‹Запомни ме›, unverified email,
two-step SMS code), the reset link, every settings action, saved searches, event folders, the deletion links
and the 390 px layout. Each step asserts what is on screen and, where useful, the database effect.
"""
import hashlib, json, os, re, struct, subprocess, sys, time, zlib
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
NODE_BIN = Path.home() / 'nodejs22' / 'bin'
MARIA = ('maria.dimitrova@gmail.com', 'eventat-demo')
PARTNER = ('studio.melodia@gmail.com', 'eventat-demo')
ADMIN = ('monika.kovacheva@eventat.bg', 'eventat-demo')
STAMP = str(int(time.time()))[-6:]
OUT = Path(os.environ.get('E2E_OUT', '/tmp')) / f'auth-account-e2e-{STAMP}'


def env_file():
    out = {}
    for line in (ROOT / '.env.local').read_text().splitlines():
        m = re.match(r'^([A-Z0-9_]+)=(.*)$', line.strip())
        if m: out[m.group(1)] = m.group(2).strip().strip('"')
    return out


ENV = env_file()
DB_URL = ENV['DATABASE_URL']


def sql(query, *params):
    """Run a query through the repo's postgres client (no Python driver needed); returns rows as dicts."""
    script = ("const p=require(process.argv[1]);const s=p(process.argv[2],{max:1,onnotice:()=>{}});"
              "s.unsafe(process.argv[3],JSON.parse(process.argv[4])).then(r=>{process.stdout.write(JSON.stringify(r));return s.end()})"
              ".catch(e=>{console.error(e.message);process.exit(1)})")
    r = subprocess.run([str(NODE_BIN / 'node'), '-e', script, str(ROOT / 'node_modules' / 'postgres'), DB_URL, query, json.dumps(list(params))],
                       capture_output=True, text=True)
    if r.returncode: raise RuntimeError(r.stderr)
    return json.loads(r.stdout or '[]')


def one(query, *params):
    rows = sql(query, *params)
    assert rows, f'no row for {query} {params}'
    return rows[0]


def reseed():
    env = {**os.environ, 'PATH': f'{NODE_BIN}:{os.environ["PATH"]}', 'DATABASE_URL': DB_URL}
    for cmd in (['npm', 'run', 'db:reset'], ['npm', 'run', 'db:seed']):
        subprocess.run(cmd, cwd=ROOT, env=env, check=True, capture_output=True)


def png(path, rgb=(127, 100, 174), size=8):
    raw = b''.join(b'\x00' + bytes(rgb) * size for _ in range(size))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    Path(path).write_bytes(data)
    return str(path)


def valid_eik(prefix='20784511'):
    d = [int(c) for c in prefix]
    r = sum(x * w for x, w in zip(d, range(1, 9))) % 11
    if r == 10: r = sum(x * w for x, w in zip(d, range(3, 11))) % 11
    return prefix + str(0 if r == 10 else r)


def last_mail(key, to=None, user_id=None):
    if to: return one('select * from email_outbox where template_key = $1 and lower(to_email) = lower($2) order by created_at desc limit 1', key, to)
    return one('select * from email_outbox where template_key = $1 and to_user_id = $2 order by created_at desc limit 1', key, user_id)


def user_by_email(email):
    return one('select * from "user" where lower(email) = lower($1)', email)


STEPS = []
def step(name):
    def deco(fn):
        STEPS.append((name, fn))
        return fn
    return deco


class T:
    def __init__(self, pw, base):
        self.pw, self.base = pw, base
        self.browser = pw.chromium.launch()

    def ctx(self, w=1440, h=900):
        c = self.browser.new_context(viewport={'width': w, 'height': h}, locale='bg-BG', timezone_id='Europe/Sofia', base_url=self.base)
        c.set_default_timeout(20_000)
        return c

    def toast(self, page, text):
        expect(page.locator('.ui-toast.is-on')).to_contain_text(text, timeout=15_000)

    def flash(self, page, text):
        """The toast on a page outside this area: shown when that route is built on this branch, otherwise the
        one-time flash cookie it would read must carry the text."""
        if page.locator('.ui-toast').count():
            self.toast(page, text)
            return
        cookie = [x for x in page.context.cookies() if x['name'] == 'flash']
        assert cookie and json.loads(unquote(cookie[0]['value']))['message'] == text, cookie

    def sign_in(self, page, email, password, remember=True):
        page.goto('/vhod')
        page.fill('#vhod-email', email)
        page.fill('#vhod-password', password)
        if not remember: tick(page, 'label.f-item:has-text("Запомни ме")')
        page.click('button:has-text("Влез")')

    def sign_out(self, page):
        page.click('.nav-user')
        page.click('[role="menuitem"]:has-text("Изход")')
        page.wait_for_url(re.compile(r'/$'))

    def type_code(self, page, code):
        page.locator('input.ver-cell').first.click()
        page.keyboard.type(code)
        page.click('button:has-text("Потвърди")')


def tick(page, label):
    """Click a drawn checkbox where a person would: on the box at the start of its label."""
    page.locator(label).click(position={'x': 8, 'y': 9})


def path_of(page):
    u = urlparse(page.url)
    return unquote(u.path) + (('?' + unquote(u.query)) if u.query else '')


# ── guards ────────────────────────────────────────────────────────────────

@step('guards: guests sign in first, wrong roles go home, signed-in users skip /vhod')
def guards(t: T):
    c = t.ctx(); p = c.new_page()
    for route in ['/akaunt', '/akaunt/nastroyki', '/akaunt/zapazeni', '/akaunt/sabitiya']:
        p.goto(route)
        assert path_of(p).startswith('/vhod?next='), (route, p.url)
    t.sign_in(p, *PARTNER); p.wait_for_url(re.compile(r'/partner'))
    p.goto('/akaunt/zapazeni'); assert urlparse(p.url).path.startswith('/partner'), p.url
    p.goto('/vhod'); assert urlparse(p.url).path.startswith('/partner'), p.url
    c.close()
    c = t.ctx(); p = c.new_page()
    t.sign_in(p, *ADMIN); p.wait_for_url(re.compile(r'/admin'))
    p.goto('/akaunt/sabitiya'); assert urlparse(p.url).path.startswith('/admin'), p.url
    c.close()
    c = t.ctx(); p = c.new_page()
    t.sign_in(p, *MARIA); p.wait_for_url(re.compile(r'/tarsene'))
    for route in ['/vhod', '/registratsiya']:
        p.goto(route); assert urlparse(p.url).path == '/tarsene', p.url
    p.goto('/akaunt'); assert unquote(urlparse(p.url).path) == '/akaunt/zayavki', p.url
    other = one("select e.id from client_event e join \"user\" u on u.id = e.client_id where u.email <> $1 limit 1", MARIA[0])
    r = p.goto(f'/akaunt/sabitiya/{other["id"]}')
    assert r.status == 404, r.status
    c.close()


# ── sign-in screen ────────────────────────────────────────────────────────

@step('sign-in: errors, role cards, ‹EN›, ‹Забравена парола?›, ‹Запомни ме› and next')
def sign_in_screen(t: T):
    c = t.ctx(); p = c.new_page()
    p.goto('/vhod')
    p.click('button:has-text("Влез")')
    expect(p.locator('.field--error')).to_have_count(2)
    p.fill('#vhod-email', MARIA[0]); p.fill('#vhod-password', 'wrong-password')
    p.click('button:has-text("Влез")')
    expect(p.locator('.acc-err[role=alert]')).to_have_text('Грешен имейл или парола.')
    assert urlparse(p.url).path == '/vhod'
    # role cards switch the photo and carry ?as= to sign-up
    p.click('button.role:has-text("Изпълнител")')
    expect(p.locator('.auth-side[data-side=partner]')).to_be_visible()
    expect(p.locator('.auth-side[data-side=client]')).to_be_hidden()
    assert 'as=partner' in p.locator('a.auth-tab:has-text("Регистрация")').get_attribute('href')
    p.click('.lang span:has-text("EN")'); t.toast(p, 'Английската версия идва скоро')
    # forgot password
    before = len(sql("select id from email_outbox where template_key = 'client-password-link' and to_email = $1", MARIA[0]))
    p.click('button:has-text("Забравена парола?")')
    t.toast(p, 'Изпратихме ви линк за нова парола')
    after = len(sql("select id from email_outbox where template_key = 'client-password-link' and to_email = $1", MARIA[0]))
    assert after == before + 1, (before, after)
    # remember me off → a browser-session cookie; next is kept
    p.goto('/vhod?next=' + '/akaunt/sabitiya')
    p.fill('#vhod-email', MARIA[0]); p.fill('#vhod-password', MARIA[1])
    tick(p, 'label.f-item:has-text("Запомни ме")')
    expect(p.locator('label.f-item .f-box')).not_to_have_class(re.compile('is-on'))
    p.click('button:has-text("Влез")')
    p.wait_for_url(lambda u: urlparse(u).path == '/akaunt/sabitiya')
    tok = [x for x in c.cookies() if x['name'].endswith('session_token')][0]
    assert tok['expires'] == -1, tok
    assert one('select last_login_at from "user" where email = $1', MARIA[0])['last_login_at']
    c.close()


@step('blocked profile: sign-in is refused (SPEC §1.3)')
def blocked(t: T):
    email = 'petya.n@gmail.com'
    sql('update "user" set banned = true where email = $1', email)
    try:
        c = t.ctx(); p = c.new_page()
        t.sign_in(p, email, 'eventat-demo')
        expect(p.locator('.acc-err[role=alert]')).to_have_text('Профилът е блокиран')
        assert urlparse(p.url).path == '/vhod', p.url
        assert not [x for x in c.cookies() if x['name'].endswith('session_token')]
        c.close()
    finally:
        sql('update "user" set banned = false where email = $1', email)


# ── client sign-up and the email code ─────────────────────────────────────

CLIENT_EMAIL = f'e2e.client.{STAMP}@example.com'
CLIENT_PW = 'Tarsene-2025!'

@step('sign-up (client): fields, consent, code screen, wrong code, resend, ‹Профилът е създаден›')
def client_sign_up(t: T):
    c = t.ctx(); p = c.new_page()
    p.goto('/vhod?next=/zayavka/studio-melodiya')
    expect(p.locator('.auth-d')).to_have_text('Ще изпратите запитването веднага след като влезете.')
    p.click('a.auth-tab:has-text("Регистрация")')
    p.wait_for_url(re.compile(r'/registratsiya\?next='))
    expect(p.locator('.auth-d')).to_have_text('Ще изпратите запитването веднага след регистрацията.')
    p.goto('/registratsiya')
    p.click('button:has-text("Създай профил")')
    for k in ['name', 'email', 'phone']: expect(p.locator(f'#reg-{k}')).to_be_visible()
    expect(p.locator('.reg-consent .acc-err')).to_have_text('Приемете Общите условия и Политиката за поверителност.')
    p.fill('#reg-name', 'Елена Тестова'); p.fill('#reg-email', MARIA[0]); p.fill('#reg-phone', '0888 123 456')
    p.fill('#reg-password', 'short')
    expect(p.locator('.reg-meter-t')).to_have_count(0)
    tick(p, '.reg-consent label.f-item')
    p.click('button:has-text("Създай профил")')
    expect(p.locator('.field--error:has(#reg-email) .acc-err')).to_have_text('Вече има профил с този имейл.')
    expect(p.locator('.field--error:has(#reg-password) .acc-err')).to_have_text('Паролата трябва да е поне 8 знака.')
    p.fill('#reg-email', CLIENT_EMAIL)
    p.fill('#reg-password', CLIENT_PW)
    expect(p.locator('.reg-meter-t')).to_have_text('Силна парола')
    if not p.locator('.reg-consent .f-box').get_attribute('class').endswith('is-on'): tick(p, '.reg-consent label.f-item')
    p.click('button:has-text("Създай профил")')
    p.wait_for_url(re.compile(r'/potvarzhdenie\?'))
    expect(p.locator('.ver-lead b')).to_have_text(CLIENT_EMAIL)
    u = user_by_email(CLIENT_EMAIL)
    assert u['role'] == 'client' and not u['email_verified'] and u['phone'] == '+359888123456', u
    assert one('select count(*)::int n from consent where user_id = $1', u['id'])['n'] == 2
    assert one('select count(*)::int n from client_profile where user_id = $1', u['id'])['n'] == 1
    code = last_mail('client-verify-code', to=CLIENT_EMAIL)['vars']['code']
    expect(p.locator('.ver-resend button')).to_be_disabled()
    expect(p.locator('.ver-timer')).to_contain_text('след 0:')
    # wrong code
    wrong = '000000' if code != '000000' else '111111'
    t.type_code(p, wrong)
    expect(p.locator('.acc-err[role=alert]')).to_have_text('Кодът не е верен.')
    # resend after the cooldown: the old code stops working
    sql("update verification set expires_at = expires_at - interval '61 seconds' where identifier = $1", f'email-verification-otp-{CLIENT_EMAIL}')
    p.reload()
    expect(p.locator('.ver-resend button')).to_be_enabled()
    p.click('.ver-resend button:has-text("Поискайте нов")')
    t.toast(p, 'Изпратихме нов код')
    code2 = last_mail('client-verify-code', to=CLIENT_EMAIL)['vars']['code']
    assert len(sql("select id from email_outbox where template_key = 'client-verify-code' and to_email = $1", CLIENT_EMAIL)) == 2
    if code2 != code:
        t.type_code(p, code)
        expect(p.locator('.acc-err[role=alert]')).to_be_visible()
    t.type_code(p, code2)
    p.wait_for_url(re.compile(r'/tarsene'))
    t.flash(p, 'Профилът е създаден')
    assert user_by_email(CLIENT_EMAIL)['email_verified'] is True
    assert last_mail('client-welcome', user_id=u['id'])
    c.close()


@step('sign-in with an unverified email goes to the code screen; ‹Сменете имейла› returns to sign-up')
def unverified(t: T):
    c = t.ctx(); p = c.new_page()
    email = f'e2e.unverified.{STAMP}@example.com'
    p.goto('/registratsiya')
    p.fill('#reg-name', 'Пламен Тестов'); p.fill('#reg-email', email); p.fill('#reg-phone', '+359 87 765 4321'); p.fill('#reg-password', 'Dlaga-parola-1')
    tick(p, '.reg-consent label.f-item')
    p.click('button:has-text("Създай профил")')
    p.wait_for_url(re.compile(r'/potvarzhdenie'))
    p.click('button.ver-change:has-text("Сменете имейла")')
    p.wait_for_url(re.compile(r'/registratsiya'))
    assert not sql('select 1 from verification where identifier = $1', f'email-verification-otp-{email}')
    t.sign_in(p, email, 'Dlaga-parola-1')
    p.wait_for_url(re.compile(r'/potvarzhdenie\?.*email='))
    assert sql('select 1 from verification where identifier = $1', f'email-verification-otp-{email}')
    c.close()


@step('sign-up (partner): business fields → vendor code → /partner/registratsiya/1')
def partner_sign_up(t: T):
    c = t.ctx(); p = c.new_page()
    email = f'e2e.partner.{STAMP}@example.com'
    p.goto('/registratsiya')
    p.click('button.role:has-text("Изпълнител")')
    expect(p.locator('.auth-side[data-side=partner]')).to_be_visible()
    p.fill('#reg-businessName', 'Тест Звук'); p.fill('#reg-contactName', 'Иван Тестов')
    p.fill('#reg-email', email); p.fill('#reg-phone', '0887 111 222'); p.fill('#reg-password', 'Partnyor-2025!')
    tick(p, '.reg-consent label.f-item')
    p.click('button:has-text("Създай профил")')
    p.wait_for_url(re.compile(r'/potvarzhdenie\?.*as=partner'))
    expect(p.locator('.auth-side[data-side=partner]')).to_be_visible()
    mail = last_mail('vendor-verify-code', to=email)
    assert mail['vars']['partnerName'] == 'Тест Звук', mail['vars']
    u = user_by_email(email)
    pr = one('select p.* from partner p join partner_member m on m.partner_id = p.id where m.user_id = $1', u['id'])
    assert u['role'] == 'partner' and pr['status'] == 'draft' and pr['business_name'] == 'Тест Звук'
    t.type_code(p, mail['vars']['code'])
    p.wait_for_url(re.compile(r'/partner/registratsiya/1'))
    t.flash(p, 'Имейлът е потвърден')
    assert last_mail('vendor-welcome', user_id=u['id'])
    c.close()


@step('reset link: email → /vhod/nova-parola → new password → sign in with it')
def reset_link(t: T):
    c = t.ctx(); p = c.new_page()
    p.goto('/vhod')
    p.fill('#vhod-email', CLIENT_EMAIL)
    p.click('button:has-text("Забравена парола?")')
    t.toast(p, 'Изпратихме ви линк за нова парола')
    url = last_mail('client-password-link', to=CLIENT_EMAIL)['vars']['url']
    p.goto(url)
    p.wait_for_url(re.compile(r'/vhod/nova-parola\?token='))
    p.fill('#nova-parola', 'Nova-parola-2025!')
    expect(p.locator('.reg-meter-t')).to_have_text('Силна парола')
    p.click('button:has-text("Задай нова парола")')
    p.wait_for_url(re.compile(r'/vhod$'))
    t.toast(p, 'Паролата ви е сменена')
    u = user_by_email(CLIENT_EMAIL)
    assert u['password_changed_at'] and last_mail('client-password-changed', user_id=u['id'])
    p.goto(url)  # used link
    expect(p.locator('.acc-err[role=alert]')).to_have_text('Линкът е изтекъл. Поискайте нов от екрана за вход.')
    t.sign_in(p, CLIENT_EMAIL, 'Nova-parola-2025!')
    p.wait_for_url(re.compile(r'/tarsene'))
    c.close()


# ── settings ──────────────────────────────────────────────────────────────

@step('settings: save profile and switches, ‹Откажи›, locked switch, photo, password link, invoice data')
def settings(t: T):
    c = t.ctx(); p = c.new_page()
    t.sign_in(p, *MARIA); p.wait_for_url(re.compile(r'/tarsene'))
    p.goto('/akaunt/nastroyki')
    maria = user_by_email(MARIA[0])
    # ‹Откажи›
    p.fill('#set-name', 'Нещо Друго')
    p.click('button:has-text("Откажи")')
    t.toast(p, 'Промените са отменени')
    expect(p.locator('#set-name')).to_have_value('Мария Димитрова')
    # locked switch
    p.click('[role=switch][aria-label="Отговор по заявка · Имейл"]')
    t.toast(p, 'Този имейл е служебен — идва винаги, за да имате потвърждение и разписка')
    # save: name, city, a switch, marketing
    p.fill('#set-name', 'Мария Петрова')
    p.select_option('#set-city', label='Пловдив')
    p.click('[role=switch][aria-label="Съобщение от изпълнител · SMS"]')
    p.click('[role=switch][aria-label="Маркетингови съобщения"]')
    expect(p.locator('[role=switch][aria-label="Маркетингови съобщения"]')).to_have_attribute('aria-checked', 'true')
    p.click('button:has-text("Запази промените")')
    t.toast(p, 'Промените са запазени')
    expect(p.locator('.nav-user-name')).to_have_text('Мария П.')
    u = user_by_email(MARIA[0])
    assert u['name'] == 'Мария Петрова', u['name']
    prof = one('select p.marketing_opt_in, c.name city from client_profile p join city c on c.id = p.city_id where p.user_id = $1', u['id'])
    assert prof['marketing_opt_in'] is True and prof['city'] == 'Пловдив', prof
    assert one("select enabled from notification_preference where user_id = $1 and key = 'client.messages' and channel = 'sms'", u['id'])['enabled'] is True
    expect(p.locator('[role=switch][aria-label="Съобщение от изпълнител · SMS"]')).to_have_attribute('aria-checked', 'true')
    # field error
    p.fill('#set-phone', '12')
    p.click('button:has-text("Запази промените")')
    expect(p.locator('.field--error:has(#set-phone) .acc-err')).to_have_text('Въведете валиден телефонен номер.')
    p.goto('/akaunt/nastroyki')
    # photo
    p.set_input_files('#set-photo', png(OUT / 'avatar.png', size=12))
    t.toast(p, 'Снимката е обновена')
    assert user_by_email(MARIA[0])['image'], 'avatar not stored'
    expect(p.locator('.acc-prof .avatar img')).to_be_visible()
    # password link
    p.click('button:has-text("Смени паролата")')
    t.toast(p, 'Изпратихме линк за нова парола на имейла ви')
    assert last_mail('client-password-link', to=MARIA[0])
    # invoice data
    p.click('button:text-is("Промени")')
    t.toast(p, 'Можете да редактирате данните')
    p.click('button.opt:has-text("Фирма")')
    p.fill('#inv-companyName', 'Тест ЕООД'); p.fill('#inv-eik', '123'); p.fill('#inv-mol', 'Мария Петрова')
    p.click('.acc-inv button:has-text("Запази промените")')
    expect(p.locator('.field--error:has(#inv-eik) .acc-err')).to_have_text('Въведете валиден ЕИК.')
    p.fill('#inv-eik', valid_eik())
    p.click('.acc-inv button:has-text("Запази промените")')
    t.toast(p, 'Промените са запазени')
    expect(p.locator('.set-d:has-text("Фирма")')).to_contain_text('Тест ЕООД')
    inv = one('select * from client_invoice_profile where user_id = $1', maria['id'])
    assert inv['recipient_type'] == 'company' and inv['eik'] == valid_eik(), inv
    c.close()


@step('settings: two-step on → sign-in needs the SMS code → off again')
def two_factor(t: T):
    c = t.ctx(); p = c.new_page()
    t.sign_in(p, CLIENT_EMAIL, 'Nova-parola-2025!'); p.wait_for_url(re.compile(r'/tarsene'))
    p.goto('/akaunt/nastroyki')
    p.click('[role=switch][aria-label="Потвърждение в две стъпки"]')
    p.click('button:has-text("Запази промените")')
    t.toast(p, 'Промените са запазени')
    u = user_by_email(CLIENT_EMAIL)
    assert u['two_factor_enabled'] is True and last_mail('client-2fa-on', user_id=u['id'])
    c.close()
    c = t.ctx(); p = c.new_page()
    t.sign_in(p, CLIENT_EMAIL, 'Nova-parola-2025!')
    p.wait_for_url(re.compile(r'/vhod/kod'))
    expect(p.locator('.ver-lead b')).to_have_text('+359 88 ••• ••56')
    sms = one("select body from sms_outbox where to_user_id = $1 and template_key = 'two-factor-code' order by created_at desc limit 1", u['id'])['body']
    t.type_code(p, '000000' if sms != '000000' else '111111')
    expect(p.locator('.acc-err[role=alert]')).to_have_text('Кодът не е верен.')
    t.type_code(p, sms)
    p.wait_for_url(re.compile(r'/tarsene'))
    p.goto('/akaunt/nastroyki')
    p.click('[role=switch][aria-label="Потвърждение в две стъпки"]')
    p.click('button:has-text("Запази промените")')
    t.toast(p, 'Промените са запазени')
    assert user_by_email(CLIENT_EMAIL)['two_factor_enabled'] is False
    c.close()


@step('settings: email change with a code (D55)')
def email_change(t: T):
    c = t.ctx(); p = c.new_page()
    t.sign_in(p, CLIENT_EMAIL, 'Nova-parola-2025!'); p.wait_for_url(re.compile(r'/tarsene'))
    new = f'e2e.new.{STAMP}@example.com'
    p.goto('/akaunt/nastroyki')
    p.fill('#set-email', MARIA[0])
    p.click('button:has-text("Запази промените")')
    expect(p.locator('.field--error:has(#set-email) .acc-err')).to_have_text('Вече има профил с този имейл.')
    p.fill('#set-email', new)
    p.click('button:has-text("Запази промените")')
    p.wait_for_url(re.compile(r'/akaunt/nastroyki/imeyl'))
    expect(p.locator('.ver-lead b')).to_have_text(new)
    code = last_mail('client-verify-code', to=new)['vars']['code']
    t.type_code(p, code)
    p.wait_for_url(re.compile(r'/akaunt/nastroyki$'))
    t.toast(p, 'Промените са запазени')
    expect(p.locator('#set-email')).to_have_value(new)
    assert user_by_email(new)['id']
    globals()['CLIENT_EMAIL'] = new
    c.close()


@step('saved searches: bell off / on, ‹Отвори›, delete, watch row')
def saved(t: T):
    c = t.ctx(); p = c.new_page()
    t.sign_in(p, *MARIA); p.wait_for_url(re.compile(r'/tarsene'))
    p.goto('/akaunt/zapazeni')
    rows = p.locator('.mine--wait .mrow')
    expect(rows).to_have_count(3)
    expect(p.locator('.mine--wait .mine-c')).to_have_text('3')
    first = rows.nth(0)
    title = first.locator('.mrow-n').inner_text()
    sid = one('select id from saved_search where title = $1', title)['id']
    first.locator('button[aria-label="Изключи известията за това търсене"]').click()
    t.toast(p, 'Известията за това търсене са изключени')
    assert one('select notify from saved_search where id = $1', sid)['notify'] is False
    p.locator('.mine--wait .mrow').nth(0).locator('button[aria-label="Включи известията за това търсене"]').click()
    t.toast(p, 'Ще ви известим при нови резултати')
    assert one('select notify from saved_search where id = $1', sid)['notify'] is True
    p.locator('.mine--wait .mrow').nth(0).locator('a:has-text("Отвори")').click()
    p.wait_for_url(re.compile(r'/tarsene\?'))
    assert 'data=2026-06-14' in p.url and 'sabitie=svatba' in p.url, p.url
    assert one('select seen_at from saved_search where id = $1', sid)['seen_at']
    p.goto('/akaunt/zapazeni')
    p.locator('.mine--wait .mrow').nth(2).locator('button[aria-label="Изтрий запазеното търсене"]').click()
    t.toast(p, 'Търсенето е изтрито')
    expect(p.locator('.mine--wait .mrow')).to_have_count(2)
    assert one('select count(*)::int n from saved_search s join "user" u on u.id = s.client_id where u.email = $1', MARIA[0])['n'] == 2
    p.click('a.mrow:has-text("Snap360")')
    p.wait_for_url(re.compile(r'/partnyori/snap360'))
    c.close()


@step('event folders: cards, add-service link, notes, request and booking rows')
def events(t: T):
    c = t.ctx(); p = c.new_page()
    t.sign_in(p, *MARIA); p.wait_for_url(re.compile(r'/tarsene'))
    p.goto('/akaunt/sabitiya')
    expect(p.locator('.ev-card')).to_have_count(3)
    wedding = p.locator('.ev-card:has-text("Сватба")')
    expect(wedding.locator('.ev-num').nth(1)).to_have_text('3')
    expect(wedding.locator('.mrow-price')).to_have_text('2 750 €')
    expect(p.locator('.ev-card--past .ev-add')).to_have_count(0)
    wedding.locator('a:has-text("Добави услуга към събитието")').click()
    p.wait_for_url(re.compile(r'/tarsene\?.*sabitie-id='))
    assert 'sabitie=svatba' in p.url and 'grad=sofia' in p.url and 'data=2026-06-14' in p.url and 'gosti=120' in p.url, p.url
    p.goto('/akaunt/sabitiya')
    p.locator('.ev-card:has-text("Коледно парти") .ev-card-link').click()
    p.wait_for_url(re.compile(r'/akaunt/sabitiya/[0-9a-f-]{36}$'))
    eid = urlparse(p.url).path.rsplit('/', 1)[1]
    expect(p.locator('.ev-facts')).to_contain_text('1 100 €')
    expect(p.locator('.ev-facts')).to_contain_text('още 2 440 € по чакащите заявки')
    p.fill('textarea.ev-note-box', 'Паркингът е отзад.\nТортата след речта.')
    p.click('button:has-text("Запази бележката")')
    t.toast(p, 'Бележката е запазена')
    saved_notes = one('select notes from client_event where id = $1', eid)['notes']
    assert saved_notes == 'Паркингът е отзад.\nТортата след речта.', repr(saved_notes)
    expect(p.locator('textarea.ev-note-box')).to_have_value('Паркингът е отзад.\nТортата след речта.')
    expect(p.locator('.ev-note-meta')).to_contain_text('Последна промяна:')
    rows = p.locator('.mine:has(.mine-t:text-is("Заявки")) .mrow')
    expect(rows).to_have_count(3)
    expect(rows.nth(0)).to_contain_text('Флора Студио')
    expect(rows.nth(0).locator('.badge')).to_contain_text('Остават')
    rows.nth(0).locator('a:has-text("Плати")').click()
    p.wait_for_url(re.compile(r'/plashtane/'))
    assert unquote(urlparse(p.url).path) == '/plashtane/2026-1219-ДК', p.url
    p.go_back(); p.wait_for_url(re.compile(r'/akaunt/sabitiya/'))
    p.locator('.mine:has(.mine-t:text-is("Заявки")) .mrow').nth(2).locator('a:has-text("Виж подобни")').click()
    p.wait_for_url(re.compile(r'/tarsene\?'))
    assert 'kategoriya=fotokabini' in p.url and 'data=2026-12-19' in p.url, p.url
    p.go_back(); p.wait_for_url(re.compile(r'/akaunt/sabitiya/'))
    p.locator('.mine:has(.mine-t:text-is("Заявки")) .mrow').nth(1).locator('.acc-row-link').click()
    p.wait_for_url(re.compile(r'/akaunt/zayavki/'))
    assert unquote(urlparse(p.url).path) == '/akaunt/zayavki/2026-1219-КТ', p.url
    p.go_back(); p.wait_for_url(re.compile(r'/akaunt/sabitiya/'))
    p.click('a.mrow:has-text("Студио Мелодия")')
    p.wait_for_url(re.compile(r'/akaunt/rezervacii/'))
    assert unquote(urlparse(p.url).path) == '/akaunt/rezervacii/2026-1219-ЕА', p.url
    p.go_back(); p.wait_for_url(re.compile(r'/akaunt/sabitiya/'))
    p.click('.crumbs a:has-text("Моите събития")')
    p.wait_for_url(re.compile(r'/akaunt/sabitiya$'))
    p.click('.ev-flat a:has-text("Всички резервации")')
    p.wait_for_url(re.compile(r'/akaunt/rezervacii$'))
    c.close()


@step('phone width (390 px): no sideways scroll on any screen of the area')
def phone(t: T):
    c = t.ctx(390, 844); p = c.new_page()
    for route in ['/vhod', '/registratsiya', '/registratsiya?as=partner']:
        p.goto(route)
        assert p.evaluate('document.documentElement.scrollWidth') <= 390, route
    t.sign_in(p, *MARIA); p.wait_for_url(re.compile(r'/tarsene'))
    eid = one("select e.id from client_event e join \"user\" u on u.id = e.client_id where u.email = $1 and e.title = 'Коледно парти'", MARIA[0])['id']
    for route in ['/akaunt/nastroyki', '/akaunt/zapazeni', '/akaunt/sabitiya', f'/akaunt/sabitiya/{eid}']:
        p.goto(route)
        w = p.evaluate('document.documentElement.scrollWidth')
        assert w <= 390, (route, w)
        over = p.evaluate('''() => [...document.querySelectorAll('.btn, .badge, .auth-tab, .role-t, .mrow-v, .ev-lab')]
          .filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim())''')
        assert not over, (route, over)
    c.close()


@step('deletion links: client (request → link → confirm) and partner (blocked by bookings, then confirmed)')
def deletion(t: T):
    c = t.ctx(); p = c.new_page()
    t.sign_in(p, CLIENT_EMAIL, 'Nova-parola-2025!'); p.wait_for_url(re.compile(r'/tarsene'))
    u = user_by_email(CLIENT_EMAIL)
    p.goto('/akaunt/nastroyki')
    p.click('button:has-text("Изтрий профила")')
    t.toast(p, 'Изпратихме имейл за потвърждение на изтриването')
    url = last_mail('client-delete-confirm', user_id=u['id'])['vars']['url']
    p.goto(url)
    expect(p.locator('h1')).to_have_text('Потвърдете изтриването на профила')
    expect(p.locator('.ver-lead b')).to_have_text(CLIENT_EMAIL)
    p.click('button:has-text("Потвърди изтриването")')
    p.wait_for_url(re.compile(r'/$'))
    row = one('select deleted_at, name from "user" where id = $1', u['id'])
    assert row['deleted_at'] and row['name'] == 'Изтрит профил', row
    p.goto('/akaunt/nastroyki'); assert path_of(p).startswith('/vhod'), p.url
    p.goto(url); expect(p.locator('.acc-err[role=alert]')).to_have_text('Линкът е изтекъл или вече е използван.')
    # partner links (the request itself is made on /partner/nastroyki; here the token is planted)
    def plant(email):
        token = f'e2e-{email.split("@")[0]}-{STAMP}'
        uid = user_by_email(email)['id']
        sql("insert into account_deletion_request (user_id, token_hash, expires_at) values ($1, $2, '2030-01-01')", uid, hashlib.sha256(token.encode()).hexdigest())
        return token
    tok = plant(PARTNER[0])
    p.goto(f'/partner/nastroyki/iztrivane?token={tok}')
    expect(p.locator('.auth-d').first).to_contain_text('Поискахте да изтриете акаунта на Студио Мелодия')
    p.click('button:has-text("Потвърди изтриването")')
    expect(p.locator('.acc-err[role=alert]')).to_have_text('Изтриването е възможно само без предстоящи резервации.')
    pid = one("select id from partner where slug = 'folklorna-trapeza'")['id']
    tok = plant('folklorna-trapeza@example.invalid')
    p.goto(f'/partner/nastroyki/iztrivane?token={tok}')
    expect(p.locator('.auth-d').first).to_contain_text('Фолклорна Трапеза')
    p.click('button:has-text("Потвърди изтриването")')
    p.wait_for_url(re.compile(r'/$'))
    assert one('select status from partner where id = $1', pid)['status'] == 'deleted'
    c.close()


@step('‹Излез навсякъде›: every session ends, client-signout-all, → /')
def sign_out_everywhere(t: T):
    c1 = t.ctx(); p1 = c1.new_page()
    t.sign_in(p1, *MARIA); p1.wait_for_url(re.compile(r'/tarsene'))
    c2 = t.ctx(); p2 = c2.new_page()
    t.sign_in(p2, *MARIA); p2.wait_for_url(re.compile(r'/tarsene'))
    p2.goto('/akaunt/nastroyki')
    expect(p2.locator('.set-sessions')).to_contain_text('активна сега')
    p2.click('button:has-text("Излез навсякъде")')
    p2.wait_for_url(re.compile(r'/$'))
    uid = user_by_email(MARIA[0])['id']
    assert one('select count(*)::int n from session where user_id = $1', uid)['n'] == 0
    assert last_mail('client-signout-all', user_id=uid)
    p2.goto('/akaunt/nastroyki'); assert path_of(p2).startswith('/vhod'), p2.url
    c1.close(); c2.close()


def main():
    args = sys.argv[1:]
    base = 'http://localhost:3202'
    if '--base' in args: base = args[args.index('--base') + 1]
    OUT.mkdir(parents=True, exist_ok=True)
    if '--no-reseed' not in args:
        print('reseeding…'); reseed()
    failed = 0
    with sync_playwright() as pw:
        t = T(pw, base)
        for name, fn in STEPS:
            try:
                fn(t); print(f'PASS  {name}')
            except Exception as e:
                failed += 1
                print(f'FAIL  {name}\n      {type(e).__name__}: {str(e)[:900]}')
                for ctx in t.browser.contexts:
                    for pg in ctx.pages:
                        try: pg.screenshot(path=str(OUT / f'fail-{len(STEPS)}-{re.sub(r"[^a-z]+", "-", name[:30])}.png'), full_page=True)
                        except Exception: pass
                    ctx.close()
        t.browser.close()
    print(f'{len(STEPS) - failed}/{len(STEPS)} passed' + (f' · screenshots in {OUT}' if failed else ''))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
