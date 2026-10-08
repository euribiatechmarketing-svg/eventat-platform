# EventAT prototype design system: report for the Next.js port

Source (read-only): `/Users/nikoladamyanov/Desktop/Alexa/eventat-app`.
Files covered: `tokens.css`, `components.css`, `app.css`, `client.css`, `public.css`, `admin.css`, `wizard.css`, `app.js`, `proto.js` (where it touches CSS), and the head and shell of `client/catalog.html`, `vendor/dashboard.html`, `admin/dashboard.html` and `onboarding/business.html`. I also looked at `client/start.html`, `client/auth.html`, `onboarding/pending.html` and `onboarding/policy.html` for shell variants.

**Facts that shape the port:**
- **No media queries.** None of the seven product stylesheets has an `@media` rule. The only two are in `styleguide.css`, which is not product. Every responsive rule has to be written new.
- **No site footer on the client side.** No client, vendor or admin page has a `<footer>`. The only `<footer>` elements in the product are `.wiz-footer` on the six onboarding steps.
- **Some component classes are defined but never used:** `.modal-overlay`/`.modal`, `.table`/`.table-wrap`, `.tabs`/`.tab`, `.toggle-track` (the `label > input` toggle), `.radio`. The pages use `.tbl`, `.tab-bar`, `.seg` and a bare `span.toggle` instead.
- **`app.js` is styleguide-only.** It renders colour ramps for `styleguide.html`. Nothing to port.
- **Some of this work already exists in the platform repo.** `/Users/nikoladamyanov/Desktop/Alexa/eventat-platform/styles/` holds verbatim copies of all seven stylesheets. Only `public.css` differs: the photo URLs became `/photos/...`. It also has `platform.css`, which already fluidises `#frame`/`.shell`/`.site`/`.wiz-*` and renames the `proto-*` runtime UI to `ui-*`, and `fonts.css`, which uses next/font variables. Check sections 2 and 7 below against that file rather than starting over.

---

## 0. Stylesheet stacks and `<head>` per area

Every page uses `<html lang="bg">`. The Google Fonts link is:
`https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600;1,700&family=Inter:wght@400;500;600;700;800&family=Spectral:wght@700&display=swap`

| Area | Stylesheets, in order | Body root |
|---|---|---|
| client (catalog, account) | tokens → components → **app** → client | `#frame > .site` |
| client public pages (start, auth, register, verify, how-it-works, become-partner, legal, category, categories, search, event-type) | tokens → components → app → client → **public** | `#frame > .site` |
| vendor | tokens → components → app | `#frame > .shell` |
| admin | tokens → components → app → **admin** | `#frame > .shell` |
| onboarding | tokens → components → **wizard** (never app.css) | `#frame > .wiz-shell`, or `#frame > .pending-shell` on pending.html |

**Client pages need `app.css`.** `client.css`, `public.css` and `admin.css` all use `--app-bg`/`--app-line`, which only `app.css` and `wizard.css` declare. They also borrow `.icon-btn`, `.lang`, `.filter-btn`, `.badge` numerals, `.num`, `.toggle`, `.fld*`, `.dcard`, `.kv` and `.tbl` from `app.css`.

**The `<head>` is identical on all four sample pages** apart from `<title>` and the area's CSS links. In order:
1. Fonts `preconnect` and the stylesheet link above.
2. `tokens.css`.
3. An inline fit script:
   ```js
   (function () {
     if (location.hash.indexOf('figmacapture') > -1 || !window.innerWidth || !window.innerHeight) return;
     var d = document.documentElement;
     d.style.setProperty('--proto-zoom', Math.min(innerWidth / 1920, innerHeight / 1080, 1));
     d.classList.add('proto-fit');
   })();
   ```
4. `components.css`, then the area stylesheets.
5. `<script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async>`.
6. An inline scroll-pin script for Figma capture. It pins `.wrap, .content` to the top; on onboarding pages it pins `#frame, .wrap, .content, .wiz-body`.

Before `</body>`: `<script src="../proto.js" defer></script>`.

**For the port, drop items 3, 5 and 6 and `proto.js`.** Keep `lang="bg"`.

**Per-page `<style>` blocks** also have to be ported. Lines per page:
- client: messages 88, invoice 67, events 55, cancel 39, dispute 29, event 20, event-type 19, categories 11, brief 8.
- vendor: service-edit 101, service-new 66, messages 55, payout-account 54, dispute 34, booking 15, request 5.
- admin: vendor 36, team 34, client 27, emails 23, booking 20.
- onboarding: review 10, policy 4.

---

## 1. Custom properties

### tokens.css `:root`

| Group | Properties |
|---|---|
| Primary (purple) | `--primary-50 #f6f3fb`, `-100 #ede5f5`, `-200 #d8c8e8`, `-300 #bfa5d6`, `-400 #a385c1`, `-500 #8868b0`, **`-600 #7f64ae` (brand)**, `-700 #664d92`, `-800 #4a3470`, `-900 #2a2340` |
| Secondary (pink) | `--pink-50 #fbf2f6`, `-100 #f7e6f1`, `-200 #ebbfdb`, `-300 #dfa0c8`, `-400 #cc7eae`, `-500 #b96196`, `-600 #9e4b7e`, `-700 #7e3a64`, `-800 #5e2a4a`, `-900 #3d1c30` |
| Accent (gold) | `--gold-50 #faf6f0`, `-100 #f1e7d3`, `-200 #e1cda4`, `-300 #cfae74`, `-400 #bb914d`, `-500 #a2783a`, `-600 #815e2c`, `-700 #5f4520`, `-800 #432f15`, `-900 #2a1d0c` |
| Neutral | `--neutral-0 #fff`, `-50 #fbf8fb`, `-100 #f4f0f5`, `-200 #ece7f1`, `-300 #ddd6e3`, `-400 #b9b1c4`, `-500 #8d8499`, `-600 #6f6a82`, `-700 #4a4555`, `-800 #2e2a3a`, `-900 #1a1726` |
| Text | `--text #2a2340`, `--text-muted: var(--neutral-600)`, `--text-on-dark #fff`, `--text-on-light: var(--text)` |
| Status | success `-50 #ecfaf2`, `-100 #c9f0db`, `-500 #1f9d5f`, `-600 #16834e`, `-700 #0f6a3d`<br>warning `-50 #fdf6e6`, `-100 #fae6b3`, `-500 #c98a16`, `-600 #a06d0d`, `-700 #784f06`<br>danger `-50 #fdedee`, `-100 #fac8cb`, `-500 #d23847`, `-600 #a92836`, `-700 #7e1d28`<br>info `-50 #ecf2fb`, `-100 #c8d8f0`, `-500 #3866c4`, `-600 #2a519f`, `-700 #1d3d7a` |
| Surface | `--surface-page: var(--neutral-50)`, `--surface-card #fff`, `--surface-raised #fff`, `--surface-muted #f4f0f5`, `--surface-inverse #1f1633`, `--surface-overlay rgba(31,22,51,.55)` |
| Border | `--border-subtle: var(--neutral-200)`, `--border-default #ddd6e3`, `--border-strong: var(--neutral-400)` |
| Font families | `--font-display: 'Constantia','Cormorant Garamond',Georgia,'Times New Roman',serif`<br>`--font-ui: 'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`<br>`--font-num: 'Spectral','Constantia',Georgia,serif`<br>`--font-mono: ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace` |
| Font sizes | `--fs-display-1 64px`, `--fs-display-2 52px`, `--fs-h1 40px`, `--fs-h2 32px`, `--fs-h3 24px`, `--fs-h4 20px`, `--fs-h5 17px`, `--fs-h6 15px`, `--fs-body-lg 17px`, `--fs-body 15px`, `--fs-body-sm 14px`, `--fs-caption 13px`, `--fs-label 12px`, `--fs-overline 11px` |
| Line heights | `--lh-display 1.05`, `--lh-heading 1.2`, `--lh-body 1.55`, `--lh-tight 1.3` |
| Weights | `--fw-regular 400`, `--fw-medium 500`, `--fw-semibold 600`, `--fw-bold 700` |
| Spacing (4-base) | `--space-0 0`, `-1 4px`, `-2 8px`, `-3 12px`, `-4 16px`, `-5 20px`, `-6 24px`, `-8 32px`, `-10 40px`, `-12 48px`, `-16 64px`, `-20 80px`, `-24 96px`, `-32 128px` |
| Radii | `--radius-xs 4px`, `-sm 6px`, `-md 10px`, `-lg 14px`, `-xl 20px`, `-2xl 28px`, `-pill 999px`, `-circle 50%` |
| Shadows | `--shadow-xs 0 1px 2px rgba(102,77,146,.05)`, `-sm 0 2px 6px …/.06`, `-md 0 6px 16px …/.07`, `-lg 0 20px 44px …/.14`, `-xl 0 32px 64px …/.18`, `--shadow-focus 0 0 0 3px rgba(127,100,174,.20)` |
| Motion | `--ease-out cubic-bezier(.22,.61,.36,1)`, `--ease-in-out cubic-bezier(.65,0,.35,1)`, `--duration-fast 120ms`, `-normal 200ms`, `-slow 360ms` |
| Layout | `--container-narrow 720px`, `--container-default 1180px`, `--container-wide 1440px`, `--header-h 64px` |

**Notes on these tokens:**
- `--header-h` is used nowhere; the real bars are 76px.
- `--container-*` is used only by `.container`/`.container-narrow` in components.css. Product pages don't use those classes; they use `.hold` and `.content`.

