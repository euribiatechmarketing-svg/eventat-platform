// Saved searches and date watches (SPEC §4.14, §13.9; timers T20, T21; D21).
//
// Date watch: watching ‹Датата е заета› → notified (the date stopped being busy: K4, K6, K7,
// K9, K11, a block removed — `client-date-freed` at once) → closed (a new request to that
// partner for that date); also expired (T21, the date passed) and removed (the stop control).
// Saved search: notify on / off, deleted; T20 scans daily at ⚙ saved_search.scan_time.
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import { category, city, clientEvent, dateWatch, eventType, partner, savedSearch, user } from '@/db/schema';
import { now } from '@/lib/clock';
import { cancelJobs, scheduleJob } from '@/lib/jobs';
import { addDays, date as fmtDate, dateShort, moneyShort, sofiaDate, sofiaInstant, type DateStr } from '@/lib/format';
import { SYSTEM, type AnyActor } from './actor';
import { audit } from './audit';
import { isBusy, isDate } from './availability';
import { DomainError, NotFoundError, assertClient, mail, withTx } from './catalogue-kit';
import { POLICY_LABEL } from './partners';
import { GUEST_BANDS, POLICY_SLUG, matchPartners, paramsJson, parseSearchParams, ratingText, searchHref, type SearchParams } from './search';
import { getSetting } from './settings';

export type SavedSearch = typeof savedSearch.$inferSelect;
export type DateWatch = typeof dateWatch.$inferSelect;

// ── Texts (§13.9) ────────────────────────────────────────────────────────

type Names = { category: string | null; pluralNoun: string | null; types: string[]; cities: string[] };

async function names(q: Queryable, p: SearchParams): Promise<Names> {
  const [c] = p.kategoriya ? await q.select().from(category).where(eq(category.slug, p.kategoriya)) : [];
  const types = p.sabitie.length ? await q.select({ slug: eventType.slug, name: eventType.name }).from(eventType).where(inArray(eventType.slug, p.sabitie)) : [];
  const cities = p.grad.length ? await q.select({ slug: city.slug, name: city.name }).from(city).where(inArray(city.slug, p.grad)) : [];
  return {
    category: c?.name ?? null, pluralNoun: c?.pluralNoun ?? null,
    types: p.sabitie.map(s => types.find(t => t.slug === s)?.name).filter(Boolean) as string[],
    cities: p.grad.map(s => cities.find(t => t.slug === s)?.name).filter(Boolean) as string[],
  };
}

const guestsText = (g: string) => `${g in GUEST_BANDS ? GUEST_BANDS[g as keyof typeof GUEST_BANDS].label : g} гости`;

/**
 * The saved search's title (‹Изпълнители за сватба · София · 14 юни 2026 · 120 гости›), its
 * summary (‹Всички услуги · свободни на датата · рейтинг 4,5 и нагоре›) and the email's inbox
 * line (title and filters without the date).
 */
export function savedTexts(p: SearchParams, n: Names): { title: string; summary: string; inboxLine: string } {
  const q = p.q ? `„${p.q.toLocaleLowerCase('bg')}“` : null;
  const what = n.category ?? (n.types.length ? `Изпълнители за ${n.types.join(', ').toLocaleLowerCase('bg')}` : q ?? 'Всички услуги');
  const dateText = p.data ? fmtDate(p.data) : null;
  const title = [what, n.cities.join(', ') || null, dateText, p.gosti ? guestsText(p.gosti) : null].filter(Boolean) as string[];
  const usedQ = what === q;
  const filters: string[] = [];
  if (q && !usedQ) filters.push(q);
  else if (!q && !n.category) filters.push('Всички услуги');
  filters.push(p.data ? (p.drugaData ? 'Предлагат друга дата' : 'свободни на датата') : 'Без избрана дата');
  if (p.reyting.length) filters.push(`рейтинг ${ratingText(Math.min(...p.reyting))} и нагоре`);
  for (const s of p.politika) filters.push(`${POLICY_LABEL[POLICY_SLUG[s]]} политика`);
  if (p.cenaOt != null && p.cenaDo != null) filters.push(`${moneyShort(p.cenaOt * 100)} – ${moneyShort(p.cenaDo * 100)}`);
  else if (p.cenaDo != null) filters.push(`до ${moneyShort(p.cenaDo * 100)}`);
  else if (p.cenaOt != null) filters.push(`от ${moneyShort(p.cenaOt * 100)}`);
  if (p.otgovor24) filters.push('Отговаря до 24 часа');
  const quiet = new Set(['Всички услуги', 'свободни на датата', 'Без избрана дата']);
  const inboxLine = [...title.filter(t => t !== dateText), ...filters.filter(f => !quiet.has(f))].join(' · ');
  return { title: title.join(' · '), summary: filters.join(' · '), inboxLine };
}

