#!/usr/bin/env python3
"""End-to-end check of the public site (SCREENS §2) with real clicks and typing.

Usage:  python3 tests/e2e/public.py [--base http://localhost:3201]
Needs the dev server running against a freshly seeded database (npm run db:reset && npm run db:seed);
DATABASE_URL is read from .env.local. Exits non-zero on the first failed check.
"""
import json, os, re, subprocess, sys, urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright, expect, Page

ROOT = Path(__file__).resolve().parents[2]
BASE = 'http://localhost:3201'
if '--base' in sys.argv:
    BASE = sys.argv[sys.argv.index('--base') + 1]
ENV = dict(os.environ)
for line in (ROOT / '.env.local').read_text().splitlines():
    m = re.match(r'^([A-Z_]+)=(.*)$', line.strip())
    if m and m.group(1) == 'DATABASE_URL':
        ENV['DATABASE_URL'] = m.group(2).strip().strip('"')
ENV['PATH'] = f"{Path.home() / 'nodejs22' / 'bin'}:{ENV.get('PATH', '')}"
DEMO = {'client': 'maria.dimitrova@gmail.com', 'partner': 'studio.melodia@gmail.com', 'admin': 'monika.kovacheva@eventat.bg'}

JS = ("const p=require('postgres');const s=p(process.env.DATABASE_URL,{onnotice:()=>{}});"
      "s.unsafe(process.argv[1]).then(r=>{process.stdout.write(JSON.stringify(r));return s.end()}).catch(e=>{console.error(e.message);process.exit(1)})")


def db(query: str):
    out = subprocess.run(['node', '-e', JS, query], cwd=ROOT, env=ENV, capture_output=True, text=True)
    if out.returncode:
        raise RuntimeError(out.stderr)
    return json.loads(out.stdout)


def maria_id() -> str:
    return db("select id from \"user\" where email = 'maria.dimitrova@gmail.com'")[0]['id']


def partner_id(slug: str) -> str:
    return db(f"select id from partner where slug = '{slug}'")[0]['id']


passed = 0


def ok(msg: str):
    global passed
    passed += 1
    print('  ✓', msg)


def toast(page: Page, text: str):
    expect(page.locator('.ui-toast.is-on')).to_contain_text(text, timeout=8000)


def sign_in(page: Page, role: str):
    r = page.request.post(BASE + '/api/auth/sign-in/email', data={'email': DEMO[role], 'password': 'eventat-demo'}, headers={'Origin': BASE})
    assert r.ok, f'sign-in {role} failed: {r.status}'


def qs(page: Page) -> dict:
    return urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query, keep_blank_values=True)


def path(page: Page) -> str:
    return urllib.parse.urlparse(page.url).path


def go(page: Page, url: str):
    page.goto(BASE + url, wait_until='networkidle')


