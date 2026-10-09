#!/usr/bin/env python3
"""J1 — the core booking, money and payout cycle, as three people in three browser contexts.

Usage: python3 tests/e2e/journey-booking.py [--base http://localhost:3301] [--no-reset] [--shots DIR]

Resets and seeds the database named in .env.local (local eventat_* databases only; --no-reset only on a database
seeded just before, as the demo clock must start at 31 Aug 2025), then drives the running server with real clicks
and typing (`next build && next start` is much faster than `next dev` for the long clock run):

  1. a new client registers (/registratsiya), types the 6-digit code from the email (/potvarzhdenie), lands signed in;
  2. searches /tarsene (DJ, София, a free date in 2026), opens Студио Мелодия, picks a package and sends the request
     (event type, date, guests, venue, note, an inspiration photo; the phone comes from the profile);
  3. the partner sees it in the bell and on /partner/zayavki, opens it and approves it;
  4. the client sees ‹Одобрени · чакат плащане› with a live countdown, pays through the test checkout, lands on the
     confirmation, sees the booking and the invoice;
  5. every email and bell item of the cycle, on both sides; the partner sees the phone only after payment;
  6. the admin moves the demo clock past the event: completion, review invite, payout line ready, T17 prepares the
     batch, the admin releases it, the partner sees the payout and gets vendor-payout-sent; the client reviews, the
     partner replies, the review is public;
  7. the ledger reconciles: client_funds 0, partner payable paid out, commission at the booking's rate.

Prints one line per step, asserts what each person sees and the database effect, exits non-zero on the first failure.
Screenshots of the key moments at 1440 and 390 px go to --shots (default: a new temp directory).
"""
import json, os, re, struct, subprocess, sys, tempfile, time, traceback, zlib
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import quote, unquote, urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
NODE_BIN = Path.home() / 'nodejs22' / 'bin'
BASE = sys.argv[sys.argv.index('--base') + 1] if '--base' in sys.argv else 'http://localhost:3301'
SHOTS = Path(sys.argv[sys.argv.index('--shots') + 1]) if '--shots' in sys.argv else Path(tempfile.mkdtemp(prefix='journey-booking-'))
SHOTS.mkdir(parents=True, exist_ok=True)

PARTNER = 'studio.melodia@gmail.com'
ADMIN = 'monika.kovacheva@eventat.bg'
DEMO_PW = 'eventat-demo'
STAMP = str(int(time.time()))[-6:]
CLIENT_NAME = 'Калина Методиева'
CLIENT_EMAIL = f'journey.client.{STAMP}@example.com'
CLIENT_PHONE = '0887 654 321'
CLIENT_PHONE_E164 = '+359887654321'
CLIENT_PW = 'Svatba-Kalina-2026'


def env_file():
    out = {}
    p = ROOT / '.env.local'
    if p.exists():
        for line in p.read_text(encoding='utf-8').splitlines():
            m = re.match(r'^([A-Z0-9_]+)=(.*)$', line.strip())
            if m: out[m.group(1)] = m.group(2).strip().strip('"')
    return out


DB_URL = os.environ.get('DATABASE_URL') or env_file().get('DATABASE_URL', '')
ENV = {**os.environ, 'PATH': f'{NODE_BIN}:{os.environ.get("PATH", "")}', 'DATABASE_URL': DB_URL}


def sql(query, *params):
    """One query through the repo's postgres client; rows as dicts (dates as ISO strings)."""
    script = ("const p=require(process.argv[1]);const s=p(process.argv[2],{max:1,onnotice:()=>{},types:{date:{to:1082,from:[1082],serialize:x=>x,parse:x=>x}}});"
              "s.unsafe(process.argv[3],JSON.parse(process.argv[4])).then(r=>{process.stdout.write(JSON.stringify(r));return s.end()})"
              ".catch(e=>{console.error(e.message);process.exit(1)})")
    r = subprocess.run([str(NODE_BIN / 'node'), '-e', script, str(ROOT / 'node_modules' / 'postgres'), DB_URL, query, json.dumps(list(params))],
                       capture_output=True, text=True)
    if r.returncode: raise RuntimeError(f'{query}: {r.stderr}')
    return json.loads(r.stdout or '[]')


def one(query, *params):
    rows = sql(query, *params)
    assert rows, f'no row: {query} {params}'
    return rows[0]


def reset():
    if not re.match(r'^postgres(ql)?://[^@]+@(127\.0\.0\.1|localhost)(:\d+)?/eventat_[a-z0-9_]+$', DB_URL):
        sys.exit(f'refusing to reset {DB_URL or "the default database"}: set DATABASE_URL in .env.local to this worktree\'s own local database')
    for cmd in (['npm', 'run', 'db:reset'], ['npm', 'run', 'db:seed']):
        r = subprocess.run(cmd, cwd=ROOT, env=ENV, capture_output=True, text=True)
        if r.returncode: sys.exit(r.stdout[-2000:] + r.stderr[-2000:])
    time.sleep(6)  # the server caches the clock offset for 5 s


def png(path, rgb):
    raw = b''.join(b'\x00' + bytes(rgb) * 16 for _ in range(16))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    Path(path).write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 16, 16, 8, 2, 0, 0, 0))
                           + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
    return str(path)


def path_of(page):
    u = urlparse(page.url)
    return unquote(u.path) + (('?' + unquote(u.query)) if u.query else '')


N = [0]
def step(text):
    N[0] += 1
    print(f'J1.{N[0]:02d} {text}', flush=True)


class People:
    """One browser context per person; every page reports script errors and error pages."""
    def __init__(self, browser):
        self.browser = browser
        self.problems = []

    def ctx(self, w=1440, h=900, storage=None):
        c = self.browser.new_context(viewport={'width': w, 'height': h}, locale='bg-BG', timezone_id='Europe/Sofia',
                                     base_url=BASE, storage_state=storage)
        c.set_default_timeout(60_000); c.set_default_navigation_timeout(90_000)
        c.on('page', self.watch)
        return c

    def watch(self, page):
        page.on('pageerror', lambda e: self.problems.append(f'page error on {unquote(page.url)}: {e}'))
        page.on('console', lambda m: self.problems.append(f'console error on {unquote(page.url)}: {m.text[:200]} … {m.text[-1500:]}') if m.type == 'error' else None)
        def resp(r):
            if r.request.resource_type == 'document' and r.status >= 400:
                self.problems.append(f'{r.status} on {unquote(r.url)}')
        page.on('response', resp)

    def check(self):
        assert not self.problems, self.problems