// ── Saved searches ───────────────────────────────────────────────────────

async function ownSearch(tx: Queryable, actor: AnyActor, id: string): Promise<SavedSearch> {
  assertClient(actor);
  const [s] = await tx.select().from(savedSearch).where(and(eq(savedSearch.id, id), eq(savedSearch.clientId, actor.userId))).limit(1);
  if (!s) throw new NotFoundError('saved_search');
  return s;
}

/** ‹Запази търсенето› (toast ‹Търсенето е запазено в профила ви›): the full parameter set plus the generated texts; notify on. */
export async function saveSearch(actor: AnyActor, a: { params: SearchParams }, tx?: Tx): Promise<SavedSearch> {
  assertClient(actor);
  return withTx(tx, async t => {
    const at = await now();
    const texts = savedTexts(a.params, await names(t, a.params));
    const [row] = await t.insert(savedSearch).values({
      clientId: actor.userId, title: texts.title, filtersSummary: texts.summary, params: paramsJson(a.params), notify: true,
      seenAt: at, lastCheckedAt: at, lastAlertedAt: at, createdAt: at,
    }).returning();
    await audit(t, { actor, action: 'saved_search.created', entity: 'saved_search', entityId: row.id });
    return row;
  });
}

/**
 * The bell on the row: ‹Изключи известията за това търсене› (toast ‹Известията за това търсене са
 * изключени›) / ‹Включи известията за това търсене› (toast ‹Ще ви известим при нови резултати›).
 */
export async function setNotify(actor: AnyActor, a: { id: string; notify: boolean }, tx?: Tx) {
  return withTx(tx, async t => {
    const s = await ownSearch(t, actor, a.id);
    // Turning alerts back on starts from now: what appeared while they were off is not mailed.
    const [row] = await t.update(savedSearch).set({ notify: a.notify, ...(a.notify && !s.notify ? { lastAlertedAt: await now() } : {}) })
      .where(eq(savedSearch.id, s.id)).returning();
    await audit(t, { actor, action: a.notify ? 'saved_search.notify_on' : 'saved_search.notify_off', entity: 'saved_search', entityId: s.id });
    return row;
  });
}

/** ‹Изтрий запазеното търсене› (toast ‹Търсенето е изтрито›). */
export async function deleteSearch(actor: AnyActor, a: { id: string }, tx?: Tx) {
  return withTx(tx, async t => {
    const s = await ownSearch(t, actor, a.id);
    await t.delete(savedSearch).where(eq(savedSearch.id, s.id));
    await audit(t, { actor, action: 'saved_search.deleted', entity: 'saved_search', entityId: s.id });
  });
}

/** ‹Отвори›: restores every filter (the returned href) and resets `seen_at`. */
export async function openSearch(actor: AnyActor, a: { id: string }, tx?: Tx): Promise<{ href: string }> {
  return withTx(tx, async t => {
    const s = await ownSearch(t, actor, a.id);
    const at = await now();
    await t.update(savedSearch).set({ seenAt: at, lastOpenedAt: at }).where(eq(savedSearch.id, s.id));
    return { href: searchHref(parseSearchParams(s.params as Record<string, unknown>)) };
  });
}

/**
 * `/akaunt/zapazeni`: saved searches with the computed row — ‹Резултати› (live count with the
 * category noun), ‹N нови от вчера› / ‹N нови тази седмица› / ‹Без нови› (partners that started
 * matching since `seen_at`), ‹N свободни на {дата}› or ‹последна проверка днес› — and the date watches.
 */
