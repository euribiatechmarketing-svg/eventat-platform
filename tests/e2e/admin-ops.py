#!/usr/bin/env python3
"""End-to-end check of the admin operations screens with real clicks and typing.

Usage: python3 tests/e2e/admin-ops.py [--base http://localhost:3208] [--reseed]
Needs a freshly seeded database (npm run db:reset && npm run db:seed, or --reseed) behind the dev server, and
DATABASE_URL in the environment (or .env.local) pointing at the same database: the script checks
the database effect of each action through a small Node helper.
Exits non-zero on the first failure.
"""
import json, os, re, subprocess, sys, time
from urllib.parse import quote
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE = 'http://localhost:3208'
if '--base' in sys.argv:
    BASE = sys.argv[sys.argv.index('--base') + 1]

def env_db_url():
    if os.environ.get('DATABASE_URL'):
        return os.environ['DATABASE_URL']
    with open(os.path.join(ROOT, '.env.local')) as f:
        for line in f:
            if line.startswith('DATABASE_URL='):
                return line.split('=', 1)[1].strip()
    raise SystemExit('DATABASE_URL not set')

DB_URL = env_db_url()
NODE = os.path.expanduser('~/nodejs22/bin/node') if os.path.exists(os.path.expanduser('~/nodejs22/bin/node')) else 'node'
HELPER = """
const postgres = require(process.argv[1] + '/node_modules/postgres/cjs/src/index.js');
const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
sql.unsafe(process.argv[2]).then(r => { console.log(JSON.stringify(r)); return sql.end(); }).catch(e => { console.error(e.message); process.exit(1); });
"""

def db(query):
    out = subprocess.run([NODE, '-e', HELPER, ROOT, query], capture_output=True, text=True, env={**os.environ, 'DATABASE_URL': DB_URL})
    if out.returncode:
        raise RuntimeError(out.stderr)
    return json.loads(out.stdout)

def one(query):
    rows = db(query)
    return rows[0] if rows else None

DEMO = {
    'client': 'maria.dimitrova@gmail.com', 'partner': 'studio.melodia@gmail.com', 'admin': 'monika.kovacheva@eventat.bg',
    'moderator': 'georgi.petrov@eventat.bg',
}

def sign_in(ctx, who):
    r = ctx.request.post(BASE + '/api/auth/sign-in/email', data={'email': DEMO[who], 'password': 'eventat-demo'}, headers={'Origin': BASE})
    assert r.ok, f'sign-in {who} failed: {r.status} {r.text()[:200]}'

def toast(page, text):
    """The toast appears with this text; then wait for it to go so the next check sees a fresh one."""
    expect(page.locator('.ui-toast.is-on')).to_contain_text(text, timeout=20000)
    expect(page.locator('.ui-toast.is-on')).to_have_count(0, timeout=10000)

def step(name):
    print(f'· {name}', flush=True)

def go(page, path):
    page.goto(BASE + path, wait_until='domcontentloaded')
    page.wait_for_load_state('networkidle')

# Layout checks run in the page: controls on one line, nothing outside the viewport or hidden in a scroller.
LAYOUT_JS = r"""
() => {
  const W = document.documentElement.clientWidth;
  const out = { scrollWidth: document.documentElement.scrollWidth, wraps: [], cut: [] };
  const lines = e => {
    const r = document.createRange(); r.selectNodeContents(e);
    const tops = [...r.getClientRects()].filter(x => x.width > 1).map(x => Math.round(x.top + x.height / 2)).sort((a, b) => a - b);
    let n = 0, last = -999; for (const t of tops) { if (t - last > 8) { n++; last = t; } } return n;
  };
  for (const e of document.querySelectorAll('.btn, .badge, .chip, .tab-bar-item, .filter-btn, .ops-seg, .topbar-title, .rec-l, .kv-label, .gmv-l, .gmv-d, .side-item, .crumb')) {
    if (!e.getBoundingClientRect().width || e.closest('[hidden], .side')) continue;
    if (lines(e) > 1) out.wraps.push((e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 50));
  }
  for (const e of document.querySelectorAll('.content *')) {
    if (e.closest('svg') || e.children.length && !e.matches('td, .tab-bar-item, .btn, .badge, .chip, .filter-btn')) continue;
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
    let box = { left: 0, right: W }, p = e.parentElement;
    while (p && p !== document.body) { const st = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(st.overflowX)) { const pr = p.getBoundingClientRect(); box = { left: Math.max(box.left, pr.left), right: Math.min(box.right, pr.right) }; } p = p.parentElement; }
    if (r.right > box.right + 1 || r.left < box.left - 1) out.cut.push((e.innerText || e.tagName).trim().slice(0, 40));
  }
  return out;
}
"""