**Global rules at the end of tokens.css:**
- `html { font-feature-settings: "locl" 0; }`: keep.
- `[hidden] { display: none !important; }`: keep. Filtering relies on it, e.g. `admin.css .mini[hidden] + .mini`.
- Three `html.proto-fit` rules: remove (see section 2).

### Custom properties declared outside tokens.css
- **`app.css :root`:** `--app-bg #f4f4f6` (the neutral canvas, used everywhere instead of `--surface-page`), `--app-line #e7e7ec` (the hairline used by every card), `--side-bg #1f1633`, `--side-line rgba(255,255,255,.09)`, `--side-dim rgba(255,255,255,.62)`, `--side-w 268px`, `--top-h 76px`.
- **`wizard.css :root`:** `--app-bg` and `--app-line` (same values), `--wiz-top-h 76px`, `--wiz-foot-h 84px`, `--wiz-w 1320px`.
- **`components.css`, local to `.btn`:** `--btn-bg`, `--btn-fg`, `--btn-bg-hover`, `--btn-border`, `--btn-shadow`. Variants and `public.css .st-login`/`.st-cta` and `wizard.css .wiz-top-btn` override these. `.stack` uses `--stack-gap`.
- **Runtime:** `--proto-zoom`, set by the head script and `proto.js fit()`.

---

## 2. The fixed-frame mechanism and what to change

### How it works now
1. Each page is `<body><div id="frame">…</div></body>`.
2. `app.css` sets `#frame { width: 1920px; height: 1080px; overflow: hidden; margin: 0 auto; background: var(--app-bg); }`. `wizard.css` has the same rule plus `position: relative`.
3. The shells are fixed height:
   - `app.css`: `.shell { display: flex; height: 1080px; }`
   - `client.css`: `.site { display: flex; flex-direction: column; height: 1080px; }`
   - `wizard.css`: `.wiz-shell, .pending-shell { height: 100%; display: flex; flex-direction: column; }`
4. The head script, and `proto.js fit()` on resize/load/pageshow/visibilitychange, set `--proto-zoom = min(innerWidth/1920, innerHeight/1080, 1)` and add `html.proto-fit`. Then `tokens.css` applies:
   - `html.proto-fit, html.proto-fit body { height: 100%; }`
   - `html.proto-fit body { display: flex; align-items: center; justify-content: center; overflow: hidden; }`
   - `html.proto-fit #frame { zoom: var(--proto-zoom, 1); flex-shrink: 0; }`

   `fit()` removes `proto-fit` when `#frame` is not 1920×1080.
5. Only one inner container scrolls, with its scrollbar hidden:
   - client: `.wrap { flex: 1; overflow-y: auto; scrollbar-width: none; }` and `.wrap::-webkit-scrollbar { width: 0; }`
   - panels: `.content { flex: 1; overflow-y: auto; padding: 28px 32px 40px; scrollbar-width: none; -ms-overflow-style: none; }` and `.content::-webkit-scrollbar { width: 0; height: 0; }`
   - onboarding: `.wiz-body { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; … }`; on pending.html it is `.pending-hero` (same pattern).
6. `body { background: #dcdce2; }` in `app.css` and `wizard.css` is the grey around the artboard.

### Exact changes so pages flow in a normal window

**tokens.css**
- Lines 194–198: delete the three `html.proto-fit` rules. They do nothing without the class, but remove them anyway.

**app.css**
- L16 `body { background: #dcdce2; }` → `body { background: var(--app-bg); }`
- L19–25 `#frame {…}`: delete, or reduce to `#frame { min-height: 100dvh; background: var(--app-bg); }`. Keep the `#frame` element if you keep wizard.css's `#frame …` selectors (see wizard.css below).
- L27 `.shell { display: flex; height: 1080px; }` → `.shell { display: flex; min-height: 100vh; min-height: 100dvh; }`
- L32 `.side`: add `position: sticky; top: 0; height: 100dvh; overflow-y: auto; scrollbar-width: none;`
- L146 `.topbar`: add `position: sticky; top: 0; z-index: 30;`
- L203–212 `.content`: remove `overflow-y: auto`, `scrollbar-width: none` and `-ms-overflow-style: none`, and delete `.content::-webkit-scrollbar`. Keep `flex: 1; padding: 28px 32px 40px`.
- L213 `.content-inner { width: 100%; }`: optionally cap it, e.g. `max-width: 1588px` (the in-frame width, 1920 − 268 − 64), so ultra-wide screens don't stretch the rows.

**client.css**
- L7 `.site { … height: 1080px; }` → `min-height: 100dvh;`. Keep the flex column.
- L10 `.nav`: add `position: sticky; top: 0; z-index: 40;`
- L32–33 `.wrap {flex:1; overflow-y:auto; scrollbar-width:none}` and `.wrap::-webkit-scrollbar` → `.wrap { flex: 1 0 auto; }`

**public.css**
- L66 `.auth { min-height: 1004px; }` (1080 − 76) → `min-height: calc(100dvh - 76px);`
- L135 `.doc-nav { position: sticky; top: 0; }` → `top: calc(76px + 24px);` because the nav is now sticky.
- L184–186 `.st-split { flex: 1; min-height: 0; … }` relied on the 1080px `.site` → `flex: 1 0 auto; min-height: 560px;`
- L197–198 `url('social/photos/…')` is relative to the stylesheet location; repoint to the public folder (already done in the platform copy).

**wizard.css**
- L25 `body { background: #dcdce2; }` → `var(--app-bg)`
- L28–35 `#frame { … 1920 × 1080 … }` → remove the size and overflow.
- L37–42 `.wiz-shell, .pending-shell { height: 100%; }` → `min-height: 100dvh;`
- L47 `.wiz-top`: add `position: sticky; top: 0; z-index: 30;`
- L92–105 `.wiz-body`: remove `overflow-y`, `min-height: 0` and the scrollbar rules; use `flex: 1 0 auto`. Change the padding to `40px max(24px, calc((100% - var(--wiz-w)) / 2)) 56px`. Below 1320px the current `calc` turns negative and is clamped to 0, leaving no gutter.
- L108 `.wiz-stepper { position: sticky; top: 0; }` → `top: calc(var(--wiz-top-h) + 40px);`
- L259–266 `.wiz-footer`: add `position: sticky; bottom: 0; z-index: 20;` to keep "always visible" (rule from the file header). Padding becomes `0 max(24px, calc((100% - var(--wiz-w)) / 2))`.
- L576–584 `.pending-hero`: remove `overflow-y`, `min-height: 0` and the scrollbar rules; use `flex: 1 0 auto`.
- **The `#frame` overrides need a decision.** Lines 243–251 and 287–310 (`#frame .field`, `#frame .field-label { white-space: nowrap }`, `#frame .check*`, `#frame .t-h1/.t-h2/.t-h3`, `#frame .t-overline`, `#frame .btn--outline`, `#frame .card`, `#frame .alert …`) only apply inside `#frame`. Either keep `<div id="frame">` in the wizard layout, or rewrite them as `.wiz-shell …, .pending-shell …`. Class-level specificity still beats the components.css base rules.

**Page-level fixed heights tied to the 1080 frame**
- `client/messages.html` `.msg-shell { height: 820px }` → `height: calc(100dvh - 260px); min-height: 560px;` (76 nav + 86 `.hold` padding + 98 heading block)
- `vendor/messages.html` `.vmsg-shell { height: 852px }` → `height: calc(100dvh - 228px); min-height: 560px;` (76 topbar + 68 `.content` padding + 84 `.page-head`). Its inner `.vmsg-convs` and `.vmsg-thread` scrollers are real component scrollers; keep them.
- `admin/emails.html` `.em-frame { height: 760px }`: derive the same way, with a min-height.

**Head scripts:** drop the fit script, `capture.js`, the scroll-pin script and `proto.js`.

---

## 3. Shells (actual markup)

### 3a. Client top nav, signed in (`client/catalog.html`; 24 client pages share these links)
```html
<div id="frame">
<div class="site">
  <header class="nav">
    <a class="nav-brand" href="catalog.html"><img class="nav-logo" src="../assets/eventat-logo.png" alt="EventAT" /></a>
    <nav class="nav-links"><a class="nav-link is-active" href="categories.html">Категории</a><a class="nav-link" href="search.html">Търсене</a><a class="nav-link" href="how-it-works.html">Как работи</a><a class="nav-link" href="become-partner.html">Стани партньор</a><a class="nav-link" href="requests.html">Моите заявки</a></nav>
    <div class="nav-right">
      <span class="lang"><b>BG</b><span>EN</span></span>
      <button class="icon-btn" aria-label="Известия">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>
        <span class="dot"></span>
      </button>
      <a class="nav-user" href="settings.html"><span class="avatar avatar--sm">МД</span><span class="nav-user-name">Мария Д.</span></a>
    </div>
  </header>
  <div class="wrap">
    <div class="hold">            <!-- .hold--narrow = max-width 1080 -->
      <div class="h-row">
        <div>
          <h1 class="h-page">…</h1>
          <p class="h-sub h-sub--ctx">…</p>
        </div>
        <!-- optional: <div class="h-right">buttons</div> -->
      </div>
      …page content…
    </div>
  </div>
</div>
</div>
```