def guest(page: Page):
    print('guest')
    # / — the two halves, the language switch
    go(page, '/')
    expect(page.locator('h1.st-ask')).to_have_text('Как ще използвате EventAT?')
    page.click('.lang >> text=EN')
    toast(page, 'Английската версия идва скоро')
    ok('start: EN → toast')
    page.click('a.st-half:has-text("Търся изпълнител")')
    page.wait_for_url('**/tarsene')
    expect(page.locator('.search-default')).to_contain_text('Търсете, за да видите резултати')
    ok('start: Търся изпълнител → /tarsene default state')

    # /tarsene — Търси on the default state shows everything, with the confirmation
    page.click('.sb-go button:has-text("Търси")')
    toast(page, 'Показваме намерените изпълнители')
    page.wait_for_url(re.compile(r'/tarsene\?q='))
    expect(page.locator('.v-card').first).to_be_visible()
    ok('search: Търси on the default state → results + toast')
    page.click('a.btn:has-text("Запази търсенето")')
    page.wait_for_url(re.compile(r'/vhod\?next='))
    assert urllib.parse.unquote(qs(page)['next'][0]).startswith('/tarsene'), page.url
    ok('search: guest ‹Запази търсенето› → sign in, back to the search')

    go(page, '/tarsene?data=2026-06-14&druga-data=1')
    card = page.locator('a.v-card:has-text("Ана Петрова Photography")')
    expect(card.locator('.badge')).to_have_text('Зает на 14 юни')
    card.locator('button:has-text("Уведоми ме")').click()
    page.wait_for_url(re.compile(r'/vhod\?next='))
    ok('search: guest busy card ‹Уведоми ме› → sign in (card not opened)')

    # /kategorii — the city dropdown, the cards
    go(page, '/kategorii')
    expect(page.locator('.filter-btn')).to_contain_text('Град: София')
    page.click('.filter-btn')
    page.click('.ui-menu a:has-text("Варна")')
    page.wait_for_url('**/kategorii?grad=varna')
    expect(page.locator('.filter-btn')).to_contain_text('Град: Варна')
    ok('categories: ‹Град› → Варна (URL + label)')
    page.click('a.feat--link:has-text("Кетъринг")')
    page.wait_for_url('**/kategorii/ketaring')
    expect(page.locator('h1.hero-t')).to_have_text('Кетъринг за сватби')
    page.click('a.cat-pill:has-text("Бюфет")')
    page.wait_for_url('**vid=byufet**')
    expect(page.locator('a.cat-pill.is-on')).to_have_text('Бюфет')
    # no seeded caterer lists a sub-type yet: the filter empties the list and says so
    expect(page.locator('a.ui-chip:has-text("Бюфет")')).to_be_visible()
    expect(page.locator('.empty-title')).to_have_text('Няма изпълнител за това търсене')
    ok('category: sub-type pill ‹Бюфет› filters (chip, zero state)')
    page.click('a.cat-pill:has-text("Всички")')
    page.wait_for_url(re.compile(r'/kategorii/ketaring$'))
    page.click('.sb-cell:has-text("Локация")')
    page.click('.ui-bar-menu:visible a:has-text("Варна")')
    page.wait_for_url('**/kategorii/ketaring?grad=varna')
    expect(page.locator('.results-n').first).to_contain_text('във Варна')
    ok('category: bar ‹Локация› stays on the category page')
    page.click('.sb-go button:has-text("Търси")')
    page.wait_for_url(re.compile(r'/tarsene\?.*kategoriya=ketaring'))
    assert qs(page).get('grad') == ['varna'], page.url
    ok('category: ‹Търси› → /tarsene with the category and the city')

    # /sabitiya — the type pills
    go(page, '/sabitiya/svatba')
    expect(page.locator('h1.hero-t')).to_have_text('Сватба · всичко необходимо')
    page.click('.pub-types a.cat-pill:has-text("Рожден ден")')
    page.wait_for_url('**/sabitiya/rozhden-den')
    ok('event type: pill → /sabitiya/rozhden-den')

    # marketing pages
    go(page, '/kak-raboti')
    page.click('a:has-text("Въпроси и отговори")')
    page.wait_for_url('**/pravila#faq')
    page.click('.doc-link:has-text("Контакт")')
    expect(page.locator('.doc-link.is-on')).to_have_text('Контакт')
    ok('how it works → legal FAQ; legal side nav highlights the section')
    expect(page.locator('a.set-row:has-text("Въпрос към екипа")')).to_have_attribute('href', 'mailto:help@eventat.bg')
    expect(page.locator('a.set-row:has-text("Проблем с конкретна резервация")')).to_have_attribute('href', '/vhod?next=%2Fakaunt%2Frezervacii')
    ok('legal: contact rows link (mailto, sign in → bookings)')
    go(page, '/stani-partnyor')
    expect(page.locator('.money-l')).to_have_text('Пример за пакет от 1 450 €')
    page.click('a:has-text("Създай профил")')
    page.wait_for_url('**/registratsiya?as=partner')
    ok('become partner: payout example; ‹Създай профил› → /registratsiya?as=partner')

    # partner profile, guest
    go(page, '/partnyori/studio-melodiya')
    expect(page.locator('h1.pv-name')).to_have_text('Студио Мелодия')
    first_choose = page.locator('.pk a:has-text("Избери")').first.get_attribute('href')
    assert first_choose.startswith('/registratsiya?next=%2Fzayavka%2Fstudio-melodiya'), first_choose
    ok('profile: guest ‹Избери› → sign up, back to the request form')
    rev = page.locator('#revyuta')
    expect(rev.locator('.rev').first.locator('.rev-reply-h')).to_have_text('Студио Мелодия')
    expect(rev.locator('.rev-reply')).to_have_count(2)
    expect(rev.locator('a:has-text("Покажи още")')).to_have_count(0)
    ok('profile: reviews carry the partner\'s public reply; no ‹Покажи още› under ten')
    assert page.title() == 'Студио Мелодия · EventAT', page.title()
    ok('profile: the page title is the partner\'s name')