def check_layout(page, path, width):
    go(page, path)
    r = page.evaluate(LAYOUT_JS)
    assert r['scrollWidth'] <= width, f'{path} @{width}: page scrolls sideways ({r["scrollWidth"]})'
    assert not r['wraps'], f'{path} @{width}: wraps onto a second line: {r["wraps"]}'
    assert not r['cut'], f'{path} @{width}: cut off or hidden in a scroller: {r["cut"][:6]}'

def reseed():
    env = {**os.environ, 'DATABASE_URL': DB_URL, 'PATH': os.path.dirname(NODE) + os.pathsep + os.environ.get('PATH', '')}
    for script in ['db:reset', 'db:seed']:
        r = subprocess.run(['npm', 'run', script], cwd=ROOT, env=env, capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(r.stdout + r.stderr)
    time.sleep(6)  # the server caches the clock offset for 5 s

def main():
    if '--reseed' in sys.argv:
        reseed()
    with sync_playwright() as p:
        b = p.chromium.launch()
        page_errors = []

        # ── Guards ───────────────────────────────────────────────────────
        step('guards: guest, client and partner are sent away from admin routes')
        ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='bg-BG', timezone_id='Europe/Sofia')
        g = ctx.new_page()
        for path in ['/admin', '/admin/partnyori', '/admin/nastroyki/ekip', '/admin/klienti', '/admin/tarsene?q=a']:
            g.goto(BASE + path)
            assert '/vhod' in g.url, f'guest not redirected from {path}: {g.url}'
        ctx.close()
        for who, home in [('client', '/akaunt'), ('partner', '/partner')]:
            ctx = b.new_context(viewport={'width': 1440, 'height': 900})
            sign_in(ctx, who)
            g = ctx.new_page()
            g.goto(BASE + '/admin/moderatsiya')
            assert g.url.rstrip('/').endswith(home) or home + '/' in g.url or g.url.endswith(home), f'{who} not redirected: {g.url}'
            ctx.close()

        step('guards: a moderator has no settings, team or money columns')
        ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='bg-BG', timezone_id='Europe/Sofia')
        sign_in(ctx, 'moderator')
        m = ctx.new_page()
        go(m, '/admin/nastroyki')
        assert m.url.endswith('/admin'), m.url
        expect(m.locator('.gmv-l', has_text='Комисиона')).to_have_count(0)
        expect(m.locator('.gmv-l', has_text='Потвърдени резервации')).to_have_count(1)
        go(m, '/admin/partnyori')
        assert '/admin/partnyori' in m.url
        ctx.close()

        # ── Layout at both widths (review fixes) ─────────────────────────
        lunna = one("select id from partner where business_name = 'Лунна Фотография'")['id']
        maria = one("select id from \"user\" where email = 'maria.dimitrova@gmail.com'")['id']
        routes = ['/admin', '/admin/partnyori', f'/admin/partnyori/{lunna}', '/admin/moderatsiya', '/admin/klienti', f'/admin/klienti/{maria}',
                  '/admin/nastroyki', '/admin/nastroyki/ekip', '/admin/tarsene?q=' + quote('Мелодия')]
        for width, height in [(390, 844), (1440, 900)]:
            step(f'layout @{width}: no sideways scroll, nothing cut off, no wrapped controls')
            ctx = b.new_context(viewport={'width': width, 'height': height}, locale='bg-BG', timezone_id='Europe/Sofia')
            sign_in(ctx, 'admin')
            lp = ctx.new_page()
            for path in routes:
                check_layout(lp, path, width)
            if width == 390:
                # phone: tables become stacked rows with labelled amounts; the permission matrix names each role
                go(lp, f'/admin/klienti/{maria}')
                expect(lp.locator('.ops-tbl thead').first).to_be_hidden()
                assert lp.locator('.ops-tbl td[data-l="Комисиона"]').first.evaluate("e => getComputedStyle(e, '::before').content") == '"Комисиона"'
                expect(lp.locator('.topbar-title')).to_have_text('Мария Димитрова')
                go(lp, '/admin/nastroyki/ekip')
                assert lp.locator('.tm-cap td[data-role="Счетоводство"]').first.evaluate("e => getComputedStyle(e, '::after').content") == '"Счетоводство"'
                go(lp, '/admin/partnyori')
                expect(lp.locator('a.tab-bar-item:has-text("Деактивирани")')).to_be_in_viewport()
                # the topbar search hides on a phone; the list repeats it in the page
                go(lp, '/admin/klienti')
                expect(lp.locator('.topbar .search')).to_be_hidden()
                lp.fill('.ops-search--narrow input[name=q]', 'Мария')
                lp.press('.ops-search--narrow input[name=q]', 'Enter')
                lp.wait_for_url(re.compile(r'/admin/klienti\?q='))
                expect(lp.locator('a.rec')).to_have_count(1)
            else:
                go(lp, '/admin/klienti')
                expect(lp.locator('.ops-search--narrow')).to_be_hidden()
            ctx.close()

        # ── Admin session ────────────────────────────────────────────────
        ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='bg-BG', timezone_id='Europe/Sofia')
        sign_in(ctx, 'admin')
        page = ctx.new_page()
        page.on('pageerror', lambda e: page_errors.append(str(e)))
        page.on('response', lambda r: page_errors.append(f'HTTP {r.status} {r.url}') if r.status >= 500 else None)

        # ── Dashboard ────────────────────────────────────────────────────
        step('dashboard: rail icons, initials and the registrations in queue order (admin/dashboard.html)')
        go(page, '/admin')
        assert 'M3 21V8l9-5 9 5v13' in page.locator('.side-item:has-text("Изпълнители") svg').inner_html()
        assert 'M12 3l9.5 17h-19L12 3z' in page.locator('.side-item:has-text("Спорове") svg').inner_html()
        expect(page.locator('.mini:has-text("Тортите на Мими") .avatar')).to_have_text('ТМ')
        regs = page.locator('section:has(h2:has-text("Нови регистрации")) .mini-n').all_inner_texts()
        assert regs[0] == 'Лунна Фотография' and regs[-1] == 'Тортите на Мими', regs

        step('dashboard: period, city filter, export')
        go(page, '/admin')
        expect(page.locator('h1.page-title')).to_have_text('Август 2025')
        page.click('.seg a:has-text("Тримесечие")')
        page.wait_for_url(re.compile(r'period=quarter'))
        expect(page.locator('h1.page-title')).to_have_text('Юли – септември 2025')
        page.click('.seg a:has-text("Месец")')
        page.wait_for_url(re.compile(r'/admin$'))
        page.click('button.filter-btn:has-text("Всички градове")')
        page.click('.ui-menu a:has-text("София")')
        page.wait_for_url(re.compile(r'grad=sofia'))
        expect(page.locator('button.filter-btn:has-text("София")')).to_be_visible()
        before = one("select count(*)::int n from report_job where kind = 'admin_dashboard'")['n']
        page.click('button:has-text("Експорт")')
        toast(page, 'Справката се подготвя — ще я получите по имейл')
        assert one("select count(*)::int n from report_job where kind = 'admin_dashboard'")['n'] == before + 1
        page.click('a.rec[href="/admin/partnyori"]')
        page.wait_for_url(re.compile(r'/admin/partnyori$'))

        # ── Partners ─────────────────────────────────────────────────────
        step('partners: invite a partner by email')
        page.click('button:has-text("Покани изпълнител")')
        page.fill('.ops-modal input[name=email]', 'nov.partnyor@example.com')
        page.click('.ops-modal button[type=submit]:has-text("Изпрати покана")')
        toast(page, 'Поканата е изпратена')
        assert one("select count(*)::int n from email_outbox where template_key = 'vendor-invite' and to_email = 'nov.partnyor@example.com'")['n'] == 1

        step('partners: tabs and filters')
        page.click('a.tab-bar-item:has-text("Активни")')
        page.wait_for_url(re.compile(r'tab=aktivni'))
        expect(page.locator('a.rec:has-text("Студио Мелодия")')).to_be_visible()
        page.click('button.filter-btn:has-text("Категория")')
        page.click('.ui-menu a:has-text("Кетъринг")')
        page.wait_for_url(re.compile(r'kategoriya=ketaring'))
        expect(page.locator('a.rec')).to_have_count(int(one("select count(*)::int n from partner p join category c on c.id = p.primary_category_id where p.status = 'approved' and c.slug = 'ketaring'")['n']))
        page.fill('.topbar input[name=q]', 'Вкусна')
        page.press('.topbar input[name=q]', 'Enter')
        page.wait_for_url(re.compile(r'q='))
        expect(page.locator('a.rec')).to_have_count(1)
        go(page, '/admin/partnyori')

        step('partners: the queue panel reads the notes only; sub-lines keep names whole')
        expect(page.locator('a.rec.is-sel')).to_contain_text('Лунна Фотография')
        expect(page.locator('aside form.ops-note')).to_have_count(0)
        expect(page.locator('a.rec.is-sel .rec-s .ops-nb', has_text='Емилия Стоянова')).to_have_count(1)

        step('application page: prototype wording, record title and the list search in the topbar')
        go(page, f'/admin/partnyori/{lunna}')
        expect(page.locator('.topbar-title')).to_have_text('Изпълнител · Лунна Фотография')
        expect(page.locator('.kv-item:has-text("Фирма") small')).to_have_text('седалище Пловдив')
        expect(page.locator('.kv-item:has-text("Телефон") small')).to_have_text('потвърден')
        expect(page.locator('.chk:has-text("ЕИК проверен") .chk-d')).to_have_text('207845112 · Лунна Фотография ЕООД · данните съвпадат с Търговския регистър')
        expect(page.locator('.chk:has-text("Контакти потвърдени") .chk-d')).to_have_text('Имейлът и телефонът са потвърдени на 29 август')
        expect(page.locator('.chk:has-text("Политика за анулиране") .chk-d')).to_have_text('Умерена · безплатно анулиране до 30 дни преди събитието')
        expect(page.locator('.chk:has-text("Банкова сметка") .chk-d')).to_have_text('IBAN подаден в Пощенска банка, чака потвърждение от банката')
        expect(page.locator('.topbar input[name=q]')).to_have_attribute('placeholder', 'Търси по име, категория или град')
        page.fill('.topbar input[name=q]', 'Балон')
        page.press('.topbar input[name=q]', 'Enter')
        page.wait_for_url(re.compile(r'/admin/partnyori\?q='))
        expect(page.locator('a.rec')).to_have_count(1)
        expect(page.locator('.topbar-title')).to_have_text('Изпълнители')
        go(page, '/admin/partnyori')

        step('partners: return the oldest application from the side panel (note required)')
        expect(page.locator('a.rec.is-sel')).to_contain_text('Лунна Фотография')
        page.click('aside button:has-text("Върни за поправка")')
        page.click('.ops-modal button[type=submit]:has-text("Върни за поправка")')
        expect(page.locator('.ops-modal')).to_be_visible()  # the browser refuses an empty required note
        page.fill('.ops-modal textarea[name=note]', 'Моля, добавете цените за видеозаснемането.')
        page.click('.ops-modal button[type=submit]:has-text("Върни за поправка")')
        toast(page, 'Профилът е върнат за поправка')
        assert one("select status from partner where business_name = 'Лунна Фотография'")['status'] == 'returned'
        assert one("select count(*)::int n from email_outbox where template_key = 'vendor-application-returned'")['n'] == 1

        step('application page: a team check, a note, then approve')
        pid = one("select id from partner where business_name = 'Балон Градина'")['id']
        go(page, f'/admin/partnyori/{pid}')
        expect(page.locator('h1.page-title')).to_have_text('Профил на изпълнител')
        page.click('.chk:has-text("Собствени снимки") .chk-box')
        toast(page, 'Промените са запазени')
        assert one(f"select state from partner_check where partner_id = '{pid}' and kind = 'gallery'")['state'] == 'waiting'
        page.click('.chk:has-text("Собствени снимки") button:has-text("Провери")')
        toast(page, 'Промените са запазени')
        assert one(f"select state from partner_check where partner_id = '{pid}' and kind = 'gallery'")['state'] == 'ok'
        page.fill('form.ops-note textarea', 'Проверих галерията, снимките са собствени.')
        page.click('h1.page-title')
        toast(page, 'Бележката е запазена')
        expect(page.locator('.rev-text', has_text='Проверих галерията')).to_be_visible()
        page.fill('aside textarea[name=note]', 'Добре дошли в EventAT.')
        page.click('aside button:has-text("Одобри")')
        toast(page, 'Профилът е одобрен')
        page.wait_for_url(re.compile(r'/admin/partnyori$'))
        assert one(f"select status from partner where id = '{pid}'")['status'] == 'approved'

        step('application page: reject with a reason')
        pid = one("select id from partner where business_name = 'DJ Живко'")['id']
        go(page, f'/admin/partnyori/{pid}')
        page.fill('aside textarea[name=note]', 'Профилът не отговаря на условията за партньори.')
        page.click('aside button:has-text("Откажи заявката")')
        toast(page, 'Заявката е отказана')
        assert one(f"select status from partner where id = '{pid}'")['status'] == 'rejected'

        step('partners: reject from the queue panel (admin/vendors.html toast)')
        go(page, '/admin/partnyori')
        expect(page.locator('a.rec.is-sel')).to_contain_text('Тортите на Мими')
        page.click('aside button:has-text("Откажи заявката")')
        page.fill('.ops-modal textarea[name=note]', 'Липсват снимки на собствени торти.')
        page.click('.ops-modal button[type=submit]:has-text("Откажи заявката")')
        toast(page, 'Заявката е отказана — изпратихме имейл с мотива')
        assert one("select status from partner where business_name = 'Тортите на Мими'")['status'] == 'rejected'

        # ── Moderation ───────────────────────────────────────────────────
        step('moderation: filter, approve an edit, publish, return with a common note')
        go(page, '/admin/moderatsiya')
        page.click('.seg a:has-text("Редакции")')
        page.wait_for_url(re.compile(r'filter=redakcii'))
        expect(page.locator('.mod')).to_have_count(1)
        page.click('.mod:has-text("Меню „Градина“") button:has-text("Одобри")')
        toast(page, 'Промяната е одобрена')
        assert one("select price_cents from service where name = 'Меню „Градина“'")['price_cents'] == 3200
        page.click('.seg a:has-text("Нови")')
        page.wait_for_url(re.compile(r'filter=novi'))
        page.click('.mod:has-text("Фотокабина „360 Premium“") button:has-text("Върни с бележка")')
        expect(page.locator('.ops-modal-title .num')).to_have_text('360')  # digits in a display-font title
        page.keyboard.press('Escape')
        expect(page.locator('.ops-modal')).to_have_count(0)
        page.click('.mod:has-text("Фотокабина „360 Premium“") button:has-text("Публикувай")')
        toast(page, 'Обявата е публикувана')
        assert one("select status from service where name = 'Фотокабина „360 Premium“'")['status'] == 'active'
        page.click('aside button.chip:has-text("Телефон в описанието")')  # ‹Чести бележки› side card: pick a note
        expect(page.locator('aside button.chip.is-on')).to_have_text('Телефон в описанието')
        page.click('.mod:has-text("Струнен дует") button:has-text("Върни с бележка")')
        expect(page.locator('.ops-modal textarea[name=note]')).to_have_value('Телефон в описанието.')
        page.click('.ops-modal button.chip:has-text("Няма продължителност")')
        expect(page.locator('.ops-modal textarea[name=note]')).to_have_value('Телефон в описанието. Няма продължителност.')
        page.click('.ops-modal button[type=submit]:has-text("Върни с бележка")')
        toast(page, 'Обявата е върната с бележка')
        assert one("select status from service where name = 'Струнен дует за церемония'")['status'] == 'returned'
        assert 'Телефон в описанието' in one("select note from service_revision r join service s on s.id = r.service_id where s.name = 'Струнен дует за церемония' order by r.decided_at desc nulls last limit 1")['note']
        expect(page.locator('aside button.chip.is-on')).to_have_count(0)  # sent: the picks are cleared
        page.fill('.topbar input[name=q]', 'Флора')
        page.press('.topbar input[name=q]', 'Enter')
        page.wait_for_url(re.compile(r'q=%D0%A4'))
        expect(page.locator('.mod')).to_have_count(1)

        # ── Clients ──────────────────────────────────────────────────────
        step('clients: tabs, filters and search')
        go(page, '/admin/klienti')
        page.click('a.tab-bar-item:has-text("Бизнес клиенти")')
        page.wait_for_url(re.compile(r'tab=biznes'))
        expect(page.locator('a.rec')).to_have_count(3)
        page.click('button.filter-btn:has-text("Град")')
        page.click('.ui-menu a:has-text("София")')
        page.wait_for_url(re.compile(r'grad=sofia'))
        page.click('a.tab-bar-item:has-text("Всички")')
        page.click('button.filter-btn:has-text("Регистрация")')
        page.click('.ui-menu a:has-text("Последните 30 дни")')
        page.wait_for_url(re.compile(r'registratsiya=30-dni'))
        go(page, '/admin/klienti')
        page.fill('.topbar input[name=q]', 'Мария')
        page.press('.topbar input[name=q]', 'Enter')
        page.wait_for_url(re.compile(r'q='))
        expect(page.locator('a.rec')).to_have_count(1)
        page.click('a.rec:has-text("Мария Димитрова")')
        page.wait_for_url(re.compile(r'/admin/klienti/\w+'))

        step('client profile: title, search, bookings coming first, requests grouped by event (admin/client.html)')
        expect(page.locator('h1.page-title')).to_have_text('Профил на клиент')
        expect(page.locator('.topbar-title')).to_have_text('Клиент · Мария Димитрова')
        expect(page.locator('.topbar input[name=q]')).to_have_attribute('placeholder', 'Търси по име, имейл или телефон')
        nums = page.locator('section:has(h2:has-text("Резервации")) tbody tr td:first-child .tbl-event').all_inner_texts()
        assert nums[0].startswith('2026-0614') and nums[-1].startswith('2025-'), nums
        reqs = page.locator('section:has(h2:has-text("Заявки")) tbody tr td:first-child .tbl-event').all_inner_texts()
        assert [r[:9] for r in reqs] == ['2026-0614'] * 3 + ['2026-1219'] * 3, reqs

        step('client profile: contact, internal note')
        page.click('a:has-text("Свържи се")')
        toast(page, 'Отваряме имейл до клиента')
        page.fill('form.ops-note textarea', 'Обади се за фактура на фирма.')
        page.click('h1.page-title')
        toast(page, 'Бележката е запазена')
        expect(page.locator('.rev-text', has_text='Обади се за фактура')).to_be_visible()

        step('client profile: block (confirm dialog)')
        cid = one("select id from \"user\" where email = 'georgi.kolev@example.invalid'")['id']
        go(page, f'/admin/klienti/{cid}')
        page.click('button:has-text("Блокирай профила")')
        page.click('.ops-modal button[type=submit]:has-text("Блокирай профила")')
        toast(page, 'Профилът е блокиран')
        page.wait_for_url(re.compile(r'/admin/klienti$'))
        assert one(f"select banned from \"user\" where id = '{cid}'")['banned'] is True
        expect(page.locator('a.rec:has-text("Георги Колев") .badge')).to_have_text('Блокиран')

        # ── Team ─────────────────────────────────────────────────────────
        step('team: invites oldest first; an older activity reads ‹Вчера, 17:40› once')
        go(page, '/admin/nastroyki/ekip')
        expect(page.locator('.tm-inv').first).to_contain_text('ivan.marinov@eventat.bg')
        row = page.locator('tr:has-text("Красимир Йотов") td').nth(3)
        expect(row.locator('.tbl-event')).to_have_text(re.compile(r'^Вчера, \d\d:\d\d$'))
        expect(row.locator('.tbl-sub')).to_have_count(0)

        step('team: invite, revoke, remove')
        go(page, '/admin/nastroyki/ekip')
        page.fill('input[name=email]', 'test.member@eventat.bg')
        page.select_option('select[name=role]', 'support')
        page.click('button:has-text("Изпрати покана")')
        toast(page, 'Поканата е изпратена')
        expect(page.locator('.tm-inv', has_text='test.member@eventat.bg')).to_be_visible()
        page.click('.tm-inv:has-text("ivan.marinov@eventat.bg") button:has-text("Оттегли")')
        toast(page, 'Поканата е оттеглена')
        expect(page.locator('.tm-inv', has_text='ivan.marinov@eventat.bg')).to_have_count(0)
        page.click('tr:has-text("Даниела Вълчева") button:has-text("Премахни")')
        page.click('.ops-modal button[type=submit]:has-text("Премахни")')
        toast(page, 'Премахнато')
        expect(page.locator('tr:has-text("Даниела Вълчева")')).to_have_count(0)
        assert one("select status from team_member tm join \"user\" u on u.id = tm.user_id where u.email = 'daniela.valcheva@eventat.bg'")['status'] == 'removed'

        step('invite link: a new team member chooses a password and lands in the panel')
        url = one("select vars->>'url' as url from email_outbox where template_key = 'team-invite' and to_email = 'test.member@eventat.bg' order by created_at desc limit 1")['url']
        ictx = b.new_context(viewport={'width': 390, 'height': 844}, locale='bg-BG', timezone_id='Europe/Sofia')
        ip = ictx.new_page()
        ip.goto(BASE + '/admin/pokana/' + quote(url.rsplit('/', 1)[1]))
        expect(ip.locator('h1')).to_have_text('Покана в екипа на EventAT')
        ip.fill('input[name=name]', 'Тест Членов')
        ip.fill('input[name=password]', 'parola-za-test-1')
        ip.click('button:has-text("Приеми поканата")')
        ip.wait_for_url(re.compile(r'/admin$'), timeout=30000)
        expect(ip.locator('.side-user-name')).to_have_text('Тест Членов')
        assert one("select tm.role::text r from team_member tm join \"user\" u on u.id = tm.user_id where u.email = 'test.member@eventat.bg'")['r'] == 'support'
        ictx.close()

        # ── Settings ─────────────────────────────────────────────────────
        step('settings: commission, category toggle, cancel')
        go(page, '/admin/nastroyki')
        page.fill('input[name="commission.standard"]', '12')
        page.click('.cat-row:has-text("Транспорт за гости") button.toggle')
        page.click('button:has-text("Запази промените")')
        toast(page, 'Промените са запазени')
        assert one("select value::text v from platform_settings where key = 'commission.standard_bp' order by effective_from desc, created_at desc limit 1")['v'] == '1200'
        assert one("select is_visible from category where slug = 'transport-za-gosti'")['is_visible'] is True
        expect(page.locator('input[name="commission.standard"]')).to_have_value('12')
        page.fill('input[name="commission.standard"]', '15')
        page.click('button:has-text("Откажи")')
        toast(page, 'Промените са отменени')
        expect(page.locator('input[name="commission.standard"]')).to_have_value('12')

        step('settings: edit the cancellation policies')
        page.click('button:has-text("Редактирай")')
        toast(page, 'Можете да редактирате данните')
        page.fill('input[name="policy.flexible.0"]', '10')
        expect(page.locator('.set-d', has_text='Гъвкава (до 10 дни)')).to_be_visible()
        page.click('button:has-text("Запази промените")')
        toast(page, 'Промените са запазени')
        expect(page.locator('.set-d', has_text='Гъвкава (до 10 дни)')).to_be_visible()
        pol = json.loads(one("select value::text v from platform_settings where key = 'cancellation.policies' order by effective_from desc, created_at desc limit 1")['v'])
        assert pol['flexible']['tiers'][0]['minDaysBefore'] == 10, pol

        step('settings: add a category, toggle moderation, search')
        page.click('button:has-text("Добави категория")')
        page.fill('.ops-modal input[name=name]', 'Аниматори')
        page.click('.ops-modal button[type=submit]:has-text("Добави категория")')
        toast(page, 'Категорията е добавена')
        expect(page.locator('.cat-row', has_text='Аниматори')).to_be_visible()
        page.click('.set-row:has-text("Ръчна модерация") button.toggle')
        page.click('button:has-text("Запази промените")')
        toast(page, 'Промените са запазени')
        assert one("select value::text v from platform_settings where key = 'moderation.manual' order by effective_from desc, created_at desc limit 1")['v'] == 'false'
        page.fill('.topbar input[name=q]', 'English')
        page.press('.topbar input[name=q]', 'Enter')
        page.wait_for_url(re.compile(r'q=English'))
        expect(page.locator('.set-row:has-text("English")')).to_be_visible()
        expect(page.locator('.set-row:has-text("Ръчна модерация")')).to_be_hidden()

        step('settings: team preview leads to the team page')
        go(page, '/admin/nastroyki')
        page.click('a:has-text("Покани в екипа")')
        page.wait_for_url(re.compile(r'/admin/nastroyki/ekip$'))

        # ── Search ───────────────────────────────────────────────────────
        step('search: topbar search lists partners, clients and bookings; a number opens the booking')
        go(page, '/admin')
        page.fill('.topbar input[name=q]', 'Мелодия')
        page.press('.topbar input[name=q]', 'Enter')
        page.wait_for_url(re.compile(r'/admin/tarsene\?q='))
        expect(page.locator('a.rec[href^="/admin/partnyori/"]:has-text("Студио Мелодия")')).to_be_visible()
        expect(page.locator('a.rec[href^="/admin/rezervacii/"]').first).to_be_visible()
        page.fill('.ops-search--page input[name=q]', '2026-0614-еа')  # lower case: the number still opens the booking
        page.press('.ops-search--page input[name=q]', 'Enter')
        page.wait_for_url(re.compile(r'/admin/rezervacii/2026-0614-'))

        # ── Demo clock (last: it moves time for everything after it) ─────
        step('settings: the demo clock moves forward and runs due jobs')
        go(page, '/admin/nastroyki')
        before = page.locator('.ops-clock-v').inner_text()
        page.click('.ops-clock-acts button:has-text("+1 ден")')
        toast(page, 'Промените са запазени')
        expect(page.locator('.ops-clock-v')).to_contain_text('1 септември 2025')
        assert before != page.locator('.ops-clock-v').inner_text()

        assert not page_errors, page_errors
        ctx.close()
        b.close()
    print('ALL PASSED')

if __name__ == '__main__':
    main()