**Nav variants:**
- **Signed out** (`auth.html`, `register.html`, `verify.html`): the same four links without "Моите заявки"; `brand href="start.html"`; `.nav-right` holds only `<span class="lang">…</span>`.
- **Guest on a PUBLIC page.** These are catalog, category, vendor, how-it-works, become-partner and legal. `proto.js` removes `.icon-btn`, `.nav-user` and the "Моите заявки" link, then appends:
  `<span class="proto-guest"><a class="btn btn--outline" href="auth.html">Вход</a><a class="btn btn--primary" href="register.html">Регистрация</a></span>`
  A partner session gets `…<a class="btn btn--outline" href="../vendor/dashboard.html">Към таблото</a>` instead. **The real app must render this state itself.**
- **Start page** (`client/start.html`): no `.nav-links`. `<div class="nav-right st-right"><span class="lang">…</span><span class="st-have">Вече имате профил?</span><a class="btn btn--outline st-login" href="auth.html">Вход</a></div>`. The `.site` then holds `section.st-head` and `main.st-split > a.st-half ×2 (.st-photo.st-photo--client|--vendor, .st-scrim, .st-body > .st-eyebrow, h2.st-label, p.st-desc, span.btn.btn--lg.btn--onDark.st-cta)`.
- **Account menu.** `proto.js` hangs it off `.nav-user` as `div.proto-menu.proto-menu--down`, appended to `.nav-right` with `position: relative` set inline. Client items: Моите събития, Съобщения, Запазени търсения, Поддръжка, Моите заявки, Моите резервации, Настройки, `<hr>`, Изход.
- **Bell.** `button.icon-btn[aria-label="Известия"]` gets wrapped in `span.proto-anchor`, plus `div.proto-menu.proto-menu--down.proto-menu--wide > a.proto-note > b + span`.

**Footer: none exists on the client side.** A site footer would be new design; nothing in the prototype to copy.

Public pages use these blocks inside `.wrap > .hold`:
- `section.hero(.hero--left) > .hero-eyebrow + h1.hero-t + p.hero-d + .hero-cta`
- `.band > .band-scrim + .band-in > .band-t + .band-d`
- `.sec-head(--left) > .sec-t + .sec-d`
- `.steps3 > .step3`
- `.feats > .feat`
- `.cta > div(.cta-t, .cta-d) + .cta-act (.btn--onDark / .btn--onDarkGhost)`
- `.doc > nav.doc-nav + .doc-body`

On auth, `.wrap > .auth > .auth-form > .auth-box` sits beside `.auth-side[data-side]`, which holds `.auth-side-scrim` and `.auth-quote`.

### 3b. Partner rail + topbar (`vendor/dashboard.html`; `vendor/_side.html` is a reference copy)
```html
<div id="frame">
<div class="shell">
<aside class="side">
  <a class="side-brand" href="dashboard.html">
    <img class="side-logo" src="../assets/eventat-logo-white.png" alt="EventAT" />
  </a>

  <div class="side-label side-label--first">Партньорски панел</div>
  <nav class="side-nav">
    <a class="side-item is-active" href="dashboard.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>Табло</a>
    <a class="side-item" href="requests.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 13h4l2 3h4l2-3h4"/><path d="M5 5h14l2 8v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4z"/></svg>Заявки<span class="side-count">3</span></a>
    <a class="side-item" href="calendar.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>Календар</a>
    <a class="side-item" href="services.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 12l9 5 9-5M3 16l9 5 9-5"/></svg>Услуги и пакети</a>
    <a class="side-item" href="bookings.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 11l2 2 4-4"/><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4"/></svg>Резервации</a>
    <a class="side-item" href="earnings.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 11h20"/><circle cx="17.5" cy="15" r="1.3"/></svg>Приходи</a>
  </nav>

  <div class="side-label">Акаунт</div>
  <nav class="side-nav">
    <a class="side-item" href="profile.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></svg>Публичен профил</a>
    <a class="side-item" href="reviews.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17.8 6.4 20.1l1.2-6.2L3 9.6l6.3-.8L12 3z"/></svg>Ревюта</a>
    <a class="side-item" href="settings.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1A1.7 1.7 0 007 19.4a1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H1a2 2 0 110-4h.1A1.7 1.7 0 004.6 7a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V1a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H23a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>Настройки</a>
  </nav>

  <div class="side-foot">
    <a class="side-user" href="settings.html">
      <span class="side-user-av"><img src="../social/photos/thumbs/v1-dj-doc.jpg" alt="" /></span>
      <span>
        <span class="side-user-name">Студио Мелодия</span>
        <span class="side-user-role">DJ и озвучаване</span>
      </span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10l5 5 5-5"/></svg>
    </a>
  </div>
</aside>
  <div class="main">
    <header class="topbar">
      <span class="topbar-title">Табло</span>
      <div class="topbar-right">
        <span class="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          Търси по клиент, услуга или дата
        </span>
        <button class="icon-btn" aria-label="Известия">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>
          <span class="dot"></span>
        </button>
        <span class="lang"><b>BG</b><span>EN</span></span>
      </div>
    </header>

    <div class="content">
      <div class="content-inner">
        <div class="page-head">
          <div>
            <h1 class="page-title">Добре дошли, Студио Мелодия</h1>
            <p class="page-sub">Имате 3 нови заявки и 2, които чакат плащане.</p>
          </div>
          <div class="page-head-right">
            <button class="btn btn--outline btn--sm">Блокирай дата</button>
            <button class="btn btn--primary btn--sm">Добави услуга</button>
          </div>
        </div>
        …  <!-- e.g. .kpis, .dash-grid > div + aside -->
      </div>
    </div>
  </div>
</div>
</div>
```
- **Breadcrumb**, used on detail pages above `.page-head`: `a.crumb > svg + text`.
- **Partner account menu** (`proto.js`): `div.proto-menu.proto-menu--up`, appended to `.side-foot`, which gets `position: relative` inline. Items: Съобщения, Поддръжка, Настройки, Виж профила като клиент, `<hr>`, Изход.

### 3c. Admin rail (`admin/dashboard.html`; same `.shell/.main/.topbar/.content` as partner)
```html
<aside class="side">
  <a class="side-brand" href="dashboard.html">
    <img class="side-logo" src="../assets/eventat-logo-white.png" alt="EventAT" />
    <span class="side-tag">Админ</span>
  </a>
  <div class="side-label side-label--first">Платформа</div>
  <nav class="side-nav">
    <a class="side-item is-active" href="dashboard.html"><svg …4 rects as partner…/>Табло</a>
    <a class="side-item" href="vendors.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/></svg>Изпълнители<span class="side-count">4</span></a>
    <a class="side-item" href="moderation.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>Модерация<span class="side-count">7</span></a>
    <a class="side-item" href="bookings.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/></svg>Резервации</a>
    <a class="side-item" href="disputes.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l9 16H3l9-16z"/><path d="M12 10v4M12 17h.01"/></svg>Спорове<span class="side-count">4</span></a>
    <a class="side-item" href="payouts.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 11h20"/><circle cx="17.5" cy="15" r="1.3"/></svg>Плащания</a>
    <a class="side-item" href="clients.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.6"/><path d="M2 21a7 7 0 0114 0"/><path d="M16 5.5a3.6 3.6 0 010 7M18 21a7 7 0 00-2.4-5.3"/></svg>Клиенти</a>
  </nav>
  <div class="side-label">Система</div>
  <nav class="side-nav">
    <a class="side-item" href="emails.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>Имейли</a>
    <a class="side-item" href="settings.html"><svg …gear as partner…/>Настройки</a>
  </nav>
  <div class="side-foot">
    <a class="side-user" href="settings.html">
      <span class="side-user-av">МК</span>
      <span><span class="side-user-name">Моника Ковачева</span><span class="side-user-role">Администратор</span></span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10l5 5 5-5"/></svg>
    </a>
  </div>
</aside>
```
- Admin topbar search text: "Търси изпълнител, клиент или резервация".
- Admin page head: `<h1 class="page-title">Август <span class="num">2025</span></h1>`, with `.page-head-right > span.seg > button.is-on…` and `.btn.btn--outline.btn--sm`.
- Admin account menu: Настройки, `<hr>`, Изход.

