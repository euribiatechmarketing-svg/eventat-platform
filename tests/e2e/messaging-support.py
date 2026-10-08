#!/usr/bin/env python3
"""End-to-end: messages and support (SCREENS §4 /akaunt/saobshteniya, /akaunt/poddrazhka; §7 /partner/saobshteniya,
/partner/poddrazhka), driven with real clicks and typing against a running dev server.

Usage: python3 tests/e2e/messaging-support.py [--base http://localhost:3204] [--no-reseed]

Reseeds the database named in .env.local first (the platform clock restarts at 31 Aug 2025 12:00), then checks:
guards; the client and partner message flows (unread state, search, drafts, attachments, masking, ‹Само
непрочетени›, new messages arriving without a reload); the support flows (opening a case with evidence, the
partner's position, the client's answer, a partner case withdrawn); phone-width layout. Each step asserts what is
on screen and, where useful, the database effect.
"""
import json, os, re, struct, subprocess, sys, tempfile, time, zlib
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
NODE_BIN = Path.home() / 'nodejs22' / 'bin'
DEMO = {
    'client': ('maria.dimitrova@gmail.com', 'eventat-demo'),
    'partner': ('studio.melodia@gmail.com', 'eventat-demo'),
}

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
    """A small valid PNG (media.upload() checks the signature)."""
    raw = b''.join(b'\x00' + bytes(rgb) * size for _ in range(size))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    Path(path).write_bytes(data)
    return path

STEPS = []
def step(name):
    STEPS.append(name)
    print(f'  ok  {name}', flush=True)

def conv_id(client_email, partner_name, event_title):
    return one('''select c.id from conversation c join "user" u on u.id = c.client_id join partner p on p.id = c.partner_id
                  join client_event e on e.id = c.client_event_id where u.email = $1 and p.business_name = $2 and e.title = $3''',
               client_email, partner_name, event_title)['id']

def toast(page, text, timeout=10_000):
    expect(page.locator('.ui-toast.is-on')).to_contain_text(text, timeout=timeout)

def sign_in(ctx, base, who):
    email, pw = DEMO[who]
    r = ctx.request.post(base + '/api/auth/sign-in/email', data={'email': email, 'password': pw}, headers={'Origin': base})
    assert r.ok, f'sign-in {who} failed: {r.status} {r.text()[:200]}'

def no_page_scroll_x(page, width):
    sw = page.evaluate('document.scrollingElement.scrollWidth')
    assert sw <= width, f'horizontal page scroll on {page.url}: {sw} > {width}'

