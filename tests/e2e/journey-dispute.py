#!/usr/bin/env python3
"""Journey J3 — disputes (сигнали), across the client account, the partner panel and the admin panel.

Usage: python3 tests/e2e/journey-dispute.py [--base http://localhost:3303] [--no-reset] [--headed] [--shots DIR]

Resets and seeds the database named in .env.local, then plays the cases the way the three people meet them,
each in their own browser context (Мария Димитрова — client, Студио Мелодия — partner, Моника Ковачева — admin),
with real clicks and typing. Every step asserts what the person sees and the database effect:

  1. Мария opens a case on her confirmed booking 2026-0614-ЕА from /akaunt/poddrazhka/nov (reason, description,
     two photos) → the partner is told (email + bell) and the team sees it on /admin/sporove with the money held;
     Студио Мелодия sends a position with a photo; the team asks both sides for more; Мария answers.
  2. The clock moves past the event: the booking completes but its payout line stays held (the batch shows it
     ‹Задържано› · ‹Виж спора›). The team decides a partial refund with a motive → both sides see the decision
     and the motive and get the emails; the refund is made; the line is released at the decided amount and the
     batch pays exactly that (commission on what the partner keeps; never shown to the partner).
  3. Студио Мелодия opens a case on 2026-1219-ЕА (‹Клиентът не отговаря›); 48 hours pass on the demo clock with no
     statement from Мария → ‹Чака решение› + team-dispute-deadline; the team obliges her to keep to the booking.
  4. Мария opens a third case (2026-1219-ТД) and withdraws it → the payout returns to its schedule.
  5. The step that moves money, the way people really use it: Ивелина Тодорова opens a case on her 390 px phone with a
     double tap (one case, one set of emails), presses ‹Назад› (the form address opens the case, never a form on her
     other booking that night); the partner double-taps the position; the team has the case open in two tabs —
     tab A double-clicks a partial refund (one decision, one refund), the stale tab B on a phone is refused, and
     ‹Назад› in tab A shows the decided case. Before the event the partner's ‹Получавате› follows the decision.
     ‹Пусни партидата› in part 2 is double-clicked too (one release).
  6. Another client and another partner get 404 on these case pages, and cannot read the evidence.

Screenshots of the key moments at 1440 and 390 px go to --shots (default .data/e2e/journey-dispute).
Prints one line per step; exits non-zero on the first failure.
"""
import json, os, re, struct, subprocess, sys, tempfile, time, traceback, zlib
from pathlib import Path
from urllib.parse import quote, unquote, urlparse
from urllib.request import Request, urlopen
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
NODE_BIN = Path.home() / 'nodejs22' / 'bin'
PW = 'eventat-demo'
CLIENT, PARTNER, ADMIN = 'maria.dimitrova@gmail.com', 'studio.melodia@gmail.com', 'monika.kovacheva@eventat.bg'
OTHER_CLIENT, OTHER_PARTNER, MED_PARTNER = 'stefka.ilieva@gmail.com', 'snap360@example.invalid', 'sladkarnitsa-med-i-mlyako@example.invalid'
CASE1, CASE2, CASE3 = '2026-0614-ЕА', '2026-1219-ЕА', '2026-1219-ТД'
# Part 5: Ивелина Тодорова's catering on 28 June 2026 (she also has Snap360 that night, 2026-0628-ФК).
CASE4, IVELINA, VKUSNA = '2026-0628-КТ', 'i.todorova@abv.bg', 'vkusna-istoriya@example.invalid'
PHONE = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='bg-BG', timezone_id='Europe/Sofia')
NBSP = ' '


def env_file():
    out = {}
    for line in (ROOT / '.env.local').read_text().splitlines():
        m = re.match(r'^([A-Z0-9_]+)=(.*)$', line.strip())
        if m: out[m.group(1)] = m.group(2).strip().strip('"')
    return out


ENV = env_file()
DB_URL = ENV['DATABASE_URL']
assert re.search(r'@(127\.0\.0\.1|localhost)[:/]', DB_URL), 'local databases only'


def sql(query, *params):
    """Run a query through the repo's postgres client; rows as dicts."""
    script = ("const p=require(process.argv[1]);const s=p(process.argv[2],{max:1,onnotice:()=>{}});"
              "s.unsafe(process.argv[3],JSON.parse(process.argv[4])).then(r=>{process.stdout.write(JSON.stringify(r));return s.end()})"
              ".catch(e=>{console.error(e.message);process.exit(1)})")
    r = subprocess.run([str(NODE_BIN / 'node'), '-e', script, str(ROOT / 'node_modules' / 'postgres'), DB_URL, query, json.dumps(list(params))],
                       capture_output=True, text=True)
    if r.returncode: raise RuntimeError(f'SQL failed: {query}\n{r.stderr}')
    return json.loads(r.stdout or '[]')


def one(query, *params):
    rows = sql(query, *params)
    assert rows, f'no row for {query} {params}'
    return rows[0]


def scalar(query, *params):
    return list(one(query, *params).values())[0]


def reset_db():
    env = {**os.environ, 'PATH': f'{NODE_BIN}:{os.environ["PATH"]}', 'DATABASE_URL': DB_URL}
    for cmd in (['npm', 'run', 'db:reset'], ['npm', 'run', 'db:seed']):
        subprocess.run(cmd, cwd=ROOT, env=env, check=True, capture_output=True)
    time.sleep(6)  # the server caches the clock offset for 5 s


def png(path, rgb, size=8):
    """A small valid PNG (media.upload() checks the signature)."""
    raw = b''.join(b'\x00' + bytes(rgb) * size for _ in range(size))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    Path(path).write_bytes(data)
    return str(path)


STEPS = []


def step(name):
    STEPS.append(name)
    print(f'  ok  {len(STEPS):>2}. {name}', flush=True)


def toast(page, text, timeout=15_000):
    expect(page.locator('.ui-toast.is-on')).to_contain_text(text, timeout=timeout)


def sign_in(ctx, base, email):
    r = ctx.request.post(base + '/api/auth/sign-in/email', data={'email': email, 'password': PW}, headers={'Origin': base})
    assert r.ok, f'sign-in {email} failed: {r.status} {r.text()[:200]}'


def path_of(page):
    return unquote(urlparse(page.url).path)


def emails(key, number=None, to=None):
    q = 'select id, to_email, subject, text, vars, status from email_outbox where template_key = $1'
    args = [key]
    if number:
        q += " and (vars->>'bookingNo' = $2 or vars->>'caseNo' = $2 or vars->>'caseId' = $2 or vars->>'bookingId' = $2)"
        args.append(number)
    if to:
        q += f' and to_email = ${len(args) + 1}'
        args.append(to)
    return sql(q + ' order by created_at', *args)


def cta_url(mail, label):
    """The URL behind the email's button (the text part writes it as ‹Label: URL›)."""
    m = re.search(rf'^{re.escape(label)}: (\S+)$', mail['text'], re.M)
    assert m, f'no ‹{label}› button in {mail["subject"]!r}:\n{mail["text"]}'
    return m.group(1)


def follow_email(page, base, mail, label):
    """Open the email's button link as the person would (same origin, their session)."""
    u = urlparse(cta_url(mail, label))
    page.goto(base + u.path + (('?' + u.query) if u.query else ''))
    return path_of(page)


