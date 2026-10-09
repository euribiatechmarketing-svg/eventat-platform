#!/usr/bin/env python3
"""Journey J2 — cancellations and refunds, across the client, partner and admin areas and the timers.

Usage: python3 tests/e2e/journey-cancel.py [--base http://localhost:3302] [--shots DIR] [--headed]

Resets and seeds the database named in .env.local (local `eventat_*` databases only), then drives the
running server the way people use the product, one browser context per person:

  1. Мария cancels a Гъвкава (seeded), an Умерена and a Строга booking (both made through the real
     request → approve → pay flow): the preview against SPEC §5, the refund at the simulated provider
     (run by the cron tick), the emails and bells, the date free again in the partner's calendar and in
     search, and the client watching that date gets `client-date-freed`.
  2. A partner asks to cancel; the team completes it (full refund) — and declines a second one.
  3. Payment deadline: an approved, unpaid request expires when the admin moves the demo clock past
     `payment_due_at`; the team's ‹Удължи срока› keeps two others alive (one is paid, one expires a day later).
  4. The amount a late cancellation kept is released to the partner the day after the event (L3), and
     the ledger and money invariants hold after every step (balanced postings, nothing negative, the
     provider's money = client funds + partner payable, every charge and refund posted exactly once).
  5. The risky steps the way people really click: double clicks on ‹Одобри заявката›, ‹Плати›,
     ‹Удължи срока›, ‹Анулиране› and ‹Анулирай резервацията›; the back button after paying and after
     cancelling; the same account in two tabs (a stale payment form, a stale cancel form, the team
     declining a request another tab has completed); a cancellation done on a 390 px touch phone, and
     one pressed before the page's JavaScript has loaded.

Prints one line per step and exits non-zero on the first failure. Screenshots of the key moments
(1440 and 390 px) go to --shots (default .data/journey-cancel).
"""
import datetime as dt
import json, os, re, subprocess, sys, time, traceback
from urllib.parse import quote, unquote
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NODE_PATH = os.path.expanduser('~/nodejs22/bin')
PW = 'eventat-demo'
MARIA = 'maria.dimitrova@gmail.com'
PETYA = 'petya.n@gmail.com'
STEFKA = 'stefka.ilieva@gmail.com'
MELODIA = 'studio.melodia@gmail.com'
ANA = 'ana-petrova-photography@example.invalid'
SWEETS = 'sladkarnitsa-med-i-mlyako@example.invalid'
SWEETS_SLUG = 'sladkarnitsa-med-i-mlyako'
ADMIN = 'monika.kovacheva@eventat.bg'

ARGS = sys.argv[1:]
BASE = ARGS[ARGS.index('--base') + 1] if '--base' in ARGS else 'http://localhost:3302'
SHOTS = ARGS[ARGS.index('--shots') + 1] if '--shots' in ARGS else os.path.join(ROOT, '.data', 'journey-cancel')
expect.set_options(timeout=60000)


def env_local():
    out = dict(os.environ)
    out['PATH'] = NODE_PATH + ':' + out.get('PATH', '')
    with open(os.path.join(ROOT, '.env.local'), encoding='utf-8') as f:
        for line in f:
            m = re.match(r'^([A-Z_][A-Z0-9_]*)=(.*)$', line.strip())
            if m: out[m.group(1)] = m.group(2).strip().strip('"')
    return out


ENV = env_local()


# ── database (read-only checks; the journey itself only clicks and types) ──

def sql(query, *params):
    code = (
        "import postgres from 'postgres';"
        "const s = postgres(process.env.DATABASE_URL, { onnotice: () => {} });"
        "try { const r = await s.unsafe(process.env.Q, JSON.parse(process.env.P)); console.log(JSON.stringify(r)); } finally { await s.end(); }"
    )
    r = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT, env={**ENV, 'Q': query, 'P': json.dumps(list(params))},
                       capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError(f'SQL failed: {query}\n{r.stderr[-1200:]}')
    return json.loads(r.stdout)


def one(query, *params):
    rows = sql(query, *params)
    return rows[0] if rows else None


def val(query, *params):
    row = one(query, *params)
    return None if row is None else next(iter(row.values()))


def reset_db():
    url = ENV.get('DATABASE_URL', '')
    if not re.match(r'^postgres(ql)?://[^@]+@(127\.0\.0\.1|localhost)(:\d+)?/eventat_[a-z0-9_]+$', url):
        sys.exit(f'refusing to reset {url or "the default database"}: .env.local must name this worktree\'s own local database')
    # A request the server is still finishing from an earlier run would hold locks the reset waits for: end it first.
    sql("select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and state <> 'idle'")
    for cmd in (['npm', 'run', 'db:reset'], ['npm', 'run', 'db:seed']):
        r = subprocess.run(cmd, cwd=ROOT, env=ENV, capture_output=True, text=True)
        if r.returncode: raise RuntimeError(f'{cmd}: {r.stderr[-1500:]}')
    time.sleep(6)  # the server caches the clock offset for 5 s


# Business "now" (the seed moves the demo clock to 31 Aug 2025 12:00 Sofia).
NOW_SQL = "(now() + coalesce((select (value::text)::bigint from platform_settings where key = 'clock_offset_ms' order by effective_from desc, created_at desc limit 1), 0) * interval '1 millisecond')"


def today():
    return dt.date.fromisoformat(val(f"select to_char(({NOW_SQL}) at time zone 'Europe/Sofia', 'YYYY-MM-DD') as d"))


# ── formats (lib/format.ts) ─────────────────────────────────────────────────

MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември']