def client(page: Page):
    print('client')
    sign_in(page, 'client')
    uid = maria_id()

    # the default state's event pills apply type, city, date and guests (D45)
    go(page, '/tarsene')
    page.click('a.cat-pill--event:has-text("Сватба · 14 юни 2026 · 120 гости")')
    page.wait_for_url(re.compile(r'/tarsene\?.*sabitie=svatba'))
    p = qs(page)
    assert p['grad'] == ['sofia'] and p['data'] == ['2026-06-14'] and p['gosti'] == ['120'] and 'sabitie-id' in p, page.url
    expect(page.locator('h1.h-page')).to_have_text('Изпълнители за сватба')
    expect(page.locator('.h-sub--ctx')).to_have_text('София · 14 юни 2026 · 120 гости')
    say = page.locator('.results-say')
    expect(say).to_have_text('Търсите изпълнители за сватба в София за 14 юни 2026 г., събитие за 120 гости.')
    ok('search: event pill → type, city, date, guests; context line and sentence')

    # typing: suggestions, Enter runs and is recorded
    before = db(f"select count(*)::int n from search_history where client_id = '{uid}'")[0]['n']
    go(page, '/tarsene')
    page.click('input.sb-v')
    expect(page.locator('.ui-suggest')).to_contain_text('Категории')
    page.fill('input.sb-v', 'кетъринг')
    expect(page.locator('.ui-suggest')).to_contain_text('Изпълнители')
    expect(page.locator('.ui-suggest .ui-note').first).to_contain_text('Кетъринг')
    ok('search: the suggestion panel lists categories and partners while typing')
    page.keyboard.press('Enter')
    page.wait_for_url(re.compile(r'q=%D0%BA%D0%B5%D1%82'))
    expect(page.locator('.results-n').first).to_contain_text('за „кетъринг“')
    page.wait_for_timeout(300)
    after = db(f"select count(*)::int n from search_history where client_id = '{uid}' and query = 'кетъринг'")[0]['n']
    assert after >= 1 and db(f"select count(*)::int n from search_history where client_id = '{uid}'")[0]['n'] == before + 1
    ok('search: Enter runs the query; search_history +1')
    # the recent search comes back in the panel
    page.fill('input.sb-v', '')
    expect(page.locator('.ui-suggest')).to_contain_text('Последни търсения')
    expect(page.locator('.ui-suggest')).to_contain_text('кетъринг')
    ok('search: ‹Последни търсения› shows the query')
    page.keyboard.press('Escape')

    # picking a category from the panel
    page.fill('input.sb-v', 'фото')
    page.locator('.ui-suggest .ui-note:has(b:text-is("Фотография"))').click()
    page.wait_for_url(re.compile(r'kategoriya=fotografiya'))
    expect(page.locator('input.sb-v')).to_have_value('Фотография')
    assert 'q' not in qs(page), page.url
    ok('search: picking ‹Фотография› sets the category; the field shows its name')

    # facets, chips, bar dropdowns, sorting, price
    go(page, '/tarsene?q=')
    page.click('a.f-item:has-text("Сватба")')
    page.wait_for_url(re.compile(r'sabitie=svatba'))
    expect(page.locator('a.f-item:has-text("Сватба") .f-box')).to_have_class(re.compile('is-on'))
    expect(page.locator('a.ui-chip:has-text("Сватба")')).to_be_visible()
    expect(page.locator('h1.h-page')).to_have_text('Изпълнители за сватба')
    ok('facet ‹Сватба› → ticked, chip, heading')
    page.click('.sb-cell:has-text("Локация")')
    page.click('.ui-bar-menu:visible a:has-text("София")')
    page.wait_for_url(re.compile(r'grad=sofia'))
    expect(page.locator('a.f-item:has-text("София") .f-box')).to_have_class(re.compile('is-on'))
    page.click('.sb-cell:has-text("Дата")')
    page.click('.ui-bar-menu:visible a:has-text("14 юни 2026")')
    page.wait_for_url(re.compile(r'data=2026-06-14'))
    page.click('.sb-cell:has-text("Гости")')
    page.click('.ui-bar-menu:visible a:has-text("100 – 150")')
    page.wait_for_url(re.compile(r'gosti=100-150'))
    expect(page.locator('.results-n').first).to_contain_text('свободни на 14 юни 2026')
    expect(page.locator('.results-say')).to_have_text('Търсите изпълнители за сватба в София за 14 юни 2026 г., събитие за 100 – 150 гости.')
    ok('bar: Локация, Дата, Гости re-query at once; count line with free on the date')
    page.click('.sb-cell:has-text("Дата")')
    page.fill('.ui-bar-menu:visible input.sb-date', '2026-07-18')
    page.wait_for_url(re.compile(r'data=2026-07-18'))
    ok('bar: the calendar in ‹Дата› picks any day')
    n_before = page.locator('a.v-card').count()
    page.click('.sort')
    page.click('.ui-menu a:has-text("Подреди: Най-ниска цена")')
    page.wait_for_url(re.compile(r'podredi=tsena'))
    expect(page.locator('.sort')).to_contain_text('Подреди: Най-ниска цена')
    prices = [int(re.sub(r'\D', '', t)) for t in page.locator('.v-price').evaluate_all('els => els.map(e => e.childNodes[0].textContent)')]
    assert prices == sorted(prices), prices
    ok('sort: ‹Най-ниска цена› orders by price')
    hi = page.locator('input[aria-label="Цена до"]')
    hi.fill('900')
    hi.press('Enter')
    page.wait_for_url(re.compile(r'cena-do=900'))
    expect(page.locator('a.ui-chip:has-text("цена")')).to_be_visible()
    assert page.locator('a.v-card').count() <= n_before
    ok('price: ‹до› 900 € applies the range; chip ‹цена›')
    page.click('a.ui-chip:has-text("Сватба")')
    page.wait_for_url(lambda u: 'sabitie=' not in u)
    assert 'grad' in qs(page) and 'cena-do' in qs(page)
    ok('chip ‹Сватба› removes only its own filter')

    # save the search
    saved = db(f"select count(*)::int n from saved_search where client_id = '{uid}'")[0]['n']
    page.click('button:has-text("Запази търсенето")')
    toast(page, 'Търсенето е запазено в профила ви')
    assert db(f"select count(*)::int n from saved_search where client_id = '{uid}'")[0]['n'] == saved + 1
    ok('‹Запази търсенето› → toast; saved_search +1')
    page.click('a.ui-chip-clear:has-text("Изчисти филтрите")')
    page.wait_for_url(re.compile(r'/tarsene\?q=$'))
    expect(page.locator('a.ui-chip')).to_have_count(0)
    ok('‹Изчисти филтрите› resets everything')

    # zero state caused by the date: ‹Уведоми ме при свободна дата›, ‹Разшири датата›, ‹Търси в друг град›
    ana = partner_id('ana-petrova-photography')
    go(page, '/tarsene?kategoriya=fotografiya&grad=sofia&data=2026-06-14')
    expect(page.locator('.empty-text')).to_have_text('С избраните филтри никой изпълнител в София не е свободен на 14 юни 2026 г.')
    expect(page.locator('a.btn:has-text("Опиши заявката")')).to_have_attribute('href', '/zayavka/otvorena?cat=fotografiya&city=sofia&date=2026-06-14')
    page.click('button:has-text("Уведоми ме при свободна дата")')
    toast(page, 'Ще ви известим, ако датата се освободи')
    w = db(f"select count(*)::int n from date_watch where client_id = '{uid}' and partner_id = '{ana}' and date = '2026-06-14' and status = 'watching'")[0]['n']
    assert w == 1, w
    ok('zero state: ‹Уведоми ме при свободна дата› → toast; a watch on the busy photographer')
    page.click('a.btn:has-text("Разшири датата")')
    toast(page, 'Показваме изпълнители за всяка дата')
    page.wait_for_url(lambda u: 'data=' not in u)
    expect(page.locator('a.v-card')).not_to_have_count(0)
    ok('zero state: ‹Разшири датата› drops the date')
    go(page, '/tarsene?q=xyz&grad=varna')
    expect(page.locator('.empty-title')).to_have_text('Няма изпълнител за това търсене')
    page.click('a.btn:has-text("Търси в друг град")')
    toast(page, 'Показваме изпълнители от цялата страна')
    page.wait_for_url(lambda u: 'grad=' not in u)
    ok('zero state: ‹Търси в друг град› drops the city')

    # a busy card's ‹Уведоми ме› does not open the card
    snap = partner_id('snap360')
    go(page, '/tarsene?data=2026-06-14&druga-data=1')
    url = page.url
    page.locator('a.v-card:has-text("Snap360") button:has-text("Уведоми ме")').click()
    toast(page, 'Ще ви известим, ако датата се освободи')
    assert page.url == url
    assert db(f"select count(*)::int n from date_watch where client_id = '{uid}' and partner_id = '{snap}' and date = '2026-06-14' and status = 'watching'")[0]['n'] == 1
    ok('busy card ‹Уведоми ме› → toast, watch saved, card not opened')
    page.click('a.v-card:has-text("Snap360") .v-name')
    page.wait_for_url(re.compile(r'/partnyori/snap360\?data=2026-06-14$'))
    expect(page.locator('.book .book-f-v').first).to_have_text('14 юни 2026 · неделя')
    ok('card → /partnyori/snap360, the widget on the searched date')

    # category page as a client
    go(page, '/kategorii/ketaring')
    page.click('.sort')
    page.click('.ui-menu a:has-text("Подреди: Най-нови")')
    page.wait_for_url('**/kategorii/ketaring?podredi=novi')
    ok('category: sort stays on the category page')

    # event-type planner with the client's event
    go(page, '/sabitiya/svatba')
    expect(page.locator('.hero-eyebrow')).to_have_text('Вашето събитие')
    expect(page.locator('.nx-line')).to_contain_text('14 юни 2026 · неделя')
    expect(page.locator('.dcard-title:has-text("Вече уредено")')).to_be_visible()
    count_line = page.locator('.results-head:not(.pub-types) .results-n')
    expect(count_line).to_contain_text('свободни на 14 юни 2026 в София')
    page.click('.sb-cell:has-text("Локация")')
    page.click('.ui-bar-menu:visible a:has-text("Всички градове")')
    page.wait_for_url(re.compile(r'grad=(&|$)'))
    expect(count_line).not_to_contain_text('в София')
    ok('event type: client panels; ‹Всички градове› clears the event\'s city')
    page.click('a:has-text("Отвори каталога")')
    page.wait_for_url(re.compile(r'/tarsene\?sabitie=svatba'))
    ok('event type: ‹Отвори каталога› → /tarsene with the type')
    go(page, '/sabitiya/svatba')
    page.click('.sb-go button:has-text("Търси")')
    page.wait_for_url(re.compile(r'/tarsene\?sabitie=svatba&grad=sofia&data=2026-06-14&gosti=120'))
    ok('event type: ‹Търси› → /tarsene with type, city, date, guests')
    go(page, '/sabitiya/svatba')
    page.locator('.feats a.feat--link:has-text("Кетъринг")').first.click()
    page.wait_for_url(re.compile(r'/kategorii/ketaring\?sabitie=svatba'))
    ok('event type: a service card → the category with the event\'s filters')

    # partner profile: busy date in the widget, watch, change the date, choose a package
    go(page, '/partnyori/ana-petrova-photography')
    expect(page.locator('.book')).to_contain_text('Заета дата:')
    page.click('button:has-text("Уведоми ме, ако се освободи")')
    toast(page, 'Ще ви известим, ако датата се освободи')
    ok('profile: busy date → ‹Уведоми ме, ако се освободи› → toast')
    page.fill('#w-date', '2026-07-18')
    expect(page.locator('.book a:has-text("Изпрати запитване")')).to_be_visible()
    expect(page.locator('.book .book-f-v').first).to_have_text('18 юли 2026 · събота')
    href = page.locator('.book a:has-text("Изпрати запитване")').get_attribute('href')
    assert href.startswith('/zayavka/ana-petrova-photography?') and 'data=2026-07-18' in href, href
    ok('profile: changing the date re-checks availability; the request link carries it')
    page.fill('#w-guests', '80')
    href = page.locator('.book a:has-text("Изпрати запитване")').get_attribute('href')
    assert 'gosti=80' in href, href
    ok('profile: guests go along to the request form')
    go(page, '/partnyori/studio-melodiya')
    expect(page.locator('.pv-meta')).to_contain_text('Отговаря до 24 ч')
    page.click('a.chip-tag:has-text("Сватби")')
    page.wait_for_url('**/sabitiya/svatba')
    ok('profile: specialisation chip → /sabitiya/svatba')
    go(page, '/partnyori/studio-melodiya')
    page.click('.crumbs a:has-text("DJ и озвучаване")')
    page.wait_for_url('**/kategorii/dj-i-ozvuchavane')
    ok('profile: breadcrumb → category')

    # signed-in client on / goes to the search (D47)
    go(page, '/')
    assert path(page) == '/tarsene', page.url
    ok('/ → /tarsene for a client')