### 3d. Wizard shell (`onboarding/business.html`)
```html
<div id="frame">
<div class="wiz-shell">
  <header class="wiz-top">
    <a class="wiz-logo" href="../client/start.html"><img src="../assets/eventat-logo.png" alt="EventAT"></a>
    <div class="wiz-top-right">
      <span class="wiz-save-status">Запазено преди 1 мин</span>
      <a class="btn btn--outline wiz-top-btn" href="../client/start.html">Запази и продължи по-късно</a>
      <a class="wiz-top-link" href="../client/start.html">Изход</a>
      <span class="lang"><b>BG</b><span>EN</span></span>
    </div>
  </header>

  <main class="wiz-body">
    <aside class="wiz-stepper">
      <span class="wiz-stepper-eyebrow">Изпълнител</span>
      <h2 class="wiz-stepper-title">Настройте профила си</h2>
      <p class="wiz-stepper-sub">Шест стъпки до първите ви заявки. Напредъкът се запазва автоматично.</p>
      <ol class="wiz-steps">
        <li class="wiz-step wiz-step--current">
          <span class="wiz-step-bullet">1</span>
          <span class="wiz-step-label">Бизнес информация<span class="wiz-step-meta">Име, категория, локация</span></span>
        </li>
        <li class="wiz-step"><span class="wiz-step-bullet">2</span><span class="wiz-step-label">Профил и галерия<span class="wiz-step-meta">Представяне и снимки</span></span></li>
        … 3 Пакети и услуги · 4 Наличност · 5 Политика за анулиране · 6 Преглед и подаване
      </ol>
    </aside>

    <div class="wiz-content">
      <header class="wiz-step-header">
        <span class="wiz-step-counter">Стъпка 1 от 6</span>
        <h1 class="wiz-step-title">Да започнем с основите.</h1>
        <p class="wiz-step-intro">…</p>
      </header>
      <form class="wiz-form" onsubmit="event.preventDefault();">
        <section class="wiz-fieldset">
          <div class="wiz-fieldset-head"><div>
            <h3 class="wiz-fieldset-title">Бизнес информация</h3>
            <p class="wiz-fieldset-sub">…</p>
          </div></div>
          <div class="wiz-row--full">…</div>
          <div class="wiz-row">…two .field…</div>
          <div class="wiz-row--3">…three .field…</div>
        </section>
        <div class="alert"><svg class="alert-icon" …/><div><p class="alert-title">…</p><p class="alert-text">…</p></div></div>
      </form>
    </div>
  </main>

  <footer class="wiz-footer">
    <div class="wiz-footer-inner">
      <div class="wiz-progress">
        <div class="wiz-progress-bar"><span style="width: 16.7%;"></span></div>
        <span>Стъпка 1 от 6</span>
      </div>
      <div class="wiz-footer-actions">
        <!-- steps 2–6 add: <a class="btn btn--ghost btn--lg" href="prev.html"><svg class="btn-icon" …><path d="M19 12H5M11 6l-6 6 6 6"/></svg>Назад</a> -->
        <a class="btn btn--primary btn--lg" href="profile.html">Продължи към профила<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
      </div>
    </div>
  </footer>
</div>
</div>
```
- A done step is `li.wiz-step.wiz-step--done` with a check SVG (`<polyline points="20 6 9 17 4 12"/>`, stroke-width 3) in the bullet instead of the digit.
- Done steps get `.proto-click` from `proto.js`, which enables the hover rule in `wizard.css` (see section 7).
- **Pending variant** (`onboarding/pending.html`): `#frame > .pending-shell > header.wiz-top` (its `.wiz-top-right` holds two `.wiz-top-link`s, Помощ and Изход, plus `.lang`) `+ main.pending-hero > .pending-card`. The card holds `.pending-icon`, `span.pending-eyebrow`, `h1.pending-title`, `p.pending-text`, `.pending-timeline > .pending-step(--done|--current) > span.pending-step-bullet + .pending-step-content > p.pending-step-title + p.pending-step-meta`, `.pending-actions` and `p.pending-help`.

---

## 4. Component classes and markup patterns

### Buttons (`components.css`)
- **Base:** `.btn` (primary purple by default; `.btn--primary` is not a defined modifier but is used 73 times as a marker, and `wizard.css .wiz-footer-actions .btn--primary { min-width: 300px }` targets it).
- **Variants:** `.btn--secondary`, `.btn--outline`, `.btn--ghost`, `.btn--danger`, `.btn--gold`, and from `public.css`: `.btn--onDark`, `.btn--onDarkGhost`.
- **Sizes and shapes:** `.btn--sm`, `.btn--lg`, `.btn--block`, `.btn--icon`, `.btn--icon.btn--sm`.
- **States:** `[disabled]`/`.is-disabled`.
- **Icon:** `svg.btn-icon` (16px).
- Buttons are `white-space: nowrap`.
- **Markup:** `<a class="btn btn--primary btn--lg" href="…">Text<svg class="btn-icon" …/></a>` and `<button class="btn btn--outline btn--sm">…</button>`.
- **Panel-only:**
  - `.icon-btn` (40×40) with `span.dot`.
  - `.filter-btn` (36h): `<button class="filter-btn"><svg …/>Филтри</button>`. `proto.js` appends `svg.proto-caret`.
  - `.link-more`: `<a class="link-more" href="…">Виж всички <svg …/></a>`.
- **Client:** `.sort` (a span that acts as a dropdown).

### Badges and counters
- **Classes:** `.badge` plus `.badge--primary` (solid purple, for counts only), `--success`, `--warning`, `--danger`, `--info`, `--gold`, `--pink`, and `.badge--dot` (6px dot via `::before`).
- **Statuses are tinted and dotted** (rule 5: a solid pill reads as a button). Usage counts: `badge--success badge--dot` 72, `--primary --dot` 22, `--warning --dot` 20, `--pink --dot` 15, `--danger --dot` 12.
- **Markup:** `<span class="badge badge--success badge--dot">Потвърдена</span>`
- **Counters:** `.side-count`, `.tab-count`, `.group-count` (inside `.group--new`/`.group--pay`), `.mine-c` (inside `.mine--wait`/`.mine--pay`), `.pill-timer` (pink, with svg), `.v-tag` (on covers).

### Fields: three systems in use
1. **Real inputs** (`components.css`; onboarding, auth/register):
   `.field > label.field-label(+ span.required-mark | span.field-label-hint) + input.field-input | textarea.field-textarea | .select-wrap > select.field-select + svg.select-chevron + span.field-message`.
   - Error state: `.field--error`.
   - Wizard additions: `.field-input--ghost`, `.input-with-suffix > .field-input + .input-suffix`, `.checklist-editor > .checklist-item`.
   - Example select:
     ```html
     <div class="select-wrap"><select class="field-select">…</select>
       <svg class="select-chevron" viewBox="0 0 20 20"><path d="M5.5 8l4.5 4.5L14.5 8" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
     ```
2. **Panel fake fields** (`app.css`; settings, profile, dispute, 13 pages):
   `.field-row > label.fld > span.fld-l(+ span.required-mark) + span.fld-i` (`.fld-i--area` for multiline, `.fld-i.is-empty` for the hint colour, `.fld-hint`, client `.fld-hint--side`).
   - `.fld-i` is a styled span that `proto.js` makes contenteditable.
   - **In React, render `<input class="fld-i">` / `<textarea class="fld-i fld-i--area">`** and add the missing `font: inherit; outline: none;` and a `:focus { border-color: var(--primary-500); box-shadow: var(--shadow-focus) }` rule. The prototype has no focus style here.
3. **Client compound fields:**
   - search bar: `.searchbar > .sb-cell > .sb-l + .sb-v(.is-empty)`, then `.sb-go > .btn`
   - booking box: `.book-f > .book-f-row > .book-f-l + .book-f-v`
   - price range: `.f-range > .f-pill`
   - client form grid: `.form-card > .form-grid(--3)`
   - admin numeric input: `input.rate-in` with `.rate-u`

**Checkbox and radio:**
- `<label class="check"><input type="checkbox" checked /><span class="check-box"></span><span>…</span></label>`. `.radio`/`.radio-dot` is defined but unused.
- Filter checkbox rows (client): `<div class="f-item"><span class="f-box is-on"></span>Сватба<span class="f-count">79</span></div>`.

**Single-select option groups** (`.is-on` on one item):
- `.opt-row > .opt`
- `.pay-method > .pay-dot + .pay-n/.pay-d + .pay-logos > .pay-logo`
- `.pol > .pol-opt > .pol-dot + .pol-name/.pol-desc`
- `.res > .res-opt > .res-dot + .res-n/.res-d`
- `.cat-pills > .cat-pill`
- `.auth-role > .role > .role-t/.role-d`
- `.auth-tabs > .auth-tab`
- Wizard `.option-card(.is-selected) > .option-card-head > .option-card-icon + .option-card-title/.option-card-sub`, then `.option-card-body + .option-card-check > svg`.
- Wizard `.dow-row > label.dow-pill > input` (checked state via `:has(input:checked)`).

### Cards and containers
- `.card` (+ `.card--raised`, `.card--interactive`, `.card-header`, `.card-title`, `.card-subtitle`, `.card-footer`). Only 7 uses; `.card-footer` is reused as an action row in `.empty`.
- **Panel workhorse, 328 uses:** `<section class="dcard"><div class="dcard-head"><h2 class="dcard-title">…</h2><span class="badge …">…</span><a class="link-more">…</a></div>…</section>`. `.dcard + .dcard` adds a 16px gap.
- **Side panel:** `.panel > h3.panel-title + p.panel-text + .panel-actions + .panel-note`.
- **Key/value grid:** `.kv > .kv-item > .kv-label + .kv-value(> small)`.
- **Others:** `.note`, `.rules > .rule > .rule-num`, `.countdown`, `.client`/`.client-stats`, `.tl > .tl-item(.is-done|.is-current) > .tl-dot + .tl-title/.tl-time`.
- **Two-column layouts** (main + fixed side): `.detail-grid`, `.dash-grid`, `.cal-grid` (each 396px), `.adm-grid` (424px), `.adm-grid--wide` (360px), `.adm-grid--mail` (700px), client `.pv-grid` (392px), `.set-grid` (420px), `.cat-grid` (268px filter column).
- **KPI:** `.kpis > .kpi.kpi--accent|--gold|--success|--ink > div(.kpi-label, .kpi-value > small) + span.kpi-icon > svg`. Admin uses `.gmv > .gmv-cell(--lead) > .gmv-l + .gmv-v(> small) + .gmv-d(.is-flat)`.
- **Client cards:** `a.v-card[data-*] > span.v-cover(style bg) > span.v-tag`, then `span.v-body > .v-cat, .v-name, .v-loc, .v-rate (.v-stars + b), .v-foot > .v-price > small`. Also `.svc-card`, `.pk`, `.book`, `.sum`, `.ticket`, `.next-card`, `.nx`, `.mine > .mine-head + .mrow…`, `.status-hero`, `.clock`, `.empty--cta`.
- **List rows:**
  - `.req` = `avatar | .req-main | .req-meta > .req-meta-item | .req-end > .req-price + .req-status`
  - `.mrow` = `.mrow-img | .mrow-main | .mrow-meta > .mrow-col | .mrow-end > .mrow-status + .mrow-price + .btn`
  - also `.mini-req`, `.ev`, `.bk`, `.rec`, `.mod`, `.case`, `.batch`, `.mini`, `.cat-row`, `.chk`, `.rule-row`, `.set-row`, `.blk`, `.split`, `.notif`