def grp(n): return f'{n:,}'.replace(',', ' ')
def money(c): return f'{"−" if c < 0 else ""}{grp(abs(c) // 100)},{abs(c) % 100:02d} €'
def money_short(c): return money(c) if c % 100 else f'{grp(c // 100)} €'
def fdate(d): return f'{d.day} {MONTHS[d.month - 1]} {d.year}'
def fshort(d): return f'{d.day} {MONTHS[d.month - 1]}'
def norm(s): return re.sub(r'\s+', ' ', (s or '').replace('\u00a0', ' ').replace('\u202f', ' ')).strip()
def half_up(n, d): return (n + d // 2) // d
def norm_lines(s): return '\n'.join(norm(x) for x in (s or '').split('\n'))


TIERS = {  # SPEC §5.2 (boundaries inclusive): (min days_before, retained)
    'flexible': [(7, 'none'), (1, 'deposit'), (0, 'total')],
    'moderate': [(30, 'none'), (7, 'deposit'), (0, 'total')],
    'strict': [(14, 'deposit'), (0, 'total')],
}
POLICY = {'flexible': 'Гъвкава', 'moderate': 'Умерена', 'strict': 'Строга'}


def expected_quote(policy, total, deposit_pct, paid, days, commission_bp):
    """SPEC §5 computed independently of lib/domain/cancellation.ts."""
    deposit = half_up(total * deposit_pct, 100)
    kind = next(k for m, k in TIERS[policy] if days >= m)
    by_policy = {'none': 0, 'deposit': deposit, 'total': total}[kind]
    retained = min(by_policy, paid)
    commission = half_up(retained * commission_bp, 10000)
    return {'tier': kind, 'deposit': deposit, 'refund': paid - retained, 'retained': retained, 'commission': commission,
            'partner': retained - commission}


# ── the journey's own checks ───────────────────────────────────────────────

def ledger_invariants(label):
    """SPEC §7.5 after every step: balanced postings, no negative client funds / partner payable, the provider's
    money equals what is owed (client funds + partner payable − receivable) and commission = platform cash."""
    bad = sql("""select t.id, t.description, coalesce(sum(e.debit_cents),0)::bigint d, coalesce(sum(e.credit_cents),0)::bigint c, count(e.id)::int n
                 from ledger_transaction t left join ledger_entry e on e.transaction_id = t.id group by t.id
                 having coalesce(sum(e.debit_cents),0) <> coalesce(sum(e.credit_cents),0) or count(e.id) < 2""")
    assert not bad, f'{label}: unbalanced ledger transactions {bad}'
    neg = sql("""select booking_id, sum(credit_cents - debit_cents)::bigint b from ledger_entry where account = 'client_funds' and booking_id is not null
                 group by booking_id having sum(credit_cents - debit_cents) < 0""")
    assert not neg, f'{label}: negative client_funds {neg}'
    neg = sql("""select partner_id, sum(credit_cents - debit_cents)::bigint b from ledger_entry where account = 'partner_payable' and partner_id is not null
                 group by partner_id having sum(credit_cents - debit_cents) < 0""")
    assert not neg, f'{label}: negative partner_payable {neg}'
    bal = {r['account']: int(r['b']) for r in sql("""select account::text, sum(case when account in ('provider_held','partner_receivable','platform_cash')
              then debit_cents - credit_cents else credit_cents - debit_cents end)::bigint b from ledger_entry group by account""")}
    g = lambda a: bal.get(a, 0)
    assert g('provider_held') + g('partner_receivable') == g('client_funds') + g('partner_payable'), f'{label}: provider_held does not reconcile {bal}'
    assert g('platform_cash') == g('commission_revenue'), f'{label}: platform cash ≠ commission {bal}'
    # Every booking: L1 credited exactly what the provider received, and the refund postings took out exactly what went back.
    off = sql("""with recv as (select booking_id, sum(amount_cents)::bigint s from charge where status in ('succeeded','partially_refunded','refunded') group by booking_id),
      back as (select booking_id, sum(amount_cents)::bigint s from refund where status = 'succeeded' group by booking_id),
      l1 as (select e.booking_id, sum(e.credit_cents)::bigint s from ledger_entry e join ledger_transaction t on t.id = e.transaction_id
             where t.kind = 'charge' and e.account = 'client_funds' group by e.booking_id),
      l2 as (select t.booking_id, sum(e.credit_cents)::bigint s from ledger_entry e join ledger_transaction t on t.id = e.transaction_id
             where t.kind = 'refund' and e.account in ('provider_held', 'platform_cash') group by t.booking_id)
      select b.number, coalesce(recv.s,0) recv, coalesce(l1.s,0) l1, coalesce(back.s,0) back, coalesce(l2.s,0) l2 from booking b
      left join recv on recv.booking_id = b.id left join back on back.booking_id = b.id left join l1 on l1.booking_id = b.id left join l2 on l2.booking_id = b.id
      where coalesce(recv.s,0) <> coalesce(l1.s,0) or coalesce(back.s,0) <> coalesce(l2.s,0)""")
    assert not off, f'{label}: client funds do not reconcile with charges and refunds {off}'


def booking_row(number):
    return one("""select b.id, b.number, b.status::text, b.cancelled_by::text, b.amount_cents, b.commission_bp, b.deposit_percent,
                  b.cancellation_policy::text policy, b.event_date::text, b.payment_due_at, b.payment_extensions, b.hold_until::text,
                  (select coalesce(sum(amount_cents),0)::int from charge c where c.booking_id = b.id and c.status in ('succeeded','partially_refunded','refunded')) paid,
                  (select coalesce(sum(amount_cents),0)::int from refund r where r.booking_id = b.id and r.status = 'succeeded') refunded,
                  (select coalesce(sum(amount_cents),0)::int from refund r where r.booking_id = b.id and r.status = 'pending') refund_pending,
                  (select coalesce(sum(credit_cents - debit_cents),0)::int from ledger_entry e where e.booking_id = b.id and e.account = 'client_funds') client_funds,
                  (select coalesce(sum(debit_cents - credit_cents),0)::int from ledger_entry e where e.booking_id = b.id and e.account = 'provider_held') provider_held,
                  (select row_to_json(x) from (select initiated_by::text, reason::text, reason_text, days_before, paid_cents, refund_cents, retained_cents,
                     commission_bp, partner_amount_cents from cancellation where booking_id = b.id) x) cancellation
                  from booking b where b.number = $1""", number)


def outbox(key, to=None, number=None):
    q, p = "select to_email, subject, text, vars, status::text from email_outbox where template_key = $1", [key]
    if to: p.append(to); q += f' and to_email = ${len(p)}'
    if number: p.append(number); q += f" and (vars->>'bookingNo' = ${len(p)} or vars->>'bookingId' = ${len(p)} or vars->>'requestNo' = ${len(p)} or vars->>'number' = ${len(p)})"
    return sql(q + ' order by created_at', *p)


def bells(email, kind, text=None):
    """Bell items of a kind; `text` keeps those whose title, body or link mentions it (a number, a date)."""
    rows = sql("""select n.title, n.body, n.href from notification n join "user" u on u.id = n.user_id
                  where u.email = $1 and n.kind = $2 order by n.created_at""", email, kind)
    return [r for r in rows if text is None or any(text in unquote(norm(r[k] or '')) for k in ('title', 'body', 'href'))]


def watch_status(email, slug, d):
    return [r['status'] for r in sql("""select w.status::text from date_watch w join "user" u on u.id = w.client_id join partner p on p.id = w.partner_id
                                         where u.email = $1 and p.slug = $2 and w.date = $3 order by w.created_at""", email, slug, str(d))]


# ── browser helpers ─────────────────────────────────────────────────────────

# Every toast a page shows (components/ui/client.tsx dispatches `eventat:toast`), kept per document.
TOAST_LOG = "window.__toasts = []; window.addEventListener('eventat:toast', e => window.__toasts.push(e.detail));"


class Person:
    def __init__(self, browser, email, width=1440, touch=False):
        self.email = email
        self.ctx = browser.new_context(viewport={'width': width, 'height': 900 if width > 500 else 844}, locale='bg-BG', timezone_id='Europe/Sofia',
                                       has_touch=touch, is_mobile=touch)
        self.ctx.add_init_script(TOAST_LOG)
        r = self.ctx.request.post(BASE + '/api/auth/sign-in/email', data={'email': email, 'password': PW}, headers={'Origin': BASE})
        assert r.ok, f'sign-in {email}: {r.status} {r.text()[:200]}'
        self.errors = []
        self.page = self.new_tab()

    def new_tab(self):
        """Another tab of the same browser (same session), watched for page and console errors like the first."""
        page = self.ctx.new_page()
        page.set_default_timeout(120000)
        page.on('pageerror', lambda e: self.errors.append(f'step {STEP[0] + 1}, pageerror on {unquote(page.url)}: {e}'))
        page.on('console', lambda m: self.errors.append(f'step {STEP[0] + 1}, console on {unquote(page.url)}: {m.text}') if m.type == 'error' else None)
        return page

    def go(self, path, status=200):
        r = self.page.goto(BASE + path)
        assert r is not None and r.status == status, f'{self.email} {path}: HTTP {r.status if r else None}'
        return self.page

    def path(self):
        return unquote(self.page.url.replace(BASE, ''))


def toasts(page):
    """The toasts this document has shown so far, as (kind, message)."""
    return [(t['kind'], t['message']) for t in page.evaluate('window.__toasts || []')]


def toast(page, text):
    expect(page.locator('.ui-toast.is-on')).to_contain_text(text, timeout=20000)


def tick(page):
    """What Vercel Cron does every minute: run due jobs (refund.submit, T8 …) and deliver the outbox."""
    r = page.request.get(BASE + '/api/cron/tick', headers={'Authorization': f'Bearer {ENV["CRON_SECRET"]}'}, timeout=180000)
    assert r.ok, f'cron tick: {r.status} {r.text()[:300]}'
    return r.json()


def bell_has(person, title):
    """Reload the page, open the header bell and find a notice by its title."""
    p = person.page
    p.reload()
    p.click('button[aria-label="Известия"]')
    expect(p.locator('.ui-menu .ui-note').filter(has_text=title).first).to_be_visible()
    p.keyboard.press('Escape')


SHOT_N = [0]


def shoot(browser, person, name, path=None, full=True):
    """The current page (or `path`) at 1440 and at 390 px, as this person."""
    os.makedirs(SHOTS, exist_ok=True)
    SHOT_N[0] += 1
    path = path or person.path()
    person.go(path)
    person.page.wait_for_load_state('networkidle')
    base = os.path.join(SHOTS, f'{SHOT_N[0]:02d}-{name}')
    person.page.screenshot(path=base + '-1440.png', full_page=full)
    phone = Person(browser, person.email, width=390)
    try:
        phone.go(path)
        phone.page.wait_for_load_state('networkidle')
        phone.page.screenshot(path=base + '-390.png', full_page=full)
        wide = phone.page.evaluate('document.documentElement.scrollWidth')
        assert wide <= 390, f'{name}: page scrolls sideways at 390 px ({wide})'
        assert not phone.errors, f'{name} at 390 px: {phone.errors}'
    finally:
        phone.ctx.close()


STEP = [0]


def step(text):
    STEP[0] += 1
    print(f'  ✓ {STEP[0]:02d} {text}', flush=True)


# ── flows through the real UI ──────────────────────────────────────────────

def send_request(maria, slug, *, event_type, day, package, guests='80', venue='Ресторант „Журнал“'):
    p = maria.go(f'/zayavka/{slug}')
    p.select_option('select[name=eventTypeId]', label=event_type)
    p.fill('input[name=eventDate]', day.isoformat())
    p.fill('input[name=startTime]', '18:00')
    p.fill('input[name=endTime]', '23:00')
    p.fill('input[name=guests]', guests)
    p.fill('input[name=venueName]', venue)
    p.fill('input[name=locality]', 'София')
    p.click('label.opt:has-text("Закрита зала")')
    p.click(f'label.opt:has-text("{package}")')
    p.click('button:has-text("Изпрати заявката")')
    p.wait_for_url(re.compile(r'/akaunt/zayavki/\d{4}-\d{4}-'))
    expect(p.locator('.sh-badge')).to_have_text('Чака отговор')
    return maria.path().rsplit('/', 1)[1]


def approve(partner, client_name, day, number):
    p = partner.go('/partner/zayavki')
    p.locator('.req').filter(has_text=client_name).filter(has_text=fdate(day)).first.locator('.req-meta').click()
    p.wait_for_url(re.compile(r'/partner/zayavki/' + re.escape(quote(number)) + '$'))
    p.click('button:has-text("Одобри заявката")')
    expect(p.locator('.page-head .badge')).to_have_text('Одобрена · чака плащане')
    expect(p.locator('.countdown-time')).to_have_text(re.compile(r'^\d\d:\d\d$'))


def pay(maria, number, amount):
    p = maria.go('/akaunt/zayavki/' + quote(number))
    p.click(f'a.btn:has-text("Плати {money_short(amount)}")')
    p.wait_for_url(re.compile(r'/plashtane/' + re.escape(quote(number)) + '$'))
    p.click(f'button:has-text("Плати {money_short(amount)}")')
    p.wait_for_url(re.compile(r'/plashtane/test/[0-9a-f-]{36}$'))
    p.click('button:has-text("Плати")')
    p.wait_for_url(re.compile(r'/potvardena$'))
    expect(p.locator('.done-t')).to_have_text('Резервацията е потвърдена')


def open_cancel_page(maria, number, partner_name):
    """From ‹Моите резервации›: the booking's row → ‹Детайли› → ‹Анулиране›."""
    p = maria.go('/akaunt/rezervacii')
    hero = p.locator('.nx').filter(has_text=number)
    if hero.count():  # the nearest event is the hero card, with its own ‹Анулиране›
        expect(hero).to_contain_text(partner_name)
        hero.locator('a:has-text("Анулиране")').click()
    else:
        row = p.locator('.mrow').filter(has_text=partner_name).filter(has=p.locator(f'a[href$="{quote(number)}"]'))
        row.locator('a:has-text("Детайли")').click()
        p.wait_for_url(re.compile(r'/akaunt/rezervacii/' + re.escape(quote(number)) + '$'))
        expect(p.locator('.h-right .badge')).to_have_text('Потвърдена')
        p.click('a:has-text("Анулиране")')
    p.wait_for_url(re.compile(r'/anulirane$'))
    return p


def check_preview(p, q, *, paid, event_date, policy, days):
    """The cancel page shows exactly the quote (SPEC §5.5 cells and strings)."""
    expect(p.locator('.cx-cell').nth(0).locator('.cx-cell-v')).to_have_text(money_short(paid))
    expect(p.locator('.cx-cell--back .cx-cell-v')).to_have_text(money_short(q['refund']))
    expect(p.locator('.cx-cell').nth(2).locator('.cx-cell-v')).to_have_text(money_short(q['retained']))
    if q['refund'] == paid: expect(p.locator('.cx-cell--back .cx-cell-n')).to_have_text('пълната сума')
    else: expect(p.locator('.cx-cell--back .cx-cell-n')).to_have_count(0)
    if q['retained'] == 0: expect(p.locator('.cx-cell').nth(2).locator('.cx-cell-n')).to_have_text('без удръжки')
    else: expect(p.locator('.cx-cell').nth(2).locator('.cx-cell-n')).to_have_count(0)
    expect(p.locator('.sum-total b')).to_have_text(money_short(q['refund']))
    expect(p.locator('.cx-pol-t')).to_have_text(f'{POLICY[policy]} политика')
    free_days = {'flexible': 7, 'moderate': 30}.get(policy)
    if free_days:
        expect(p.locator('.cx-pol-d')).to_have_text(
            f'Безплатно анулиране до {fdate(event_date - dt.timedelta(days=free_days))} — {free_days} дни преди събитието. След това се задържа депозитът.')
    else:
        expect(p.locator('.cx-pol-d')).to_have_text('Депозитът не се връща; остатъкът се възстановява до 14 дни преди събитието.')
    if q['tier'] == 'none':
        expect(p.locator('.h-sub')).to_have_text(f'До събитието остават {days} дни — анулирането е в безплатния срок и сумата се възстановява изцяло.')
    else:
        # The partial and no-refund variants of the h-sub are new copy (SPEC §5.5): nothing may claim a full refund.
        expect(p.locator('.h-sub').filter(has_text='изцяло')).to_have_count(0)
        expect(p.locator('body')).not_to_contain_text('в безплатния срок')
    card_line = p.locator('.book-note:has-text("Възстановяването тръгва към картата")')
    expect(card_line).to_have_count(1 if q['refund'] > 0 else 0)
    expect(p.locator('.cx-next')).to_contain_text('Потвърждението за анулирането и за възстановената сума идва на' if q['refund'] > 0
                                                  else 'Потвърждението за анулирането идва на')


def cancel_with(p, reason):
    p.click(f'label.cx-pick:has-text("{reason}")')
    p.click('button:has-text("Анулирай резервацията")')
    p.wait_for_url(BASE + '/akaunt/rezervacii')
    toast(p, 'Резервацията е анулирана — изпратихме ви потвърждение по имейл')


def calendar_day(partner, day):
    """The partner's month view: the day's cell (aria-label ‹14 · Свободно›) and its chip."""
    p = partner.go(f'/partner/kalendar?mesec={day.isoformat()[:7]}')
    return p.locator(f'.mdays [aria-label^="{day.day} ·"]')


def no_commission_for_partner(person, *paths):
    for path in paths:
        p = person.go(path)
        body = norm(p.locator('body').inner_text())
        assert 'Комисиона' not in body and 'комисиона' not in body, f'{path}: commission visible to the partner'


def no_error_toast(page, label):
    bad = [m for k, m in toasts(page) if k == 'error']
    assert not bad, f'{label}: error toast {bad}'
    expect(page.locator('.form-alert')).to_have_count(0)


def count(query, *params):
    return int(val(query, *params))


# ── 5. A real person at the risky steps ────────────────────────────────────

def risky_steps(b, maria, melodia, admin, n_paid):
    """Approving, paying and cancelling the way people really do it: a double click on every button that
    moves a booking or money, the back button after paying and after cancelling, the same account in two
    tabs, the cancellation done on a 390 px phone. Every move happens once and nobody sees an error."""
    T1 = today()

    # ── approve: the partner double-clicks ‹Одобри заявката› ──
    d1 = T1 + dt.timedelta(days=45)
    n1 = send_request(maria, 'studio-melodiya', event_type='Рожден ден', day=d1, package='Пакет „Вечер“')
    p = melodia.go('/partner/zayavki/' + quote(n1))
    p.locator('button:has-text("Одобри заявката")').dblclick()
    expect(p.locator('.page-head .badge')).to_have_text('Одобрена · чака плащане')
    expect(p.locator('.countdown-time')).to_have_text(re.compile(r'^\d\d:\d\d$'))
    p.wait_for_timeout(1500)  # a second submit, if one went out, has answered by now
    no_error_toast(p, 'double click on ‹Одобри заявката›')
    assert count("select count(*) from booking where number = $1", n1) == 1
    assert count("select count(*) from audit_log where action = 'request.approved' and data->>'number' = $1", n1) == 1
    assert len(outbox('client-request-approved', MARIA, n1)) == 1
    step(f'Двоен клик: the partner double-clicks ‹Одобри заявката› on {n1} → one booking, one approval, no error')

    # ── pay: two tabs, a double click on each ‹Плати›, the back button ──
    p = maria.go('/akaunt/zayavki/' + quote(n1))
    p.click('a.btn:has-text("Плати 640 €")')
    p.wait_for_url(re.compile(r'/plashtane/' + re.escape(quote(n1)) + '$'))
    p.locator('button:has-text("Плати 640 €")').dblclick()
    p.wait_for_url(re.compile(r'/plashtane/test/[0-9a-f-]{36}$'))
    checkout = maria.path()
    tab = maria.new_tab()
    tab.goto(BASE + '/plashtane/' + quote(n1))
    tab.click('button:has-text("Плати 640 €")')
    tab.wait_for_url(re.compile(r'/plashtane/test/[0-9a-f-]{36}$'))
    assert unquote(tab.url.replace(BASE, '')) == checkout, (tab.url, checkout)  # the open charge is reused
    bid = booking_row(n1)['id']
    assert count("select count(*) from charge where booking_id = $1", bid) == 1
    # Both tabs press the provider's ‹Плати› at the same moment, the first with a double click.
    p.locator('form button:has-text("Плати")').dblclick(no_wait_after=True)
    tab.locator('form button:has-text("Плати")').click(no_wait_after=True)
    p.wait_for_url(re.compile(r'/potvardena$'))
    expect(p.locator('.done-t')).to_have_text('Резервацията е потвърдена')
    tab.wait_for_url(re.compile(r'/potvardena$'))
    expect(tab.locator('.done-t')).to_have_text('Резервацията е потвърдена')
    no_error_toast(p, 'double click on ‹Плати›')
    no_error_toast(tab, '‹Плати› in a second tab')
    bp = booking_row(n1)
    assert bp['status'] == 'confirmed' and bp['paid'] == 64000 and bp['client_funds'] == 64000, bp
    assert sql("select status::text from charge where booking_id = $1", bid) == [{'status': 'succeeded'}]
    assert len(outbox('client-booking-confirmed', MARIA, n1)) == 1
    ledger_invariants('after a double-clicked payment')
    step(f'Плащане: two tabs and a double click on every ‹Плати› → one charge of 640 €, {n1} confirmed once')

    for _ in range(2):  # back to the provider's form, then to ‹Плащане›: neither takes money again
        p.go_back()
        p.wait_for_load_state('networkidle')
        if p.locator('form button:has-text("Плати")').count():
            p.locator('form button:has-text("Плати")').first.click()
            p.wait_for_load_state('networkidle')
            p.wait_for_timeout(1000)
    p.reload()
    assert maria.path() == '/akaunt/rezervacii/' + n1, maria.path()
    expect(p.locator('.h-right .badge')).to_have_text('Потвърдена')
    assert sql("select status::text from charge where booking_id = $1", bid) == [{'status': 'succeeded'}]
    assert booking_row(n1)['paid'] == 64000
    no_error_toast(p, 'back after paying')
    step('Назад след плащане: the provider\'s form and ‹Плащане› no longer take money; a reload lands on the booking')

    # ── the team double-clicks ‹Удължи срока› ──
    d3 = T1 + dt.timedelta(days=50)
    n3 = send_request(maria, 'studio-melodiya', event_type='Рожден ден', day=d3, package='Пакет „Вечер“')
    approve(melodia, 'Мария Димитрова', d3, n3)
    due0 = dt.datetime.fromisoformat(booking_row(n3)['payment_due_at'].replace('Z', '+00:00'))
    p = admin.go('/admin/rezervacii/' + quote(n3))
    p.locator('button:has-text("Удължи срока")').dblclick()
    toast(p, 'Срокът е удължен с 24 часа')
    p.wait_for_timeout(1500)
    no_error_toast(p, 'double click on ‹Удължи срока›')
    r3 = booking_row(n3)
    assert r3['payment_extensions'] == 1, r3
    assert dt.datetime.fromisoformat(r3['payment_due_at'].replace('Z', '+00:00')) - due0 == dt.timedelta(hours=24), (r3, due0)
    assert count("select count(*) from payment_extension where booking_id = $1", r3['id']) == 1
    assert len(outbox('client-payment-extended', MARIA, n3)) == 1
    step(f'Двоен клик: the team double-clicks ‹Удължи срока› on {n3} → extended once, by 24 hours')

    # ── a partner's request, the team in two tabs, a double click on ‹Анулирай резервацията› ──
    p = melodia.go('/partner/rezervacii/' + quote(n_paid))
    p.click('.panel-actions button:has-text("Анулиране")')
    p.locator('.po-confirm button[type="submit"]:has-text("Анулиране")').dblclick()
    toast(p, 'Изпратихме искането за анулиране — екипът се свързва с клиента')
    p.wait_for_timeout(1500)
    no_error_toast(p, 'double click on the partner\'s ‹Анулиране›')
    pid = booking_row(n_paid)['id']
    assert count("select count(*) from partner_cancellation_request where booking_id = $1", pid) == 1
    a1, a2 = admin.page, admin.new_tab()
    a1.goto(BASE + '/admin/rezervacii/' + quote(n_paid))
    a2.goto(BASE + '/admin/rezervacii/' + quote(n_paid))
    expect(a2.locator('.page-head .badge').first).to_have_text('Искане за анулиране')
    a1.click('button:has-text("Анулирай резервацията")')
    a1.locator('dialog[open] button[type="submit"]').dblclick()
    toast(a1, 'Резервацията е анулирана')
    expect(a1.locator('.page-head .badge').first).to_have_text('Анулирана')
    a1.wait_for_timeout(1500)
    no_error_toast(a1, 'double click on the team\'s ‹Анулирай резервацията›')
    a2.click('button:has-text("Откажи анулирането")')  # the second tab still offers it
    expect(a2.locator('.ui-toast.is-on.ui-toast--error')).to_have_count(1)
    expect(a2.locator('.page-head .badge').first).to_have_text('Анулирана')
    tick(a1)
    rp = booking_row(n_paid)
    assert rp['status'] == 'cancelled' and rp['cancelled_by'] == 'partner' and rp['refunded'] == 64000 and rp['client_funds'] == 0, rp
    assert count("select count(*) from refund where booking_id = $1", pid) == 1
    assert val("select string_agg(status::text, ',') from partner_cancellation_request where booking_id = $1", pid) == 'completed'
    assert len(outbox('client-vendor-cancelled', MARIA, n_paid)) == 1 and len(outbox('client-refund-sent', MARIA, n_paid)) == 1
    ledger_invariants('after the team\'s double click')
    step(f'Екип в два раздела: {n_paid} cancelled once with a double click (one refund of 640 €); ‹Откажи анулирането› in the other tab is refused')

    # ── Мария cancels on her phone (390 px, touch) with a double tap; her laptop tab has the form open ──
    tab.goto(BASE + f'/akaunt/rezervacii/{quote(n1)}/anulirane')
    expect(tab.locator('button:has-text("Анулирай резервацията")')).to_be_enabled()
    phone = Person(b, MARIA, width=390, touch=True)
    days = (d1 - T1).days
    q = expected_quote('moderate', 64000, 30, 64000, days, 1000)
    assert q['tier'] == 'none' and q['refund'] == 64000, q
    p = open_cancel_page(phone, n1, 'Студио Мелодия')
    check_preview(p, q, paid=64000, event_date=d1, policy='moderate', days=days)
    p.locator('label.cx-pick:has-text("Събитието се отменя")').tap()
    btn = p.locator('button:has-text("Анулирай резервацията")')
    btn.scroll_into_view_if_needed()
    expect(btn).to_be_in_viewport()
    assert p.evaluate('document.documentElement.scrollWidth') <= 390
    btn.dblclick()
    p.wait_for_url(BASE + '/akaunt/rezervacii')
    toast(p, 'Резервацията е анулирана — изпратихме ви потвърждение по имейл')
    p.wait_for_timeout(1500)
    no_error_toast(p, 'double tap on ‹Анулирай резервацията›')
    r1 = booking_row(n1)
    assert r1['status'] == 'cancelled' and r1['cancellation']['reason'] == 'event_cancelled' and r1['refund_pending'] == 64000, r1
    assert count("select count(*) from refund where booking_id = $1", bid) == 1
    assert len(outbox('client-cancel-confirmed', MARIA, n1)) == 1 and len(outbox('vendor-client-cancelled', MELODIA, n1)) == 1
    step(f'Телефон: Мария cancels {n1} at 390 px with a double tap → cancelled once, one refund of 640 € pending')

    p.go_back()  # back to the cancel page: the form is not offered again
    p.wait_for_load_state('networkidle')
    p.wait_for_timeout(500)
    if p.url.endswith('/anulirane'):
        expect(p.locator('button:has-text("Анулирай резервацията")')).to_have_count(0)
    expect(p.locator('body')).not_to_contain_text('Анулирай резервацията')
    tab.click('label.cx-pick:has-text("Промяна в датата")')  # the laptop tab, opened before the phone cancelled
    tab.click('button:has-text("Анулирай резервацията")')
    expect(tab.locator('.form-alert')).to_have_text('Състоянието се промени. Презаредете страницата.')
    expect(tab.locator('input[name=reason][value=date_change]')).to_be_checked()  # a refusal keeps what was picked
    r1 = booking_row(n1)
    assert r1['cancellation']['reason'] == 'event_cancelled' and count("select count(*) from refund where booking_id = $1", bid) == 1, r1
    tick(p)
    r1 = booking_row(n1)
    assert r1['refunded'] == 64000 and r1['client_funds'] == 0 and len(outbox('client-refund-sent', MARIA, n1)) == 1, r1
    ledger_invariants('after the double-tapped cancellation')
    assert not phone.errors, phone.errors
    phone.ctx.close()
    step('Назад и втори раздел: back on the phone offers no second cancellation; the stale laptop tab is told the state changed; one refund')

    # ── a tap before the page's JavaScript has loaded (a slow phone): the form still reaches the server ──
    EA2 = '2026-1219-ЕА'
    slow = b.new_context(java_script_enabled=False, viewport={'width': 390, 'height': 844}, locale='bg-BG', timezone_id='Europe/Sofia')
    assert slow.request.post(BASE + '/api/auth/sign-in/email', data={'email': MARIA, 'password': PW}, headers={'Origin': BASE}).ok
    sp = slow.new_page()
    sp.goto(BASE + f'/akaunt/rezervacii/{quote(EA2)}/anulirane')
    sp.click('label.cb-pick-other .cx-pick-n')
    sp.fill('textarea[name=reasonText]', 'Сменихме мястото на събитието.')
    sp.click('button:has-text("Анулирай резервацията")')
    sp.wait_for_url(BASE + '/akaunt/rezervacii')  # not the page again with the fields in its address
    ea2 = booking_row(EA2)
    c = ea2['cancellation']
    assert ea2['status'] == 'cancelled' and c and c['reason'] == 'other' and c['reason_text'] == 'Сменихме мястото на събитието.' \
        and c['refund_cents'] == 68000 and ea2['refund_pending'] == 68000, ea2
    slow.close()
    tick(maria.page)
    assert booking_row(EA2)['refunded'] == 68000
    ledger_invariants('after the cancellation sent before the page loaded')
    step(f'Бавен телефон: ‹Анулирай резервацията› pressed before the JavaScript loaded still cancels {EA2} (the reason stays out of the address)')


# ── the journey ─────────────────────────────────────────────────────────────

def main():
    print(f'journey J2 — cancellations and refunds against {BASE}')
    reset_db()
    T0 = today()
    assert T0 == dt.date(2025, 8, 31), T0
    ledger_invariants('seed')
    step('fresh database: seeded demo, clock 31 август 2025, ledger invariants hold')

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless='--headed' not in ARGS)
        maria, petya, stefka = Person(b, MARIA), Person(b, PETYA), Person(b, STEFKA)
        melodia, sweets, ana, admin = Person(b, MELODIA), Person(b, SWEETS), Person(b, ANA), Person(b, ADMIN)
        people = [maria, petya, stefka, melodia, sweets, ana, admin]

        # ════ 1a. Гъвкава — the seeded Сладкарница booking for 19 декември 2026 ═══
        # (2026-0614-ФК, the other seeded Гъвкава booking, has an open case: K7 rightly offers no ‹Анулиране› there.)
        dec19, TD = dt.date(2026, 12, 19), '2026-1219-ТД'
        p = petya.go('/tarsene?kategoriya=torti-i-deserti&data=2026-12-19&druga-data=1')
        card = p.locator('a.v-card:has-text("Мед и мляко")')
        expect(card.locator('.badge')).to_have_text('Зает на 19 декември')
        p = petya.go('/partnyori/sladkarnitsa-med-i-mlyako?data=2026-12-19')
        expect(p.locator('.book')).to_contain_text('Заета дата')
        p.click('.book button:has-text("Уведоми ме, ако се освободи")')
        toast(p, 'Ще ви известим, ако датата се освободи')
        assert watch_status(PETYA, SWEETS_SLUG, dec19) == ['watching']
        step('Петя: Сладкарница „Мед и мляко“ is busy on 19 декември 2026 in search and on the profile → ‹Уведоми ме, ако се освободи›')

        td = booking_row(TD)
        assert td['status'] == 'confirmed' and td['policy'] == 'flexible', td
        days = (dec19 - T0).days
        q1 = expected_quote('flexible', td['amount_cents'], td['deposit_percent'], td['paid'], days, td['commission_bp'])
        assert q1['tier'] == 'none' and q1['refund'] == 42000 and q1['retained'] == 0, q1
        p = open_cancel_page(maria, TD, 'Мед и мляко')
        check_preview(p, q1, paid=td['paid'], event_date=dec19, policy='flexible', days=days)
        expect(p.locator('.cx-side-l:has-text("Другите ви резервации за 19 декември остават непроменени.")')).to_have_count(1)
        shoot(b, maria, 'cancel-flexible-preview')
        step(f'Гъвкава {TD}: the preview is the §5 quote ({days} дни → {money_short(q1["refund"])} back, nothing kept, policy box, card line, same-day note)')

        cancel_with(p, 'Промяна в датата')
        expect(p.locator('.mrow').filter(has=p.locator('a[href$="' + quote(TD) + '"]')).locator('.badge')).to_have_text('Анулирана')
        td = booking_row(TD)
        assert td['status'] == 'cancelled' and td['cancelled_by'] == 'client', td
        c = td['cancellation']
        assert c['reason'] == 'date_change' and c['days_before'] == days and c['refund_cents'] == q1['refund'] and c['retained_cents'] == 0 \
            and c['partner_amount_cents'] == 0, c
        assert td['refund_pending'] == q1['refund'], td
        step('Гъвкава: ‹Анулирай резервацията› → toast, row ‹Анулирана›, cancellation stored, refund pending at the provider')

        tick(maria.page)
        td = booking_row(TD)
        assert td['refunded'] == q1['refund'] and td['refund_pending'] == 0 and td['client_funds'] == 0 and td['provider_held'] == 0, td
        assert val("select string_agg(status::text, ',') from charge where booking_id = $1", td['id']) == 'refunded'
        assert val("select count(*)::int from invoice where booking_id = $1 and type = 'credit_note'", td['id']) == 1
        m = outbox('client-cancel-confirmed', MARIA, TD)
        assert len(m) == 1 and norm(m[0]['vars']['refund']) == money(q1['refund']) and norm(m[0]['vars']['kept']) == money(0) \
            and norm(m[0]['vars']['paid']) == money(td['paid']), m
        m = outbox('vendor-client-cancelled', SWEETS, TD)
        assert len(m) == 1 and norm(m[0]['vars']['partnerAmount']) == money(0) and m[0]['vars']['reason'] == 'Промяна в датата', m
        m = outbox('client-refund-sent', MARIA, TD)
        assert len(m) == 1 and norm(m[0]['vars']['refund']) == money(q1['refund']), m
        assert len(bells(MARIA, 'client-cancel-confirmed')) == 1 and len(bells(MARIA, 'client-refund-sent')) == 1
        assert len(bells(SWEETS, 'vendor-client-cancelled')) == 1
        maria.go('/akaunt/rezervacii')
        bell_has(maria, 'Сумата е възстановена')
        sweets.go('/partner')
        bell_has(sweets, 'Резервацията за 19 декември 2026 е анулирана')
        step('Гъвкава: cron tick → refund succeeded (charge refunded, credit note, client funds 0); emails and bells for Мария and the partner')

        cell = calendar_day(sweets, dec19)
        expect(cell).to_have_attribute('aria-label', '19 · Свободно')
        expect(cell.locator('.chip')).to_have_count(0)
        p = petya.go('/tarsene?kategoriya=torti-i-deserti&data=2026-12-19')
        expect(p.locator('a.v-card:has-text("Мед и мляко")')).to_have_count(1)
        expect(p.locator('a.v-card:has-text("Мед и мляко") .badge:has-text("Зает")')).to_have_count(0)
        p = petya.go('/partnyori/sladkarnitsa-med-i-mlyako?data=2026-12-19')
        expect(p.locator('.book a:has-text("Изпрати запитване")')).to_be_visible()
        assert watch_status(PETYA, SWEETS_SLUG, dec19) == ['notified']
        m = outbox('client-date-freed', PETYA)
        assert len(m) == 1 and m[0]['vars']['partnerSlug'] == SWEETS_SLUG and norm(m[0]['vars']['eventDate']) == fdate(dec19), m
        # Петя has no event that day: the row is the date alone — never Мария's event (‹Коледно парти›, ‹Фирмено събитие›).
        assert f'Събитие: {fdate(dec19)}\n' in norm_lines(m[0]['text']) and 'Коледно' not in m[0]['text'] and 'Фирмено' not in m[0]['text'], m[0]['text']
        assert f'/partnyori/{SWEETS_SLUG}?data={dec19}' in m[0]['text'], m[0]['text']
        assert len(bells(PETYA, 'client-date-freed')) == 1
        bell_has(petya, 'Датата се освободи')
        step('Гъвкава: 19 декември is free again in the partner\'s calendar, in search and on the profile; Петя got client-date-freed + bell')
        ledger_invariants('after Гъвкава')
        step('ledger: balanced, nothing negative, provider money = client funds + payable')


        # ════ 1b. Умерена — a fresh booking with Студио Мелодия, 20 days out ═════
        d_mod = T0 + dt.timedelta(days=20)
        n_mod = send_request(maria, 'studio-melodiya', event_type='Рожден ден', day=d_mod, package='Пакет „Вечер“')
        approve(melodia, 'Мария Димитрова', d_mod, n_mod)
        pay(maria, n_mod, 64000)
        bm = booking_row(n_mod)
        assert bm['status'] == 'confirmed' and bm['paid'] == 64000 and bm['policy'] == 'moderate' and bm['deposit_percent'] == 30 \
            and bm['commission_bp'] == 1000 and bm['client_funds'] == 64000, bm
        step(f'Умерена {n_mod}: Мария requests Студио Мелодия for {fdate(d_mod)} → the partner approves → Мария pays 640 € → confirmed at 10%')

        p = stefka.go(f'/tarsene?kategoriya=dj-i-ozvuchavane&data={d_mod}&druga-data=1')
        card = p.locator('a.v-card:has-text("Студио Мелодия")')
        expect(card.locator('.badge')).to_have_text(f'Зает на {fshort(d_mod)}')
        card.locator('button:has-text("Уведоми ме")').click()
        toast(p, 'Ще ви известим, ако датата се освободи')
        assert watch_status(STEFKA, 'studio-melodiya', d_mod) == ['watching']
        cell = calendar_day(melodia, d_mod)
        expect(cell.locator('.chip--booked')).to_have_count(1)
        step(f'Стефка: Студио Мелодия is busy on {fshort(d_mod)} → ‹Уведоми ме› on the search card; the partner\'s calendar shows the booking')

        days = (d_mod - T0).days
        q2 = expected_quote('moderate', 64000, 30, 64000, days, 1000)
        assert q2 == {'tier': 'deposit', 'deposit': 19200, 'refund': 44800, 'retained': 19200, 'commission': 1920, 'partner': 17280}, q2
        p = open_cancel_page(maria, n_mod, 'Студио Мелодия')
        check_preview(p, q2, paid=64000, event_date=d_mod, policy='moderate', days=days)
        shoot(b, maria, 'cancel-moderate-preview')
        step(f'Умерена: the preview — {days} дни → {money_short(q2["refund"])} back, the deposit {money_short(q2["retained"])} kept, no full-refund claim')

        cancel_with(p, 'Намерихме друг изпълнител')
        tick(maria.page)
        bm = booking_row(n_mod)
        assert bm['status'] == 'cancelled' and bm['cancelled_by'] == 'client', bm
        c = bm['cancellation']
        assert c['reason'] == 'other_vendor' and c['refund_cents'] == 44800 and c['retained_cents'] == 19200 and c['partner_amount_cents'] == 17280, c
        assert bm['refunded'] == 44800 and bm['refund_pending'] == 0 and bm['client_funds'] == 19200 and bm['provider_held'] == 19200, bm
        assert val("select string_agg(status::text, ',') from charge where booking_id = $1", bm['id']) == 'partially_refunded'
        rel = one("select run_at, status::text from job where dedupe_key = $1", f"booking:{bm['id']}:release")
        assert rel and rel['status'] == 'pending', rel
        assert val(f"select to_char(run_at at time zone 'Europe/Sofia', 'YYYY-MM-DD HH24:MI') from job where dedupe_key = $1", f"booking:{bm['id']}:release") \
            == (d_mod + dt.timedelta(days=1)).isoformat() + ' 00:00'
        m = outbox('client-cancel-confirmed', MARIA, n_mod)
        assert len(m) == 1 and norm(m[0]['vars']['refund']) == money(44800) and norm(m[0]['vars']['kept']) == money(19200), m
        assert 'изцяло' not in m[0]['text'], ('client-cancel-confirmed claims a full refund on a partial one', m[0]['text'])
        m = outbox('vendor-client-cancelled', MELODIA, n_mod)
        assert len(m) == 1 and norm(m[0]['vars']['partnerAmount']) == money(17280) and m[0]['vars']['reason'] == 'Намерихме друг изпълнител', m
        assert 'няма изплащане' not in m[0]['text'] and 'изцяло' not in m[0]['text'], ('vendor-client-cancelled says nothing is paid out', m[0]['text'])
        assert 'омисион' not in m[0]['text'], 'commission in a partner email'
        m = outbox('client-refund-sent', MARIA, n_mod)
        assert len(m) == 1 and norm(m[0]['vars']['refund']) == money(44800), m
        assert 'без удръжки' not in m[0]['text'], ('client-refund-sent says nothing was kept', m[0]['text'])
        step('Умерена: cancelled → tick → 448 € refunded (charge partially refunded), 192 € stays held until the day after the event; emails tell the real split')

        p = melodia.go('/partner/rezervacii/' + quote(n_mod))
        expect(p.locator('.page-head .badge').first).to_have_text('Анулирана')
        expect(p.locator('.split.is-total b')).to_have_text(money(17280))
        no_commission_for_partner(melodia, '/partner/rezervacii/' + quote(n_mod), '/partner/rezervacii?tab=anulirani', '/partner/prihodi')
        bell_has(melodia, f'Резервацията за {fdate(d_mod)} е анулирана')
        cell = calendar_day(melodia, d_mod)
        expect(cell).to_have_attribute('aria-label', f'{d_mod.day} · Свободно')
        p = stefka.go(f'/tarsene?kategoriya=dj-i-ozvuchavane&data={d_mod}')
        expect(p.locator('a.v-card:has-text("Студио Мелодия")')).to_have_count(1)
        expect(p.locator('a.v-card:has-text("Студио Мелодия") .badge:has-text("Зает")')).to_have_count(0)
        assert watch_status(STEFKA, 'studio-melodiya', d_mod) == ['notified']
        m = outbox('client-date-freed', STEFKA)
        assert len(m) == 1 and norm(m[0]['vars']['eventDate']) == fdate(d_mod), m
        assert f'Събитие: {fdate(d_mod)}\n' in norm_lines(m[0]['text']) and 'Рожден ден' not in m[0]['text'], m[0]['text']
        bell_has(stefka, 'Датата се освободи')
        p = admin.go('/admin/rezervacii/' + quote(n_mod))
        expect(p.locator('.page-head .badge').first).to_have_text('Анулирана')
        expect(p.locator('.bkg-money .split').filter(has_text='Платено от клиента').locator('b')).to_have_text(money(64000))
        expect(p.locator('.bkg-money .split.is-fee').filter(has_text='Върнати').locator('b')).to_have_text('− ' + money(44800))
        expect(p.locator('.bkg-money .split.is-total').filter(has_text='За изплащане').locator('b')).to_have_text(money(17280))
        step('Умерена: the partner sees ‹Анулирана› and ‹Получавате 172,80 €› (no commission anywhere), the team the same split; the date is free; Стефка told')
        ledger_invariants('after Умерена')
        step('ledger: the kept 192 € is the booking\'s client funds; everything reconciles')

        # ════ 1c. Строга — a fresh booking with Ана Петрова Photography, 10 days out ═
        d_str = T0 + dt.timedelta(days=10)
        n_str = send_request(maria, 'ana-petrova-photography', event_type='Сватба', day=d_str, package='Цял ден с втори фотограф', guests='120')
        approve(ana, 'Мария Димитрова', d_str, n_str)
        pay(maria, n_str, 190000)
        bs = booking_row(n_str)
        # The partner's second paid booking: the introductory 5% (SPEC §6, first three bookings).
        assert bs['status'] == 'confirmed' and bs['policy'] == 'strict' and bs['commission_bp'] == 500 and bs['paid'] == 190000, bs
        step(f'Строга {n_str}: request → Ана Петрова approves → Мария pays 1 900 € → confirmed at the introductory 5%')

        days = (d_str - T0).days
        q3 = expected_quote('strict', 190000, 30, 190000, days, 500)
        assert q3 == {'tier': 'total', 'deposit': 57000, 'refund': 0, 'retained': 190000, 'commission': 9500, 'partner': 180500}, q3
        p = open_cancel_page(maria, n_str, 'Ана Петрова')
        check_preview(p, q3, paid=190000, event_date=d_str, policy='strict', days=days)
        shoot(b, maria, 'cancel-strict-preview')
        step(f'Строга: the preview — {days} дни → nothing back, the whole 1 900 € kept, no card line, no full-refund claim')

        cancel_with(p, 'Събитието се отменя')
        tick(maria.page)
        bs = booking_row(n_str)
        c = bs['cancellation']
        assert bs['status'] == 'cancelled' and c['reason'] == 'event_cancelled' and c['refund_cents'] == 0 and c['retained_cents'] == 190000 \
            and c['partner_amount_cents'] == 180500, bs
        assert bs['refunded'] == 0 and bs['refund_pending'] == 0 and bs['client_funds'] == 190000, bs
        assert val("select count(*)::int from refund where booking_id = $1", bs['id']) == 0
        assert outbox('client-refund-sent', MARIA, n_str) == []
        m = outbox('client-cancel-confirmed', MARIA, n_str)
        assert len(m) == 1 and norm(m[0]['vars']['refund']) == money(0) and norm(m[0]['vars']['kept']) == money(190000), m
        assert 'изцяло' not in m[0]['text'] and 'Възстановяването тръгва' not in m[0]['text'], ('client-cancel-confirmed promises a refund', m[0]['text'])
        assert 'безплатно до' not in m[0]['text'], ('Строга has no free cancellation', m[0]['text'])
        m = outbox('vendor-client-cancelled', ANA, n_str)
        assert len(m) == 1 and norm(m[0]['vars']['partnerAmount']) == money(180500), m
        assert 'няма изплащане' not in m[0]['text'] and 'безплатния срок' not in m[0]['text'], ('vendor-client-cancelled', m[0]['text'])
        p = ana.go('/partner/rezervacii/' + quote(n_str))
        expect(p.locator('.page-head .badge').first).to_have_text('Анулирана')
        expect(p.locator('.split.is-total b')).to_have_text(money(180500))
        no_commission_for_partner(ana, '/partner/rezervacii/' + quote(n_str))
        expect(calendar_day(ana, d_str)).to_have_attribute('aria-label', f'{d_str.day} · Свободно')
        p = ana.go('/partner/prihodi')
        row = p.locator('.tbl tbody tr').filter(has_text=d_str.strftime('%d.%m.%Y'))
        expect(row.locator('td.num')).to_have_text(money(180500))
        no_commission_for_partner(ana, '/partner/prihodi')
        step('Строга: cancelled → no refund, no refund email; the partner receives 1 805,00 € (listed in ‹Приходи›); the date is free')
        ledger_invariants('after Строга')
        step('ledger: the whole 1 900 € stays as client funds until the day after the event')

        # ════ 2. The partner asks to cancel; the team completes one and declines another ═══
        EA, EA2, june14 = '2026-0614-ЕА', '2026-1219-ЕА', dt.date(2026, 6, 14)
        p = petya.go('/partnyori/studio-melodiya?data=2026-06-14')
        p.click('.book button:has-text("Уведоми ме, ако се освободи")')
        toast(p, 'Ще ви известим, ако датата се освободи')
        assert watch_status(PETYA, 'studio-melodiya', june14) == ['watching']

        p = melodia.go('/partner/rezervacii/' + quote(EA))
        expect(p.locator('.page-head .badge').first).to_have_text('Потвърдена')
        p.click('.panel-actions button:has-text("Анулиране")')
        p.click('.po-confirm button[type="submit"]:has-text("Анулиране")')
        toast(p, 'Изпратихме искането за анулиране — екипът се свързва с клиента')
        expect(p.locator('.page-head .badge').first).to_have_text('Искане за анулиране')
        expect(p.locator('.tl-title:has-text("Искане за анулиране")')).to_have_count(1)
        expect(p.locator('.panel-actions button:has-text("Анулиране")')).to_have_count(0)
        ea = booking_row(EA)
        assert ea['status'] == 'cancellation_requested', ea
        assert val("select string_agg(status::text, ',') from partner_cancellation_request where booking_id = $1", ea['id']) == 'pending'
        assert len(outbox('vendor-cancel-requested', MELODIA, EA)) == 1
        team = outbox('team-vendor-cancel', number=EA)
        assert ADMIN in [m['to_email'] for m in team], team
        assert len(bells(MELODIA, 'vendor-cancel-requested')) == 1
        p = maria.go('/akaunt/rezervacii/' + quote(EA))
        expect(p.locator('.h-right .badge')).to_have_text('Потвърдена')
        shoot(b, melodia, 'partner-cancellation-requested', '/partner/rezervacii/' + quote(EA))
        step(f'Партньор: Студио Мелодия asks to cancel {EA} → toast, ‹Искане за анулиране›; emails to the partner and the team; Мария still sees ‹Потвърдена›')

        mail = next(m for m in team if m['to_email'] == ADMIN)
        link = re.search(r'Отвори резервацията: (\S+)', mail['text']).group(1)
        assert unquote(link).endswith('/admin/rezervacii/' + EA), link
        p = admin.go(unquote(link).replace(BASE, ''))
        expect(p.locator('.page-head .badge').first).to_have_text('Искане за анулиране')
        expect(p.locator('.hint').filter(has_text='поиска анулиране')).to_contain_text(f'Студио Мелодия поиска анулиране на {fdate(T0)}.')
        # the topbar search is styled on the money pages too (not a bare browser input)
        expect(p.locator('form.ops-search:not(.ops-search--page) input[name=q]')).to_have_css('border-top-width', '0px')
        shoot(b, admin, 'admin-partner-request')
        p.click('button:has-text("Анулирай резервацията")')
        dlg = p.locator('dialog[open]')
        expect(dlg.locator('.split').nth(0)).to_contain_text(money(145000))
        expect(dlg.locator('.split').nth(1)).to_contain_text('Връща се')
        expect(dlg.locator('.split').nth(1)).to_contain_text(money(145000))
        expect(dlg.locator('.split').nth(2)).to_contain_text(money(0))
        dlg.locator('button[type="submit"]').click()
        toast(p, 'Резервацията е анулирана')
        expect(p.locator('.page-head .badge').first).to_have_text('Анулирана')
        tick(admin.page)
        ea = booking_row(EA)
        c = ea['cancellation']
        assert ea['status'] == 'cancelled' and ea['cancelled_by'] == 'partner' and c['refund_cents'] == 145000 and c['retained_cents'] == 0 \
            and c['partner_amount_cents'] == 0, ea
        assert ea['refunded'] == 145000 and ea['client_funds'] == 0 and ea['provider_held'] == 0, ea
        assert val("select string_agg(status::text, ',') from partner_cancellation_request where booking_id = $1", ea['id']) == 'completed'
        m = outbox('client-vendor-cancelled', MARIA, EA)
        assert len(m) == 1 and norm(m[0]['vars']['refund']) == money(145000), m
        m = outbox('vendor-cancel-completed', MELODIA, EA)
        assert len(m) == 1 and norm(m[0]['vars']['partnerAmount']) == money(0), m
        m = outbox('client-refund-sent', MARIA, EA)
        assert len(m) == 1 and norm(m[0]['vars']['refund']) == money(145000), m
        assert len(bells(MARIA, 'client-vendor-cancelled')) == 1 and len(bells(MELODIA, 'vendor-cancel-completed')) == 1
        step(f'Екип: the email\'s link opens {EA}; ‹Анулирай резервацията› shows 1 450 / 1 450 / 0 → cancelled by the partner, full refund, emails and bells')

        p = maria.go('/akaunt/rezervacii/' + quote(EA))
        expect(p.locator('.h-right .badge')).to_have_text('Анулирана')
        bell_has(maria, 'Изпълнителят анулира резервацията')
        p = melodia.go('/partner/rezervacii/' + quote(EA))
        expect(p.locator('.page-head .badge').first).to_have_text('Анулирана')
        expect(p.locator('.split.is-total b')).to_have_text(money(0))
        bell_has(melodia, 'Резервацията е анулирана')
        expect(calendar_day(melodia, june14)).to_have_attribute('aria-label', '14 · Свободно')
        assert watch_status(PETYA, 'studio-melodiya', june14) == ['notified']
        m = outbox('client-date-freed', PETYA)
        assert len(m) == 2 and m[-1]['vars']['partnerSlug'] == 'studio-melodiya' and norm(m[-1]['vars']['eventDate']) == fdate(june14), m
        p = petya.go('/tarsene?kategoriya=dj-i-ozvuchavane&data=2026-06-14')
        expect(p.locator('a.v-card:has-text("Студио Мелодия")')).to_have_count(1)
        ledger_invariants('after K9')
        step('K9: Мария sees ‹Анулирана›, the partner ‹Получавате 0,00 €›; 14 юни free in the calendar and search; Петя got client-date-freed; ledger ok')

        p = melodia.go('/partner/rezervacii/' + quote(EA2))
        p.click('.panel-actions button:has-text("Анулиране")')
        p.click('.po-confirm button[type="submit"]:has-text("Анулиране")')
        toast(p, 'Изпратихме искането за анулиране — екипът се свързва с клиента')
        p = admin.go('/admin/rezervacii/' + quote(EA2))
        expect(p.locator('.page-head .badge').first).to_have_text('Искане за анулиране')
        p.click('button:has-text("Откажи анулирането")')
        toast(p, 'Искането за анулиране е отказано')
        expect(p.locator('.page-head .badge').first).to_have_text('Платена')
        e2 = booking_row(EA2)
        assert e2['status'] == 'confirmed' and e2['refunded'] == 0 and e2['refund_pending'] == 0 and e2['client_funds'] == 68000 and not e2['cancellation'], e2
        assert val("select string_agg(status::text, ',') from partner_cancellation_request where booking_id = $1", e2['id']) == 'declined'
        assert val("select status::text from job where dedupe_key = $1", f"booking:{e2['id']}:complete") == 'pending'
        assert outbox('client-vendor-cancelled', MARIA, EA2) == [] and outbox('vendor-cancel-completed', MELODIA, EA2) == []
        p = melodia.go('/partner/rezervacii/' + quote(EA2))
        expect(p.locator('.page-head .badge').first).to_have_text('Потвърдена')
        expect(p.locator('.panel-actions button:has-text("Анулиране")')).to_have_count(1)
        p = maria.go('/akaunt/rezervacii/' + quote(EA2))
        expect(p.locator('.h-right .badge')).to_have_text('Потвърдена')
        expect(calendar_day(melodia, dec19).locator('.chip--booked')).to_have_count(1)
        ledger_invariants('after K10')
        step(f'K10: a second request ({EA2}) → ‹Откажи анулирането› → confirmed again, money untouched, completion re-armed, the date stays booked')

        # ════ 3. Payment deadline: an approved request nobody pays; ‹Удължи срока› before expiry ═══
        d_exp, d_ext, d_ext2 = (T0 + dt.timedelta(days=n) for n in (30, 32, 34))
        n_exp = send_request(maria, 'studio-melodiya', event_type='Рожден ден', day=d_exp, package='Пакет „Вечер“')
        approve(melodia, 'Мария Димитрова', d_exp, n_exp)
        n_ext = send_request(maria, 'studio-melodiya', event_type='Рожден ден', day=d_ext, package='Пакет „Вечер“')
        approve(melodia, 'Мария Димитрова', d_ext, n_ext)
        n_ext2 = send_request(maria, 'studio-melodiya', event_type='Рожден ден', day=d_ext2, package='Пакет „Вечер“')
        approve(melodia, 'Мария Димитрова', d_ext2, n_ext2)
        p = maria.go('/akaunt/zayavki')
        pay_group = p.locator('.mine').filter(has=p.locator('.mine-t:text-is("Одобрени · чакат плащане")'))
        for n in (n_exp, n_ext, n_ext2):
            expect(pay_group.locator('.mrow').filter(has_text=n)).to_have_count(1)
        cell = calendar_day(melodia, d_exp)
        expect(cell.locator('.chip--hold')).to_have_count(1)
        p = stefka.go(f'/tarsene?kategoriya=dj-i-ozvuchavane&data={d_exp}&druga-data=1')
        card = p.locator('a.v-card:has-text("Студио Мелодия")')
        expect(card.locator('.badge')).to_have_text(f'Зает на {fshort(d_exp)}')
        card.locator('button:has-text("Уведоми ме")').click()
        toast(p, 'Ще ви известим, ако датата се освободи')
        p = petya.go(f'/partnyori/studio-melodiya?data={d_ext2}')
        p.click('.book button:has-text("Уведоми ме, ако се освободи")')
        toast(p, 'Ще ви известим, ако датата се освободи')
        assert watch_status(STEFKA, 'studio-melodiya', d_exp) == ['watching'] and watch_status(PETYA, 'studio-melodiya', d_ext2) == ['watching']
        step(f'Срок: three requests approved and unpaid ({n_exp}, {n_ext}, {n_ext2}) under ‹Одобрени · чакат плащане›; held in the calendar; watched')

        due = {n: booking_row(n)['payment_due_at'] for n in (n_ext, n_ext2)}
        for n in (n_ext, n_ext2):
            p = admin.go('/admin/rezervacii/' + quote(n))
            expect(p.locator('.page-head .badge').first).to_have_text('Чака плащане')
            p.click('button:has-text("Удължи срока")')
            toast(p, 'Срокът е удължен с 24 часа')
            expect(p.locator('.tl-title:has-text("Срокът е удължен с 24 часа")')).to_have_count(1)
            r = booking_row(n)
            assert r['payment_extensions'] == 1, r
            assert dt.datetime.fromisoformat(r['payment_due_at'].replace('Z', '+00:00')) - dt.datetime.fromisoformat(due[n].replace('Z', '+00:00')) == dt.timedelta(hours=24), (r, due[n])
            exp_job = one("select status::text, run_at from job where dedupe_key = $1", f"booking:{r['id']}:payexpire")
            assert exp_job['status'] == 'pending' and exp_job['run_at'] == r['payment_due_at'], exp_job
            assert len(outbox('client-payment-extended', MARIA, n)) == 1 and len(outbox('vendor-payment-deadline-extended', MELODIA, n)) == 1
        p = maria.go('/akaunt/zayavki/' + quote(n_ext))
        expect(p.locator('.clock-v')).to_have_text(re.compile(r'^4\d:\d\d$'))
        expect(p.locator('body')).to_contain_text('платете в рамките на 48 часа')
        bell_has(maria, 'Срокът за плащане е удължен')
        bell_has(melodia, 'Срокът за плащане е удължен с 24 часа')
        step('Екип: ‹Удължи срока› on two of them → +24 h, T8 moved, emails and bells to Мария and the partner; Мария sees the new countdown')

        p = admin.go('/admin/nastroyki')
        p.click('.ops-clock-acts button:has-text("+1 ден")')
        toast(p, 'Промените са запазени')
        expect(p.locator('.ops-clock-v')).to_contain_text('1 септември 2025')
        time.sleep(6)  # every server-side clock cache has moved on
        be = booking_row(n_exp)
        assert be['status'] == 'payment_expired', be
        assert booking_row(n_ext)['status'] == 'awaiting_payment' and booking_row(n_ext2)['status'] == 'awaiting_payment'
        m = outbox('client-payment-expired', MARIA, n_exp)
        assert len(m) == 1 and 'в рамките на 24 часа' in norm(m[0]['text']), m
        m = outbox('vendor-hold-expired', MELODIA, n_exp)
        assert len(m) == 1, m
        assert len(bells(MARIA, 'client-payment-expired', n_exp)) == 1 and len(bells(MELODIA, 'vendor-hold-expired', n_exp)) == 1
        step('Часовник: the admin moves the demo clock +1 ден → the unextended request expires (payment_expired, emails, bells); the extended ones wait')

        p = maria.go('/akaunt/zayavki')
        closed = p.locator('.mine').filter(has=p.locator('.mine-t:text-is("Приключени")'))
        expect(closed.locator('.mrow').filter(has_text=n_exp).locator('.badge')).to_have_text('Изтекъл срок за плащане')
        p = maria.go('/akaunt/zayavki/' + quote(n_exp))
        expect(p.locator('.sh-t')).to_have_text('Срокът за плащане изтече')
        expect(p.locator('body')).to_contain_text('в рамките на 24 часа')
        r = maria.page.goto(BASE + '/plashtane/' + quote(n_exp))
        assert maria.path() == '/akaunt/zayavki/' + n_exp, maria.path()
        p = melodia.go('/partner/zayavki/' + quote(n_exp))
        expect(p.locator('.page-head .badge').first).to_have_text('Неплатена заявка — датата е освободена')
        bell_has(melodia, f'Датата {fdate(d_exp)} е освободена')
        expect(calendar_day(melodia, d_exp)).to_have_attribute('aria-label', f'{d_exp.day} · Свободно')
        p = stefka.go(f'/tarsene?kategoriya=dj-i-ozvuchavane&data={d_exp}')
        expect(p.locator('a.v-card:has-text("Студио Мелодия") .badge:has-text("Зает")')).to_have_count(0)
        expect(p.locator('a.v-card:has-text("Студио Мелодия")')).to_have_count(1)
        assert watch_status(STEFKA, 'studio-melodiya', d_exp) == ['notified']
        assert any(norm(x['vars']['eventDate']) == fdate(d_exp) for x in outbox('client-date-freed', STEFKA))
        shoot(b, maria, 'client-requests-after-expiry', '/akaunt/zayavki')
        step('After expiry: ‹Приключени› / ‹Изтекъл срок за плащане› for Мария, no way to pay; ‹Неплатена заявка…› for the partner; the date free; Стефка told')

        pay(maria, n_ext, 64000)
        bx = booking_row(n_ext)
        assert bx['status'] == 'confirmed' and bx['paid'] == 64000 and bx['commission_bp'] == 1000, bx
        # The team's record counts the window the client really had (24 + 24 hours).
        p = admin.go('/admin/rezervacii/' + quote(n_ext))
        expect(p.locator('.tl-item').filter(has_text='Плащането постъпи в платформата')).to_contain_text('в срока от 48 часа')
        ledger_invariants('after the extended payment')
        step(f'{n_ext}: paid inside the extended window → confirmed (‹в срока от 48 часа› for the team); ledger ok')

        p = admin.go('/admin/nastroyki')
        p.click('.ops-clock-acts button:has-text("+1 ден")')
        toast(p, 'Промените са запазени')
        expect(p.locator('.ops-clock-v')).to_contain_text('2 септември 2025')
        time.sleep(6)
        assert booking_row(n_ext2)['status'] == 'payment_expired'
        m = outbox('client-payment-expired', MARIA, n_ext2)
        # It had 48 hours (24 + the team's 24): the email and the page say so.
        assert len(m) == 1 and 'в рамките на 48 часа' in norm(m[0]['text']), m[0]['text'] if m else m
        p = maria.go('/akaunt/zayavki/' + quote(n_ext2))
        expect(p.locator('body')).to_contain_text('в рамките на 48 часа')
        assert watch_status(PETYA, 'studio-melodiya', d_ext2) == ['notified']
        expect(calendar_day(melodia, d_ext2)).to_have_attribute('aria-label', f'{d_ext2.day} · Свободно')
        ledger_invariants('after the second clock move')
        step(f'+1 ден again: the extended {n_ext2} expires at its new deadline; the texts count 48 hours; Петя told; ledger ok')

        # ════ 4. The kept money reaches the partner the day after the event (§5.4, D11) ═══
        ana_pid = val("select id from partner where slug = 'ana-petrova-photography'")
        payable0 = int(val("select coalesce(sum(credit_cents - debit_cents), 0)::bigint from ledger_entry where account = 'partner_payable' and partner_id = $1", ana_pid))
        p = admin.go('/admin/nastroyki')
        for label, shown in (('+7 дни', '9 септември 2025'), ('+1 ден', '10 септември 2025'), ('+1 ден', '11 септември 2025')):
            p.click(f'.ops-clock-acts button:has-text("{label}")')
            toast(p, 'Промените са запазени')
            expect(p.locator('.ops-clock-v')).to_contain_text(shown)
            p.wait_for_timeout(3500)  # the toast goes, so the next one is a new toast
        time.sleep(6)
        bs = booking_row(n_str)
        assert bs['client_funds'] == 0 and bs['status'] == 'cancelled', bs
        payable = int(val("select coalesce(sum(credit_cents - debit_cents), 0)::bigint from ledger_entry where account = 'partner_payable' and partner_id = $1", ana_pid))
        assert payable - payable0 == 180500, (payable0, payable)
        rev = int(val("select coalesce(sum(credit_cents - debit_cents), 0)::bigint from ledger_entry where account = 'commission_revenue' and booking_id = $1", bs['id']))
        assert rev == 9500, rev
        line = one("select status::text, batch_date::text, base_cents, commission_cents, amount_cents from payout_line where booking_id = $1", bs['id'])
        assert line == {'status': 'ready', 'batch_date': '2025-09-15', 'base_cents': 190000, 'commission_cents': 9500, 'amount_cents': 180500}, line
        assert booking_row(n_mod)['client_funds'] == 19200  # its event (20 септември) is still ahead
        p = ana.go('/partner/rezervacii/' + quote(n_str))
        expect(p.locator('.split.is-total b')).to_have_text(money(180500))
        expect(p.locator('.tl-title').filter(has_text='Изплащането предстои')).to_have_count(1)
        expect(p.locator('.tl-item').filter(has_text='Изплащането предстои')).to_contain_text(f'15 септември 2025 · {money(180500)}')
        no_commission_for_partner(ana, '/partner/rezervacii/' + quote(n_str), '/partner/prihodi')
        ledger_invariants('after the release of the kept amount')
        step(f'11 септември: the kept 1 900 € of {n_str} is released — 1 805 € to the partner (batch 15 септември), 95 € commission; the Умерена 192 € still waits; ledger ok')

        # ════ 5. The risky steps the way people really click ════════════════════
        risky_steps(b, maria, melodia, admin, n_ext)

        leaks = sql("select template_key, to_email from email_outbox where audience = 'partner' and (text ilike '%омисион%' or html ilike '%омисион%')")
        assert not leaks, f'commission in partner emails: {leaks}'
        for x in people: assert not x.errors, (x.email, x.errors)
        step('no partner email mentions commission; no page error or console error for anyone')
        b.close()
    print(f'\nJ2 passed: {STEP[0]} steps')


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except BaseException as e:
        print(f'  ✗ {STEP[0] + 1:02d} FAILED: {type(e).__name__}: {e}', flush=True)
        traceback.print_exc()
        sys.exit(1)