def main():
    args = sys.argv[1:]
    base = 'http://localhost:3204'
    if '--base' in args: base = args[args.index('--base') + 1]
    if '--no-reseed' not in args:
        print('reseeding', DB_URL.rsplit('/', 1)[-1], flush=True)
        reseed()
    tmp = Path(tempfile.mkdtemp())
    hall, proof, proof2, answer = (png(tmp / n, c) for n, c in [('zala.png', (200, 180, 160)), ('tehnika.png', (40, 40, 60)), ('obyava.png', (90, 140, 90)), ('poziciya.png', (160, 60, 60))])

    flora = conv_id('maria.dimitrova@gmail.com', 'Флора Студио', 'Коледно парти')
    melodia = conv_id('maria.dimitrova@gmail.com', 'Студио Мелодия', 'Сватба')
    vkusna = conv_id('maria.dimitrova@gmail.com', 'Вкусна История', 'Коледно парти')
    ivelina = one('''select c.id from conversation c join "user" u on u.id = c.client_id where u.name = 'Ивелина Тодорова' ''')['id']

    with sync_playwright() as p:
        b = p.chromium.launch()
        opts = dict(viewport={'width': 1440, 'height': 900}, locale='bg-BG', timezone_id='Europe/Sofia')

        # ── guards ──────────────────────────────────────────────────────────
        guest = b.new_context(**opts)
        gp = guest.new_page()
        for path in ['/akaunt/saobshteniya', '/akaunt/poddrazhka', '/partner/saobshteniya', '/partner/poddrazhka/nov']:
            gp.goto(base + path)
            assert '/vhod' in gp.url and 'next=' in gp.url, f'guest not sent to sign-in from {path}: {gp.url}'
        assert gp.request.get(f'{base}/api/files/00000000-0000-4000-8000-000000000000').status in (401, 404)
        step('guests are sent to /vhod?next= from every route')

        client = b.new_context(**opts)
        sign_in(client, base, 'client')
        cp = client.new_page()
        partner = b.new_context(**opts)
        sign_in(partner, base, 'partner')
        pp = partner.new_page()

        cp.goto(base + '/partner/saobshteniya')
        assert '/partner/' not in cp.url, f'client reached the partner panel: {cp.url}'
        pp.goto(base + '/akaunt/poddrazhka')
        assert '/akaunt/poddrazhka' not in pp.url, f'partner reached the client account: {pp.url}'
        assert cp.goto(f'{base}/akaunt/saobshteniya/{ivelina}').status == 404, 'client opened another client\'s conversation'
        assert cp.goto(base + '/akaunt/poddrazhka/' + '2026-0630-АБ').status == 404, 'client opened another client\'s case'
        assert pp.goto(f'{base}/partner/saobshteniya/{vkusna}').status == 404, 'partner opened another partner\'s conversation'
        assert pp.goto(base + '/partner/poddrazhka/' + '2026-0614-ФК').status == 404, 'partner opened another partner\'s case'
        step('wrong role is redirected; other people\'s conversations and cases are 404')

        # ── client messages ────────────────────────────────────────────────
        cp.goto(base + '/akaunt/saobshteniya')
        expect(cp.locator('.msg-item')).to_have_count(6)
        expect(cp.locator('.msg-list-c')).to_have_text('6')
        flora_item = cp.locator('.msg-item', has_text='Флора Студио')
        expect(flora_item.locator('.msg-item-dot')).to_have_count(1)
        flora_item.click()
        cp.wait_for_url(f'**/akaunt/saobshteniya/{flora}')
        expect(cp.locator('.msg-ctx-n')).to_have_text('Флора Студио')
        expect(cp.locator('.msg-item.is-active')).to_contain_text('Флора Студио')
        expect(cp.locator('.msg-item.is-active .msg-item-dot')).to_have_count(0)
        assert one('select client_unread_count n from conversation where id = $1', flora)['n'] == 0
        step('opening a conversation marks it read (dot gone, unread count 0)')

        cp.fill('.msg-search input', 'Snap')
        cp.wait_for_url('**q=Snap**')
        expect(cp.locator('.msg-item')).to_have_count(1)
        expect(cp.locator('.msg-item')).to_contain_text('Snap360')
        cp.fill('.msg-search input', '')
        expect(cp.locator('.msg-item')).to_have_count(6)
        step('‹Търсене по изпълнител или събитие› filters the list through ?q=')

        cp.locator('.msg-item', has_text='Студио Мелодия').click()
        cp.wait_for_url(f'**/akaunt/saobshteniya/{melodia}')
        expect(cp.locator('.msg-comp-f')).to_have_value('Благодаря! Ще изпратя списъка с песните в петък.')
        expect(cp.locator('.msg-ctx-link')).to_have_text('Виж резервацията')
        cp.fill('.msg-comp-f', 'Чернова: списъкът с песните идва в петък')
        cp.wait_for_timeout(1500)
        assert one('select client_draft d from conversation where id = $1', melodia)['d'] == 'Чернова: списъкът с песните идва в петък'
        cp.reload()
        expect(cp.locator('.msg-comp-f')).to_have_value('Чернова: списъкът с песните идва в петък')
        step('typing saves the draft; it is back after a reload')

        cp.set_input_files('[data-testid=message-file]', str(hall))
        toast(cp, 'Файлът е прикачен към съобщението')
        expect(cp.locator('.ms-chip')).to_contain_text('zala.png')
        cp.fill('.msg-comp-f', 'Изпращам ви снимка на залата.')
        cp.click('.msg-comp .btn--primary')
        toast(cp, 'Съобщението е изпратено')
        expect(cp.locator('.msg-line--out .msg-b').last).to_have_text('Изпращам ви снимка на залата.')
        expect(cp.locator('.msg-line--out .ms-att--img').last).to_be_visible()
        expect(cp.locator('.msg-comp-f')).to_have_value('')
        m = one('''select m.id, m.body, c.client_draft, c.partner_unread_count, (select media_id from message_attachment a where a.message_id = m.id) media
                   from message m join conversation c on c.id = m.conversation_id where m.conversation_id = $1 order by m.created_at desc limit 1''', melodia)
        assert m['body'] == 'Изпращам ви снимка на залата.' and m['media'] and m['client_draft'] is None and m['partner_unread_count'] >= 1, m
        assert one("select count(*)::int n from email_outbox where template_key = 'vendor-new-message' and vars->>'message' = $1", 'Изпращам ви снимка на залата.')['n'] == 1
        assert client.request.get(f'{base}/api/files/{m["media"]}').status == 200
        assert guest.request.get(f'{base}/api/files/{m["media"]}').status == 401
        step('attach + ‹Изпрати› → stored with its attachment, draft cleared, vendor-new-message queued; file readable by the party only')

        cp.locator('.msg-item', has_text='Вкусна История').click()
        cp.wait_for_url(f'**/akaunt/saobshteniya/{vkusna}')
        cp.fill('.msg-comp-f', 'Обадете се на 0888 123 456 или пишете на maria.test@example.com')
        cp.press('.msg-comp-f', 'Enter')
        toast(cp, 'Съобщението е изпратено')
        expect(cp.locator('.msg-line--out .msg-b').last).to_have_text('Обадете се на 0888 123 456 или пишете на maria.test@example.com')
        row = one('select body, body_original from message where conversation_id = $1 order by created_at desc limit 1', vkusna)
        assert row['body'] == 'Обадете се на ••• или пишете на •••' and '0888' in row['body_original'], row
        step('before a confirmed booking contacts are masked for the partner (SPEC §10); the sender sees the original')

        # ── partner messages ───────────────────────────────────────────────
        pp.goto(base + '/partner/saobshteniya')
        # wide screen: the newest conversation opens beside the list (and is read)
        pp.wait_for_url(f'**/partner/saobshteniya/{melodia}')
        expect(pp.locator('.page-sub')).to_contain_text('3 разговора')
        expect(pp.locator('.page-sub')).to_contain_text('2 непрочетени съобщения')
        expect(pp.locator('.vmsg-list-c')).to_have_text('Всички')
        expect(pp.locator('.vmsg-conv.is-on')).to_contain_text('Мария Димитрова')
        expect(pp.locator('.vmsg-head-n')).to_have_text('Мария Димитрова')
        expect(pp.locator('.vmsg-head-right .badge')).to_have_text('Потвърдена резервация')
        expect(pp.locator('.vmsg-m:not(.vmsg-m--out) .vmsg-b').last).to_have_text('Изпращам ви снимка на залата.')
        expect(pp.locator('.vmsg-m .ms-att--img').last).to_be_visible()
        assert partner.request.get(f'{base}/api/files/{m["media"]}').status == 200
        assert one('select partner_unread_count n from conversation where id = $1', melodia)['n'] == 0
        pp.click('text=Само непрочетени')
        pp.wait_for_url(f'**/partner/saobshteniya/{melodia}?neprocheteni=1')
        expect(pp.locator('.vmsg-list-c')).to_have_text('Непрочетени')
        expect(pp.locator('.page-head-right .btn')).to_have_class(re.compile('btn--primary'))
        expect(pp.locator('.vmsg-conv')).to_have_count(1)
        expect(pp.locator('.vmsg-conv.is-unread')).to_contain_text('Ивелина Тодорова')
        expect(pp.locator('.vmsg-unread')).to_have_text('2')
        step('the newest conversation opens and is read; ‹Само непрочетени› leaves only unread ones; the client\'s attachment shows')

        pp.fill('.vmsg-input', 'Благодарим, получихме снимката.')
        pp.click('.vmsg-tools .btn--primary')
        toast(pp, 'Съобщението е изпратено')
        expect(pp.locator('.vmsg-m--out .vmsg-b').last).to_have_text('Благодарим, получихме снимката.')
        assert one("select count(*)::int n from email_outbox where template_key = 'client-new-message' and vars->>'message' = $1", 'Благодарим, получихме снимката.')['n'] == 1
        pp.click('text=Само непрочетени')
        pp.wait_for_url(re.compile(r'/partner/saobshteniya/[0-9a-f-]+$'))
        expect(pp.locator('.vmsg-list-c')).to_have_text('Всички')
        step('partner ‹Изпрати› → client-new-message; the filter toggles back to ‹Всички›')

        cp.goto(f'{base}/akaunt/saobshteniya/{melodia}')
        expect(cp.locator('.msg-line--in .msg-b').last).to_have_text('Благодарим, получихме снимката.')
        cp.locator('.msg-line--out .msg-t').last.wait_for()
        expect(cp.locator('.msg-line--out .msg-t').last).to_contain_text('прочетено')
        pp.fill('.vmsg-input', 'Ще ви чакаме в 15:30.')
        pp.click('.vmsg-tools .btn--primary')
        toast(pp, 'Съобщението е изпратено')
        t0 = time.time()
        expect(cp.locator('.msg-line--in .msg-b').last).to_have_text('Ще ви чакаме в 15:30.', timeout=25_000)
        step(f'the client sees ‹· прочетено› and a new partner message arrives without a reload ({time.time() - t0:.0f} s)')

        # ── client support ─────────────────────────────────────────────────
        cp.goto(base + '/akaunt/poddrazhka/nov?rezervaciya=' + '2026-0614-ЕА')
        expect(cp.locator('.dp-pick.is-on')).to_contain_text('2026-0614-ЕА')
        cp.fill('#dp-description', 'Изпълнителят два пъти отложи огледа на залата и не потвърждава техниката.')
        cp.click('text=Изпрати сигнала')
        expect(cp.locator('.form-error')).to_have_text('Изберете причина.')
        expect(cp.locator('#dp-description')).to_have_value('Изпълнителят два пъти отложи огледа на залата и не потвърждава техниката.')
        cp.click('.opt:has-text("Услугата не беше по описание")')
        expect(cp.locator('.opt.is-on')).to_have_text('Услугата не беше по описание')
        cp.set_input_files('[data-testid=evidence-file]', [str(proof), str(proof2)])
        expect(cp.locator('.ms-drop .ms-shot')).to_have_count(2, timeout=10_000)
        toast(cp, 'Снимката е прикачена към сигнала')
        cp.locator('.ms-drop .ms-shot .rw-shot-x').first.click()
        toast(cp, 'Снимката е премахната')
        expect(cp.locator('.ms-drop .ms-shot')).to_have_count(1)
        cp.click('text=Изпрати сигнала')
        cp.wait_for_url('**/akaunt/rezervacii')
        d = one('''select d.id, d.status, d.opened_by, d.reason, d.holds_payout, (select count(*)::int from dispute_attachment a where a.dispute_id = d.id) files
                   from dispute d where d.number = $1''', '2026-0614-ЕА')
        assert d['status'] == 'collecting' and d['opened_by'] == 'client' and d['reason'] == 'not_as_described' and d['holds_payout'] and d['files'] == 1, d
        keys = {r['template_key'] for r in sql("select template_key from email_outbox where vars->>'bookingNo' = $1 or vars->>'caseId' = $1", '2026-0614-ЕА')}
        assert {'client-dispute-opened', 'vendor-ticket-client-opened', 'team-dispute-new'} <= keys, keys
        step('‹Изпрати сигнала› (refused without a reason, text kept) → case collecting, 1 photo, the three emails')

        cp.goto(base + '/akaunt/poddrazhka')
        expect(cp.locator('.dcard-head .badge')).to_have_text('2 отворени')
        expect(cp.locator('.dp-pick', has_text='2026-0614-ЕА')).to_have_count(0)
        cp.locator('.dp-case', has_text='Студио Мелодия').click()
        cp.wait_for_url('**/akaunt/poddrazhka/2026-0614-%D0%95%D0%90')
        expect(cp.locator('.h-right .badge')).to_have_text('Събираме данни')
        expect(cp.locator('.clock-l')).to_have_text('Срок за изпълнителя')
        expect(cp.locator('.cs-wait')).to_contain_text('Още не е отговорил.')
        expect(cp.locator('.cs-party').first.locator('.cs-att-i')).to_have_count(1)
        step('‹Моите сигнали› lists the case; its page shows the statement, the photo and the partner\'s deadline')

        pp.goto(base + '/partner/poddrazhka')
        pp.locator('.case', has_text='Услугата не беше по описание').click()
        pp.wait_for_url('**/partner/poddrazhka/2026-0614-%D0%95%D0%90')
        expect(pp.locator('.countdown-label')).to_have_text('Срок за изпълнителя')
        pp.fill('textarea[name=body]', 'Техниката е същата като в обявата — прилагаме снимка от последното събитие.')
        pp.set_input_files('[data-testid=evidence-file]', str(answer))
        toast(pp, 'Снимката е прикачена към сигнала')
        pp.click('button:has-text("Изпрати позицията")')
        toast(pp, 'Съобщението е изпратено')
        expect(pp.locator('.page-head-right .badge')).to_have_text('Чака решение')
        assert one('select status from dispute where number = $1', '2026-0614-ЕА')['status'] == 'awaiting_decision'
        assert one("select count(*)::int n from email_outbox where template_key = 'team-dispute-reply' and vars->>'caseId' = $1", '2026-0614-ЕА')['n'] >= 1
        step('partner ‹Изпрати позицията› with a photo → awaiting decision, team-dispute-reply')

        cp.reload()
        partner_side = cp.locator('.cs-party.is-vendor')
        expect(partner_side.locator('.cs-quote')).to_contain_text('Техниката е същата')
        href = partner_side.locator('.cs-att-i').first.get_attribute('href')
        assert client.request.get(base + href).status == 200, 'the client cannot see the partner\'s evidence'
        cp.fill('#st-body', 'Снимката е от друга зала — на огледа апаратурата беше различна.')
        cp.click('.form-card button:has-text("Изпрати")')
        toast(cp, 'Съобщението е изпратено')
        expect(cp.locator('.cs-party').first.locator('.cs-quote')).to_have_count(2)
        assert one('''select count(*)::int n from dispute_message m join dispute d on d.id = m.dispute_id
                      where d.number = $1 and m.kind = 'statement' ''', '2026-0614-ЕА')['n'] == 3
        expect(cp.locator('text=Оттегли сигнала')).to_have_count(0)
        step('the client sees the partner\'s position and evidence and answers the team')

        pp.goto(base + '/partner/poddrazhka/nov')
        pp.locator('.pol-opt', has_text='Ана и Виктор').click()
        pp.locator('.pol-opt', has_text='Промени условията на място').click()
        expect(pp.locator('.pol-opt.is-on')).to_have_count(2)
        pp.fill('textarea[name=description]', 'Клиентите искат да преместим началото с два часа по-рано без доплащане.')
        pp.click('button:has-text("Изпрати сигнала")')
        pp.wait_for_url('**/partner/rezervacii')
        n = one('''select d.number, d.status, d.opened_by, d.holds_payout from dispute d join booking b on b.id = d.booking_id
                   join "user" u on u.id = b.client_id where u.name = 'Ана и Виктор' and d.opened_by = 'partner' ''')
        assert n['status'] == 'collecting' and n['opened_by'] == 'partner' and n['holds_payout'], n
        pp.goto(base + '/partner/poddrazhka')
        expect(pp.locator('.dcard-head .badge')).to_have_text('3 отворени')
        pp.locator('.case', has_text='Ана и Виктор').click()
        pp.wait_for_url('**/partner/poddrazhka/**')
        expect(pp.locator('.countdown-label')).to_have_text('Срок за клиента')
        pp.click('button:has-text("Оттегли сигнала")')
        toast(pp, 'Сигналът е оттеглен')
        expect(pp.locator('.page-head-right .badge')).to_have_text('Оттеглен')
        assert one('select status from dispute where number = $1', n['number'])['status'] == 'withdrawn'
        step('partner ‹Изпрати сигнала› → case collecting; ‹Оттегли сигнала› → withdrawn')

        # ── phone width ────────────────────────────────────────────────────
        mob = dict(viewport={'width': 390, 'height': 844}, locale='bg-BG', timezone_id='Europe/Sofia', is_mobile=True, has_touch=True)
        cm = b.new_context(**mob); sign_in(cm, base, 'client'); mp = cm.new_page()
        mp.goto(base + '/akaunt/saobshteniya')
        expect(mp.locator('.msg-list')).to_be_visible()
        expect(mp.locator('.msg-thread')).to_be_hidden()
        no_page_scroll_x(mp, 390)
        mp.locator('.msg-item', has_text='Snap360').click()
        mp.wait_for_url('**/akaunt/saobshteniya/*')
        expect(mp.locator('.msg-thread')).to_be_visible()
        expect(mp.locator('.msg-list')).to_be_hidden()
        no_page_scroll_x(mp, 390)
        mp.click('.ms-back')
        mp.wait_for_url(re.compile(r'/akaunt/saobshteniya$'))
        for path in ['/akaunt/poddrazhka', '/akaunt/poddrazhka/2026-0614-ЕА']:
            mp.goto(base + path); no_page_scroll_x(mp, 390)
        pm = b.new_context(**mob); sign_in(pm, base, 'partner'); mq = pm.new_page()
        for path in ['/partner/saobshteniya', f'/partner/saobshteniya/{melodia}', '/partner/poddrazhka', '/partner/poddrazhka/nov', '/partner/poddrazhka/2026-0614-ЕА']:
            mq.goto(base + path); no_page_scroll_x(mq, 390)
        step('at 390 px: list or thread, ‹Разговори› back link, no horizontal page scroll on any route')
        b.close()
    print(f'PASS — {len(STEPS)} steps')

if __name__ == '__main__':
    main()