export async function listSaved(actor: AnyActor, q: Queryable = db) {
  assertClient(actor);
  const at = await now();
  const rows = await q.select().from(savedSearch).where(eq(savedSearch.clientId, actor.userId)).orderBy(asc(savedSearch.createdAt));
  const searches = [];
  for (const s of rows) {
    const p = parseSearchParams(s.params as Record<string, unknown>);
    const n = await names(q, p);
    const all = await matchPartners(p, { clientId: actor.userId }, { ignoreDate: true }, q);
    const free = p.data ? all.filter(m => !m.busyOnDate).length : null;
    const seen = s.seenAt ?? s.createdAt;
    const fresh = all.filter(m => m.listedAt && m.listedAt > seen).length;
    const recent = at.getTime() - seen.getTime() <= 86_400_000;
    searches.push({
      search: s, href: searchHref(p),
      results: all.length === 1 ? '1 изпълнител' : `${all.length} ${n.pluralNoun ?? 'изпълнители'}`,
      fresh: fresh ? `${fresh} нови ${recent ? 'от вчера' : 'тази седмица'}` : 'Без нови',
      free: p.data ? `${free} свободни на ${dateShort(p.data)}` : 'последна проверка днес',
      savedOn: sofiaDate(s.createdAt),
    });
  }
  const watches = await q.select({ w: dateWatch, partnerName: partner.businessName, partnerSlug: partner.slug, categoryName: category.name, eventTitle: clientEvent.title })
    .from(dateWatch).innerJoin(partner, eq(partner.id, dateWatch.partnerId)).leftJoin(category, eq(category.id, partner.primaryCategoryId))
    .leftJoin(clientEvent, eq(clientEvent.id, dateWatch.clientEventId))
    .where(and(eq(dateWatch.clientId, actor.userId), eq(dateWatch.status, 'watching'))).orderBy(asc(dateWatch.date));
  return {
    searches,
    watches: watches.map(r => ({
      watch: r.w, partnerName: r.partnerName, partnerHref: `/partnyori/${r.partnerSlug}`,
      line: `${r.categoryName ?? ''} · щом ${dateShort(r.w.date)} се освободи, ви известяваме веднага`,
      date: r.w.date, eventTitle: r.eventTitle, badge: 'Датата е заета', since: `следим от ${dateShort(sofiaDate(r.w.createdAt))}`,
    })),
  };
}

// ── Date watches ─────────────────────────────────────────────────────────

async function insertWatch(t: Tx, clientId: string, partnerId: string, d: DateStr, clientEventId: string | null, at: Date): Promise<{ watch: DateWatch; created: boolean }> {
  const [existing] = await t.select().from(dateWatch)
    .where(and(eq(dateWatch.clientId, clientId), eq(dateWatch.partnerId, partnerId), eq(dateWatch.date, d), eq(dateWatch.status, 'watching'))).limit(1);
  if (existing) return { watch: existing, created: false };
  // Two clicks at once: the partial unique index keeps one `watching` row; the loser reads the winner's.
  const [w] = await t.insert(dateWatch).values({ clientId, partnerId, date: d, clientEventId, createdAt: at })
    .onConflictDoNothing().returning();
  if (!w) {
    const [winner] = await t.select().from(dateWatch)
      .where(and(eq(dateWatch.clientId, clientId), eq(dateWatch.partnerId, partnerId), eq(dateWatch.date, d), eq(dateWatch.status, 'watching'))).limit(1);
    return { watch: winner, created: false };
  }
  // T21: the watch ends when the date passes (watching → expired, notified → closed).
  await scheduleJob('datewatch.expire', sofiaInstant(addDays(d, 1), 0, 0), { watchId: w.id }, `datewatch:${w.id}:expire`, t);
  return { watch: w, created: true };
}

/**
 * ‹Уведоми ме› / ‹Уведоми ме, ако се освободи›: one active watch per client, partner and date
 * (an existing one is returned). Toast ‹Ще ви известим, ако датата се освободи›.
 */
export async function watchDate(actor: AnyActor, a: { partnerId: string; date: DateStr; clientEventId?: string | null }, tx?: Tx): Promise<DateWatch> {
  assertClient(actor);
  if (!isDate(a.date)) throw new DomainError('invalid_date');
  return withTx(tx, async t => {
    const at = await now();
    if (a.date < sofiaDate(at)) throw new DomainError('date_past');
    const [p] = await t.select({ id: partner.id, status: partner.status, isListed: partner.isListed }).from(partner).where(eq(partner.id, a.partnerId));
    if (!p || p.status !== 'approved' || !p.isListed) throw new NotFoundError('partner');
    if (a.clientEventId) {
      const [ev] = await t.select({ id: clientEvent.id }).from(clientEvent).where(and(eq(clientEvent.id, a.clientEventId), eq(clientEvent.clientId, actor.userId)));
      if (!ev) throw new NotFoundError('client_event');
    }
    if (!(await isBusy(p.id, a.date, t))) throw new DomainError('date_free');
    const { watch: w, created } = await insertWatch(t, actor.userId, p.id, a.date, a.clientEventId ?? null, at);
    if (created) await audit(t, { actor, action: 'date_watch.created', entity: 'date_watch', entityId: w.id, data: { partnerId: p.id, date: a.date } });
    return w;
  });
}