### Tabs
- **Used pattern:**
  ```html
  <div class="toolbar">
    <nav class="tab-bar">
      <button data-tab class="tab-bar-item">Нови <span class="tab-count">3</span></button>
      …<button data-tab class="tab-bar-item is-active">Всички</button>
    </nav>
    <div class="toolbar-right">
      <button class="filter-btn"><svg …/>Филтри</button>
    </div>
  </div>
  ```
- **Segmented control** (admin): `<span class="seg"><button class="is-on">Месец</button><button>Тримесечие</button><button>Година</button></span>`
- `.tabs > .tab.is-active` (pill tabs) is defined in components.css but unused.

### Tables
- **Used** (`app.css .tbl`, 7 pages):
  ```html
  <table class="tbl"><thead><tr><th>Дата</th>…<th style="text-align:right">Сума</th></tr></thead>
  <tbody><tr><td><div class="tbl-event">14 юни</div><div class="tbl-sub">неделя</div></td>
    <td class="num muted">120</td><td class="num">1 450,00 €</td><td class="num strong">1 305,00 €</td>
    <td><span class="badge badge--success badge--dot">Потвърдена</span></td></tr></tbody></table>
  ```
  `.tbl .num` right-aligns the cell, and the global `.num` rule also sets Spectral (see section 5). `.tbl` sits directly inside `.dcard` with no scroll wrapper.
- `.table`/`.table-wrap` (components.css, uppercase header, hover) is unused.

### Toggles: two incompatible definitions
- `components.css`: `label.toggle > input + span.toggle-track` (unused).
- `app.css` L660–667, **used 35 times:** `<span class="toggle is-on"></span>` (42×24, `::after` knob, `.is-on` moves it) and `<span class="toggle is-on is-locked" title="Служебен имейл — не се изключва"></span>`.
- **If both stylesheets load, a `label.toggle` breaks.** Use the span pattern (as a `<button role="switch" aria-checked>` with class `toggle`) everywhere.
- **Stepper:** `.stepper > button + span + button`.

### Chips: four meanings share `.chip`
- `app.css .chip` = calendar event chip inside `.mday`: `.chip--booked`, `.chip--hold`, `.chip--blocked` (11px, ellipsis).
- `admin.css .chip` = neutral pill tag (`.chips > span.chip`, moderation reasons).
- `wizard.css .chip` = selectable pill (`.chip--active`, `.chip--add`; `.chips` wrapper).
- `app.css .chip-tag` = solid purple tag with an × svg (`.chip-add` dashed variant).
- `client.css .rw-chip` = multi-select pill. Its `.is-on` style exists only in `proto.js`'s injected CSS.
- Plus `.cat-pill`, `.opt`, `.dow-pill`, and the runtime `.proto-chip` (active-filter chip).

### Modals
- `components.css`: `.modal-overlay > .modal > .modal-header > .modal-title`, `+ .modal-text + .modal-footer`.
- **No page uses them.** Every confirm action is a toast via the `CONFIRM` map in `proto.js`.

### Toasts and alerts
- **The only toast is runtime:** `div.proto-toast(.is-on) > svg(check) + span`. It is fixed bottom-centre, dark `#1f1633`, white 600 14px, green check `#6fd99b`, and hides after 2.6 s. **Its CSS lives only in `proto.js`**, so it has to be ported.
- **Inline alert:** `.alert(--success|--warning|--danger) > svg.alert-icon + div > p.alert-title + p.alert-text`. It is used only on onboarding, where `#frame .alert` restyles it as a white card with a coloured icon.
- **Empty states:**
  - `.empty > span.empty-icon + h3.empty-title.t-h3 + p.empty-text + .card-footer`
  - client `.empty--cta` (grid-area banner)
  - runtime `.proto-empty` ("Няма записи в този изглед.")

### Other shared pieces
- `.avatar`: sizes `--xs`, `--sm`, `--lg`, `--xl`, plus `.avatar-group`.
- `.lang > b + span`.
- `.search`.
- Panel calendar:
  - mini: `.cal-head`, `.cal-dow`, `.cal-days > .cal-day(.is-out|.is-booked|.is-hold|.is-today|.is-blocked)`, `.cal-legend`
  - month: `.month-head`, `.mdow`, `.mdays > .mday(.is-out|.is-today|.is-blocked) > .mday-n + .chip`
- Wizard calendar: `.calendar > .calendar-head + .calendar-grid > .calendar-dow | .calendar-day(--off|--today|--blocked|--booked)`.
- `.gal > .gal-item(.is-cover) + .gal-add`; wizard `.gallery-grid > .gallery-item(--cover) > .gallery-tag + button.gallery-action`.
- `.dist`, `.rev`, `.rev-reply`, `.bars`, `.eh-bars`, `.steps > .step(.is-on|.is-done) > .step-n + .step-t + .step-line`.

---

## 5. Fonts and digits

### Families
- **Display:** `--font-display` = Constantia → Cormorant Garamond → Georgia.
  - **Constantia is never loaded as a webfont.** It appears only where it is installed locally (Windows/MS Office). Most visitors see Cormorant Garamond (Google Fonts, 400–700 plus italics).
  - Used for every headline class: `.page-title`, `.h-page`, `.dcard-title`, `.panel-title`, `.v-name`, `.wiz-step-title`, `.hero-t`, `.sec-t`, `.kpi-value`, …
- **UI:** `--font-ui` = Inter (400–800).
- **Numbers:** `--font-num` = Spectral. **Only weight 700 is loaded** (`Spectral:wght@700`), so any Spectral text renders bold whatever weight is declared (e.g. `.tbl .num` asks for 600).
- **Platform:** `/Users/nikoladamyanov/Desktop/Alexa/eventat-platform/styles/fonts.css` already redefines the three families with `--nf-cormorant`/`--nf-inter`/`--nf-spectral` from next/font. Keep Spectral at weight 700.

### Why digits leave the display face
Constantia and Cormorant use old-style figures ("jumping" digits), and a font-feature override doesn't survive export to Figma. Two mechanisms result:

1. **Spectral for digits in display-face elements.**
   - **app.css L873–894** (the "Figures" block, last in the file so it wins): `font-family: var(--font-num)` on
     `.kpi-value, .req-price, .svc-price-value, .svc-meta-v, .countdown-time, .client-stat-value, .mini-req-price, .ev-day, .earn-value, .rate-value, .bk-amount, .tbl .strong, .split b, .eh-value, .eh-stat-v, .rev-score-v, .cal-month, .month-title, .month-div b, .num`
   - **client.css L330–339:** `.v-price, .pk-p b, .book-price, .sum-total b, .clock-v, .mrow-price, .nx-d, .nx-in`
   - **public.css** sets it inside the rules for `.step3-n`, `.money-v`, `.ver-cell`.
   - **admin.css** sets it inside `.case-amt`, `.batch-amt`, `.gmv-v`, `.mini-v`, `.rate-in`, `.rate-u`, `.cs-money-v`.
   - **wizard.css L287:** `.num { font-family: var(--font-num); }`
   - **Inline digits in display headings are wrapped by hand:**
     - `<h1 class="page-title">Август <span class="num">2025</span></h1>`
     - `<span class="v-name">Snap<span class="num">360</span></span>`
     - 39 uses across 14 pages.
   - **For the port:** a `<Num>` component, or a helper that wraps digit runs (`/\d[\d\s.,]*/`) in `span.num` whenever display-font text is dynamic (vendor names, package names, titles with dates). The prototype's rule is "Digits never in Constantia".
   - **`.num` has two meanings inside `.tbl`:** a right-aligned, semibold numeric cell, and Spectral.
2. **Lining, tabular figures for Inter UI numbers.**
   - **app.css L509–528:** `font-variant-numeric: lining-nums tabular-nums; font-feature-settings: "lnum" 1, "tnum" 1, "locl" 0` on
     `.kpi-value, .req-price, .svc-price-value, .countdown-time, .client-stat-value, .kv-value, .req-meta-value, .side-count, .tab-count, .appnav-count, .pill-timer, .topbar-title, .page-sub, .tl-time, .rule, .panel-note, .badge`
   - Many individual rules also carry `font-variant-numeric: lining-nums (tabular-nums)`: `.f-count`, `.mrow-v`, `.sum-row b`, `.cal-day`, `.mday-n`, `.wiz-step-bullet`, `.wiz-progress`, `.rec-v`, `.ver-timer`, and others.
3. **Global:** `html { font-feature-settings: "locl" 0 }` with `lang="bg"` turns off Spectral's Bulgarian letterforms, so "от 640 €" reads the same everywhere. Keep both.

### Formats to keep
Money "1 450,00 €" (thin breaks are plain spaces in markup). Dates "14 юни 2026".

---

## 6. Responsive plan (selector → change)

Desktop-first: the existing rules are the ≥1281px design, and each block below adds to the one above.
- New UI is needed for the panel rail drawer and the client nav menu, e.g. a burger button in `.topbar`/`.nav` plus `.shell.is-nav-open` / `.nav.is-open`. The platform already has `.ui-burger`.
- Keep rule 3 (no wrapping in buttons, pills, tabs, chips): tab rows scroll horizontally rather than wrap.