def toast(page, text):
    expect(page.locator('.ui-toast.is-on')).to_contain_text(text, timeout=20_000)


def shot(page, name, full=False):
    page.screenshot(path=str(SHOTS / f'{name}.png'), full_page=full, caret='initial')


def phone_shot(people, ctx, route, name, full=True):
    """The same person's screen at 390 px: no sideways scroll, and a picture of it."""
    c = people.ctx(390, 844, storage=ctx.storage_state())
    p = c.new_page()
    p.goto(route, wait_until='networkidle')
    wide = p.evaluate('document.documentElement.scrollWidth')
    assert wide <= 390, f'{route} scrolls sideways at 390 px ({wide})'
    shot(p, name, full)
    c.close()


def wait_path(page, pattern):
    """Wait until the decoded path (and query) matches `pattern` (numbers are Cyrillic, URLs are percent-encoded)."""
    rx = re.compile(pattern)
    page.wait_for_url(lambda u: bool(rx.search(unquote(u))), timeout=90_000)


def tick(page, label):
    page.locator(label).click(position={'x': 8, 'y': 9})


def mails(key, to):
    return sql('select * from email_outbox where template_key = $1 and lower(to_email) = lower($2) order by created_at', key, to)


def bells(user_id):
    rows = sql('select * from notification where user_id = $1 order by created_at', user_id)
    for r in rows:  # dates are written with a no-break space (14\u00a0юни 2026)
        r['title'], r['body'] = sp(r['title']), sp(r['body'])
    return rows


def sp(t): return t.replace('\xa0', ' ') if isinstance(t, str) else t


def first_free_saturday_2026(partner_slug):
    """The first Saturday of 2026 with nothing on this partner's calendar (no request, block or booking)."""
    p = one('select id from partner where slug = $1', partner_slug)
    d = date(2026, 1, 3)
    while d.year == 2026:
        busy = one("""select (select count(*) from request where partner_id = $1 and event_date = $2::date)
                         + (select count(*) from availability_block where partner_id = $1 and $2::date between start_date and end_date) as n""",
                   p['id'], d.isoformat())['n']
        if int(busy) == 0: return d
        d += timedelta(days=7)
    raise AssertionError('no free Saturday in 2026')


# Business "now" of the demo clock (lib/clock: real time + the stored offset), as SQL.
NOW_SQL = ("(now() + coalesce((select (value::text)::bigint from platform_settings where key = 'clock_offset_ms' "
           "order by effective_from desc, created_at desc limit 1), 0) * interval '1 millisecond')")


def biz_now():
    """The platform clock in Sofia as 'YYYY-MM-DD HH:MI'."""
    return one(f"select to_char({NOW_SQL} at time zone 'Europe/Sofia', 'YYYY-MM-DD HH24:MI') as t")['t']