/** Zero state ‹Уведоми ме при свободна дата›: a watch on every matching partner busy on the chosen date. */
export async function watchDates(actor: AnyActor, a: { params: SearchParams }, tx?: Tx): Promise<{ created: number }> {
  assertClient(actor);
  const d = a.params.data;
  if (!d) throw new DomainError('date_required');
  return withTx(tx, async t => {
    const at = await now();
    if (d < sofiaDate(at)) throw new DomainError('date_past');
    const matches = await matchPartners(a.params, { clientId: actor.userId }, { ignoreDate: true }, t);
    // The event context comes from the URL: keep it only when it is the client's own event.
    const [ev] = a.params.sabitieId && /^[0-9a-f-]{36}$/i.test(a.params.sabitieId)
      ? await t.select({ id: clientEvent.id }).from(clientEvent).where(and(eq(clientEvent.id, a.params.sabitieId), eq(clientEvent.clientId, actor.userId)))
      : [];
    let created = 0;
    for (const m of matches.filter(x => x.busyOnDate)) {
      if ((await insertWatch(t, actor.userId, m.id, d, ev?.id ?? null, at)).created) created++;
    }
    await audit(t, { actor, action: 'date_watch.created_many', entity: 'user', entityId: actor.userId, data: { date: d, created } });
    return { created };
  });
}

/** The stop control on the watch row [new copy, D21]. */
export async function removeWatch(actor: AnyActor, a: { id: string }, tx?: Tx) {
  assertClient(actor);
  return withTx(tx, async t => {
    const [w] = await t.select().from(dateWatch).where(and(eq(dateWatch.id, a.id), eq(dateWatch.clientId, actor.userId))).for('update');
    if (!w) throw new NotFoundError('date_watch');
    if (w.status !== 'watching') return w;
    const [row] = await t.update(dateWatch).set({ status: 'removed', closedAt: await now() }).where(eq(dateWatch.id, w.id)).returning();
    await cancelJobs(`datewatch:${w.id}:`, t);
    await audit(t, { actor, action: 'date_watch.removed', entity: 'date_watch', entityId: w.id });
    return row;
  });
}

/**
 * §4.14 Notify: when the partner's date stops being busy, every `watching` watch on it →
 * `notified` and `client-date-freed` goes out at once (D21). Safe to call after any change
 * (K4, K6, K7, K9, K11, a block removed): it re-checks availability and does nothing while the
 * date is still busy. Returns how many watches fired. Call inside the transaction of the change.
 */
export async function notifyDateFreed(partnerId: string, d: DateStr, tx?: Tx): Promise<number> {
  return withTx(tx, async t => {
    const at = await now();
    if (d < sofiaDate(at)) return 0;
    const watches = await t.select().from(dateWatch)
      .where(and(eq(dateWatch.partnerId, partnerId), eq(dateWatch.date, d), eq(dateWatch.status, 'watching'))).for('update');
    if (!watches.length || await isBusy(partnerId, d, t)) return 0;
    const [p] = await t.select({ p: partner, categoryName: category.name }).from(partner)
      .leftJoin(category, eq(category.id, partner.primaryCategoryId)).where(eq(partner.id, partnerId));
    let n = 0;
    for (const w of watches) {
      // T21 stays scheduled: a notified watch is closed when its date passes (§4.14 Close).
      await t.update(dateWatch).set({ status: 'notified', notifiedAt: at }).where(eq(dateWatch.id, w.id));
      const [u] = await t.select().from(user).where(and(eq(user.id, w.clientId), isNull(user.deletedAt)));
      if (!u) continue;
      // The watch's event, else the client's event on that date.
      const [ev] = w.clientEventId
        ? await t.select({ title: clientEvent.title }).from(clientEvent).where(eq(clientEvent.id, w.clientEventId))
        : await t.select({ title: clientEvent.title }).from(clientEvent).where(and(eq(clientEvent.clientId, w.clientId), eq(clientEvent.date, d))).limit(1);
      await mail(t, {
        key: 'client-date-freed', to: u.email, toUserId: u.id, dedupeKey: `datewatch:${w.id}:freed`,
        vars: {
          partnerSlug: p.p.slug, partnerName: p.p.businessName, partnerCategory: p.categoryName ?? '',
          eventType: ev?.title ?? '—', eventDate: fmtDate(d), watchingSince: fmtDate(w.createdAt),
        },
        bell: { href: `/partnyori/${p.p.slug}?data=${d}` },
      });
      await audit(t, { actor: SYSTEM, action: 'date_watch.notified', entity: 'date_watch', entityId: w.id, data: { partnerId, date: d } });
      n++;
    }
    return n;
  });
}