### ≤1280px
**Panel shell**
- `:root` → `--side-w: 240px`
- `.side` → `padding: 22px 12px 16px`
- `.side-logo` → `width: 160px`
- `.topbar` → `padding: 0 24px; gap: 16px`
- `.search` → `min-width: 220px`
- `.content` → `padding: 24px 24px 36px`
- `.detail-grid, .dash-grid, .cal-grid` → `grid-template-columns: minmax(0,1fr) 340px`
- `.adm-grid` → `minmax(0,1fr) 360px`
- `.adm-grid--wide` → `minmax(0,1fr) 320px`
- `.adm-grid--mail` → `minmax(0,1fr) 520px`
- `.gmv` → `grid-template-columns: repeat(2, minmax(0,1fr))`, with `.gmv-cell:nth-child(2n) { border-right: none }` and `.gmv-cell:nth-child(-n+2) { border-bottom: 1px solid var(--app-line) }`
- `.rec` → `grid-template-columns: 42px minmax(0,1fr) auto auto`
- `.req-meta` → `gap: 22px`; `.req-meta-item` → `min-width: 88px`
- `.mrow-meta` → `gap: 20px`; `.mrow-col` → `min-width: 84px`
- `.eh-stat` → `min-width: 160px; padding: 22px`
- `.svc-grid` stays 3 columns (≈300px each at 1280).

**Client**
- `.nav` → `gap: 24px; padding: 0 32px`; `.nav-links` → `gap: 20px`
- `.hold` → `padding: 28px 32px 52px`
- `.cat-grid` → `grid-template-columns: 240px minmax(0,1fr)`
- `.pv-grid` → `minmax(0,1fr) 340px`
- `.set-grid` → `minmax(0,1fr) 360px`
- `.cat-hero` → `minmax(0,1fr) 360px`
- `.earn-split` → `minmax(0,1fr) 360px`
- `.v-grid` stays 3 columns.
- `.auth-form` → `padding: 88px 64px 0`

**Wizard**
- `.wiz-body` → `grid-template-columns: 260px minmax(0,1fr); column-gap: 40px; padding: 32px max(24px, calc((100% - var(--wiz-w))/2)) 48px`
- `.wiz-top` → `padding: 0 32px`
- `.wiz-footer` → `padding: 0 max(24px, calc((100% - var(--wiz-w))/2))`

### ≤960px
**Panel shell**
- `.side` → `position: fixed; inset: 0 auto 0 0; width: 280px; height: 100dvh; z-index: 80; transform: translateX(-100%); transition: transform var(--duration-normal) var(--ease-out)`
- `.shell.is-nav-open .side` → `transform: none`, plus a backdrop element using `var(--surface-overlay)`
- `.main` → full width
- `.topbar` → `padding: 0 16px 0 12px; height: 64px`, burger before `.topbar-title`
- `.search` → `display: none` (or an icon-only `.icon-btn`)

**Panel content**
- `.detail-grid, .dash-grid, .cal-grid, .adm-grid, .adm-grid--wide, .adm-grid--mail, .cs-vs` → `grid-template-columns: minmax(0,1fr)`
- `.kpis` → `repeat(2, minmax(0,1fr))`
- `.kv` → `repeat(2, minmax(0,1fr))`
- `.svc-grid` → `repeat(2, minmax(0,1fr))`
- `.gal` → `repeat(3, minmax(0,1fr))`
- `.page-head` → `flex-wrap: wrap; align-items: flex-start`; `.page-head-right` → `margin-left: 0; flex-wrap: wrap`
- `.toolbar` → `flex-wrap: wrap; padding: 6px 16px 0`
- `.toolbar .tab-bar` → `overflow-x: auto; scrollbar-width: none; flex-wrap: nowrap; max-width: 100%`
- `.toolbar-right` → `margin-left: 0; width: 100%; padding-bottom: 10px`
- `.req` → `grid-template-columns: 46px minmax(0,1fr)`; `.req-meta, .req-end` → `grid-column: 2 / -1`; `.req-meta` → `flex-wrap: wrap; gap: 12px 24px`; `.req-end` → `justify-content: space-between`; `.req-status` → `align-items: flex-start; min-width: 0`
- `.bk` → `grid-template-columns: 58px minmax(0,1fr) auto`; `.bk-col` → `grid-row: 2; grid-column: 2`
- `.rec` → `grid-template-columns: 42px minmax(0,1fr)`; `.rec-meta, .rec-end` → `grid-column: 2 / -1`; `.rec-end` → `justify-content: flex-start`
- `.mod-act` → `grid-column: 1 / -1; flex-direction: row; min-width: 0; align-self: start`
- `.batch` → `grid-template-columns: minmax(0,1fr) auto`
- **Tables:** `.tbl` → wrap in a scroll container (`.dcard:has(> .tbl) { overflow-x: auto }`, or render `<div class="table-wrap">`, which already has `overflow-x: auto`); `.tbl` → `min-width: 720px`
- `.earn-hero` → `grid-template-columns: minmax(0,1fr)`; `.eh-side` → `border-left: none; border-top: 1px solid var(--app-line)`; `.eh-stat` → `flex: 1; min-width: 0`
- `.mday` → `min-height: 76px; padding: 7px 8px`; `.mdays, .mdow` → `gap: 6px`
- Page-level styles in the same spirit:
  - `vendor/messages.html` `.vmsg-shell` → `grid-template-columns: minmax(0,1fr)` (list/thread toggle)
  - `client/messages.html` `.msg-shell` → the same
  - `vendor/service-new.html` `.sn-cover` and `vendor/service-edit.html` `.se-cover` → 1 column

**Client nav**
- `.nav` → `height: 64px; padding: 0 20px; gap: 16px`
- `.nav-links` → hidden behind a burger; open state `.nav.is-open .nav-links { display: flex; flex-direction: column; position: absolute; top: 64px; left: 0; right: 0; background: #fff; padding: 12px 20px; border-bottom: 1px solid var(--app-line) }`
- `.nav-user-name` → `display: none` (avatar only)

**Client content**
- `.hold` → `padding: 24px 20px 48px`
- `.searchbar` → `grid-template-columns: repeat(2, minmax(0,1fr))`
  - `.sb-cell:nth-child(2n)` → `border-right: none`
  - `.sb-cell:nth-child(-n+2)` → `border-bottom: 1px solid var(--app-line)`
  - `.sb-go` → `grid-column: 1 / -1; padding: 8px 0 0`; `.sb-go .btn` → `width: 100%`
  - The prototype's `.sb-cell:last-of-type` rule assumes plain sibling cells; don't wrap cells the way `proto.js` does.
- `.cat-grid` → `grid-template-columns: minmax(0,1fr)`; `.filters` → hidden behind a "Филтри" button (drawer/sheet, e.g. `.filters.is-open`)
- `.v-grid` → `repeat(2, minmax(0,1fr))`
- `.pv-grid` → 1 column; `.pv-gal` → `grid-template-columns: 2fr 1fr; grid-template-rows: 140px 140px`, hide `span:nth-child(n+4)`
- `.status-hero` → 1 column; `.clock` → `min-width: 0`
- `.ticket-grid` → `repeat(2, minmax(0,1fr))` (`.ticket-cell:nth-child(2n) { border-right: none }`, plus a top border on row 2)
- `.next` → `repeat(2, minmax(0,1fr))`
- `.form-grid--3` → `repeat(2, minmax(0,1fr))`
- `.mrow` → `grid-template-columns: 62px minmax(0,1fr) auto`; `.mrow-meta` → `grid-column: 2 / -1; grid-row: 2; flex-wrap: wrap; gap: 10px 24px`
- `.nx` → `grid-template-columns: 96px minmax(0,1fr)`; `.nx-side` → `grid-column: 1 / -1; text-align: left`
- `.set-grid` → 1 column
- `.empty--cta` → `grid-template-columns: 56px minmax(0,1fr); grid-template-areas: "icon title" "icon text" "act act"`; `.empty--cta .card-footer` → `flex-wrap: wrap; justify-content: flex-start`

**Public**
- `.hero-t` → `40px`
- `.steps3` → `minmax(0,1fr)`
- `.feats` → `repeat(2, minmax(0,1fr))`
- `.earn-split, .cat-hero, .cta, .doc` → `grid-template-columns: minmax(0,1fr)`
- `.doc-nav` → `position: static; display: flex; overflow-x: auto; gap: 6px`
- `.cta` → `padding: 36px 32px`
- `.cat-shot` → `height: 220px`
- `.auth` → `grid-template-columns: minmax(0,1fr)`; `.auth-side` → `display: none` (or a 200px banner); `.auth-form` → `padding: 48px 24px 56px; align-items: center`
- `.st-split` → `grid-template-columns: minmax(0,1fr); grid-template-rows: repeat(2, minmax(380px, 1fr))`
- `.st-ask, .st-lead, .st-label, .st-desc, .st-eyebrow` → `white-space: normal`
- `.st-label` → `40px`
- `.st-body` → `left: 32px; right: 32px; bottom: 40px`

**Wizard**
- `.wiz-body` → `grid-template-columns: minmax(0,1fr); row-gap: 24px`
- `.wiz-stepper` → `position: static`; `.wiz-stepper-sub` → `display: none`
- `.wiz-steps` → `flex-direction: row; overflow-x: auto; gap: 8px`; `.wiz-step` → `padding: 0`; `.wiz-step::after` → `display: none`; `.wiz-step-meta` → `display: none`; `.wiz-step:not(.wiz-step--current) .wiz-step-label` → `display: none`
- `.wiz-row--3` → `repeat(2, minmax(0,1fr))`
- `.gallery-grid` → `repeat(3, minmax(0,1fr))`
- `.wiz-top` → `padding: 0 20px; gap: 16px`; `.wiz-save-status` → `display: none`