def phone(page: Page):
    print('phone (390 px)')
    go(page, '/tarsene?sabitie=svatba')
    filters = page.locator('aside.filters')
    expect(filters).to_be_hidden()
    page.click('button.pub-filters-btn:has-text("Филтри")')
    expect(filters).to_be_visible()
    page.click('a.f-item:has-text("София")')
    page.wait_for_url(re.compile(r'grad=sofia'))
    expect(page.locator('a.ui-chip:has-text("София")')).to_be_visible()
    ok('phone: ‹Филтри› opens the facets; a facet applies')
    page.click('.sort')
    expect(page.locator('.pub-sort .ui-menu')).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth') <= 390
    page.keyboard.press('Escape')
    page.click('.sb-cell:has-text("Локация")')
    expect(page.locator('.ui-bar-menu:visible')).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth') <= 390
    ok('phone: open menus stay inside the screen')
    go(page, '/kategorii')
    page.click('.filter-btn')
    expect(page.locator('.ui-menu')).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth') <= 390
    ok('phone: the city menu stays inside the screen')


def others(page: Page, role: str, home: str):
    print(role)
    sign_in(page, role)
    go(page, '/')
    assert path(page) == home, page.url
    go(page, '/tarsene?q=')
    expect(page.locator('text=Запази търсенето')).to_have_count(0)
    go(page, '/partnyori/ana-petrova-photography')
    expect(page.locator('.book a:has-text("Изпрати запитване")')).to_have_count(0)
    ok(f'{role}: / → {home}; no client-only controls')


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        for fn in (guest, client, lambda pg: others(pg, 'partner', '/partner'), lambda pg: others(pg, 'admin', '/admin')):
            ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='bg-BG', timezone_id='Europe/Sofia')
            page = ctx.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            fn(page)
            assert not errors, errors
            ctx.close()
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, locale='bg-BG', timezone_id='Europe/Sofia')
        phone(ctx.new_page())
        ctx.close()
        b.close()
    print(f'\nall {passed} checks passed')


if __name__ == '__main__':
    main()