/** §4.14 Close: the client sent a new request to that partner for that date (call from R1). */
export async function closeWatches(a: { clientId: string; partnerId: string; date: DateStr }, tx?: Tx): Promise<number> {
  return withTx(tx, async t => {
    const rows = await t.update(dateWatch).set({ status: 'closed', closedAt: await now() })
      .where(and(eq(dateWatch.clientId, a.clientId), eq(dateWatch.partnerId, a.partnerId), eq(dateWatch.date, a.date),
        inArray(dateWatch.status, ['watching', 'notified']))).returning({ id: dateWatch.id });
    for (const r of rows) await cancelJobs(`datewatch:${r.id}:`, t);
    return rows.length;
  });
}

/**
 * T21 `datewatch.expire` after the watch's date: `watching` → `expired` (T21) and `notified` →
 * `closed` (§4.14 Close: the date passed). Idempotent.
 */
export async function expireWatch(a: { watchId: string }, tx?: Tx): Promise<boolean> {
  return withTx(tx, async t => {
    const at = await now();
    const [w] = await t.select().from(dateWatch).where(eq(dateWatch.id, a.watchId)).for('update');
    if (!w || w.date >= sofiaDate(at) || (w.status !== 'watching' && w.status !== 'notified')) return false;
    const status = w.status === 'watching' ? 'expired' as const : 'closed' as const;
    await t.update(dateWatch).set({ status, closedAt: at }).where(eq(dateWatch.id, w.id));
    await audit(t, { actor: SYSTEM, action: status === 'expired' ? 'date_watch.expired' : 'date_watch.closed', entity: 'date_watch', entityId: w.id });
    return true;
  });
}

// ── T20 saved-search scan ────────────────────────────────────────────────

/** Schedule the next T20 scan at ⚙ saved_search.scan_time (today if still ahead, else tomorrow). Idempotent. */
export async function scheduleSavedSearchScan(tx?: Tx, after?: Date) {
  const at = after ?? await now();
  const [hh, mm] = (await getSetting('saved_search.scan_time', at, tx)).split(':').map(Number);
  let d = sofiaDate(at);
  if (sofiaInstant(d, hh, mm) <= at) d = addDays(d, 1);
  await scheduleJob('savedsearch.scan', sofiaInstant(d, hh, mm), { date: d }, `savedsearch:${d}`, tx);
  return d;
}

/**
 * T20 `savedsearch.scan` (daily 08:00): for every saved search with notify on, partners that
 * match its filters and were approved or listed after `last_alerted_at` → `client-saved-search-alert`
 * (+ bell). Then the next day's scan is scheduled. Idempotent per day (dedupe per search and date).
 */
export async function scanSavedSearches(a: { date?: DateStr } = {}): Promise<{ scanned: number; alerted: number }> {
  const at = await now();
  const day = a.date ?? sofiaDate(at);
  const rows = await db.select({ s: savedSearch, email: user.email }).from(savedSearch).innerJoin(user, eq(user.id, savedSearch.clientId))
    .where(and(eq(savedSearch.notify, true), isNull(user.deletedAt), eq(user.banned, false))).orderBy(asc(savedSearch.createdAt));
  let alerted = 0;
  for (const { s, email } of rows) {
    await db.transaction(async t => {
      const p = parseSearchParams(s.params as Record<string, unknown>);
      const matches = await matchPartners(p, { clientId: s.clientId }, {}, t);
      const since = s.lastAlertedAt ?? s.createdAt;
      const fresh = matches.filter(m => m.listedAt && m.listedAt > since);
      if (fresh.length) {
        const texts = savedTexts(p, await names(t, p));
        const id = await mail(t, {
          key: 'client-saved-search-alert', to: email, toUserId: s.clientId, dedupeKey: `savedsearch:${s.id}:${day}`,
          vars: {
            newCount: fresh.length, ...(p.data ? { eventDate: fmtDate(p.data) } : {}), search: s.title, summary: texts.inboxLine,
            filters: s.filtersSummary, totalCount: matches.length,
          },
          bell: { href: searchHref(p) },
        });
        if (id) alerted++;
        await t.update(savedSearch).set({ lastAlertedAt: at, lastCheckedAt: at }).where(eq(savedSearch.id, s.id));
      } else {
        await t.update(savedSearch).set({ lastCheckedAt: at }).where(eq(savedSearch.id, s.id));
      }
    });
  }
  await scheduleSavedSearchScan(undefined, new Date(Math.max(sofiaInstant(day, 23, 59).getTime(), at.getTime())));
  return { scanned: rows.length, alerted };
}

