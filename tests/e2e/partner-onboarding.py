#!/usr/bin/env python3
"""End-to-end test of the partner sign-up wizard (SCREENS §6) with real clicks and typing.

Usage:  python3 tests/e2e/partner-onboarding.py [--base http://localhost:3205] [--headed]
Needs:  a running dev server on the worktree's own database (.env.local), seeded (npm run db:seed).
        It creates fresh draft partners (tests/e2e/onboarding-setup.ts) and takes the team's
        decisions through the domain (tests/e2e/onboarding-admin.ts).
"""
import json, os, re, subprocess, sys, time
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ARGS = sys.argv[1:]
BASE = ARGS[ARGS.index('--base') + 1] if '--base' in ARGS else 'http://localhost:3205'
HEADED = '--headed' in ARGS
ENV = {**os.environ, 'PATH': os.path.expanduser('~/nodejs22/bin') + ':' + os.environ.get('PATH', '')}
PHOTOS = [os.path.join(ROOT, 'public/photos', f) for f in ['v1-dj-mod.jpg', 'v1-dj-doc.jpg', 'v1-dj-perf.jpg', 'dancers.jpg', 'booth.jpg']]
STAMP = str(int(time.time()))
R = '/partner/registratsiya'
passed = []


def node(*cmd):
    r = subprocess.run(cmd, cwd=ROOT, env=ENV, capture_output=True, text=True, timeout=120)
    if r.returncode:
        raise RuntimeError(f'{cmd}: {r.stderr[-800:]}')
    return r.stdout.strip()


def tsx(script, *args):
    return node('npx', 'tsx', '--conditions=react-server', f'tests/e2e/{script}', *args).splitlines()[-1]


def q(sql):
    return json.loads(node('node', 'tests/e2e/query.mjs', sql))


def one(sql):
    rows = q(sql)
    return rows[0] if rows else None


def ok(name):
    passed.append(name)
    print(f'  ok  {name}')


def toast(page, text):
    expect(page.locator('.ui-toast.is-on')).to_contain_text(text, timeout=15000)


def sign_in(page, email):
    r = page.request.post(BASE + '/api/auth/sign-in/email', data={'email': email, 'password': 'eventat-demo'}, headers={'Origin': BASE})
    assert r.ok, f'sign-in {email}: {r.status} {r.text()[:200]}'


def partner(email):
    return one(f"""select p.* from partner p join partner_member m on m.partner_id = p.id join "user" u on u.id = m.user_id
                   where u.email = '{email}'""")


def wait_url(page, pattern):
    page.wait_for_url(re.compile(pattern), timeout=20000)


def continue_(page):
    page.locator('.wiz-footer-actions .btn--primary').click()


# Phone checks (390 px). A control's hit area: walk out from its centre while the hit-test
# still lands on it (an invisible ::before can enlarge a small drawn control).
HIT_JS = """sel => [...document.querySelectorAll(sel)].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map(el => {
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const hits = (x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === el || el.contains(h)); };
  const reach = (dx, dy) => { let d = 0; while (d < 40 && hits(cx + dx * (d + 1), cy + dy * (d + 1))) d++; return d; };
  return { what: (el.innerText || el.getAttribute('aria-label') || el.className).trim().slice(0, 30), w: reach(-1, 0) + reach(1, 0) + 1, h: reach(0, -1) + reach(0, 1) + 1 };
})"""
OVERFLOW_JS = """() => {
  const vw = innerWidth, out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
    if (r.right <= vw + 0.5 && r.left >= -0.5) continue;
    let p = el.parentElement, scroller = false;
    for (; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (/(auto|scroll|hidden|clip)/.test(o) && p.scrollWidth > p.clientWidth + 1) { scroller = true; break; } }
    if (!scroller) out.push(el.tagName + '.' + el.className);
  }
  return { sw: document.documentElement.scrollWidth, cut: out.slice(0, 5) };
}"""
SMALL_CONTROLS = '.m-step-btn, .wiz-top-link, .lang .ui-click, .btn--sm, .calendar-head .btn, .gallery-action, .review-section-head a'