def cron_tick():
    """What Vercel Cron does every minute: GET /api/cron/tick with the bearer secret."""
    import urllib.request
    secret = os.environ.get('CRON_SECRET') or env_file().get('CRON_SECRET', '')
    req = urllib.request.Request(BASE + '/api/cron/tick', headers={'Authorization': f'Bearer {secret}'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def ledger(account, booking_id=None, partner_id=None):
    """Balance on the account's normal side (credit − debit for liabilities and income)."""
    sign = '(credit_cents - debit_cents)' if account in ('client_funds', 'partner_payable', 'commission_revenue') else '(debit_cents - credit_cents)'
    cond, args = ['account = $1'], [account]
    if booking_id: args.append(booking_id); cond.append(f'booking_id = ${len(args)}')
    if partner_id: args.append(partner_id); cond.append(f'partner_id = ${len(args)}')
    return int(one(f"select coalesce(sum({sign}), 0)::bigint as b from ledger_entry where {' and '.join(cond)}", *args)['b'])


BG_MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември']
def bg_date(d): return f'{d.day} {BG_MONTHS[d.month - 1]} {d.year}'


def main():
    if '--no-reset' not in sys.argv:
        print('resetting the database…', flush=True)
        reset()
    tmp = Path(tempfile.mkdtemp())
    inspiration = png(tmp / 'vdahnovenie.png', (176, 120, 210))
    event_day = first_free_saturday_2026('studio-melodiya')
    EVENT = event_day.isoformat()
    print(f'event date: {EVENT}; screenshots: {SHOTS}', flush=True)

    with sync_playwright() as pw:
        people = People(pw.chromium.launch())
        S = {}
        try:
            run(people, S, EVENT, event_day, inspiration)
        except Exception:
            traceback.print_exc()
            print(f'FAILED in J1.{N[0] + 1:02d} (the step after J1.{N[0]:02d})', flush=True)
            sys.exit(1)
    print(f'J1 PASSED ({N[0]} steps)')


def run(people, S, EVENT, event_day, inspiration):
    S['t0'] = one('select now()::text as t')['t']  # outbox and bell rows carry real time
    # ── 1. a new client registers and verifies ─────────────────────────
    client = people.ctx()
    c = client.new_page()
    c.goto('/registratsiya')
    c.fill('#reg-name', CLIENT_NAME)
    c.fill('#reg-email', CLIENT_EMAIL)
    c.fill('#reg-phone', CLIENT_PHONE)
    c.fill('#reg-password', CLIENT_PW)
    expect(c.locator('.reg-meter-t')).to_have_text('Силна парола')
    tick(c, '.reg-consent label.f-item')
    shot(c, '01-register-1440')
    c.click('button:has-text("Създай профил")')
    c.wait_for_url(re.compile(r'/potvarzhdenie\?'))
    expect(c.locator('.ver-lead b')).to_have_text(CLIENT_EMAIL)
    u = one('select * from "user" where lower(email) = lower($1)', CLIENT_EMAIL)
    assert u['role'] == 'client' and not u['email_verified'] and u['phone'] == CLIENT_PHONE_E164, u
    S['client_id'] = u['id']
    code = mails('client-verify-code', CLIENT_EMAIL)[-1]['vars']['code']
    assert re.fullmatch(r'\d{6}', code), code
    step('client: /registratsiya → code screen; user unverified, phone stored, client-verify-code queued')

    c.locator('input.ver-cell').first.click()
    c.keyboard.type(code)
    c.click('button:has-text("Потвърди")')
    c.wait_for_url(re.compile(r'/tarsene'))
    toast(c, 'Профилът е създаден')
    expect(c.locator('.nav-user')).to_be_visible()
    assert one('select email_verified from "user" where id = $1', u['id'])['email_verified'] is True
    assert len(mails('client-welcome', CLIENT_EMAIL)) == 1
    people.check()
    step('client: the 6-digit code verifies the email → /tarsene signed in, ‹Профилът е създаден›, client-welcome')

    # ── 2. search, profile, package, request ───────────────────────────
    c.click('input.sb-v')
    c.fill('input.sb-v', 'DJ')
    c.locator('.ui-suggest .ui-note:has(b:text-is("DJ и озвучаване"))').click()
    c.wait_for_url(re.compile(r'kategoriya=dj-i-ozvuchavane'))
    c.click('.sb-cell:has-text("Локация")')
    c.click('.ui-bar-menu:visible a:has-text("София")')
    c.wait_for_url(re.compile(r'grad=sofia'))
    c.click('.sb-cell:has-text("Дата")')
    c.fill('.ui-bar-menu:visible input.sb-date', EVENT)
    c.wait_for_url(re.compile(r'data=' + EVENT))
    expect(c.locator('.results-n').first).to_contain_text(f'свободни на {bg_date(event_day)}')
    card = c.locator('a.v-card:has-text("Студио Мелодия")')
    expect(card).to_be_visible()
    shot(c, '02-search-1440')
    step(f'client: /tarsene ‹DJ и озвучаване› · София · {bg_date(event_day)} → Студио Мелодия is free')

    card.locator('.v-name').click()
    c.wait_for_url(re.compile(r'/partnyori/studio-melodiya\?data=' + EVENT))
    expect(c.locator('h1.pv-name')).to_have_text('Студио Мелодия')
    shot(c, '03-profile-1440')
    c.locator('.pk:has-text("Вечер") a:has-text("Избери")').click()
    c.wait_for_url(re.compile(r'/zayavka/studio-melodiya\?'))
    expect(c.locator('input[name=eventDate]')).to_have_value(EVENT)
    step('client: profile on the searched date → ‹Избери› on Пакет „Вечер“ → the request form with the date')

    c.select_option('select[name=eventTypeId]', label='Рожден ден')
    c.fill('input[name=startTime]', '19:00')
    c.fill('input[name=endTime]', '23:00')
    c.fill('input[name=guests]', '70')
    c.fill('input[name=venueName]', 'Ресторант „Липите“')
    c.fill('input[name=locality]', 'София')
    phone = c.locator('label.fld:has-text("Телефон за връзка") input')
    expect(phone).to_have_value('+359 88 765 4321')  # from the profile, not editable here
    expect(phone).to_have_attribute('readonly', '')
    c.click('label.opt:has-text("Закрита зала")')
    expect(c.locator('label.opt:has-text("Пакет „Вечер“") input')).to_be_checked()
    expect(c.locator('.sum-total b')).to_have_text('640 €')
    c.fill('textarea[name=note]', 'Здравейте, правим 40-и рожден ден. Искаме музика от 80-те и 90-те и малко латино след полунощ.')
    c.set_input_files('.cb-drop input[type=file]', [inspiration])
    expect(c.locator('input[type=hidden][name=photo]')).to_have_count(1, timeout=20_000)
    toast(c, 'Снимката е прикачена към заявката')
    shot(c, '04-request-form-1440', full=True)
    phone_shot(people, client, path_of(c), '04-request-form-390')
    c.click('button:has-text("Изпрати заявката")')
    c.wait_for_url(re.compile(r'/akaunt/zayavki/\d{4}-\d{4}-'))
    nomer = path_of(c).rsplit('/', 1)[1]
    S['nomer'] = nomer
    expect(c.locator('.sh-t')).to_have_text('Запитването е изпратено')
    expect(c.locator('.sh-badge')).to_have_text('Чака отговор')
    rq = one("""select r.*, (select count(*)::int from request_attachment a where a.request_id = r.id) photos from request r where number = $1""", nomer)
    assert rq['status'] == 'pending' and rq['client_id'] == S['client_id'] and rq['event_date'] == EVENT and rq['guests'] == 70 \
        and rq['amount_cents'] == 64000 and rq['photos'] == 1 and rq['contact_phone'] == CLIENT_PHONE_E164 \
        and rq['venue_name'] == 'Ресторант „Липите“' and rq['note'].startswith('Здравейте, правим'), rq
    shot(c, '05-request-sent-1440', full=True)
    phone_shot(people, client, '/akaunt/zayavki/' + quote(nomer), '05-request-sent-390')
    people.check()
    step(f'client: ‹Изпрати заявката› → {nomer} pending, 640 €, 1 photo, phone {CLIENT_PHONE_E164} snapshotted')

    # the request's emails and bell items (R1)
    assert len(mails('client-request-sent', CLIENT_EMAIL)) == 1
    vnr = mails('vendor-new-request', PARTNER)
    assert len(vnr) == 1 and nomer in json.dumps(vnr[0]['vars'], ensure_ascii=False), vnr
    assert CLIENT_PHONE_E164 not in vnr[0]['html'] and '765 4321' not in vnr[0]['html'], 'phone in vendor-new-request'
    partner_user = one('select id from "user" where email = $1', PARTNER)['id']
    S['partner_user'] = partner_user
    S['partner_id'] = one("select id from partner where slug = 'studio-melodiya'")['id']
    nb = [n for n in bells(partner_user) if nomer in (n['href'] or '')]
    assert [n['title'] for n in nb] == ['Нова заявка от Калина Методиева'] and nb[0]['body'] == f'Рожден ден · {bg_date(event_day)} · отговорете до 24 часа', nb
    assert [n['kind'] for n in bells(S['client_id'])] == ['client-welcome', 'client-request-sent'], bells(S['client_id'])
    step('emails client-request-sent + vendor-new-request (no phone); bell ‹Нова заявка от Калина Методиева› for the partner')

    # ── 3. the partner: bell, inbox, request page, approval ────────────
    partner = people.ctx()
    r = partner.request.post(BASE + '/api/auth/sign-in/email', data={'email': PARTNER, 'password': DEMO_PW}, headers={'Origin': BASE})
    assert r.ok, r.status
    p = partner.new_page()
    p.goto('/partner')
    bell = p.locator('.topbar button[aria-label="Известия"]')
    expect(bell.locator('.dot')).to_be_visible()
    bell.click()
    note = p.locator('.ui-menu .ui-note').first
    expect(note.locator('b')).to_have_text('Нова заявка от Калина Методиева')
    expect(note).to_contain_text(f'Рожден ден · {bg_date(event_day)} · отговорете до 24 часа')
    shot(p, '06-partner-bell-1440')
    p.keyboard.press('Escape')
    step('partner: the bell has a dot and ‹Нова заявка от Калина Методиева› on top')

    p.click('.side-item:has-text("Заявки")')
    p.wait_for_url(re.compile(r'/partner/zayavki$'))
    row = p.locator('.group--new .req:has-text("Калина Методиева")')
    expect(row).to_contain_text(bg_date(event_day))
    expect(row).to_contain_text('70 души')
    expect(row).to_contain_text('640 €')
    shot(p, '07-partner-inbox-1440')
    row.locator('.btn:has-text("Разгледай")').click()
    wait_path(p, r'/partner/zayavki/' + re.escape(nomer) + '$')
    expect(p.locator('h1.page-title')).to_have_text('Заявка от Калина Методиева')
    expect(p.locator('.page-head .badge')).to_have_text('Нова заявка')
    body = sp(p.inner_text('body'))
    assert 'Здравейте, правим 40-и рожден ден' in body and 'Ресторант „Липите“' in body, body[:400]
    assert 'Телефонът на клиента се показва след потвърдена резервация. Дотогава си пишете в платформата.' in body
    assert '765 4321' not in body and '887654321' not in body, 'client phone shown before payment'
    assert 'Комисиона' not in body and 'комисиона' not in body, 'commission shown to the partner'
    assert 'След събитието получавате 576 €.' in body, 'projected ‹Получавате›'
    assert 'КЛИЕНТ ОТ' in body.upper() and re.search(r'\b2025\b\s*\n\s*КЛИЕНТ ОТ', body, re.I), 'client since (platform clock)'
    src = p.locator('.rw-shot').first.get_attribute('href')
    img = partner.request.get(BASE + src)
    assert img.ok and img.headers['content-type'] == 'image/png', (src, img.status)
    shot(p, '08-partner-request-1440', full=True)
    phone_shot(people, partner, '/partner/zayavki/' + quote(nomer), '08-partner-request-390')
    people.check()
    step('partner: inbox row → request page: note, venue, the inspiration photo opens, ‹Получавате› 576 €, no phone, no commission')

    p.click('button:has-text("Одобри заявката")')
    expect(p.locator('.page-head .badge')).to_have_text('Одобрена · чака плащане', timeout=15_000)
    expect(p.locator('.countdown-time')).to_have_text(re.compile(r'^(23:5\d|24:00)$'))
    bk = one('select * from booking where number = $1', nomer)
    assert bk['status'] == 'awaiting_payment' and bk['amount_cents'] == 64000 and bk['commission_bp'] is None, bk
    assert one('select status from request where number = $1', nomer)['status'] == 'approved'
    body = sp(p.inner_text('body'))
    assert '765 4321' not in body, 'client phone shown while awaiting payment'
    S['booking_id'] = bk['id']
    shot(p, '09-partner-approved-1440', full=True)
    people.check()
    step('partner: ‹Одобри заявката› → booking awaiting_payment with the 24 h countdown; still no phone')

    assert len(mails('client-request-approved', CLIENT_EMAIL)) == 1
    assert len(mails('vendor-request-approved', PARTNER)) == 1
    cb = [n for n in bells(S['client_id']) if n['kind'] == 'client-request-approved']
    assert len(cb) == 1 and cb[0]['title'] == 'Студио Мелодия одобри заявката ви' and cb[0]['body'].startswith('Платете до'), cb
    pb = [n for n in bells(partner_user) if n['kind'] == 'vendor-request-approved' and nomer in (n['href'] or '')]
    assert len(pb) == 1, bells(partner_user)[-3:]
    step('emails client-request-approved + vendor-request-approved; bell items on both sides')

    # ── 4. the client pays ─────────────────────────────────────────────
    c.goto('/akaunt/zayavki')
    expect(c.locator('.mine-t').first).to_have_text('Одобрени · чакат плащане')
    pay = c.locator('.mine--pay .mrow:has-text("' + nomer + '")')
    badge = ' '.join(pay.locator('.badge').first.text_content().split())
    m = re.fullmatch(r'Остават (\d\d):(\d\d) ч', badge)
    assert m, badge
    left = int(m.group(1)) * 60 + int(m.group(2))
    assert 23 * 60 + 55 <= left <= 24 * 60, badge
    shot(c, '10-client-pay-group-1440')
    phone_shot(people, client, '/akaunt/zayavki', '10-client-pay-group-390')
    t1 = time.time()
    c.wait_for_timeout(61_000)
    badge2 = ' '.join(pay.locator('.badge').first.text_content().split())
    m2 = re.fullmatch(r'Остават (\d\d):(\d\d) ч', badge2)
    vis = c.evaluate('document.visibilityState')
    assert m2 and left - 2 <= int(m2.group(1)) * 60 + int(m2.group(2)) <= left - 1, (badge, badge2, round(time.time() - t1), vis)
    c.locator('.bell, button[aria-label="Известия"]').first.click()
    expect(c.locator('.ui-menu .ui-note').first.locator('b')).to_have_text('Студио Мелодия одобри заявката ви')
    c.keyboard.press('Escape')
    step(f'client: ‹Одобрени · чакат плащане› with a live countdown ({badge} → {badge2}); the bell says it was approved')

    pay.locator('a:has-text("Плати")').click()
    wait_path(c, r'/plashtane/' + re.escape(nomer) + '$')
    expect(c.locator('input[name=method][value=card]')).to_be_checked()
    expect(c.locator('.h-sub')).to_contain_text(re.compile(r'Остават \d\d:\d\d часа'))
    shot(c, '11-client-payment-1440', full=True)
    phone_shot(people, client, '/plashtane/' + quote(nomer), '11-client-payment-390')
    c.click('button:has-text("Плати 640 €")')
    c.wait_for_url(re.compile(r'/plashtane/test/[0-9a-f-]{36}$'))
    shot(c, '12-test-checkout-1440')
    c.click('button:has-text("Плати")')
    c.wait_for_url(re.compile(r'/potvardena$'))
    expect(c.locator('.done-t')).to_have_text('Резервацията е потвърдена')
    expect(c.locator('.done-d')).to_contain_text(CLIENT_EMAIL)
    # the header stayed mounted since the bell was opened: the new items bring the dot back
    expect(c.locator('button[aria-label="Известия"] .dot')).to_be_visible()
    shot(c, '13-confirmed-1440', full=True)
    phone_shot(people, client, path_of(c), '13-confirmed-390')
    bk = one('select * from booking where number = $1', nomer)
    assert bk['status'] == 'confirmed' and bk['paid_at'] and bk['commission_bp'] == 1000, bk
    ch = sql('select * from charge where booking_id = $1', bk['id'])
    assert [x['status'] for x in ch] == ['succeeded'] and ch[0]['amount_cents'] == 64000, ch
    people.check()
    step('client: ‹Плати› → /plashtane → test checkout ‹Плати› → ‹Резервацията е потвърдена›; booking confirmed at 10%')

    c.click('a:has-text("Виж резервацията")')
    wait_path(c, r'/akaunt/rezervacii/' + re.escape(nomer) + '$')
    expect(c.locator('.h-right .badge')).to_have_text('Потвърдена')
    shot(c, '14-client-booking-1440', full=True)
    c.click('a:has-text("Свали фактура")')
    c.wait_for_url(re.compile(r'/faktura$'))
    inv = one("select * from invoice where booking_id = $1", bk['id'])
    expect(c.locator('.inv-no')).to_have_text(f"№ {inv['number']}")
    expect(c.locator('.inv-total b')).to_have_text('640 €')
    expect(c.locator('.inv-doc')).to_contain_text(CLIENT_NAME)
    shot(c, '15-client-invoice-1440', full=True)
    phone_shot(people, client, '/akaunt/rezervacii/' + quote(nomer) + '/faktura', '15-client-invoice-390')
    people.check()
    step(f"client: the booking page (‹Потвърдена›) and the invoice № {inv['number']} for 640 €")

    # ── 5. emails, bell items, the phone rule ──────────────────────────
    for key, to in (('client-booking-confirmed', CLIENT_EMAIL), ('client-invoice', CLIENT_EMAIL), ('vendor-booking-confirmed', PARTNER)):
        got = [m for m in mails(key, to) if nomer in json.dumps(m['vars'], ensure_ascii=False) or nomer in m['html']]
        assert len(got) == 1, (key, len(got))
    vbc = [m for m in mails('vendor-booking-confirmed', PARTNER) if nomer in m['html']][0]
    assert sp(vbc['subject']) == f'Получено плащане: рожденият ден на {bg_date(event_day)} е потвърден', vbc['subject']
    assert '+359 88 765 4321' in sp(vbc['html']) or CLIENT_PHONE_E164 in vbc['html'], 'vendor-booking-confirmed carries the phone'
    assert '576' in sp(vbc['html']) and 'омисион' not in vbc['html'], 'vendor-booking-confirmed: ‹Получавате› 576, no commission'
    every = {m['template_key'] for m in sql("select template_key from email_outbox where to_user_id in ($1, $2) and (vars::text like '%' || $3 || '%' or html like '%' || $3 || '%')", S['client_id'], partner_user, nomer)}
    assert every == {'client-request-sent', 'vendor-new-request', 'client-request-approved', 'vendor-request-approved',
                     'client-booking-confirmed', 'client-invoice', 'vendor-booking-confirmed'}, every
    ck = [n['kind'] for n in bells(S['client_id'])]
    assert ck == ['client-welcome', 'client-request-sent', 'client-request-approved', 'client-booking-confirmed', 'client-invoice'], ck
    cbc = [n for n in bells(S['client_id']) if n['kind'] == 'client-booking-confirmed'][0]
    assert cbc['title'] == f'Резервацията за {event_day.day} {BG_MONTHS[event_day.month - 1]} е потвърдена' and cbc['body'] == 'Студио Мелодия · Пакет „Вечер“', cbc
    pk = [n for n in bells(partner_user) if nomer in (n['href'] or '')]
    assert [n['kind'] for n in pk] == ['vendor-new-request', 'vendor-request-approved', 'vendor-booking-confirmed'], [n['kind'] for n in pk]
    assert pk[-1]['title'] == 'Плащане получено · 576 €' and pk[-1]['body'] == f'Рожден ден · {event_day.day} {BG_MONTHS[event_day.month - 1]} · {CLIENT_NAME}', pk[-1]
    step('emails client-booking-confirmed, client-invoice, vendor-booking-confirmed (phone, ‹Получавате› 576 €); the cycle sent exactly these seven; bell items match')

    c.goto('/akaunt/rezervacii')
    expect(c.locator('button[aria-label="Известия"] .dot')).to_be_visible()
    c.click('button[aria-label="Известия"]')
    expect(c.locator('.ui-menu .ui-note b').first).to_have_text(re.compile('Фактура|Резервацията за'))
    expect(c.locator('.ui-menu')).to_contain_text(cbc['title'])
    shot(c, '16-client-bell-1440')
    c.keyboard.press('Escape')
    step('client: the bell dot is back and lists the confirmed booking')

    p.goto('/partner')
    expect(p.locator('.topbar button[aria-label="Известия"] .dot')).to_be_visible()
    p.click('.topbar button[aria-label="Известия"]')
    first = p.locator('.ui-menu .ui-note').first
    expect(first.locator('b')).to_have_text(pk[-1]['title'])
    first.click()
    wait_path(p, r'/partner/rezervacii/' + re.escape(nomer) + '$')
    expect(p.locator('.kv-label:has-text("Телефон за деня на събитието")')).to_have_count(1)
    body = sp(p.inner_text('body'))
    assert '+359 88 765 4321' in body, 'phone after payment'
    assert 'омисион' not in body, 'commission shown to the partner'
    assert '576 €' in body or '576,00 €' in body, 'partner ‹Получавате›'
    shot(p, '17-partner-booking-1440', full=True)
    p.click('a:has-text("Виж в календара")')
    p.wait_for_url(re.compile(r'/partner/kalendar\?mesec=' + EVENT[:7] + '$'))
    expect(p.locator('.page-sub')).to_contain_text('1 заета дата')
    p.go_back()
    phone_shot(people, partner, '/partner/rezervacii/' + quote(nomer), '17-partner-booking-390')
    people.check()
    step('partner: bell ‹Плащане получено› → the booking; ‹Телефон за деня на събитието› +359 88 765 4321 now shown; no commission')

    # ledger after payment: L1 only
    assert ledger('client_funds', bk['id']) == 64000 and ledger('provider_held', bk['id']) == 64000, 'L1 charge'
    line = one('select * from payout_line where booking_id = $1', bk['id'])
    assert line['status'] == 'awaiting_event' and line['amount_cents'] == 57600 and line['commission_cents'] == 6400, line
    batch_date = line['batch_date']
    step(f"ledger after payment: client_funds 640 € held; payout line 576 € awaiting the event, batch {batch_date}")

    # ── 6. the admin moves the clock past the event ────────────────────
    admin = people.ctx()
    r = admin.request.post(BASE + '/api/auth/sign-in/email', data={'email': ADMIN, 'password': DEMO_PW}, headers={'Origin': BASE})
    assert r.ok, r.status
    a = admin.new_page()
    a.goto('/admin/nastroyki')
    expect(a.locator('.ops-clock-v')).to_contain_text('31 август 2025')
    shot(a, '18-admin-clock-1440')

    def advance_to(target):
        """Press ‹+7 дни› while a week still fits before `target` (Sofia 'YYYY-MM-DD HH:MI'), then ‹+1 ден›."""
        presses = 0
        if urlparse(a.url).path != '/admin/nastroyki':
            a.click('.side-item:has-text("Настройки")')
            a.wait_for_url(re.compile(r'/admin/nastroyki$'))
        while biz_now() < target:
            t = biz_now()
            week = one(f"select to_char(({NOW_SQL} + interval '7 days') at time zone 'Europe/Sofia', 'YYYY-MM-DD HH24:MI') as t")['t']
            label = '+7 дни' if week <= target else '+1 ден'
            before = a.locator('.ops-clock-v').inner_text()
            a.click(f'.ops-clock-acts button:has-text("{label}")')
            toast(a, 'Промените са запазени')
            expect(a.locator('.ops-clock-v')).not_to_have_text(before, timeout=90_000)
            assert biz_now() > t, 'the clock did not move'
            presses += 1
            assert presses < 60, 'too many presses'
        return presses

    day_after = event_day + timedelta(days=1)
    n = advance_to(f'{day_after.isoformat()} 10:00')
    expect(a.locator('.ops-clock-v')).to_contain_text(f'{day_after.day} {BG_MONTHS[day_after.month - 1]} {day_after.year}')
    people.check()
    step(f'admin: ‹Демо часовник› pressed {n} times → {biz_now()} (past the event and the review-invite hour); due jobs ran')

    bk = one('select * from booking where id = $1', S['booking_id'])
    assert bk['status'] == 'completed' and bk['review_state'] == 'invited', (bk['status'], bk['review_state'])
    line = one('select * from payout_line where booking_id = $1', bk['id'])
    assert line['status'] == 'ready' and line['ready_at'] and line['amount_cents'] == 57600, line
    assert ledger('client_funds', bk['id']) == 0, ledger('client_funds', bk['id'])
    assert ledger('commission_revenue', bk['id']) == 6400 and ledger('partner_payable', bk['id']) == 57600
    cri = mails('client-review-invite', CLIENT_EMAIL)
    assert len(cri) == 1 and sp(cri[0]['subject']) == 'Как мина рожденият ден ви? Оценете Студио Мелодия', [m['subject'] for m in cri]
    rb = [n for n in bells(S['client_id']) if n['kind'] == 'client-review-invite']
    assert len(rb) == 1 and nomer in (rb[0]['href'] or ''), rb
    jobs = sql("select kind, status, last_error from job where status = 'failed' or (last_error is not null and status = 'pending')")
    assert not jobs, jobs
    step('T13/T14: booking completed, funds released (client_funds 0, payable 576 €, commission 64 €), line ready; client-review-invite + bell; no failed jobs')

    # the reminders the clock passed on the way (T11 seven days and one day before, T12 for the partner, with the phone)
    cer = mails('client-event-reminder', CLIENT_EMAIL)
    assert len(cer) == 2, [m['subject'] for m in cer]
    ver = [m for m in mails('vendor-event-reminder', PARTNER) if nomer in m['html']]
    assert len(ver) == 1 and '+359 88 765 4321' in sp(ver[0]['html']), [m['subject'] for m in ver]
    assert len([n for n in bells(S['client_id']) if n['kind'] == 'client-event-reminder']) == 2
    assert sp(ver[0]['subject']) == f'След 7 дни: рожденият ден на {CLIENT_NAME}, {bg_date(event_day)}', ver[0]['subject']
    assert [n for n in bells(partner_user) if n['kind'] == 'vendor-event-reminder' and n['title'] == f'Рожденият ден на {CLIENT_NAME} е след седмица'], 'vendor-event-reminder bell'
    assert all(sp(m['html']).count('Рожденият ден ви е на ' + bg_date(event_day)) == 1 for m in cer), 'client-event-reminder text'
    step('reminders on the way: client-event-reminder ×2 (7 days, 1 day), vendor-event-reminder with the phone; bell items')

    c.goto('/akaunt/rezervacii')
    past = c.locator('.mine:has(.mine-t:text-is("Минали")) .mrow:has-text("Студио Мелодия")').first
    expect(past).to_be_visible()
    shot(c, '19-client-past-1440', full=True)
    c.goto('/akaunt/rezervacii/' + quote(nomer))
    expect(c.locator('.h-right .badge')).to_have_text('Чака вашето ревю')
    expect(c.locator('a:has-text("Остави ревю")')).to_be_visible()
    people.check()
    step('client: the booking moves to ‹Минали›, its page says ‹Чака вашето ревю› with ‹Остави ревю›')

    # T17: the batch is prepared the day before at 09:00
    prep = (date.fromisoformat(batch_date) - timedelta(days=1)).isoformat()
    n = advance_to(f'{prep} 09:00')
    bt = one('select * from payout_batch where batch_date = $1', batch_date)
    assert bt['status'] == 'ready', bt
    item = one('select i.* from payout_item i join payout_line l on l.payout_item_id = i.id where l.booking_id = $1', S['booking_id'])
    assert item['status'] == 'ready' and item['batch_id'] == bt['id'] and item['partner_id'] == S['partner_id'], item
    tbr = sql("select subject from email_outbox where template_key = 'team-batch-ready' and to_email = $1 and dedupe_key like $2", ADMIN, f'batch:{batch_date}:ready:%')
    assert [sp(m['subject']) for m in tbr] == [f'Партидата за {bg_date(date.fromisoformat(batch_date))} е готова за пускане'], tbr
    a.click('.side-item:has-text("Плащания")')
    a.wait_for_url(re.compile(r'/admin/plashtaniya$'))
    head = sp(a.inner_text('.am'))
    assert bt['label'] in head, (bt['label'], head[:600])
    expect(a.locator('button.btn--block:has-text("Пусни партидата")')).to_be_disabled()
    shot(a, '20-admin-batch-ready-1440', full=True)
    phone_shot(people, admin, '/admin/plashtaniya', '20-admin-batch-ready-390')
    a.click('.dcard-head a.link-more')
    a.wait_for_url(re.compile(r'/admin/plashtaniya/partidi/'))
    expect(a.locator('h1.page-title')).to_have_text(bt['label'])
    expect(a.locator('body')).to_contain_text(nomer)
    shot(a, '21-admin-batch-page-1440', full=True)
    people.check()
    step(f"T17 at {prep} 09:00: {bt['label']} ready with Студио Мелодия's line; team-batch-ready; ‹Пусни партидата› waits for the day")

    n = advance_to(f'{batch_date} 09:00')
    a.goto('/admin/plashtaniya')
    rel = a.locator('button.btn--block:has-text("Пусни партидата")')
    expect(rel).to_be_enabled()
    rel.click()
    dlg = a.locator('dialog[open]')
    expect(dlg).to_contain_text(bt['label'])
    dlg.locator('button[type="submit"]').click()
    toast(a, 'Партидата е пусната')
    bt = one('select * from payout_batch where id = $1', bt['id'])
    assert bt['status'] in ('released', 'paid') and bt['released_by'], bt
    shot(a, '22-admin-released-1440', full=True)
    ticked = cron_tick()
    item = one('select * from payout_item where id = $1', item['id'])
    line = one('select * from payout_line where booking_id = $1', S['booking_id'])
    assert item["status"] == "paid" and line["status"] == "paid", (item, line, ticked)
    assert one('select status from payout_batch where id = $1', bt['id'])['status'] == 'paid'
    people.check()
    step(f"admin on {batch_date}: ‹Пусни партидата› → released; the cron tick pays the item (batch paid)")

    vps = [m for m in mails('vendor-payout-sent', PARTNER) if nomer in json.dumps(m['vars'], ensure_ascii=False)]
    assert len(vps) == 1 and sp(vps[0]['subject']) == f'Изплатихме 576,00 € за рождения ден на {bg_date(event_day)}', [m['subject'] for m in vps]
    assert 'омисион' not in vps[0]['html'], 'commission in vendor-payout-sent'
    pb = sql("select href from notification where user_id = $1 and kind = 'vendor-payout-sent' and created_at >= $2::timestamptz", partner_user, S['t0'])
    assert [n['href'] for n in pb] == ['/partner/prihodi'], pb
    p.goto('/partner/prihodi')
    row = p.locator('.tbl tbody tr', has_text=event_day.strftime('%d.%m.%Y')).first
    expect(row).to_contain_text('Изплатено')
    expect(row).to_contain_text('576')
    body = sp(p.inner_text('body'))
    assert 'омисион' not in body, 'commission on /partner/prihodi'
    shot(p, '23-partner-earnings-1440', full=True)
    phone_shot(people, partner, '/partner/prihodi', '23-partner-earnings-390')
    people.check()
    step('partner: vendor-payout-sent (576,00 €) + bell; /partner/prihodi lists the booking as ‹Изплатено› 576 €, no commission')

    # ── the review: client writes, partner replies, the profile shows it ──
    before = one("select review_count, rating_avg from partner where id = $1", S['partner_id'])
    c.goto('/akaunt/rezervacii')
    c.locator('.mrow:has-text("Студио Мелодия")').first.locator('a:has-text("Остави ревю")').click()
    wait_path(c, r'/akaunt/rezervacii/' + re.escape(nomer) + '/revyu$')
    expect(c.locator('button:has-text("Публикувай ревюто")')).to_be_disabled()
    c.click('.rw-stars button[aria-label="5 звезди"]')
    for label in ('Комуникация', 'Точност', 'Качество', 'Съотношение цена'):
        c.click(f'.rw-mini button[aria-label="{label}: 5"]')
    review_text = 'Музиката беше точно каквато искахме, гостите танцуваха до края. Много коректни и навременни.'
    c.fill('textarea[name=body]', review_text)
    shot(c, '24-client-review-1440', full=True)
    phone_shot(people, client, '/akaunt/rezervacii/' + quote(nomer) + '/revyu', '24-client-review-390')
    c.click('button:has-text("Публикувай ревюто")')
    c.wait_for_url(re.compile(r'/akaunt/rezervacii$'))
    toast(c, 'Ревюто е публикувано')
    rv = one('select * from review where booking_id = $1', S['booking_id'])
    assert rv['rating_overall'] == 5 and rv['body'] == review_text and rv['client_id'] == S['client_id'], rv
    assert one('select review_state from booking where id = $1', S['booking_id'])['review_state'] == 'reviewed'
    after = one("select review_count, rating_avg from partner where id = $1", S['partner_id'])
    assert after['review_count'] == before['review_count'] + 1, (before, after)
    vnr = [m for m in mails('vendor-new-review', PARTNER) if 'Музиката беше точно каквато искахме' in m['html']]
    assert len(vnr) == 1, len(vnr)
    nrb = [n for n in bells(partner_user) if n['kind'] == 'vendor-new-review' and 'Музиката беше' in (n['body'] or '')]
    assert len(nrb) == 1 and nrb[0]['title'] == 'Ново ревю с 5 звезди' and nrb[0]['body'] == 'Калина Методиева · „Музиката беше точно каквато искахме…“', nrb
    people.check()
    step('client: ‹Остави ревю› 5★ + criteria + text → ‹Ревюто е публикувано›; vendor-new-review + bell ‹Ново ревю с 5 звезди›')

    p.goto('/partner/revyuta')
    p.click('.tab-bar-item:has-text("Без отговор")')
    p.wait_for_url(re.compile(r'tab=bez-otgovor'))
    mine = p.locator('.rev', has_text='гостите танцуваха до края')
    expect(mine).to_have_count(1)
    mine.locator('button:has-text("Отговори")').click()
    reply = 'Благодарим ви, Калина — беше удоволствие да свирим на вашия празник.'
    mine.locator('.pc-reply textarea').fill(reply)
    shot(p, '25-partner-reply-1440', full=True)
    mine.locator('.pc-reply button[type="submit"]').click()
    toast(p, 'Отговорът е публикуван под ревюто')
    assert one('select reply_text from review where id = $1', rv['id'])['reply_text'] == reply
    assert len(mails('client-review-reply', CLIENT_EMAIL)) == 1
    assert [n for n in bells(S['client_id']) if n['kind'] == 'client-review-reply'], 'client-review-reply bell'
    people.check()
    step('partner: /partner/revyuta ‹Без отговор› → ‹Отговори› → ‹Отговорът е публикуван под ревюто›; client-review-reply + bell')

    pub = people.ctx()
    g = pub.new_page()
    g.goto('/partnyori/studio-melodiya')
    card = g.locator('#revyuta .rev', has_text='гостите танцуваха до края')
    expect(card).to_have_count(1)
    expect(card.locator('.rev-name')).to_have_text(CLIENT_NAME)
    expect(card.locator('.rev-meta')).to_have_text(f'Рожден ден · {BG_MONTHS[event_day.month - 1]} {event_day.year}')
    expect(card.locator('.rev-reply-t')).to_have_text(reply)
    expect(g.locator('.pv-meta')).to_contain_text(f"{after['review_count']} ревюта")
    shot(g, '26-public-profile-1440', full=True)
    phone_shot(people, pub, '/partnyori/studio-melodiya', '26-public-profile-390')
    pub.close()
    people.check()
    step(f"public profile: the review ({CLIENT_NAME}, 5★) with the partner's reply; {after['review_count']} ревюта")

    # every link the two of them were sent — email buttons and bell items — opens a page for them
    def links_open(ctx, user_id, who):
        rows = sql("select template_key, html from email_outbox where to_user_id = $1 and created_at >= $2::timestamptz", user_id, S['t0'])
        hrefs = {}
        for m in rows:
            for h in re.findall(r'href="([^"]+)"', m['html']):
                if h.startswith(BASE): hrefs.setdefault(h[len(BASE):], m['template_key'])
        for n in sql("select kind, href from notification where user_id = $1 and created_at >= $2::timestamptz and href is not null", user_id, S['t0']):
            hrefs.setdefault(n['href'], 'bell ' + n['kind'])
        pg = ctx.new_page()
        for path, src in sorted(hrefs.items()):
            pg.goto('about:blank')
            r = pg.goto(BASE + (path if path.startswith('/') else '/' + path))
            assert r and r.status < 400, f'{who}: {src} → {path}: {r and r.status}'
            assert pg.locator('.ui-notfound-t').count() == 0, f'{who}: {src} → {path}: ‹Страницата не е намерена›'
            if '#' in path:
                assert pg.locator('#' + path.split('#', 1)[1]).count() == 1, f'{who}: {src} → {path}: no such anchor'
        pg.close()
        return len(hrefs), len(rows)
    nc = links_open(client, S['client_id'], 'client')
    np_ = links_open(partner, partner_user, 'partner')
    people.check()
    step(f'links: {nc[0]} client and {np_[0]} partner destinations from {nc[1] + np_[1]} emails and their bell items all open (no 404)')

    # ── 7. the ledger reconciles ───────────────────────────────────────
    bid, pid = S['booking_id'], S['partner_id']
    assert ledger('client_funds', bid) == 0, ledger('client_funds', bid)
    bk = one('select * from booking where id = $1', bid)
    commission = (bk['amount_cents'] * bk['commission_bp'] + 5000) // 10000
    assert commission == 6400 and ledger('commission_revenue', bid) == commission and ledger('platform_cash', bid) == commission, 'commission at the rate'
    item = one('select * from payout_item where id = (select payout_item_id from payout_line where booking_id = $1)', bid)
    l4 = sql("""select e.account, e.debit_cents, e.credit_cents from ledger_entry e join ledger_transaction t on t.id = e.transaction_id
                where t.kind = 'payout' and t.payout_item_id = $1""", item['id'])
    assert sum(int(e['debit_cents']) for e in l4 if e['account'] == 'partner_payable') == item['amount_cents'] == 57600, l4
    assert ledger('partner_payable', bid) == 57600, 'L3 credited the partner payable for the booking'
    unpaid_released = int(one("select coalesce(sum(amount_cents), 0)::bigint as s from payout_line where partner_id = $1 and ready_at is not null and status <> 'paid'", pid)['s'])
    assert ledger('partner_payable', partner_id=pid) == unpaid_released == 0, (ledger('partner_payable', partner_id=pid), unpaid_released)
    held = int(one("""select coalesce(sum(e.debit_cents - e.credit_cents), 0)::bigint as b from ledger_entry e join ledger_transaction t on t.id = e.transaction_id
                      where e.account = 'provider_held' and (e.booking_id = $1 or t.payout_item_id = $2)""", bid, item['id'])['b'])
    assert held == 0, f'provider still holds {held} for the booking'
    unbalanced = sql("""select t.id from ledger_transaction t join ledger_entry e on e.transaction_id = t.id
                        group by t.id having sum(e.debit_cents) <> sum(e.credit_cents)""")
    assert not unbalanced, unbalanced
    a.goto('/admin/rezervacii/' + quote(nomer))
    # the topbar search is styled on a page opened directly, not only after visiting an admin-ops page
    expect(a.locator('.topbar .ops-search input')).to_have_css('border-top-width', '0px')
    split = sp(a.inner_text('body'))
    assert 'Комисиона (10%)' in split and '64,00 €' in split, split[:800]
    shot(a, '27-admin-booking-1440', full=True)
    people.check()
    step('ledger: client_funds 0; payable 576 € released and paid out (partner payable 0); commission 64 € = 10% of 640 €; provider holds 0; every transaction balances')


if __name__ == '__main__':
    main()