def bell_has(page, title):
    """Open the bell and find the notice; returns its link (or None)."""
    page.click('button[aria-label="Известия"]')
    note = page.locator('.ui-menu .ui-note', has_text=title).first
    expect(note).to_be_visible()
    href = note.get_attribute('href')
    page.keyboard.press('Escape')
    return href


def cents_of(text):
    """‹2 070 €› / ‹1 305,00 €› → cents."""
    t = re.sub(r'[\s\u00a0€]', '', text).replace(',', '.')
    return round(float(t) * 100)


def no_page_scroll_x(page, width):
    sw = page.evaluate('document.scrollingElement.scrollWidth')
    assert sw <= width, f'horizontal page scroll on {page.url}: {sw} > {width}'


SHOTS = None


def shot(page, name, focus=None):
    """The key moment at 1440 and 390 px — the whole page, or the viewport around `focus` — and no sideways scroll at 390."""
    page.wait_for_load_state('networkidle')
    for w, h in ((1440, 900), (390, 844)):
        page.set_viewport_size({'width': w, 'height': h})
        page.wait_for_timeout(250)
        if w == 390: no_page_scroll_x(page, 390)
        if focus:
            page.locator(focus).first.scroll_into_view_if_needed()
            page.wait_for_timeout(150)
        page.screenshot(path=str(SHOTS / f'{name}-{w}.png'), full_page=not focus)
    page.set_viewport_size({'width': 1440, 'height': 900})
    page.wait_for_timeout(150)


def shot_phone(page, name, focus=None):
    """A page used on the 390 px phone: no sideways scroll, and the screenshot as the person sees it."""
    page.wait_for_load_state('networkidle')
    no_page_scroll_x(page, 390)
    if focus:
        page.locator(focus).first.scroll_into_view_if_needed()
        page.wait_for_timeout(150)
    page.screenshot(path=str(SHOTS / f'{name}-390.png'), full_page=not focus)


def settled_toast(page, text):
    """The success toast shows and stays the only outcome: a second submit (double click) must not
    follow it with a refusal."""
    toast(page, text)
    page.wait_for_timeout(1500)
    t = page.locator('.ui-toast')
    assert 'ui-toast--error' not in (t.get_attribute('class') or ''), t.inner_text()


def set_clock(sofia_local):
    """Move the demo clock to a Sofia wall time (ALLOW_TIME_TRAVEL), as Админ → Настройки does in steps."""
    # $1 travels as text: the driver would turn a bare timestamp string into a JS Date in the machine's zone first.
    # effective_from = the new business time, so the setting reads (getSetting) agree with the clock (lib/clock).
    sql("insert into platform_settings (key, value, effective_from) select 'clock_offset_ms', "
        "to_jsonb((extract(epoch from (t - now())) * 1000)::bigint), t from (select ($1::text)::timestamp at time zone 'Europe/Sofia' t) x", sofia_local)
    time.sleep(6)


def tick(base, rounds=60):
    """What Vercel Cron does every minute: /api/cron/tick runs the due jobs and delivers the emails."""
    total = 0
    for _ in range(rounds):
        req = Request(base + '/api/cron/tick', headers={'Authorization': f'Bearer {ENV["CRON_SECRET"]}'})
        with urlopen(req, timeout=300) as r:
            out = json.loads(r.read())
        n = out['jobs']['ran'] + out['jobs']['failed']
        total += n
        if n == 0: break
    return total


def now_sofia():
    return scalar("select to_char((now() + (select (value::text)::bigint from platform_settings where key = 'clock_offset_ms' "
                  "order by effective_from desc, created_at desc limit 1) * interval '1 millisecond') at time zone 'Europe/Sofia', 'YYYY-MM-DD HH24:MI') t")


def balance(account, booking=None, partner=None):
    """Ledger balance in its natural sign (assets debit − credit, the rest credit − debit)."""
    sign = 'e.debit_cents - e.credit_cents' if account in ('provider_held', 'partner_receivable', 'platform_cash') else 'e.credit_cents - e.debit_cents'
    q = f'select coalesce(sum({sign}), 0)::int b from ledger_entry e join ledger_transaction t on t.id = e.transaction_id where e.account = $1'
    args = [account]
    if booking:
        q += ' and coalesce(e.booking_id, t.booking_id) = (select id from booking where number = $2)'
        args.append(booking)
    if partner:
        q += f' and e.partner_id = (select id from partner where business_name = ${len(args) + 1})'
        args.append(partner)
    return scalar(q, *args)