### ≤640px
**Panel**
- `.topbar-title` → `18px`; `.lang` → `display: none` (move into the account menu)
- `.content` → `padding: 18px 16px 32px`
- `.page-title` → `26px`
- `.kpis, .kv, .svc-grid, .field-row, .cs-facts, .cs-cmp, .mod-diff` → `grid-template-columns: minmax(0,1fr)`; `.cs-fact` → `border-right: none; border-bottom: 1px solid var(--app-line)`
- `.gmv` → 1 column (`.gmv-cell` → `border-right: none; border-bottom: 1px solid var(--app-line)`); `.gmv-cell--lead .gmv-v` → `38px`
- `.gal` → `repeat(2, minmax(0,1fr))`
- `.dcard` → `padding: 18px 16px`; `.panel` → `padding: 18px`
- `.mini-req` → `grid-template-columns: 40px minmax(0,1fr) auto`; `.mini-req-date` → `grid-column: 2; grid-row: 2`
- `.ev` stays as is (58px / 1fr / auto fits)
- `.mod` → `grid-template-columns: 72px minmax(0,1fr)`; `.mod-img` → `width: 72px; height: 54px`
- `.case` → `grid-template-columns: 4px minmax(0,1fr)`; `.case-end` → `grid-column: 2`
- `.cat-row` → `grid-template-columns: 34px minmax(0,1fr) auto`; `.cat-c` → `display: none`
- `.rev-hero` → 1 column; `.rev-score` → `border-right: none; padding: 0 0 16px; border-bottom: 1px solid var(--app-line)`; `.rev-reply` → `margin-left: 0`
- `.svc, .client-stats, .pk` → `flex-wrap: wrap`
- `.eh-side` → `flex-direction: column`; `.eh-stat + .eh-stat` → `border-left: none; border-top: 1px solid var(--app-line)`; `.eh-value` → `40px`; `.eh-bars i, .eh-x span` → `flex: 1; width: auto`
- `.mday` → `min-height: 44px; padding: 5px`; `.mday .chip` → `font-size: 0; height: 6px; padding: 0` (colour bar instead of text)
- `.seg` → `max-width: 100%; overflow-x: auto`
- `.danger-zone .set-row, .set-row` → `flex-wrap: wrap`

**Client**
- `.nav` → `padding: 0 16px`; `.nav-logo` → `height: 34px`; `.lang` → into the menu
- `.hold` → `padding: 20px 16px 40px`
- `.h-row` → `flex-wrap: wrap; align-items: flex-start`; `.h-row .h-right` → `margin-left: 0`; `.h-page` → `28px`
- `.searchbar` → `grid-template-columns: minmax(0,1fr)`; `.sb-cell` → `border-right: none; border-bottom: 1px solid var(--app-line)`
- `.v-grid, .next, .form-grid, .form-grid--3, .rw-grid` → `grid-template-columns: minmax(0,1fr)`
- `.results-head` → `flex-wrap: wrap; gap: 8px`; `.sort` → `margin-left: 0`
- `.pv-gal` → horizontal scroll-snap strip, or show only `span:first-child` at `height: 220px`
- `.pk-p` → `margin-left: 0; text-align: left; width: 100%`
- `.steps` → `overflow-x: auto`; `.step:not(.is-on) .step-t` → `display: none`; `.step-line` → `width: 24px; margin: 0 8px`
- `.form-card` → `padding: 20px 18px`
- `.pay-method` → `flex-wrap: wrap`; `.pay-logos` → `margin-left: 32px`
- `.ticket-top` → `flex-wrap: wrap`; `.ticket-cell` → `padding: 16px 18px`
- `.done-t` → `30px`
- `.mrow` → `grid-template-columns: 48px minmax(0,1fr)`; `.mrow-img` → `48px`; `.mrow-end` → `grid-column: 1 / -1; justify-content: space-between`; `.mrow-status` → `align-items: flex-start; min-width: 0`
- `.mine-head` → `flex-wrap: wrap`; `.mine-hint` → `margin-left: 0; width: 100%`
- `.nx` → `grid-template-columns: minmax(0,1fr)`; `.nx-date` → `display: flex; gap: 8px; align-items: baseline`
- `.rw-stars svg` → `34px`; `.rw-drop` → `flex-wrap: wrap`; `.rw-shots` → `margin-left: 0`
- `.empty--cta` → `grid-template-columns: minmax(0,1fr); grid-template-areas: "icon" "title" "text" "act"`; `.empty--cta .card-footer` → `flex-direction: column`; buttons `width: 100%`

**Public**
- `.hero` → `padding: 32px 0 24px`; `.hero-t` → `32px`; `.hero-d` → `15px`
- `.hero-cta, .cta-act` → `flex-direction: column`; `.btn` → `width: 100%`
- `.band` → `height: auto; min-height: 260px`; `.band-in` → `position: relative; padding: 32px 20px`; `.band-t` → `28px`
- `.feats` → 1 column
- `.sec-t` → `26px`
- `.doc-body` → `padding: 24px 18px`
- `.auth-form` → `padding: 32px 16px 48px`
- `.reg-fields, .reg-social` → 1 column
- `.role-d, .reg-consent .f-item, .reg-fields .field-input, .ver-eyebrow, .ver-hint, .ver-resend` → `white-space: normal`
- `.ver-code` → `gap: 6px`; `.ver-cell` → `height: 56px; font-size: 26px`
- `.st-head` → `padding: 24px 16px`; `.st-have` → `display: none`; `.st-label` → `34px`; `.st-desc` → `16px`; `.st-cta` → `min-width: 0`

**Wizard**
- `.wiz-top-btn` → `display: none` (or move into a menu); `.wiz-steps` → `display: none` (the footer already says "Стъпка N от 6")
- `.wiz-row, .wiz-row--3, .policy-timeline, .review-grid` → `grid-template-columns: minmax(0,1fr)`; `.policy-tl-cell` → `border-right: none; border-bottom: 1px solid var(--app-line)`
- `.wiz-shell .field-label` (now `#frame .field-label`) → `white-space: normal`
- `.wiz-fieldset, .review-section` → `padding: 20px 18px 22px`
- `.wiz-step-title` → `30px`
- `.gallery-grid` → `repeat(2, minmax(0,1fr))`
- `.service-row-actions` → `grid-column: 1 / -1`
- `.wiz-footer` → `height: auto; padding: 12px 16px`; `.wiz-progress-bar` → `width: 96px`; `.wiz-footer-actions` → `flex: 1`; `.wiz-footer-actions .btn` → `flex: 1`; `.wiz-footer-actions .btn--primary` → `min-width: 0`
- `.pending-card` → `padding: 32px 20px`; `.pending-title` → `28px`; `.pending-actions` → `flex-direction: column`
- `.calendar-day` → `height: 40px`

**Any width:** `@media (hover: none) { .gallery-item .gallery-action { opacity: 1 } }`. Today it only appears on hover.

---

## 7. CSS that depends on proto.js classes

### A. Rules in the stylesheets that key on proto classes
- `tokens.css` L196–198: `html.proto-fit …` → remove.
- `app.css` L299: `.filter-btn .proto-caret { width: 14px; height: 14px; margin: 0 -3px 0 2px; }`. `proto.js` appends `<svg class="proto-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 9l6 6 6-6"/></svg>` to every `.filter-btn` that has options (rule 5: every dropdown shows a chevron). **React must render the caret itself.**
- `app.css` L300: `.proto-anchor:has(> .proto-menu:not([hidden])) > .filter-btn { border-color: var(--primary-500); background: var(--primary-50); }` is the open-dropdown state. Reproduce it with the same wrapper structure (`span.proto-anchor > .filter-btn + div.proto-menu[hidden]`), or switch to `.filter-btn[aria-expanded="true"]`.
- `wizard.css` L173: `.wiz-step.proto-click:hover .wiz-step-label { color: var(--primary-700); }`. `proto.js` marks done steps clickable. **React must add the class**, or a renamed one, to steps that link back.

### B. Styles that exist only in proto.js's injected `<style>` (L316–357)
These disappear without `proto.js` and must move into a real stylesheet. The platform renamed them `ui-*` in `platform.css`.
- **Cursors and helpers:**
  - `.proto-click { cursor: pointer }`
  - `.proto-closed { opacity: .4; pointer-events: none }`
- **Guest nav:**
  - `.proto-guest { display: flex; align-items: center; gap: 10px }`
  - `.proto-guest .btn { display: inline-flex; align-items: center; height: 40px; padding: 0 22px; border-radius: var(--radius-md); font-size: 14px }`
- **Dropdowns** (account menu, bell, filter options, search bar menus):
  - `.proto-menu { position: absolute; z-index: 60; min-width: 230px; padding: 6px; background: #fff; border: 1px solid #e7e7ec; border-radius: 12px; box-shadow: 0 14px 36px rgba(31,22,51,.18); font-family: var(--font-ui); text-align: left }`
  - `.proto-menu--up { left: 0; right: 0; bottom: calc(100% + 8px) }`
  - `.proto-menu--down { right: 0; top: calc(100% + 8px) }`
  - `.proto-menu a { display: block; padding: 9px 12px; border-radius: 8px; font-size: 13.5px; font-weight: 500; color: var(--neutral-700); white-space: nowrap }`; `:hover { background: var(--primary-50); color: var(--text) }`
  - `.proto-menu hr { border: 0; border-top: 1px solid #e7e7ec; margin: 6px 4px }`
  - `.proto-menu--wide { min-width: 320px }` (clamp it on mobile)
  - `.proto-anchor { position: relative; display: inline-flex; align-items: center }`; `.proto-anchor.proto-anchor--block { display: block; position: relative }`
  - `.proto-bar-menu { left: 0; right: auto; min-width: 100% }`