def phone_layout(page, path):
    r = page.evaluate(OVERFLOW_JS)
    assert r['sw'] <= 390 and not r['cut'], (path, r)
    small = [c for c in page.evaluate(HIT_JS, SMALL_CONTROLS) if c['h'] < 40 or c['w'] < 32]
    assert not small, (path, small)


def run():
    email = f'onb-{STAMP}@example.test'
    tsx('onboarding-setup.ts', email, 'Студио Тест', 'Иван Петров', '+359887001122')

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not HEADED)
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, locale='bg-BG', timezone_id='Europe/Sofia')
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))

        # ── guards ───────────────────────────────────────────────────────
        page.goto(BASE + R + '/1')
        wait_url(page, r'/vhod\?next=')
        ok('guest is sent to sign-in')

        sign_in(page, 'maria.dimitrova@gmail.com')
        page.goto(BASE + R + '/1')
        assert '/registratsiya' not in page.url, page.url
        ok('a client is sent to her own home')
        ctx.clear_cookies()

        sign_in(page, 'studio.melodia@gmail.com')
        page.goto(BASE + R + '/1')
        wait_url(page, r'/partner$')
        ok('an approved partner is sent to the panel')
        ctx.clear_cookies()

        sign_in(page, email)
        page.goto(BASE + R)
        wait_url(page, R + '/1$')
        expect(page.locator('.wiz-step-title')).to_have_text('Да започнем с основите.')
        page.goto(BASE + R + '/3')
        wait_url(page, R + '/1$')
        ok('draft partner lands on step 1; unfinished steps are not reachable')

        # ── language switch ──────────────────────────────────────────────
        page.locator('.wiz-top .lang span[role=button]').click()
        toast(page, 'Английската версия идва скоро')
        ok('EN answers with a toast')

        # ── step 1 ───────────────────────────────────────────────────────
        continue_(page)
        expect(page.locator('.m-form-alert')).to_contain_text('Попълнете отбелязаните полета.')
        expect(page.locator('.field--error:has(#f-eik) .field-message')).to_have_text('Попълнете полето.')
        ok('step 1 shows field errors when empty')

        page.select_option('#f-legalForm', 'eood')
        page.fill('#f-eik', '123456789')
        page.select_option('#f-primaryCategoryId', label='DJ и озвучаване')
        page.select_option('#f-cityId', label='София')
        page.select_option('#f-radius', '150')
        page.select_option('#f-experienceBand', 'gt_10')
        page.fill('#f-languages', 'Български, английски')
        page.fill('#f-socialHandle', '@studio.test')
        page.fill('#f-businessName', 'Студио Тест Плюс')
        continue_(page)
        expect(page.locator('.field--error:has(#f-eik) .field-message')).to_have_text('Проверете ЕИК / Булстат.')
        ok('invalid EIK is refused')

        page.fill('#f-eik', '204512384')
        continue_(page)
        wait_url(page, R + '/2$')
        row = partner(email)
        assert row['eik'] == '204512384' and row['business_name'] == 'Студио Тест Плюс' and row['legal_form'] == 'eood', row
        assert row['onboarding_step'] == 2 and row['languages'] == ['Български', 'английски'], row
        expect(page.locator('.wiz-step--done').first).to_contain_text('Студио Тест Плюс · София')
        ok('step 1 saved; rail shows ‹Име · Град›')

        # ── step 2 ───────────────────────────────────────────────────────
        page.locator('.wiz-footer-actions .btn--ghost').click()
        wait_url(page, R + '/1$')
        page.locator('.wiz-step:nth-child(2) .m-step-btn').click()
        wait_url(page, R + '/2$')
        ok('‹Назад› and the steps rail navigate')

        # Review fix: the whole rail row has the pointer cursor, so its top band must navigate too.
        page.locator('.wiz-footer-actions .btn--ghost').click()
        wait_url(page, R + '/1$')
        box = page.locator('.wiz-step').nth(1).bounding_box()
        assert page.evaluate('([x, y]) => getComputedStyle(document.elementFromPoint(x, y)).cursor', [box['x'] + 60, box['y'] + 3]) == 'pointer'
        page.mouse.click(box['x'] + 60, box['y'] + 3)
        wait_url(page, R + '/2$')
        ok('the rail row band (pointer cursor) navigates, not only the label')

        page.fill('#f-shortDescription', 'DJ и озвучаване за сватби и фирмени събития.')
        expect(page.locator('.field:has(#f-shortDescription) .m-counter')).to_have_text('44')
        expect(page.locator('.wiz-save-status')).to_have_text('Запазено току-що', timeout=15000)
        for _ in range(20):
            if (partner(email)['short_description'] or '').startswith('DJ и озвучаване'):
                break
            time.sleep(0.5)
        assert partner(email)['short_description'] == 'DJ и озвучаване за сватби и фирмени събития.'
        ok('typing saves the draft by itself (‹Запазено току-що›)')

        # Review fix: the dashed avatar circle looks like the cover's drop area, so it opens the picker too.
        with page.expect_file_chooser() as fc:
            page.locator('.upload--circle .m-avatar-pick').click()
        fc.value.set_files(PHOTOS[1])
        toast(page, 'Снимката е качена')
        expect(page.locator('.upload--circle .avatar img')).to_be_visible()
        expect(page.locator('.upload-meta .btn')).to_have_text('Смени снимката')
        first_avatar = partner(email)['avatar_media_id']
        assert first_avatar
        page.wait_for_timeout(3500)
        with page.expect_file_chooser() as fc:
            page.locator('.upload-meta .btn').click()
        fc.value.set_files(PHOTOS[2])
        toast(page, 'Снимката е обновена')
        for _ in range(20):
            if partner(email)['avatar_media_id'] != first_avatar:
                break
            time.sleep(0.5)
        assert partner(email)['avatar_media_id'] != first_avatar
        ok('profile photo: the circle uploads (‹Снимката е качена›), ‹Смени снимката› replaces (‹Снимката е обновена›)')

        with page.expect_file_chooser() as fc:
            page.locator('.upload--cover .upload-preview').click()
        fc.value.set_files(PHOTOS[0])
        toast(page, 'Снимката е качена')
        expect(page.locator('.upload--cover .upload-preview--placeholder')).to_have_count(0)
        assert partner(email)['cover_media_id']
        page.wait_for_timeout(3500)
        with page.expect_file_chooser() as fc:
            page.locator('.upload--cover .upload-preview').click()
        fc.value.set_files(PHOTOS[3])
        toast(page, 'Снимката е обновена')
        ok('cover upload, and a replaced cover toasts ‹Снимката е обновена›')

        with page.expect_file_chooser() as fc:
            page.locator('.gallery-add').click()
        fc.value.set_files(PHOTOS)
        toast(page, 'Снимката е добавена')
        expect(page.locator('.gallery-item')).to_have_count(5)
        expect(page.locator('.wiz-fieldset-head .badge')).to_have_text('5 / 8')
        expect(page.locator('.gallery-item').first.locator('.gallery-tag')).to_have_text('Главна')
        page.locator('.gallery-item').nth(0).hover()
        page.locator('.gallery-item').nth(0).locator('.gallery-action').click()
        toast(page, 'Снимката е премахната')
        expect(page.locator('.gallery-item')).to_have_count(4)
        expect(page.locator('.gallery-item').first.locator('.gallery-tag')).to_have_text('Главна')
        n = one(f"select count(*)::int n from partner_photo where partner_id = '{partner(email)['id']}'")['n']
        assert n == 4, n
        ok('gallery: add five, remove one, next photo becomes ‹Главна›')

        with page.expect_file_chooser() as fc:
            page.locator('.gallery-add').click()
        fc.value.set_files(files=[{'name': 'big.jpg', 'mimeType': 'image/jpeg', 'buffer': b'\xff\xd8\xff' + b'\0' * (6 * 1024 * 1024)}])
        expect(page.locator('.ui-toast.is-on')).to_contain_text('JPG или PNG · до 5 MB', timeout=15000)
        expect(page.locator('.gallery-item')).to_have_count(4)
        ok('a photo over 5 MB is refused with the upload rule')

        page.locator('.chips .chip', has_text=re.compile('^Сватби$')).click()
        page.locator('.chips .chip', has_text=re.compile('^Озвучаване$')).click()
        expect(page.locator('.chips .chip', has_text=re.compile('^Сватби$'))).to_have_attribute('aria-pressed', 'true')
        page.locator('.chip--add').click()
        page.locator('.m-chip-input').fill('Сватбени шествия')
        page.locator('.m-chip-input').press('Enter')
        toast(page, 'Категорията е добавена')
        expect(page.locator('.chips .chip--active', has_text='Сватбени шествия')).to_be_visible()
        ok('specialisation chips and ‹Друго›')

        page.fill('#f-description', 'Над 10 години озвучаваме сватби и фирмени събития в София и страната.')
        page.fill('#f-videoUrl', 'https://example.com/video')
        continue_(page)
        expect(page.locator('.field--error:has(#f-videoUrl) .field-message')).to_have_text('Линк към YouTube или Vimeo.')
        page.fill('#f-videoUrl', 'https://youtube.com/watch?v=abc123')
        continue_(page)
        wait_url(page, R + '/3$')
        pid = partner(email)['id']
        assert one(f"select count(*)::int n from partner_event_type where partner_id = '{pid}'")['n'] == 1
        tags = {r['label']: r['is_custom'] for r in q(f"select label, is_custom from partner_tag where partner_id = '{pid}'")}
        assert tags == {'Озвучаване': False, 'Сватбени шествия': True}, tags
        expect(page.locator('.wiz-step--done').nth(1)).to_contain_text('Представяне и 4 снимки')
        ok('step 2 saved (event types, tags, video)')

        # ── step 3 ───────────────────────────────────────────────────────
        editors = page.locator('.card.m-pkg')
        expect(editors).to_have_count(1)
        continue_(page)
        expect(page.locator('.m-form-alert')).to_be_visible()
        ok('step 3 needs a package')

        first = editors.nth(0)
        first.locator('input[name$=".name"]').fill('Пакет „Цял ден“')
        expect(first.locator('.wiz-fieldset-title')).to_have_text('Пакет „Цял ден“')
        first.locator('textarea[name$=".description"]').fill('DJ, озвучаване за церемония и парти, диско осветление.')
        first.locator('input[name$=".inc"]').first.fill('DJ през цялото събитие')
        first.locator('.checklist-add').click()
        toast(page, 'Добавена е нова точка')
        first.locator('input[name$=".inc"]').nth(1).fill('Диско осветление')
        first.locator('input[name$=".price"]').fill('1 450')
        first.locator('input[name$=".duration"]').fill('До 10 часа')
        first.locator('input[name$=".extraHour"] + .check-box').click()
        first.locator('.m-inline-amount').fill('150')
        first.locator('input[name$=".travel"] + .check-box').click()

        page.get_by_role('button', name='Добави пакет').click()
        toast(page, 'Добавен е нов пакет')
        second = editors.nth(1)
        second.locator('input[name$=".name"]').fill('Пакет „Вечер“')
        second.locator('textarea[name$=".description"]').fill('5 часа музика и озвучаване.')
        second.locator('input[name$=".price"]').fill('640')

        page.get_by_role('button', name='Добави услуга по запитване').click()
        toast(page, 'Добавена е услуга по запитване')
        third = editors.nth(2)
        third.locator('input[name$=".name"]').fill('Фирмени събития')
        third.locator('textarea[name$=".description"]').fill('Озвучаване, сцена, техник на място.')
        expect(third.locator('input[name$=".price"]')).to_have_count(0)

        first.get_by_role('button', name='Свий').click()
        expect(first.locator('.m-pkg-body')).to_be_hidden()
        first.get_by_role('button', name='Разгъни').click()
        expect(first.locator('.m-pkg-body')).to_be_visible()
        ok('package editor: points, extras, collapse')

        # Let the background save create the packages, then remove the second one on the server.
        expect(page.locator('.wiz-save-status')).to_have_text('Запазено току-що', timeout=15000)
        for _ in range(30):
            if one(f"select count(*)::int n from service where partner_id = '{pid}' and status <> 'archived'")['n'] == 3:
                break
            time.sleep(0.5)
        second.get_by_role('button', name='Премахни').click()
        toast(page, 'Пакетът е премахнат')
        expect(editors).to_have_count(2)
        continue_(page)
        wait_url(page, R + '/4$')
        svcs = q(f"select name, kind, status, price_cents, extra_hour_enabled, extra_hour_price_cents, travel_fee_enabled from service where partner_id = '{pid}' order by sort_order")
        live = [s for s in svcs if s['status'] != 'archived']
        assert [s['name'] for s in live] == ['Пакет „Цял ден“', 'Фирмени събития'], svcs
        assert all(s['status'] == 'ready' for s in live), svcs
        assert live[0]['price_cents'] == 145000 and live[0]['extra_hour_price_cents'] == 15000 and live[0]['travel_fee_enabled'], live[0]
        assert any(s['name'] == 'Пакет „Вечер“' and s['status'] == 'archived' for s in svcs), svcs
        incs = [r['text'] for r in q(f"select i.text from service_inclusion i join service s on s.id = i.service_id where s.partner_id = '{pid}' and s.name = 'Пакет „Цял ден“' order by i.position")]
        assert incs == ['DJ през цялото събитие', 'Диско осветление'], incs
        expect(page.locator('.wiz-step--done').nth(2)).to_contain_text('1 пакет · 1 по запитване')
        ok('step 3 saved: packages ready, removed one archived, no duplicates')

        page.locator('.wiz-step:nth-child(3) .m-step-btn').click()
        wait_url(page, R + '/3$')
        expect(page.locator('.service-row')).to_have_count(1)
        page.locator('.service-row').get_by_role('button', name='Редактирай').click()
        expect(page.locator('.card.m-pkg')).to_have_count(2)
        page.locator('.wiz-step:nth-child(4) .m-step-btn').click()
        wait_url(page, R + '/4$')
        ok('step 3 rows open with ‹Редактирай›')

        # ── step 4 ───────────────────────────────────────────────────────
        # Review fix: a past day is not a control, so it must not light up on hover.
        page.goto(BASE + R + '/4?mesec=2025-08')
        past = page.locator('.calendar-day.m-past').first
        expect(past).to_be_visible()
        assert past.evaluate('e => e.tagName') == 'DIV'
        past.hover()
        assert past.evaluate('e => getComputedStyle(e).backgroundColor') == 'rgb(255, 255, 255)'
        assert past.evaluate('e => getComputedStyle(e).cursor') == 'default'
        page.get_by_role('link', name='Следващ месец').click()
        expect(page.locator('.calendar-head strong')).to_have_text('Септември 2025')
        ok('past calendar days look inert (no hover, no pointer)')

        page.locator('.option-card', has_text='Лимит на ден').click()
        page.select_option('#f-maxBookingsPerDate', '3')
        page.locator('.dow-pill', has_text='Нд').click()
        page.select_option('#f-leadTimeDays', '14')
        page.select_option('#f-horizonMonths', '12')
        title = page.locator('.calendar-head strong').inner_text()
        page.get_by_role('link', name='Следващ месец').click()
        expect(page.locator('.calendar-head strong')).not_to_have_text(title)
        day = page.locator('button.calendar-day').nth(9)
        date = day.get_attribute('data-date')
        day.click()
        expect(page.locator(f'button.calendar-day[data-date="{date}"]')).to_have_class(re.compile('calendar-day--blocked'))
        for _ in range(20):
            if one(f"select count(*)::int n from availability_block where partner_id = '{pid}' and start_date <= '{date}' and end_date >= '{date}'")['n']:
                break
            time.sleep(0.5)
        assert one(f"select count(*)::int n from availability_block where partner_id = '{pid}' and start_date <= '{date}' and end_date >= '{date}'")['n'] == 1
        page.locator(f'button.calendar-day[data-date="{date}"]').click()
        expect(page.locator(f'button.calendar-day[data-date="{date}"]')).not_to_have_class(re.compile('calendar-day--blocked'))
        time.sleep(1.5)
        assert one(f"select count(*)::int n from availability_block where partner_id = '{pid}'")['n'] == 0
        page.locator(f'button.calendar-day[data-date="{date}"]').click()
        expect(page.locator(f'button.calendar-day[data-date="{date}"]')).to_have_class(re.compile('calendar-day--blocked'))
        time.sleep(1.5)
        ok('calendar: month navigation, block and free a day')

        continue_(page)
        wait_url(page, R + '/5$')
        row = partner(email)
        assert row['bookings_per_day_mode'] == 'limit' and row['max_bookings_per_date'] == 3, row
        assert row['working_days'] == [1, 2, 3, 4, 5, 6] and row['lead_time_days'] == 14 and row['horizon_months'] == 12, row
        assert one(f"select count(*)::int n from availability_block where partner_id = '{pid}'")['n'] == 1
        ok('step 4 saved')

        # ── step 5 ───────────────────────────────────────────────────────
        continue_(page)
        expect(page.locator('.m-section-error')).to_have_text('Изберете една политика.')
        page.locator('.option-card', has_text='Умерена').click()
        expect(page.locator('.option-card.is-selected')).to_contain_text('Умерена')
        page.select_option('#f-depositPercent', '40')
        page.select_option('#f-reschedulePolicy', 'one_free')
        continue_(page)
        wait_url(page, R + '/6$')
        row = partner(email)
        assert row['cancellation_policy'] == 'moderate' and row['deposit_percent'] == 40 and row['reschedule_policy'] == 'one_free', row
        ok('step 5 saved')

        # ── step 6 ───────────────────────────────────────────────────────
        expect(page.locator('.preview-card .t-h3')).to_have_text('Студио Тест Плюс')
        expect(page.locator('.preview-card-meta')).to_contain_text('Умерена политика')
        expect(page.locator('.review-section', has_text='Политика за анулиране')).to_contain_text('Умерена · безплатно анулиране до 30 дни преди събитието')
        expect(page.locator('.review-section', has_text='Пакети и услуги').locator('.badge--success')).to_have_count(2)
        expect(page.locator('.review-section', has_text='Наличност')).to_contain_text('До 3 резервации')
        page.locator('.review-section', has_text='Политика за анулиране').get_by_role('link', name='Редактирай').click()
        wait_url(page, R + '/5$')
        page.goto(BASE + R + '/6')
        ok('review summary and ‹Редактирай›')

        # Review fix: Enter on a focused checkbox used to submit the form through its first submit
        # button (the logo = ‹Запази и продължи по-късно›) and sign the partner out.
        page.locator('input[name=confirmInfo]').focus()
        page.keyboard.press('Enter')
        page.wait_for_timeout(2500)
        assert page.url.endswith(R + '/6'), page.url
        expect(page.locator('.ui-toast.is-on', has_text='Черновата е запазена')).to_have_count(0)
        ok('Enter on a consent checkbox does not sign the partner out')

        page.get_by_role('button', name='Подай за одобрение').click()
        expect(page.locator('.m-form-alert')).to_be_visible()
        expect(page.locator('.check.m-check-error')).to_have_count(2)
        assert partner(email)['status'] == 'draft'
        page.locator('label.check', has_text='Приемам').locator('.check-box').click()
        page.locator('label.check', has_text='Потвърждавам').locator('.check-box').click()
        page.get_by_role('button', name='Подай за одобрение').click()
        wait_url(page, R + '/podadeno$')
        expect(page.locator('.pending-eyebrow')).to_have_text('Профилът ви е подаден')
        expect(page.locator('.pending-title')).to_have_text('Благодарим, Иван.')
        expect(page.get_by_role('link', name='Към таблото')).to_have_count(0)
        row = partner(email)
        assert row['status'] == 'submitted' and row['submitted_at'], row
        mails = [r['template_key'] for r in q(f"select template_key from email_outbox where to_email = '{email}'")]
        assert 'vendor-application-received' in mails, mails
        ok('submit → pending page, status submitted, email queued')

        page.goto(BASE + R + '/2')
        wait_url(page, R + '/podadeno$')
        ok('a submitted wizard is read-only')

        tsx('onboarding-admin.ts', 'approve', email)
        expect(page.get_by_role('link', name='Към таблото')).to_be_visible(timeout=30000)
        expect(page.locator('.pending-eyebrow')).to_have_text('Профилът ви е одобрен')
        ok('pending page follows the decision live')
        page.get_by_role('link', name='Към таблото').click()
        wait_url(page, r'/partner$')
        ok('‹Към таблото› → panel')
        ctx.clear_cookies()

        # ── save and continue later / exit ───────────────────────────────
        email2 = f'onb2-{STAMP}@example.test'
        tsx('onboarding-setup.ts', email2, 'Фото Ден', 'Мария Иванова', '+359887003344')
        sign_in(page, email2)
        page.goto(BASE + R + '/1')
        page.fill('#f-businessName', 'Фото Ден и Нощ')
        page.get_by_role('button', name='Запази и продължи по-късно').click()
        wait_url(page, BASE.replace('.', r'\.') + '/$')
        toast(page, 'Черновата е запазена')
        assert partner(email2)['business_name'] == 'Фото Ден и Нощ'
        page.goto(BASE + R)
        wait_url(page, r'/vhod')
        ok('‹Запази и продължи по-късно› saves, signs out, toasts')

        sign_in(page, email2)
        page.goto(BASE + R + '/1')
        page.fill('#f-socialHandle', '@foto.den')
        page.locator('.wiz-top button.wiz-top-link', has_text='Изход').click()
        wait_url(page, BASE.replace('.', r'\.') + '/$')
        toast(page, 'Черновата е запазена')
        assert partner(email2)['social_handle'] == '@foto.den'
        ok('‹Изход› saves the draft too')
        ctx.clear_cookies()

        # ── returned and rejected applications ───────────────────────────
        email3 = f'onb3-{STAMP}@example.test'
        tsx('onboarding-setup.ts', email3, 'Фото Пловдив', 'Петя Колева', '+359887005566', '--submitted')
        sign_in(page, email3)
        page.goto(BASE + R)
        wait_url(page, R + '/podadeno$')
        expect(page.locator('.pending-step--current')).to_contain_text('Преглед от екипа')
        tsx('onboarding-admin.ts', 'return', email3, 'Моля, добавете поне още 2 снимки от ваши събития.')
        page.goto(BASE + R)
        wait_url(page, R + '/6$')
        expect(page.locator('.alert--warning')).to_contain_text('Бележка от екипа')
        expect(page.locator('.alert--warning')).to_contain_text('Моля, добавете поне още 2 снимки')
        expect(page.locator('.wiz-step--done')).to_have_count(5)
        page.locator('label.check', has_text='Приемам').locator('.check-box').click()
        page.locator('label.check', has_text='Потвърждавам').locator('.check-box').click()
        page.get_by_role('button', name='Подай за одобрение').click()
        wait_url(page, R + '/podadeno$')
        assert partner(email3)['status'] == 'submitted'
        ok('returned application: step 6 with the team note, resubmitted')
        ctx.clear_cookies()

        email4 = f'onb4-{STAMP}@example.test'
        tsx('onboarding-setup.ts', email4, 'Торти Тест', 'Нели Петрова', '+359887007788', '--submitted')
        tsx('onboarding-admin.ts', 'reject', email4, 'Липсват снимки от ваши събития.')
        sign_in(page, email4)
        page.goto(BASE + R + '/1')
        wait_url(page, R + '/podadeno$')
        expect(page.locator('.pending-title')).to_have_text('Не можем да одобрим профила ви')
        expect(page.locator('.m-reason')).to_contain_text('Липсват снимки от ваши събития.')
        page.locator('.wiz-top button.wiz-top-link', has_text='Изход').click()
        wait_url(page, BASE.replace('.', r'\.') + '/$')
        ok('rejected variant shows the motive; ‹Изход› signs out')

        ctx.clear_cookies()

        # ── review fixes: package rows (prototype ‹640 € · {описание}›) ─────
        email5 = f'onb5-{STAMP}@example.test'
        tsx('onboarding-setup.ts', email5, 'Студио Мелодия Тест', 'Мартин Стоянов', '+359881234567', '--complete')
        sign_in(page, email5)
        page.goto(BASE + R + '/3')
        meta = page.locator('.service-row', has_text='Пакет „Вечер“').locator('.service-row-meta')
        expect(meta).to_have_text(re.compile(r'^640\s€\s*·\s*Музика и озвучаване за вечерното парти\.$'))
        ok('a collapsed package reads ‹цена · кратко описание› as in the prototype')
        ctx.clear_cookies()

        # ── phone (390 px): every route, no sideways scroll, tap targets, one-line rows ──
        phone = browser.new_context(viewport={'width': 390, 'height': 844}, locale='bg-BG', timezone_id='Europe/Sofia')
        ph = phone.new_page()
        ph.on('pageerror', lambda e: errors.append(str(e)))
        sign_in(ph, email5)
        for n in range(1, 7):
            ph.goto(BASE + R + f'/{n}')
            wait_url(ph, R + f'/{n}$')
            phone_layout(ph, n)
            if n in (3, 6):
                for m in ph.locator('.service-row-meta').all():
                    tops = m.evaluate("e => new Set([...e.children].map(c => Math.round(c.getBoundingClientRect().top))).size")
                    assert tops == 1, (n, m.inner_text())
            if n == 4:
                tops = ph.evaluate("() => new Set([...document.querySelectorAll('.dow-pill')].map(p => Math.round(p.getBoundingClientRect().top))).size")
                assert tops == 1, 'working-day pills wrap'
        ok('phone: steps 1–6 have no sideways scroll, ≥ 40 px tap targets, one-line package rows, one row of working days')
        phone.clear_cookies()

        for who, title in [(email3, 'Благодарим, Петя.'), (email4, 'Не можем да одобрим профила ви')]:
            sign_in(ph, who)
            ph.goto(BASE + R + '/podadeno')
            expect(ph.locator('.pending-title')).to_have_text(title)
            phone_layout(ph, 'podadeno')
            assert ph.locator('.pending-text strong').first.evaluate('e => e.getClientRects().length') == 1
            phone.clear_cookies()
        page.set_viewport_size({'width': 1440, 'height': 900})
        sign_in(page, email4)
        page.goto(BASE + R + '/podadeno')
        # words on the heading's last line (text-wrap: balance — no orphan ‹ви›)
        last_line_words = page.locator('.pending-title').evaluate('''e => {
          const t = e.firstChild, rg = document.createRange(), tops = [];
          for (const m of t.textContent.matchAll(/\\S+/g)) { rg.setStart(t, m.index); rg.setEnd(t, m.index + m[0].length); tops.push(Math.round(rg.getBoundingClientRect().top)); }
          const last = Math.max(...tops);
          return tops.filter(x => x === last).length;
        }''')
        assert last_line_words > 1, 'the rejected heading leaves one word on its last line'
        ok('pending page on a phone: no sideways scroll, names and emails never split; headings balanced')
        phone.close()

        assert not errors, errors
        browser.close()
    print(f'\nPASS — {len(passed)} checks')


if __name__ == '__main__':
    run()