def main():
    global SHOTS
    args = sys.argv[1:]
    base = args[args.index('--base') + 1] if '--base' in args else 'http://localhost:3303'
    SHOTS = Path(args[args.index('--shots') + 1]) if '--shots' in args else ROOT / '.data' / 'e2e' / 'journey-dispute'
    SHOTS.mkdir(parents=True, exist_ok=True)
    if '--no-reset' not in args:
        print('resetting', DB_URL.rsplit('/', 1)[-1], flush=True)
        reset_db()
    tmp = Path(tempfile.mkdtemp())
    hall, program, setlist, receipt, answer, menu = (png(tmp / n, c) for n, c in [
        ('zala-pravila.png', (200, 180, 160)), ('programa.png', (40, 40, 90)), ('setlist.png', (90, 140, 90)),
        ('dogovor.png', (150, 120, 60)), ('saobshtenie.png', (160, 60, 60)), ('menyu.png', (60, 120, 160))])

    with sync_playwright() as p:
        b = p.chromium.launch(headless='--headed' not in args)
        opts = dict(viewport={'width': 1440, 'height': 900}, locale='bg-BG', timezone_id='Europe/Sofia')
        errors = []

        def person(email, phone=False):
            ctx = b.new_context(**(PHONE if phone else opts))
            ctx.set_default_navigation_timeout(120_000)  # a dev server compiles a route on its first visit
            sign_in(ctx, base, email)
            return ctx, tab(ctx, email)

        def tab(ctx, email):
            pg = ctx.new_page()
            pg.on('pageerror', lambda e: errors.append(f'{email} {pg.url}: {e}'))
            pg.on('response', lambda r: errors.append(f'{email} {r.status} {r.url}') if r.status >= 500 else None)
            return pg

        client, cp = person(CLIENT)
        partner, pp = person(PARTNER)
        admin, ap = person(ADMIN)

        def no_errors():
            assert not errors, errors

        # ══ 1. The client opens a case; the partner answers; the team asks for more ═════════════════════
        held0 = one("select count(*)::int n, coalesce(sum(held_cents), 0)::int s from dispute where status in ('collecting', 'awaiting_decision')")
        cp.goto(base + '/akaunt/rezervacii/' + quote(CASE1))
        expect(cp.locator('h1.h-page')).to_contain_text(CASE1)
        cp.click('a:has-text("Сигнал до екипа")')
        cp.wait_for_url('**/akaunt/poddrazhka/nov?rezervaciya=**')
        expect(cp.locator('.dp-pick.is-on')).to_contain_text(CASE1)
        expect(cp.locator('.dp-pick.is-on')).to_contain_text('Студио Мелодия')
        cp.click('.opt:has-text("Услугата не беше по описание")')
        expect(cp.locator('.opt.is-on')).to_have_text('Услугата не беше по описание')
        desc1 = ('Студио Мелодия ни писа, че на 14 юни може да остане само до 22:00, а пакетът „Цял ден“ е до 02:00 '
                 'и така пише в резервацията. Прилагам правилата на залата и програмата на вечерта.')
        cp.fill('#dp-description', desc1)
        with cp.expect_file_chooser(timeout=5_000) as fc:
            cp.click('.rw-drop-t')
        fc.value.set_files([hall, program])
        expect(cp.locator('.ms-drop .ms-shot')).to_have_count(2, timeout=15_000)
        toast(cp, 'Снимката е прикачена към сигнала')
        shot(cp, '01-client-form', '.ms-drop')
        cp.click('button:has-text("Изпрати сигнала")')
        cp.wait_for_url(re.compile(r'/akaunt/rezervacii$'))
        toast(cp, 'Сигналът е изпратен — екипът отговаря до 24 часа')
        d1 = one('''select d.id, d.status, d.opened_by, d.reason, d.holds_payout, d.held_cents, d.position_from,
                    (select count(*)::int from dispute_attachment a where a.dispute_id = d.id) files,
                    b.payout_hold, (select status from payout_line l where l.booking_id = b.id and l.charge_id is null) line
                    from dispute d join booking b on b.id = d.booking_id where d.number = $1''', CASE1)
        assert (d1['status'], d1['opened_by'], d1['reason'], d1['holds_payout'], d1['held_cents'], d1['position_from'], d1['files']) == \
            ('collecting', 'client', 'not_as_described', True, 145000, 'partner', 2), d1
        assert d1['payout_hold'] is True and d1['line'] == 'held', d1
        assert scalar("select count(*)::int from job where dedupe_key = $1 and status = 'pending'", f'dispute:{d1["id"]}:position') == 1
        assert len(emails('client-dispute-opened', CASE1, CLIENT)) == 1
        assert len(emails('vendor-ticket-client-opened', CASE1)) == 1
        team_new = emails('team-dispute-new', CASE1)
        assert team_new and any(m['to_email'] == ADMIN for m in team_new), team_new
        step('client: booking → ‹Сигнал до екипа› → reason, description, 2 photos → ‹Изпрати сигнала›: toast, case collecting, payout held, T15 armed, the three emails')

        cp.goto(base + '/akaunt/rezervacii/' + quote(CASE1))
        expect(cp.locator('a:has-text("Анулиране")')).to_have_count(0)
        cp.click('a:has-text("Сигнал до екипа")')   # one case per booking: the button now opens it
        cp.wait_for_url(f'**/akaunt/poddrazhka/{quote(CASE1)}')
        cp.goto(base + '/akaunt/poddrazhka')
        row = cp.locator('.dp-case', has_text='Студио Мелодия')
        expect(row).to_contain_text('Услугата не беше по описание')
        expect(row.locator('.badge')).to_have_text('Събираме данни')
        expect(cp.locator('.dp-pick', has_text=CASE1)).to_have_count(0)
        mail = emails('client-dispute-opened', CASE1, CLIENT)[0]
        assert follow_email(cp, base, mail, 'Моите сигнали') == f'/akaunt/poddrazhka/{CASE1}', cp.url
        expect(cp.locator('h1.h-page')).to_have_text('Услугата не беше по описание')
        expect(cp.locator('.h-right .badge')).to_have_text('Събираме данни')
        expect(cp.locator('.clock-l')).to_have_text('Срок за изпълнителя')
        expect(cp.locator('.cs-party').first.locator('.cs-att-i')).to_have_count(2)
        expect(cp.locator('.cs-money-v')).to_have_text(f'1{NBSP}450 €')
        step('client: no ‹Анулиране› while the case is open and ‹Сигнал до екипа› opens the case; ‹Моите сигнали› lists it; the email button opens the case (2 photos, 1 450 € held, the partner\'s deadline)')

        pp.goto(base + '/partner')
        href = bell_has(pp, 'Клиентът изпрати сигнал по ваша резервация')
        assert unquote(href or '') == f'/partner/poddrazhka/{CASE1}', href
        mail = emails('vendor-ticket-client-opened', CASE1)[0]
        assert mail['to_email'] == scalar("select notification_email from partner where business_name = 'Студио Мелодия'"), mail['to_email']
        assert follow_email(pp, base, mail, 'Изпрати позицията') == f'/partner/poddrazhka/{CASE1}', pp.url
        expect(pp.locator('.page-head-right .badge')).to_have_text('Събираме данни')
        expect(pp.locator('.countdown-label')).to_have_text('Срок за изпълнителя')
        client_side = pp.locator('.cs-party').first
        expect(client_side.locator('.cs-quote')).to_contain_text('само до 22:00')
        pics = client_side.locator('.cs-att-i')
        expect(pics).to_have_count(2)
        evidence = [pics.nth(i).get_attribute('href') for i in range(2)]
        for h in evidence:
            assert partner.request.get(base + h).status == 200, f'the partner cannot open the client\'s evidence {h}'
        expect(pp.locator('body')).not_to_contain_text('Комисиона')
        step('partner: bell ‹Клиентът изпрати сигнал…› and the email button open the case; the statement and both photos are readable')

        ap.goto(base + '/admin')
        expect(ap.locator('.side a:has-text("Спорове")')).to_contain_text(str(held0['n'] + 1))
        ap.click('button[aria-label="Известия"]')
        note = ap.locator('.ui-menu .ui-note', has_text='отворени спора')
        expect(note).to_contain_text(f'{held0["n"] + 1} отворени спора')
        held_sum = held0['s'] + 145000
        expect(note).to_contain_text(f'{held_sum // 100:,} € задържани'.replace(',', NBSP))
        ap.keyboard.press('Escape')
        ap.goto(base + '/admin/sporove')
        expect(ap.locator('.page-sub')).to_contain_text(f'{held0["n"] + 1} отворени · {held_sum // 100:,} € задържани'.replace(',', NBSP))
        case_row = ap.locator('.case', has_text=CASE1)
        expect(case_row).to_contain_text('Услугата не беше по описание')
        expect(case_row.locator('.case-amt')).to_have_text(f'1{NBSP}450 €')
        mail = next(m for m in emails('team-dispute-new', CASE1) if m['to_email'] == ADMIN)
        assert follow_email(ap, base, mail, 'Отвори кейса') == f'/admin/sporove/{CASE1}', ap.url
        expect(ap.locator('.topbar-title')).to_have_text(f'Кейс{NBSP}·{NBSP}№{NBSP}{CASE1}')
        # the topbar search is drawn as a field here too, not as a bare browser input inside the pill
        assert ap.locator('.topbar .ops-search input').evaluate('e => getComputedStyle(e).borderTopWidth') == '0px'
        expect(ap.locator('.cs-money-v')).to_have_text(f'1{NBSP}450 €')
        expect(ap.locator('.cs-money-l')).to_have_text('платени и задържани от платформата')
        expect(ap.locator('.cs-party').first.locator('.cs-att-i')).to_have_count(2)
        expect(ap.locator('.cs-party.is-vendor .cs-wait')).to_contain_text('Още не е отговорил')
        shot(ap, '02-admin-case-open')
        step('admin: rail and bell count the new case with its 1 450 € held; /admin/sporove lists it; the email opens the case with both photos and the partner\'s wait')

        pp.goto(base + '/partner/poddrazhka/' + quote(CASE1))
        pp.fill('textarea[name=body]', 'Договорихме до 22:00, защото залата спира музиката тогава — прилагаме програмата, която клиентите подписаха.')
        with pp.expect_file_chooser(timeout=5_000) as fc:
            pp.click('.dp-drop-t')
        fc.value.set_files([setlist])
        expect(pp.locator('.gal-item.ms-shot')).to_have_count(1, timeout=15_000)
        toast(pp, 'Снимката е прикачена към сигнала')
        pp.click('button:has-text("Изпрати позицията")')
        toast(pp, 'Съобщението е изпратено')
        expect(pp.locator('.page-head-right .badge')).to_have_text('Чака решение')
        d = one("select status from dispute where number = $1", CASE1)
        assert d['status'] == 'awaiting_decision', d
        assert scalar("select count(*)::int from job where dedupe_key = $1 and status = 'pending'", f'dispute:{d1["id"]}:position') == 0, 'T15 still armed after the position'
        assert len(emails('team-dispute-reply', CASE1)) >= 1
        shot(pp, '03-partner-position')
        ap.goto(base + '/admin/sporove/' + quote(CASE1))
        expect(ap.locator('.page-head-right .badge').last).to_have_text('Чака решение')
        vendor = ap.locator('.cs-party.is-vendor')
        expect(vendor.locator('.cs-quote')).to_contain_text('до 22:00')
        expect(vendor.locator('.cs-att-i')).to_have_count(1)
        step('partner: ‹Изпрати позицията› with a photo → ‹Чака решение›, T15 cancelled, team-dispute-reply; the team sees the position and the photo')

        ap.click('button:has-text("Поискай още информация")')
        dlg = ap.locator('dialog[open]')
        question = 'Моля, изпратете договора или съобщението, в което е записан часът на края — до 22:00 или до 02:00.'
        dlg.locator('textarea[name="question"]').fill(question)
        dlg.locator('button[type="submit"]').click()
        toast(ap, 'Въпросът е изпратен до двете страни')
        assert len(emails('client-dispute-info-request', CASE1, CLIENT)) == 1
        assert len(emails('vendor-ticket-info-request', CASE1)) == 1
        assert scalar("select count(*)::int from dispute_message m join dispute d on d.id = m.dispute_id where d.number = $1 and m.kind = 'question'", CASE1) == 1
        step('admin: ‹Поискай още информация› → toast, the question stored, client-dispute-info-request and vendor-ticket-info-request')

        cp.goto(base + '/akaunt')
        href = bell_has(cp, 'Екипът има въпрос по сигнала ви')
        mail = emails('client-dispute-info-request', CASE1, CLIENT)[0]
        assert follow_email(cp, base, mail, 'Отговори') == f'/akaunt/poddrazhka/{CASE1}', cp.url
        expect(cp.locator('body')).to_contain_text(question)
        cp.fill('#st-body', 'Прилагам снимка на договора — в него пише „до 02:00“.')
        with cp.expect_file_chooser(timeout=5_000) as fc:
            cp.click('.form-card .rw-drop-t')
        fc.value.set_files([receipt])
        expect(cp.locator('.form-card .ms-shot')).to_have_count(1, timeout=15_000)
        cp.click('.form-card button:has-text("Изпрати")')
        toast(cp, 'Съобщението е изпратено')
        expect(cp.locator('.cs-party').first.locator('.cs-quote')).to_have_count(2)
        assert scalar('''select count(*)::int from dispute_message m join dispute d on d.id = m.dispute_id
                         where d.number = $1 and m.kind = 'statement' and m.party = 'client' ''', CASE1) == 2
        pp.goto(base + '/partner/poddrazhka/' + quote(CASE1))
        expect(pp.locator('.cs-party').first.locator('.cs-quote')).to_have_count(2)
        expect(pp.locator('body')).to_contain_text(question)
        ap.goto(base + '/admin/sporove/' + quote(CASE1))
        expect(ap.locator('.cs-party').first.locator('.cs-quote')).to_have_count(2)
        expect(ap.locator('.cs-party').first.locator('.cs-att-i')).to_have_count(3)
        shot(cp, '04-client-answer')
        no_errors()
        step('client: the bell and ‹Отговори› open the case with the question; the answer with a photo reaches the partner\'s and the team\'s pages')

        # ══ 2. Past the event: held; the decision; the refund; the payout at the decided amount ══════════
        set_clock('2026-06-15 08:00')
        ran = tick(base)
        assert ran > 0
        failed = sql("select kind, last_error from job where last_error is not null")
        assert not failed, failed
        bk = one('''select b.status, b.payout_hold, l.status line, l.hold_reason, l.amount_cents, l.payout_item_id is not null in_item
                    from booking b join payout_line l on l.booking_id = b.id and l.charge_id is null where b.number = $1''', CASE1)
        assert bk['status'] == 'completed' and bk['payout_hold'] is True and bk['line'] == 'held' and bk['hold_reason'] == 'dispute', bk
        assert balance('client_funds', CASE1) == 145000, 'money left client_funds while the case holds it'
        batch = one("select id, status, held_cents from payout_batch where batch_date = '2026-06-15'")
        assert batch['status'] == 'ready', batch
        item = one('''select i.status, i.hold_reason, i.amount_cents, d.number from payout_item i join partner p on p.id = i.partner_id
                      left join dispute d on d.id = i.dispute_id where i.batch_id = $1 and p.business_name = 'Студио Мелодия' ''', batch['id'])
        assert (item['status'], item['hold_reason'], item['amount_cents'], item['number']) == ('held', 'dispute', 130500, CASE1), item
        ap.goto(base + '/admin/plashtaniya')
        mel = ap.locator('.batch', has_text='Студио Мелодия')
        expect(mel.locator('.badge')).to_have_text('Задържано')
        expect(mel.locator('.batch-amt')).to_have_text(f'1{NBSP}305,00 €')
        shot(ap, '08a-admin-batch-held', '.batch')
        ap.click('button[aria-label="Известия"]')
        expect(ap.locator('.ui-menu .ui-note', has_text='Партида')).to_contain_text(f'Партида 15 юни 2026')
        ap.keyboard.press('Escape')
        mel.locator('a:has-text("Виж спора")').click()
        ap.wait_for_url(f'**/admin/sporove/{quote(CASE1)}')
        pp.goto(base + '/partner/prihodi')
        prow = pp.locator('.pc-earn tbody tr', has_text='14.06.2026')
        expect(prow.first).to_contain_text(f'1{NBSP}305,00 €')
        expect(pp.locator('body')).not_to_contain_text('Комисиона')
        step(f'clock → 15 юни 2026 08:00 ({ran} jobs): the booking completed but its line stays held; the batch (and the admin bell) show 15 юни with Студио Мелодия ‹Задържано› 1 305,00 € · ‹Виж спора› opens the case')

        ap.goto(base + '/admin/sporove/' + quote(CASE1))
        ap.click('.res-opt:has-text("Частично възстановяване")')
        expect(ap.locator('.res-opt.is-on')).to_contain_text('Частично възстановяване')
        refund_in = ap.locator('input[name="refund"]')
        refund_in.fill('2000')
        expect(ap.locator('.am-decide .split.is-fee b')).to_have_text('—')
        refund_in.fill('450')
        expect(ap.locator('.am-decide .split.is-fee b')).to_have_text(f'1{NBSP}000,00 €')
        motive = ('Договорът и резервацията казват „до 02:00“, а Студио Мелодия ще свири до 22:00. '
                  'Връщаме на Мария 450 € — частта от пакета за четирите часа, които няма да бъдат изпълнени.')
        ap.fill('textarea[name="motive"]', motive)
        shot(ap, '05-admin-decision-form', '.am-decide')
        ap.click('button:has-text("Приложи решението")')
        ap.wait_for_url(re.compile(r'/admin/sporove$'))
        toast(ap, 'Решението е изпратено до двете страни')
        d = one('''select status, decision_kind, decision_title, decision_detail, motive, refund_cents, partner_keeps_cents
                   from dispute where number = $1''', CASE1)
        assert (d['status'], d['decision_kind'], d['refund_cents'], d['partner_keeps_cents'], d['motive']) == \
            ('resolved', 'partial_refund', 45000, 100000, motive), d
        assert d['decision_title'] == f'Частично възстановяване — 450{NBSP}€', d
        rf = one("select r.status, r.amount_cents, r.reason from refund r join booking b on b.id = r.booking_id where b.number = $1", CASE1)
        assert rf['amount_cents'] == 45000 and rf['reason'] == 'dispute_decision', rf
        line = one('''select l.status, l.base_cents, l.commission_cents, l.amount_cents from payout_line l join booking b on b.id = l.booking_id
                      where b.number = $1 and l.charge_id is null''', CASE1)
        assert (line['status'], line['base_cents'], line['commission_cents'], line['amount_cents']) == ('ready', 100000, 10000, 90000), line
        assert one("select payout_hold from booking where number = $1", CASE1)['payout_hold'] is False
        assert len(emails('client-dispute-decision', CASE1, CLIENT)) == 1
        vmail = emails('vendor-ticket-decision', CASE1)
        assert len(vmail) == 1 and vmail[0]['vars']['partnerAmount'] == f'900,00{NBSP}€' and vmail[0]['vars']['refunded'] == f'450,00{NBSP}€', vmail
        assert motive in vmail[0]['text'] and motive in emails('client-dispute-decision', CASE1, CLIENT)[0]['text']
        # the partner's email leads with the decision, not with the client's own words
        assert desc1 not in vmail[0]['text'] and vmail[0]['vars']['account'] == d['decision_detail'], vmail[0]['vars']['account']
        expect(ap.locator('.case', has_text=CASE1)).to_contain_text('Решен')
        ap.click('.seg a:has-text("Отворени")')
        ap.wait_for_url(re.compile(r'filter=otvoreni'))
        expect(ap.locator('.case', has_text=CASE1)).to_have_count(0)
        ap.click('.seg a:has-text("Решени")')
        ap.wait_for_url(re.compile(r'filter=resheni'))
        expect(ap.locator('.case', has_text=CASE1)).to_contain_text('Решен')
        step('admin: ‹Частично възстановяване›, ‹Връща се› 450 € (more than paid → ‹—›), motive → resolved; refund 450 €; line ready 1 000 € − 100 € = 900 €; both emails carry the motive')

        ticks = tick(base)
        rf = one("select r.status from refund r join booking b on b.id = r.booking_id where b.number = $1", CASE1)
        assert rf['status'] == 'succeeded', rf
        sent = [m for m in emails('client-refund-sent', None, CLIENT) if m['vars'].get('bookingNo') == CASE1]
        assert len(sent) == 1, sent
        # the booking stands: no ‹анулираната резервация›, no free-cancellation sentence
        assert f'Върнахме 450,00{NBSP}€ по резервацията при Студио Мелодия' in sent[0]['text'] and 'анулира' not in sent[0]['text'], sent[0]['text']
        ch = one("select c.status, c.refunded_cents from charge c join booking b on b.id = c.booking_id where b.number = $1", CASE1)
        assert ch == {'status': 'partially_refunded', 'refunded_cents': 45000}, ch
        assert balance('client_funds', CASE1) == 0, balance('client_funds', CASE1)
        step(f'cron tick ({ticks} jobs): the refund succeeded at the provider, the charge is partially refunded, client-refund-sent; client funds for the booking are 0')

        cp.goto(base + '/akaunt')
        href = bell_has(cp, 'Екипът реши сигнала ви')
        cp.goto(base + '/akaunt/poddrazhka/' + quote(CASE1))
        expect(cp.locator('.h-right .badge')).to_have_text('Решен')
        expect(cp.locator('.cs-done-n')).to_have_text(f'Частично възстановяване — 450{NBSP}€')
        expect(cp.locator('.cs-done-d')).to_have_text(f'450 € към Мария Димитрова, 1 000 € остават за Студио Мелодия.')
        expect(cp.locator('.cs-motive-t')).to_have_text(motive)
        expect(cp.locator('.cs-money-v')).to_have_text('450 €')
        expect(cp.locator('.cs-money-l')).to_have_text('върнати на клиента')
        expect(cp.locator('form:has(#st-body)')).to_have_count(0)
        shot(cp, '06-client-decision')
        pp.goto(base + '/partner')
        bell_has(pp, 'Екипът реши сигнала')
        pp.goto(base + '/partner/poddrazhka/' + quote(CASE1))
        expect(pp.locator('.page-head-right .badge')).to_have_text('Решен')
        expect(pp.locator('.cs-done-n')).to_have_text(f'Частично възстановяване — 450{NBSP}€')
        expect(pp.locator('.cs-motive-t')).to_have_text(motive)
        expect(pp.locator('body')).not_to_contain_text('Комисиона')
        expect(pp.locator('.cs-done-d')).to_have_text(f'450 € към Мария Димитрова, 1 000 € остават за Студио Мелодия.')
        shot(pp, '07-partner-decision')
        pp.goto(base + '/partner/rezervacii/' + quote(CASE1))
        expect(pp.locator('.vbk-money .split.is-total b')).to_have_text(f'900,00{NBSP}€')   # ‹Получавате› after the decision
        step('both sides: bell item, ‹Решен›, the decision ‹Частично възстановяване — 450 €› and the motive on their case pages; the partner sees no commission')

        ap.goto(base + '/admin/plashtaniya')
        mel = ap.locator('.batch', has_text='Студио Мелодия')
        expect(mel.locator('.badge')).to_have_text('Готово')
        expect(mel.locator('.batch-amt')).to_have_text(f'900,00{NBSP}€')
        shot(ap, '08b-admin-batch-ready', '.batch')
        ap.click('button.btn--block:has-text("Пусни партидата")')
        dlg = ap.locator('dialog[open]')
        expect(dlg).to_contain_text('Партида юни · първа половина')
        to_send = cents_of(dlg.locator('.split.is-total b').inner_text())  # ‹За превод›
        # a double click on the money button releases once: one transfer per partner, no refusal after the toast
        dlg.locator('button[type="submit"]').dblclick()
        settled_toast(ap, 'Партидата е пусната')
        assert scalar('''select count(*)::int from audit_log where action = 'payout.batch_released'
                         and entity_id = (select id::text from payout_batch where batch_date = '2026-06-15')''') == 1
        tick(base)
        ap.reload()
        ap.click('button[aria-label="Известия"]')
        expect(ap.locator('.ui-menu .ui-note', has_text='Партида')).to_contain_text('Партида 1 юли 2026')
        ap.keyboard.press('Escape')
        it = one('''select i.status, i.amount_cents from payout_item i join payout_batch pb on pb.id = i.batch_id join partner p on p.id = i.partner_id
                    where pb.batch_date = '2026-06-15' and p.business_name = 'Студио Мелодия' ''')
        assert it == {'status': 'paid', 'amount_cents': 90000}, it
        # what the confirm dialog said goes out is what went out (bookings completed since T17 included)
        paid_out = scalar('''select coalesce(sum(i.amount_cents), 0)::int from payout_item i join payout_batch pb on pb.id = i.batch_id
                             where pb.batch_date = '2026-06-15' and i.status = 'paid' ''')
        assert paid_out == to_send, (paid_out, to_send)
        assert one('''select l.status from payout_line l join booking b on b.id = l.booking_id where b.number = $1 and l.charge_id is null''', CASE1)['status'] == 'paid'
        pm = [m for m in emails('vendor-payout-sent', CASE1)]
        assert len(pm) == 1 and pm[0]['vars']['amount'] == f'900,00{NBSP}€', pm
        # Money reconciles: paid 1 450 € = 450 € back to the client + 900 € to the partner + 100 € commission.
        assert balance('commission_revenue', CASE1) == 10000, balance('commission_revenue', CASE1)
        assert scalar("select coalesce(sum(r.amount_cents), 0)::int from refund r join booking b on b.id = r.booking_id where b.number = $1 and r.status = 'succeeded'", CASE1) \
            + it['amount_cents'] + balance('commission_revenue', CASE1) == 145000
        assert balance('partner_payable', partner='Студио Мелодия') >= 0
        pp.goto(base + '/partner/prihodi')
        prow = pp.locator('.pc-earn tbody tr', has_text='14.06.2026').first
        expect(prow).to_contain_text(f'900,00{NBSP}€')
        expect(prow.locator('.badge')).to_have_text('Изплатено')
        shot(pp, '08-partner-paid', '.pc-earn')
        shot(ap, '09-admin-batch-released')
        no_errors()
        step('admin: the batch shows Студио Мелодия ‹Готово› 900,00 € → ‹Пусни партидата› (‹За превод› = what is paid) → paid 900,00 €, vendor-payout-sent; 450 + 900 + 100 = 1 450 €; the partner sees ‹Изплатено› 900,00 €')

        # ══ 3. A partner's case: the client does not answer in 48 hours; the team enforces the terms ═════
        pp.goto(base + '/partner/rezervacii/' + quote(CASE2))
        pp.click('a:has-text("Сигнал до екипа")')
        pp.wait_for_url('**/partner/poddrazhka/nov?rezervaciya=**')
        expect(pp.locator('.pol[aria-label="За коя резервация"] .pol-opt.is-on')).to_contain_text('19 декември 2026')
        expect(pp.locator('.dp-reasons .pol-opt.is-on')).to_contain_text('Клиентът не отговаря')
        pp.fill('textarea[name=description]', 'От юни пишем на Мария за песента за първия танц и часа на тортата — без отговор. Трябват ни до края на месеца.')
        pp.click('button:has-text("Изпрати сигнала")')
        pp.wait_for_url(re.compile(r'/partner/rezervacii$'))
        toast(pp, 'Сигналът е изпратен — екипът отговаря до 24 часа')
        d2 = one('''select d.id, d.status, d.opened_by, d.reason, d.holds_payout, d.position_from, b.payout_hold,
                    to_char(d.position_due_at at time zone 'Europe/Sofia', 'YYYY-MM-DD HH24:MI') due from dispute d join booking b on b.id = d.booking_id where d.number = $1''', CASE2)
        assert (d2['status'], d2['opened_by'], d2['reason'], d2['holds_payout'], d2['position_from'], d2['payout_hold']) == \
            ('collecting', 'partner', 'client_unresponsive', False, 'client', False), d2
        assert len(emails('vendor-ticket-received', CASE2)) == 1 and len(emails('client-ticket-vendor-opened', CASE2, CLIENT)) == 1 and emails('team-dispute-new', CASE2)
        cp.goto(base + '/akaunt')
        bell_has(cp, 'Изпълнителят подаде сигнал до екипа')
        mail = emails('client-ticket-vendor-opened', CASE2, CLIENT)[0]
        assert follow_email(cp, base, mail, 'Отговори на екипа') == f'/akaunt/poddrazhka/{CASE2}', cp.url
        expect(cp.locator('.clock-l')).to_have_text('Срок за клиента')
        expect(cp.locator('.cs-money-l')).to_have_text('платени и задържани до събитието')
        step('partner: booking → ‹Сигнал до екипа› → ‹Клиентът не отговаря› → collecting, payout not held (D13), 48 h for the client; the client\'s bell and email open the case')

        ap.goto(base + '/admin/nastroyki')
        for _ in range(2):
            ap.click('.ops-clock-acts button:has-text("+1 ден")')
            ap.wait_for_load_state('networkidle')
            ap.wait_for_timeout(500)
        assert now_sofia() >= d2['due'], (now_sofia(), d2['due'])
        tick(base)
        d = one("select status from dispute where number = $1", CASE2)
        assert d['status'] == 'awaiting_decision', d
        dl = emails('team-dispute-deadline', CASE2)
        assert dl and any(m['to_email'] == ADMIN for m in dl), dl
        assert 'Мария Димитрова не отговори в срок' in dl[0]['subject'], dl[0]['subject']
        ap.goto(base + '/admin/sporove/' + quote(CASE2))
        expect(ap.locator('.page-head-right .badge').last).to_have_text('Чака решение')
        expect(ap.locator('.cs-party.is-vendor .cs-filer')).to_have_text('Подаде сигнала')
        pp.goto(base + '/partner/poddrazhka/' + quote(CASE2))
        expect(pp.locator('.page-head-right .badge')).to_have_text('Чака решение')
        expect(pp.locator('button:has-text("Оттегли сигнала")')).to_have_count(0)
        step('demo clock ‹+1 ден› ×2 (Админ → Настройки): no statement from the client in 48 h → ‹Чака решение›, team-dispute-deadline (‹Мария Димитрова не отговори в срок›)')

        ap.goto(base + '/admin/sporove/' + quote(CASE2))
        opt = ap.locator('.res-opt', has_text='Задължи Мария Димитрова да')
        opt.click()
        expect(ap.locator('.res-opt.is-on')).to_contain_text('Задължи Мария Димитрова да')
        ap.fill('textarea[name="motive"]', 'Мария не отговори в срока. Резервацията остава, както е договорена.')
        ap.click('button:has-text("Приложи решението")')
        expect(ap.locator('input[name="obligation"]:invalid')).to_have_count(1)
        ap.fill('input[name="obligation"]', 'изпрати песента и часа на тортата до 30 юни, както е договорено')
        shot(ap, '10-admin-enforce', '.am-decide')
        ap.click('button:has-text("Приложи решението")')
        ap.wait_for_url(re.compile(r'/admin/sporove$'))
        toast(ap, 'Решението е изпратено до двете страни')
        enforce_title = 'Задължи Мария Димитрова да изпрати песента и часа на тортата до 30 юни, както е договорено'
        d = one("select status, decision_kind, decision_title, refund_cents from dispute where number = $1", CASE2)
        assert d == {'status': 'resolved', 'decision_kind': 'enforce_terms', 'decision_title': enforce_title, 'refund_cents': 0}, d
        assert scalar("select count(*)::int from refund r join booking b on b.id = r.booking_id where b.number = $1", CASE2) == 0
        assert one("select status from booking where number = $1", CASE2)['status'] == 'confirmed'
        assert len(emails('client-dispute-decision', CASE2, CLIENT)) == 1 and len(emails('vendor-ticket-decision', CASE2)) == 1
        cp.goto(base + '/akaunt/poddrazhka/' + quote(CASE2))
        expect(cp.locator('.cs-done-n')).to_have_text(enforce_title)
        expect(cp.locator('.cs-motive-t')).to_have_text('Мария не отговори в срока. Резервацията остава, както е договорена.')
        pp.goto(base + '/partner/rezervacii/' + quote(CASE2))
        pp.click('a:has-text("Сигнал до екипа")')
        pp.wait_for_url(f'**/partner/poddrazhka/{quote(CASE2)}')
        expect(pp.locator('.cs-done-n')).to_have_text(enforce_title)
        shot(pp, '11-partner-enforced')
        no_errors()
        step('admin: ‹Задължи Мария Димитрова да …› needs its text, then resolves enforce_terms — no money moves, the booking stays; both see the decision and the motive')

        # ══ 4. A case its filer withdraws ═════════════════════════════════════════════════════════════
        cp.goto(base + '/akaunt/rezervacii/' + quote(CASE3))
        cp.click('a:has-text("Сигнал до екипа")')
        cp.wait_for_url('**/akaunt/poddrazhka/nov?rezervaciya=**')
        expect(cp.locator('.dp-pick.is-on')).to_contain_text(CASE3)
        cp.click('.opt:has-text("Друго")')
        cp.fill('#dp-description', 'Сладкарницата не потвърждава надписа на тортата.')
        cp.click('button:has-text("Изпрати сигнала")')
        cp.wait_for_url(re.compile(r'/akaunt/rezervacii$'))
        toast(cp, 'Сигналът е изпратен — екипът отговаря до 24 часа')
        d3 = one('''select d.id, d.status, b.payout_hold, (select status from payout_line l where l.booking_id = b.id and l.charge_id is null) line
                    from dispute d join booking b on b.id = d.booking_id where d.number = $1''', CASE3)
        assert d3['status'] == 'collecting' and d3['payout_hold'] is True and d3['line'] == 'held', d3
        cp.goto(base + '/akaunt/poddrazhka/' + quote(CASE3))
        cp.click('button:has-text("Оттегли сигнала")')
        toast(cp, 'Сигналът е оттеглен')
        expect(cp.locator('.h-right .badge')).to_have_text('Оттеглен')
        expect(cp.locator('button:has-text("Оттегли сигнала")')).to_have_count(0)
        expect(cp.locator('form:has(#st-body)')).to_have_count(0)
        d3 = one('''select d.status, b.payout_hold, (select status from payout_line l where l.booking_id = b.id and l.charge_id is null) line,
                    (select count(*)::int from job j where j.dedupe_key like 'dispute:' || d.id || ':%' and j.status = 'pending') jobs
                    from dispute d join booking b on b.id = d.booking_id where d.number = $1''', CASE3)
        assert d3 == {'status': 'withdrawn', 'payout_hold': False, 'line': 'awaiting_event', 'jobs': 0}, d3
        shot(cp, '12-client-withdrawn')
        cp.goto(base + '/akaunt/rezervacii/' + quote(CASE3))
        cp.click('a:has-text("Сигнал до екипа")')   # no second case on the booking: the withdrawn one opens
        cp.wait_for_url(f'**/akaunt/poddrazhka/{quote(CASE3)}')
        expect(cp.locator('.h-right .badge')).to_have_text('Оттеглен')
        med, mp = person(MED_PARTNER)
        mp.goto(base + '/partner/poddrazhka/' + quote(CASE3))
        expect(mp.locator('.page-head-right .badge')).to_have_text('Оттеглен')
        ap.goto(base + '/admin/sporove?filter=resheni')
        expect(ap.locator('.case', has_text=CASE3)).to_contain_text('Оттеглен')
        no_errors()
        step('client: a third case, then ‹Оттегли сигнала› → ‹Оттеглен›, the hold lifted (line back to awaiting_event), no timer left; the booking\'s ‹Сигнал до екипа› opens the withdrawn case, not an empty form; the partner and the team see ‹Оттеглен›')

        # ══ 5. The step that moves money, as people really use it: a phone, a double click, the back button, two tabs ══
        iv, ip = person(IVELINA, phone=True)
        ip.goto(base + '/akaunt/rezervacii/' + quote(CASE4))
        ip.click('a:has-text("Сигнал до екипа")')
        ip.wait_for_url('**/akaunt/poddrazhka/nov?rezervaciya=**')
        expect(ip.locator('.dp-pick.is-on')).to_contain_text(CASE4)
        ip.click('.opt:has-text("Услугата не беше по описание")')
        desc4 = 'Вкусна История ни изпрати меню без вегетарианските ястия, които договорихме за 12 от гостите. Прилагам менюто.'
        ip.fill('#dp-description', desc4)
        with ip.expect_file_chooser(timeout=5_000) as fc:
            ip.click('.rw-drop-t')
        fc.value.set_files([menu])
        expect(ip.locator('.ms-drop .ms-shot')).to_have_count(1, timeout=15_000)
        shot_phone(ip, '13-client-phone-form')
        ip.locator('button:has-text("Изпрати сигнала")').dblclick()
        ip.wait_for_url(re.compile(r'/akaunt/rezervacii$'))
        settled_toast(ip, 'Сигналът е изпратен — екипът отговаря до 24 часа')
        d4 = one('''select d.id, d.status, d.holds_payout, b.payout_hold, (select count(*)::int from dispute x where x.booking_id = b.id) cases,
                    (select count(*)::int from dispute_message m where m.dispute_id = d.id) statements,
                    (select count(*)::int from dispute_attachment a where a.dispute_id = d.id) files
                    from dispute d join booking b on b.id = d.booking_id where d.number = $1''', CASE4)
        assert (d4['status'], d4['holds_payout'], d4['payout_hold'], d4['cases'], d4['statements'], d4['files']) == ('collecting', True, True, 1, 1, 1), d4
        assert len(emails('client-dispute-opened', CASE4, IVELINA)) == 1 and len(emails('vendor-ticket-client-opened', CASE4)) == 1
        team = [m['to_email'] for m in emails('team-dispute-new', CASE4)]
        assert team and len(team) == len(set(team)), team
        # ‹Назад› returns to the form's address: it opens the case now (one per booking), never a form that
        # quietly preselects her other booking that night (Snap360, 2026-0628-ФК)
        ip.go_back()
        ip.wait_for_url(f'**/akaunt/poddrazhka/{quote(CASE4)}')
        expect(ip.locator('.h-right .badge')).to_have_text('Събираме данни')
        expect(ip.locator('.dp-pick')).to_have_count(0)
        ip.goto(base + '/akaunt/poddrazhka/nov?rezervaciya=' + quote(CASE4))
        ip.wait_for_url(f'**/akaunt/poddrazhka/{quote(CASE4)}')
        shot_phone(ip, '14-client-phone-case')
        no_errors()
        step('phone (390 px): Ивелина opens a case with a photo by double-tapping ‹Изпрати сигнала› → one case, one set of emails, the success toast only; ‹Назад› and the old form link open the case, not a form on her other booking')

        vk, vp = person(VKUSNA, phone=True)
        vp.goto(base + '/partner/poddrazhka/' + quote(CASE4))
        expect(vp.locator('.cs-party').first.locator('.cs-att-i')).to_have_count(1)
        vp.fill('textarea[name=body]', 'Вегетарианските ястия са в менюто за деня — изпратихме старата версия по грешка. Прилагаме новото меню.')
        vp.locator('button:has-text("Изпрати позицията")').dblclick()
        settled_toast(vp, 'Съобщението е изпратено')
        expect(vp.locator('.page-head-right .badge')).to_have_text('Чака решение')
        assert scalar("select count(*)::int from dispute_message where dispute_id = $1 and party = 'partner'", d4['id']) == 1
        replies = [m['to_email'] for m in emails('team-dispute-reply', CASE4)]
        assert replies and len(replies) == len(set(replies)), replies
        shot_phone(vp, '15-partner-phone-position')
        no_errors()
        step('phone: Вкусна История double-taps ‹Изпрати позицията› → one statement, ‹Чака решение›, team-dispute-reply once per team member')

        tb = tab(admin, ADMIN)
        tb.set_viewport_size({'width': 390, 'height': 844})
        ap.goto(base + '/admin/sporove/' + quote(CASE4))
        tb.goto(base + '/admin/sporove/' + quote(CASE4))
        expect(tb.locator('.res-opt')).to_have_count(5)
        no_page_scroll_x(tb, 390)
        # Tab A: a partial refund, applied with a double click
        ap.click('.res-opt:has-text("Частично възстановяване")')
        ap.fill('input[name="refund"]', '280')
        expect(ap.locator('.am-decide .split.is-fee b')).to_have_text(f'1{NBSP}000,00{NBSP}€')
        motive4 = 'Вкусна История пусна старо меню по грешка; новото има вегетарианските ястия. Връщаме 280 € за неудобството.'
        ap.fill('textarea[name="motive"]', motive4)
        ap.locator('button:has-text("Приложи решението")').dblclick()
        ap.wait_for_url(re.compile(r'/admin/sporove$'))
        settled_toast(ap, 'Решението е изпратено до двете страни')
        d = one('select status, decision_kind, refund_cents, partner_keeps_cents from dispute where id = $1', d4['id'])
        assert d == {'status': 'resolved', 'decision_kind': 'partial_refund', 'refund_cents': 28000, 'partner_keeps_cents': 100000}, d
        refunds4 = sql("select r.amount_cents from refund r join booking b on b.id = r.booking_id where b.number = $1", CASE4)
        assert refunds4 == [{'amount_cents': 28000}], refunds4
        assert len(emails('client-dispute-decision', CASE4, IVELINA)) == 1 and len(emails('vendor-ticket-decision', CASE4)) == 1
        assert scalar("select count(*)::int from audit_log where action = 'dispute.decided' and entity_id = $1", d4['id']) == 1
        # Tab B (the phone, opened before the decision): another option on the stale page is refused, nothing moves
        tb.click('.res-opt:has-text("Анулирай с пълно възстановяване")')
        tb.fill('textarea[name="motive"]', 'Анулираме с пълно възстановяване.')
        tb.click('button:has-text("Приложи решението")')
        toast(tb, 'Действието вече не е възможно')
        expect(tb.locator('.ui-toast')).to_have_class(re.compile(r'ui-toast--error'))
        expect(tb.locator('.page-head-right .badge').last).to_have_text('Решен')
        expect(tb.locator('.am-decide')).to_have_count(0)
        assert one('select decision_kind from dispute where id = $1', d4['id'])['decision_kind'] == 'partial_refund'
        assert one('select status from booking where number = $1', CASE4)['status'] == 'confirmed'
        assert len(sql("select 1 from refund r join booking b on b.id = r.booking_id where b.number = $1", CASE4)) == 1
        shot_phone(tb, '16-admin-phone-stale-tab')
        # Tab A: ‹Назад› after deciding shows the decided case, not a form to decide again
        ap.go_back()
        ap.wait_for_url(f'**/admin/sporove/{quote(CASE4)}')
        expect(ap.locator('.page-head-right .badge').last).to_have_text('Решен')
        expect(ap.locator('.am-decide')).to_have_count(0)
        expect(ap.locator('.cs-done-n')).to_have_text(f'Частично възстановяване — 280{NBSP}€')
        tb.close()
        no_errors()
        step('admin, two tabs: tab A double-clicks ‹Приложи решението› (partial refund 280 €) → one decision, one refund, one email each; the stale tab B on a phone is refused (‹Действието вече не е възможно›), nothing cancelled; ‹Назад› shows ‹Решен›, no second decision form')

        tick(base)
        assert one("select r.status from refund r join booking b on b.id = r.booking_id where b.number = $1", CASE4)['status'] == 'succeeded'
        bk4 = one('''select b.status, b.payout_hold, l.status line, l.amount_cents from booking b
                     join payout_line l on l.booking_id = b.id and l.charge_id is null where b.number = $1''', CASE4)
        assert bk4 == {'status': 'confirmed', 'payout_hold': False, 'line': 'awaiting_event', 'amount_cents': 90000}, bk4
        assert balance('client_funds', CASE4) == 100000, balance('client_funds', CASE4)
        ip.goto(base + '/akaunt/poddrazhka/' + quote(CASE4))
        expect(ip.locator('.h-right .badge')).to_have_text('Решен')
        expect(ip.locator('.cs-done-n')).to_have_text(f'Частично възстановяване — 280{NBSP}€')
        expect(ip.locator('.cs-motive-t')).to_have_text(motive4)
        shot_phone(ip, '17-client-phone-decision')
        vp.goto(base + '/partner/rezervacii/' + quote(CASE4))
        expect(vp.locator('.vbk-money .split.is-total b')).to_have_text(f'900,00{NBSP}€')
        no_errors()
        step('the refund of 280 € succeeds once; the booking stands, the hold is lifted and 1 000 € stays held until the event (900 € to the partner); both phones show the decision')

        # ══ 6. Nobody else reaches these cases ════════════════════════════════════════════════════════
        oc, op = person(OTHER_CLIENT)
        ox, oxp = person(OTHER_PARTNER)
        for n in (CASE1, CASE2, CASE3):
            r = op.goto(base + '/akaunt/poddrazhka/' + quote(n))
            assert r.status == 404, f'another client opened case {n}: {r.status}'
            r = oxp.goto(base + '/partner/poddrazhka/' + quote(n))
            assert r.status == 404, f'another partner opened case {n}: {r.status}'
        for h in evidence:
            assert oc.request.get(base + h).status in (403, 404), f'another client read evidence {h}'
            assert ox.request.get(base + h).status in (403, 404), f'another partner read evidence {h}'
        mp.goto(base + '/partner/poddrazhka/' + quote(CASE1))
        assert mp.locator('h1').first.inner_text() != 'Услугата не беше по описание'
        r = mp.goto(base + '/partner/poddrazhka/' + quote(CASE1))
        assert r.status == 404, r.status
        cp.goto(base + '/admin/sporove/' + quote(CASE1))
        assert '/admin' not in cp.url, cp.url
        errors[:] = [e for e in errors if ' 404 ' not in e]
        no_errors()
        step('another client and another partner get 404 on all three cases and cannot read the evidence; a client never reaches the admin case')
        b.close()
    print(f'PASS — {len(STEPS)} steps')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        print(f'FAIL after {len(STEPS)} steps', flush=True)
        sys.exit(1)