- **Notifications:** `.proto-note` (block, 10/12 padding, radius 8, hover primary-50), `.proto-note b` (13px 600 text), `.proto-note span` (12px neutral-500, margin-top 2).
- **Search suggestions** (catalog, search, category):
  - `.proto-suggest { left: 0; right: auto; width: 420px; max-height: 420px; overflow-y: auto; padding: 8px }` (use `width: min(420px, 100%)` on mobile)
  - `.proto-suggest-h` (10.5px, uppercase, .09em, neutral-400)
  - `.proto-anchor--block > .sb-cell { position: relative; width: 100%; box-sizing: border-box; padding-left: 44px }`
  - `.sb-ico { position: absolute; left: 18px; top: 50%; width: 15px; height: 15px; margin-top: -1px; color: var(--neutral-400) }` (a search icon injected into the first cell)
- **Active filter chips:**
  - `.proto-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 18px }`
  - `.proto-chip { height: 30px; padding: 0 10px 0 13px; border: 1px solid var(--primary-200); border-radius: 999px; background: var(--primary-50); color: var(--text); font: 600 12.5px/1 var(--font-ui) }`, with `:hover` and `svg` rules
  - `.proto-chip-clear` (an underlined text button in primary-700)
- **Empty list state:** `.proto-empty { padding: 26px 4px; text-align: center; font-size: 13.5px; color: var(--neutral-500) }`
- **Toast:**
  - `.proto-toast { position: fixed; left: 50%; bottom: 32px; z-index: 1000; display: flex; align-items: center; gap: 10px; padding: 12px 18px 12px 14px; border-radius: 12px; background: #1f1633; color: #fff; font: 600 14px/1.3 var(--font-ui); box-shadow: 0 14px 36px rgba(31,22,51,.3); opacity: 0; transform: translate(-50%, 12px); transition: opacity .2s, transform .2s; pointer-events: none }`
  - `.proto-toast.is-on { opacity: 1; transform: translate(-50%, 0) }`
  - `.proto-toast svg { width: 18px; height: 18px; color: #6fd99b }`
- **`.rw-chip.is-on { background: var(--primary-600); border-color: var(--primary-600); color: #fff; font-weight: 600 }`.** This is the only selected style for review chips, so it must be ported.
- **Prototype-only, drop:** `.proto-field*` (contenteditable fake inputs) and `body.proto-hint .proto-hot` (the click-empty-space hotspot flash).

### C. State classes the CSS styles and proto.js toggles
React must drive these from state with the same class names.
- **Tabs and segments:**
  - `.tab-bar-item.is-active` (including `.tab-bar-item.is-active .tab-count`)
  - `.seg button.is-on`
  - `proto.js` also hides filtered rows with the `hidden` attribute and appends `.proto-empty` when none remain. List config is in `PROTO_LISTS`.
- **Switches:** `.toggle.is-on`, and `.toggle.is-locked` (not toggleable; shows a toast).
- **Single-select groups** (one `.is-on` per parent): `.opt`, `.pay-method`, `.pol-opt`, `.res-opt`, `.cat-pill`, `.dp-pick` (page-level, client/dispute), `.role`, `[data-role]`, `.doc-link`.
- **Multi-select:**
  - `.f-box.is-on` (toggled by clicking the parent `.f-item`)
  - `.rw-chip.is-on`
  - wizard `.chip.chip--active`
  - `.option-card.is-selected` (radio-like, or multi when several start selected)
  - `.dow-pill:has(input:checked)` (native)
- **Ratings:** `.rw-stars svg.is-on` (stars up to the clicked one), `.rw-mini svg.is-off`.
- **Admin:** `.chk.is-ok` (moderation checklist).
- **Calendars:**
  - `.cal-day.is-blocked` toggled on free days
  - `.mday`: `proto.js` adds or removes a `span.chip.chip--blocked` ("Блокирана") child
  - wizard `.calendar-day--blocked`
- **Gallery:** `.gallery-item--cover` (+ `span.gallery-tag` "Главна"; moves to the next item when the cover is removed).
- **Catalog busy state:** `.v-card.is-off` (dims `.v-cover`/`.v-price`, greys `.v-name`), with an appended row:
  `<span class="v-busy proto-busy"><span class="badge badge--danger badge--dot">Зает на 14 юни</span><button class="btn btn--outline btn--sm">Уведоми ме</button></span>`
  It appears only when the card's `data-busy` contains the chosen date.
- **Hint styles:** `.sb-v.is-empty`, `.fld-i.is-empty`. With real inputs, use `::placeholder` instead.
- **Messages pages** (page-level CSS): conversation items get `.is-on`/`.is-active`, and lose `.is-unread`/`.is-new` when opened. `.msg-comp-f.is-ph` is the empty-composer hint. The "unread only" button swaps `.btn--primary` ↔ `.btn--outline`.
- **Static state classes** rendered straight from data:
  - `.step.is-on/.is-done`, `.wiz-step--done/--current`, `.pending-step--done/--current`, `.tl-item.is-done/.is-current`
  - `.cal-day.is-out/.is-booked/.is-hold/.is-today`, `.mday.is-out/.is-today/.is-blocked`
  - `.rec.is-sel`, `.case.is-urgent/.is-open/.is-done`, `.chk.is-wait`
  - `.mod-side.is-new`, `.split.is-total/.is-fee`, `.bars i.is-now`, `.eh-bars i.is-now`
  - `.reg-meter-bar i.is-on`, `.ver-cell.is-next`, `.mrow.is-off`
  - `.gmv-d.is-flat`, `.cs-fact.is-warn`, `.cs-party.is-vendor`
  - `.group--new/--pay`, `.mine--wait/--pay`, `.kpi--accent/--gold/--success/--ink`

### D. Behaviour attributes worth keeping as conventions
`data-go="page.html"` and `data-toast="…"` (the delegated click handler), and the `.v-card` filter data attributes: `data-name`, `data-cat`, `data-city`, `data-price`, `data-rating`, `data-policy`, `data-events`, `data-free`, `data-busy`, `data-cap`.

---

## 8. Collisions when all CSS is global (matters for Next.js)

In the App Router, CSS imported by `(site)`, `(panel)` and `(wizard)` layouts is global. After client-side navigation it stays loaded, so the separation the prototype relied on ("Never load app.css next to wizard.css") no longer holds. Selectors defined in more than one file:

| Selector | Files | Effect if both load |
|---|---|---|
| `#frame` | app, wizard | harmless once neutralised |
| `body` background, `:root` `--app-bg`/`--app-line` | components, app, wizard | same values; set the background to `var(--app-bg)` |
| `.toggle` | components (`label > input + .toggle-track`), app (`span.toggle.is-on`) | a `label.toggle` gets app's 42×24 pill background; use only the app pattern |
| `.chip`, `.chips` | app (calendar chip, 11px, ellipsis), admin (neutral pill), wizard (selectable pill) | **breaks the vendor calendar chips** when admin or wizard CSS is present, and wizard chips pick up the ellipsis and 7px radius from app |
| `.cal-legend` | app (`margin-top`/`padding-top`/`border-top`), wizard (flex-wrap, 12px) | the wizard legend gains app's top rule |
| `.rate` | app (rating row, gap 14), admin (editable rate row: `padding: 13px 0`, `.rate + .rate` border) | the vendor dashboard rating gains padding |
| `.lang`, `.lang b`, `.lang span` | app, wizard | identical; harmless |
| `.num` | app, wizard | identical font rule; harmless |
| `.fld-i.is-empty` | app, admin | identical |
| `.badge` | components + app numerals block | intended |

**Fix:** scope area CSS under a root class (e.g. `.area-admin .chip`, `.area-wizard .chip`), or rename the colliding classes: `.chip` → `.cal-chip` (app calendar), `.tag-chip` (admin), `.pick-chip` (wizard); `.rate` → `.rate-row` in admin. Either way, update the matching selectors in `proto.js`'s replacement logic.

**Key file paths**
- Prototype: `/Users/nikoladamyanov/Desktop/Alexa/eventat-app/{tokens,components,app,client,public,admin,wizard}.css`, `/Users/nikoladamyanov/Desktop/Alexa/eventat-app/proto.js` (injected CSS L316–357, `fit()` L405–418, account menu L1910–1932, guest nav L448–465, filter carets L895–935, state toggles L960–1085)
- Sample pages: `/Users/nikoladamyanov/Desktop/Alexa/eventat-app/client/catalog.html`, `/Users/nikoladamyanov/Desktop/Alexa/eventat-app/vendor/dashboard.html`, `/Users/nikoladamyanov/Desktop/Alexa/eventat-app/admin/dashboard.html`, `/Users/nikoladamyanov/Desktop/Alexa/eventat-app/onboarding/business.html`
- Existing port layer: `/Users/nikoladamyanov/Desktop/Alexa/eventat-platform/styles/platform.css` and `/Users/nikoladamyanov/Desktop/Alexa/eventat-platform/styles/fonts.css`