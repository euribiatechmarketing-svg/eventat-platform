# EventAT platform — approval list

This list covers every place where the platform build is not a 1:1 copy of the approved prototype: new copy, rules the prototype left open, values we had to assume for the demo, and deviations we kept.
Answer by number: **keep**, **change to …** or **remove**, for example "12: keep" or "31: change to ‹…›". For a decision, name the option ("3: A").
Until you answer, the platform does what the item describes under "Now". Bulgarian text is quoted exactly in ‹…›; {…} marks a value filled in from data.
(D…) is the number of the decision in the build spec, for reference only.

---

## Decisions that change behaviour

**1. How the client pays: in full, or deposit + balance** (D5)
- Now (default): the client pays the whole amount within 24 h of approval, as in the prototype. Payments run through the test checkout.
- Option B: a deposit at approval and the balance charged automatically before the event (30 days before by default, never less than 14). Stripe holds money for at most 90 days, so going live on Stripe needs B.
- B is held back until its copy is approved. What is missing is listed in 149.

**2. Bank transfer** (D6)
- Now: ‹Банков превод› is offered on every booking next to ‹Карта›. The client has the same 24 h to pay, and the team can extend that by 24 h. In the demo the transfer goes to the test account ‹BG80 BNBG 9661 1020 3456 78›. Live, the payment provider issues the account, never EventAT.
- Option: offer the transfer only for events more than N days away (you name N).
- Why: ‹Потвърждението отнема до 2 работни дни› does not fit a 24 h payment window.

**3. Offers on ‹По запитване› services and open requests** (D60)
- Now: held back. A partner can answer a ‹По запитване› request only with ‹Поискай още информация› or ‹Откажи›; there is no ‹Изпрати оферта›. A client's open request (`/zayavka/otvorena`) is emailed to matching partners (‹Ново запитване: …›), but it appears nowhere in their panel, so they cannot answer it. The client side can already show a quote offer under ‹Нова оферта› with ‹Избери› (the demo has one). An offer that lapses sends no email.
- Options: A — approve copy and design for the offer screens (listed in 148), then we build them; B — keep as now; C — keep held back and hide the open-request form until A.

**4. Phone rule: a client with no phone number**
- Now: a partner sees the client's phone only after a paid booking. Until then, phone numbers and emails in messages show as ‹•••›. A client whose profile has no phone cannot send a request: `/zayavka/[partnerSlug]` shows the general ‹Действието не е изпълнено. Опитайте отново.›
- Options: A — a message that sends her to ‹Настройки› to add a phone (new copy); B — ask for the phone on the request form when it is missing (new copy); C — keep.

**5. Who gets the money a late client cancellation leaves behind** (D11)
- Now: the amount the policy keeps goes to the partner, minus commission at the booking's rate, in the normal payout for the event date.
- Option: say otherwise (for example, no commission on kept amounts).

**6. The last tier of ‹Гъвкава›** (D9)
- Now: full refund up to 7 days before, the deposit is kept from 6 days to 1 day before, nothing is refunded on the event day. These are the three tiers of the partner sign-up; the legal page describes two.
- Also: the policy summary in `/admin/nastroyki` reads ‹Строга (депозитът не се връща)›. The prototype's ‹Строга (без връщане)› is wrong, because the rest is refunded up to 14 days before.
- Options: A — three tiers (now); B — two tiers, as on the legal page.

**7. An unanswered request lapses** (D12)
- Now: if the partner does not answer within 24 h, the request lapses and the client is told. It does not pass to the next free partner, as the prototype's `/admin/nastroyki` says. The helper line under ‹Срок за отговор от изпълнител› is left out.
- Proposed line: ‹След това заявката отпада.›

**8. How long after the event a case can be opened** (D70)
- Now: up to 30 days after the event date (`/akaunt/poddrazhka/nov`, `/partner/poddrazhka/nov`).

**9. ‹Друго› as the main category in partner sign-up** (D16)
- Now: not offered in step 1 (`/partner/registratsiya/1`), so a partner whose service fits no category cannot finish sign-up. The spec turns ‹Друго› into a free-text "suggest a category" note, but sign-up still requires a real category.
- Options: A — offer ‹Друго› with a text field and let the team set the category on approval (the field needs copy); B — keep it out.

**10. Profile edits go live at once, service edits are checked first** (D59)
- Now: changes on `/partner/profil` (texts, photos, switches) are public immediately. Changes to a published service wait for the team in ‹Модерация›.
- Option: check profile edits too.

**11. Invoices** (D41, with an accountant)
- Now: an invoice per payment, numbered per issuer. VAT, credit notes, EventAT's commission invoice and EventAT's legal entity are not confirmed. The demo issues no commission invoices because the legal entity is missing. After a cancellation with a refund, the client sees only the original invoice marked ‹Платена›; no credit note appears.
- Needed: the legal entity (name, ЕИК, VAT number, address) and the accountant's rules.

**12. Event types** (D15)
- Now: four public types, Сватба, Рожден ден, Фирмено събитие and Абитуриентски бал, plus a hidden ‹Друго›. The prototype's ‹Коледно парти› counts as Фирмено събитие and ‹Годишнина› as Друго. ‹Кръщене› is not included. The client's own event name stays free text.

**13. Reminder times** (D37)
- Now: event reminders at 09:00 (client 7 days and 1 day before, partner 7 days before). Review invitation at 10:00 the day after the event. Team daily digest at 09:00. Payout batch prepared at 09:00 the day before payout.

**14. Filter counts in search** (D43)
- Now: the number next to each filter counts results under all the other filters already chosen. The prototype's numbers ignored the other filters.

**15. The ‹Отговаря до 24 часа› filter** (D44)
- Now: shows partners who let no request lapse unanswered in the last 90 days. In the prototype the filter did nothing.

**16. City filter** (D73)
- Now: a partner matches a city if based there, working nationwide, or within the radius they set. The counts will differ from the prototype's typed numbers.

---

## Public site & search

**17. Page not found** — any unknown address, and any record the visitor may not open (site, partner panel, admin)
- Now: ‹404›, heading ‹Страницата не е намерена›, text ‹Връзката може да е непълна или страницата вече не съществува.›, button ‹Към началото› (site) or ‹Към таблото› (partner and admin panels). Browser tab: ‹Страницата не е намерена · EventAT›.
- Why: new copy; the prototype has no 404 screen.

**18. The start page for signed-in users** (D47) — `/`
- Now: a signed-in client goes to `/tarsene`, a partner to `/partner`, an admin to `/admin`. Guests see the start page.

**19. Commission on public pages** (D8) — `/stani-partnyor`, the questions on `/pravila`
- Now: they show the commission as in the prototype, with the numbers taken from settings: ‹При потвърдена резервация платформата удържа {10 %} комисиона.› and ‹За първите {три} резервации комисионата е {5 %}.› Partner panels, booking screens and emails show only what the partner receives.

**20. A partner who has switched off ‹Приемам нови заявки›** (D72) — `/partnyori/[slug]`
- Now: the partner is left out of search and open requests. The profile still opens, but its booking box shows no date, type or request button and no line saying why.
- Why: the explanation is new copy.

**21. ‹Още липсва› when no partner is free** — `/sabitiya/[slug]`
- Now: ‹Няма партньори›, the wording the tier cards on the same page already use.
- Why: the row read ‹0 партньори са свободни›.

**22. Date in the default search pill** — `/tarsene`
- Now: ‹19 декември 2026› (full month, per the date rule). The prototype shows ‹19 дек 2026›.

**23. Search card of a partner the client has already booked** — `/tarsene`
- Now: the grey ‹Зает на 14 юни› badge stays; only ‹Уведоми ме› is removed. The prototype showed that partner as free.

**24. Position of the sort control** — `/tarsene`, `/kategorii/[slug]`
- Now: right-aligned, as in the prototype's styles and the Figma capture. In the live prototype it sits right next to the count line.

**25. ‹· подредени по рейтинг› left out** — `/kategorii/[slug]`
- Why: the default sort is ‹Препоръчани›, so the line would be wrong.

**26. Second sentence of the catering hero left out** — `/kategorii/ketaring`
- Prototype: ‹Менюта от 24 € на гост, с дегустация преди подписване›.
- Why: the real prices contradict "от 24 €", and no category has its own intro text yet.

**27. Language switch on phones** — every page
- Now: ‹BG› / ‹EN› is hidden at 960 px and below. On wider screens ‹EN› shows ‹Английската версия идва скоро›.

---

## Sign-in & account

**28. Form errors on sign-in, sign-up, codes and settings** — `/vhod`, `/registratsiya`, `/potvarzhdenie`, `/vhod/nova-parola`, `/akaunt/nastroyki`, the deletion links
- Now: ‹Попълнете полето.› · ‹Въведете валиден имейл.› · ‹Паролата трябва да е поне 8 знака.› · ‹Въведете валиден телефонен номер.› · ‹Приемете Общите условия и Политиката за поверителност.› · ‹Вече има профил с този имейл.› · ‹Грешен имейл или парола.› · ‹Кодът не е верен.› · ‹Кодът е изтекъл. Поискайте нов.› · ‹Линкът е изтекъл. Поискайте нов от екрана за вход.› · ‹Линкът е изтекъл или вече е използван.› · ‹Въведете валиден ЕИК.› · ‹Изтриването е възможно само без предстоящи резервации.› · ‹Неподдържан формат на файла.› · ‹Файлът е твърде голям.› · ‹Нещо се обърка. Опитайте отново.›
- Why: new copy; the prototype has no error states.

**29. Two-step sign-in SMS** (D20) — `/vhod/kod`
- Now: the SMS contains only the 6-digit code, no words.
- Needed: the SMS text.

**30. Consent box on sign-up** — `/registratsiya`
- Now: starts unticked. The prototype shows it ticked.
- Why: consent is an active choice.

**31. Google and Facebook buttons** — `/vhod`, `/registratsiya`
- Now: hidden, because no Google or Facebook account is connected yet. Once connected, ‹Продължи с Google› shows, and on `/registratsiya` for clients only. ‹Продължи с Facebook› stays hidden: Facebook does not confirm that the email address belongs to the person, and a profile needs a confirmed address.

**32. Company-invoice field labels** — `/akaunt/nastroyki`
- Now: ‹Адрес› and ‹МОЛ›.
- Why: new labels.

**33. ‹Моите събития› with no events** — `/akaunt/sabitiya`
- Now: only an icon and the button ‹Добави още услуги›, no title or text.
- Why: the prototype has no empty state here; a title and a line need copy.

**34. Hint on a watched date** (D21) — `/akaunt/zapazeni`
- Now: ‹Проверяваме наличността всеки ден — щом се освободи, можете да заявите отново› (prototype).
- Why: the email goes out the moment the date frees up, not once a day, so the hint needs new wording.

---

## Client booking flow

**35. Failed payment** — `/plashtane/[nomer]`
- Now: ‹Плащането не е преминало. Опитайте отново.›
- Why: new copy.

**36. Errors on request, payment, cancellation and review** — `/zayavka/[partnerSlug]`, `/zayavka/otvorena`, `/plashtane/[nomer]`, `/akaunt/rezervacii/[nomer]/anulirane`, `/akaunt/rezervacii/[nomer]/revyu`
- Now: ‹Вече имате заявка към този изпълнител за тази дата.› · ‹Плащането не е възможно в момента. Опитайте отново по-късно.› · ‹Действието не е разрешено за този профил.› · ‹Състоянието се промени. Презаредете страницата.› · ‹Записът не е намерен.› · ‹Събитието вече е минало.› · ‹По резервацията има отворен сигнал.› · ‹Опишете причината.› · ‹Действието не е изпълнено. Опитайте отново.› (any other refusal)
- Why: new copy. The other errors on these pages reuse prototype wording (‹Датата е заета›, ‹Срокът за плащане изтече›).

**37. Next-step cards after a booking** — `/plashtane/[nomer]/potvardena`, `/akaunt/rezervacii/[nomer]`
- Now: the prototype's lines speak of a DJ at a wedding. For other partners and events they read ‹Обикновено до седмица преди събитието, за да уточните програмата.› and ‹Ще получите покана за ревю — то помага на следващите клиенти да избират.›
- Why: combined from approved wording (the confirmation email and the bookings page).

**38. Review wording** (D30) — `/akaunt/rezervacii/[nomer]/revyu`
- Now: 5 stars shows ‹Отлично — бих ги препоръчала› (feminine); 1–4 stars show no verdict. The quick tags include ‹+ Бих ги наела пак›.
- Needed: neutral variants and verdicts for 1–4 stars (new copy).

**39. ‹Свали PDF› opens a printable page, not a file** — `/akaunt/rezervacii/[nomer]/faktura`, `/admin/rezervacii/[nomer]`
- Now: the browser's print window opens and the user saves it as PDF there. No ‹Файлът се изтегля› toast.
- Why: a real PDF file needs a PDF generator and an embeddable Cyrillic font, which the project does not have yet.

**40. Purple text on purple, kept from the prototype** — `/akaunt/zayavki`, `/akaunt/rezervacii`, `/zayavka/otvorena`
- Now: the tab counters, the date block on the bookings page and the step numbers of the open-request form are purple on a light purple tint.
- Why: they come straight from the prototype's styles, but break the "no purple on purple" rule.

**41. The browser's own "fill in this field" messages** — all forms
- Now: for an empty required field the browser shows its built-in message, in the browser's language (English on an English browser).

**42. A client cannot withdraw a request** — `/akaunt/zayavki/[nomer]`
- Now: once sent, a request waits for the partner's answer or lapses. There is no withdraw button, as in the prototype.
- Option: add one (needs copy).

---

## Messages & disputes

**43. Empty lists** — `/akaunt/saobshteniya`, `/partner/saobshteniya`, `/akaunt/poddrazhka`, `/partner/poddrazhka`
- Now: ‹Няма записи в този изглед.›, the prototype's generic line.
- Why: these screens have no empty state in the prototype.

**44. Withdrawing a case** (D68) — `/akaunt/poddrazhka/[nomer]`, `/partner/poddrazhka/[nomer]`
- Now: button ‹Оттегли сигнала›, toast ‹Сигналът е оттеглен›. Only whoever filed the case sees it. No email goes out (see 96).
- Why: new copy.

**45. Note for the client on an open case** — `/akaunt/poddrazhka/[nomer]`
- Now: ‹Ако се разберете с изпълнителя преди решението, оттеглете сигнала.›
- Why: new copy.

**46. The case page for client and partner** — `/akaunt/poddrazhka/[nomer]`, `/partner/poddrazhka/[nomer]`
- Now: the prototype has a case page only for the team, so this page reuses the team's wording: ‹Подаде сигнала›, ‹Поискахме позиция…›, ‹Чакаме отговор от…›, ‹Пари по случая›, ‹Мотив към двете страни›, and the card title ‹Въпрос по сигнала› (from the email subject).

**47. Errors when writing a message or filing a case** — the four routes above, plus `/akaunt/poddrazhka/nov` and `/partner/poddrazhka/nov`
- Now: ‹Напишете съобщение или прикачете файл.› · ‹Съобщението е твърде дълго — до 4 000 знака.› · ‹Файлът трябва да е JPG, PNG или PDF.› · ‹Файлът е по-голям от 5 MB.› · ‹Опишете какво се случи.› · ‹Изберете причина.› · ‹Изберете резервация.› · ‹По тази резервация вече има отворен сигнал.› · ‹По тази резервация вече има сигнал.› · ‹За тази резервация не може да се подаде сигнал.› · ‹Сигнал може да се подаде до 30 дни след събитието.› · ‹Случаят вече е приключен.› · ‹Сигналът вече не може да се оттегли.›
- Shared: ‹Нещо се обърка. Опитайте отново.› (answer under 28).
- Why: new copy. The forms now open with a booking and a reason already chosen, so ‹Изберете причина.› and ‹Изберете резервация.› rarely appear.

**48. List preview of a message that has only a file** — `/akaunt/saobshteniya`, `/partner/saobshteniya`
- Now: the file name.
- Why: there is no approved wording for it.

---

## Partner sign-up

**49. Field errors** — `/partner/registratsiya/1` to `/6`
- Now: ‹Попълнете отбелязаните полета.› · ‹Проверете ЕИК / Булстат.› · ‹Проверете имейла.› · ‹Проверете телефона.› · ‹Качете снимка.› · ‹Изберете поне едно събитие.› · ‹Проверете цената.› · ‹Добавете поне един пакет с фиксирана цена.› · ‹Можете да добавите до {N} пакета.› · ‹Галерията е пълна› · ‹Изберете поне един ден.› Prototype hints now also used as errors: ‹Линк към YouTube или Vimeo.›, ‹Поне {N} снимки от ваши събития.›, ‹Изберете една политика.›
- Shared: ‹Попълнете полето.› (answer under 28).
- Why: new copy.

**50. Save status after the first hour** — the wizard's top bar
- Now: ‹Запазено преди {N} ч›, and after 24 hours ‹Запазено на {дата}›. The prototype has only ‹Запазено току-що› and ‹Запазено преди {N} мин›.

**51. Approved and rejected states of the waiting page** (D51) — `/partner/registratsiya/podadeno`
- Now, approved: ‹Профилът ви е одобрен›, ‹{бизнес} вече се показва в каталога и можете да приемате заявки.›
- Now, rejected: ‹Заявката е отказана›, ‹Не можем да одобрим профила ви›, ‹Екипът на EventAT прегледа заявката на {бизнес} и не може да я одобри. Мотивът е по-долу.›, ‹Мотив›, ‹Ако смятате, че има грешка, пишете ни на {имейл} и посочете ЕИК {ЕИК}.›
- Why: the prototype draws only the "submitted" state; the text is taken from the approval and rejection emails.

**52. ‹Към таблото› on the waiting page** (D94) — `/partner/registratsiya/podadeno`
- Now: shows only once the partner is approved. While waiting, the page shows the timeline only.

**53. ‹Запази и продължи по-късно› on phones**
- Now: hidden at 640 px and below, because it does not fit. ‹Изход› saves the same way there.

**54. Remove button on an open package** — `/partner/registratsiya/3`
- Now: a bin button on an expanded package (not in the prototype).
- Why: otherwise a saved but unfinished package cannot be removed.

**55. Text box for the ‹Друго› business type** — `/partner/registratsiya/1`
- Now: picking ‹Друго› under ‹Тип на бизнеса› opens a text box with no label under it.
- Why: we need the actual business type.

**56. ‹Максимум резервации за дата› in the availability step** — `/partner/registratsiya/4`
- Now: the label from the partner calendar, reused in step 4.

**57. Work radius options** (D76) — `/partner/registratsiya/1`, `/partner/profil`
- Now: ‹до 50 км›, ‹до 100 км›, ‹до 150 км›, ‹В цялата страна›. Demo partners keep the prototype's 60, 80, 120 and 200 km, which the list does not offer.

---

## Partner panel

**58. Error toasts** — `/partner/zayavki/[nomer]`, `/partner/rezervacii/[nomer]`, `/partner/kalendar`
- Now: ‹Срокът е изтекъл› · ‹Датата е минала› · ‹Проверете въведените данни› · ‹Действието вече не е възможно›
- Why: new copy.

**59. Client card on a request** (D95) — `/partner/zayavki/[nomer]`
- Now: the number of bookings and ‹Клиент от {година}›. The prototype's ‹4,9 Оценка› is dropped, because nobody can rate clients.

**60. Badge ‹Искане за анулиране›** (D58) — `/partner/rezervacii/[nomer]`, `/admin/rezervacii`, `/akaunt/sabitiya/[id]`
- Now: ‹Искане за анулиране› (taken from the email wording) while the team handles a partner's request to cancel.
- Note: the client also sees it on her event page, while the spec says the client keeps seeing ‹Потвърдена› until the team acts. Say which you want.

**61. Approving before the partner's payment account is ready** (D62) — `/partner/zayavki/[nomer]`
- Now: matters only once Stripe is on. ‹Одобри заявката› stays clickable and the refusal reads ‹Действието вече не е възможно›. The spec wants the button disabled with a line that explains why; that line needs copy.

**62. Calendar layout** — `/partner/kalendar`
- Now: below 1700 px wide the month takes the full width and the two side panels move under it. On narrow days a chip keeps only its first word, or becomes a colour bar.
- Why: the day chips were unreadable (‹Сватб…›).

---

## Partner services & money

**63. Price unit and minimum guests** (D42) — `/partner/uslugi/nova`, `/partner/uslugi/[id]`
- Now: price per ‹за събитие› or ‹на гост›, and the field ‹Минимум гости›.
- Why: new labels; the prototype uses per-guest prices but cannot edit them.

**64. Labels on the services page** — `/partner/uslugi`
- Now: the tab ‹В преглед› (when a service waits for review), the menu item ‹Всички категории›, and ‹Откажи› / ‹Запази промените› in ‹Подреди› mode.

**65. A service returned by the team** (D58) — `/partner/uslugi`, `/partner/uslugi/[id]`
- Now: badge ‹Върната с бележка›, and the banner ‹Бележка от екипа:› followed by the team's note.

**66. Reactivating a deactivated profile** (D24) — `/partner/nastroyki`
- Now: the row ‹Профилът е деактивиран› with ‹Профилът не се показва в каталога, но резервациите остават.› and the button ‹Активирай›; toast ‹Промените са запазени›. On `/partner/profil` the ‹Профилът е активен› switch shows off and cannot be changed.

**67. Chip ‹Абитуриентски балове›** (D74) — `/partner/profil`, `/partner/uslugi/[id]`
- Now: ‹Абитуриентски балове› among the event-type chips. The prototype's specialisations have no prom chip.

**68. Field errors on services** — `/partner/uslugi/nova`, `/partner/uslugi/[id]`
- Now: ‹Въведете име на услугата.› · ‹До 80 знака.› · ‹До 600 знака.› · ‹Въведете кратко описание.› · ‹Изберете категория.› · ‹Въведете цена.› · ‹Въведете цена за допълнителния час.› · ‹Въведете брой гости.› · ‹До 120 знака на точка.› · ‹До 12 точки.› · ‹Проверете попълнените полета.›
- Shared: ‹Изберете поне едно събитие.› (answer under 49).

**69. Field errors on profile, settings, payout account and reviews** — `/partner/profil`, `/partner/nastroyki`, `/partner/smetka`, `/partner/revyuta`
- Now: ‹Въведете описание.› · ‹Въведете профил в Instagram или Facebook.› · ‹Въведете лице за контакт.› · ‹Въведете валиден телефон.› · ‹Въведете валиден български IBAN.› · ‹Изберете банка.› · ‹Титулярят трябва да е фирмата от профила ви.› · ‹Липсва името на фирмата в профила ви.› · ‹Качете документ от банката.› · ‹Напишете отговор.› · ‹Вече сте отговорили на това ревю.›
- Shared: ‹Въведете валиден имейл.› (answer under 28).

**70. Refusals and upload errors** — the partner's services, profile and money pages
- Now: ‹Достигнахте максималния брой пакети с фиксирана цена.› · ‹Действието не е достъпно за профила ви в момента.› · ‹Услугата не може да се промени в това състояние.› · ‹Услугата още не е публикувана — изпратете я за преглед.› · ‹Услугата е публикувана — запазете промените, за да ги прегледа екипът.› · ‹Форматът на файла не се приема.› · ‹Снимката е твърде малка.› · ‹Галерията е пълна.› · ‹Галерията не може да има по-малко снимки.› · ‹Снимката вече е в галерията.› · ‹Подредбата не може да се запази.› · ‹Линкът е невалиден или е изтекъл.›
- Shared: ‹Файлът е по-голям от 5 MB.› (answer under 47) and ‹Записът не е намерен.› (answer under 36).

**71. Download link for the earnings report** — `/partner/prihodi`
- Now: ‹Изтегли справката› on the page once a report exists, so the report announced by email can be downloaded. The prototype has this label only in the email.

**72. Stripe-only button** — `/partner/smetka`
- Now: ‹Потвърди данните при доставчика› (opens the payment provider's identity check). Hidden with the test provider.

**73. Bank list** — `/partner/smetka`
- Now: 17 banks we compiled, since no reference list exists: ‹Алианц Банк България›, ‹Банка ДСК›, ‹Българо-американска кредитна банка›, ‹Българска банка за развитие›, ‹Инвестбанк›, ‹Интернешънъл Асет Банк›, ‹Обединена българска банка›, ‹Общинска банка›, ‹Първа инвестиционна банка›, ‹Postbank›, ‹ПроКредит Банк›, ‹Тексим Банк›, ‹ТИ БИ АЙ Банк›, ‹Токуда Банк›, ‹Търговска банка Д›, ‹УниКредит Булбанк›, ‹Централна кооперативна банка›.
- Note: the demo accounts say ‹Обединена банка› and ‹Пощенска банка› (see 110), which the list spells differently.

**74. How the IBAN is shown** — `/partner/smetka`
- Now: ‹BG•• •••• •••• 5272›, because only the last four digits are stored. The prototype shows ‹BG•• •••• •••• 5272 01 · Postbank›.

**75. Fixed texts kept from the prototype** — `/partner/nastroyki`, `/partner/prihodi`, `/partner/smetka`
- Now: the time zone ‹GMT+2 · София› and the payout days ‹1-во и 15-то число› are fixed text, not read from settings. Sofia is GMT+3 in summer.

---

## Admin

**76. Cancelling and extending from the booking page** (D66) — `/admin/rezervacii/[nomer]`
- Now: ‹Удължи срока› (while awaiting payment) and ‹Анулирай резервацията› with a refund preview; the prototype's booking page has neither. For a partner's cancellation request: ‹Откажи анулирането›, toast ‹Искането за анулиране е отказано›. After a cancellation: toast ‹Резервацията е анулирана›.

**77. Payout hold switch on a case** (D13) — `/admin/sporove/[nomer]`
- Now: the switch reads ‹Изплащането е спряно до решението› or ‹Изплащането следва обичайния график›. Toasts: ‹Изплащането към {партньор} е спряно до решението› / ‹Изплащането следва обичайния график›. The wording comes from the prototype's money notes.

**78. Fields on the case page** — `/admin/sporove/[nomer]`
- Now: ‹Какво очакваме от клиента›, ‹Въпрос към двете страни›.
- Why: new copy.

**79. Extra links on money pages** — `/admin/sporove/[nomer]`, `/admin/plashtaniya`
- Now: a link to the booking on the case page, and a link on the date of the next-batch card. Neither is in the prototype.

**80. Payout accounts to check** — `/admin/plashtaniya`
- Now: block title ‹Нова сметка за проверка› (from an email heading) with ‹Потвърди› / ‹Откажи›; toasts ‹Сметката е потвърдена› / ‹Сметката е отказана›.

**81. Second admin for payout release** (D40) — `/admin/plashtaniya`
- Now: off by default. When it is on: ‹Партидата чака потвърждение от втори администратор› and ‹Одобрена от {име} — чака втори администратор.›

**82. Batch page** — `/admin/plashtaniya/partidi/[id]`
- Now: a new screen with the batch's items and lines and a CSV download. The prototype has no batch page.

**83. Tabs on the email page** — `/admin/imeyli`
- Now: ‹Шаблони› / ‹Изпратени›.

**84. ‹Задейства се от› on email previews** — `/admin/imeyli/[key]`
- Now: mostly plain text. Only links to team screens are live, because client and partner screens would send an admin away.

**85. Error toasts on money pages** — `/admin/rezervacii/[nomer]`, `/admin/sporove/[nomer]`, `/admin/plashtaniya`
- Now: ‹Нямате права за това действие› · ‹По резервацията вече има спор› · ‹Партидата се пуска от втори администратор› · ‹Проверете сумата за връщане› · ‹Напишете причината за анулирането›
- Shared: ‹Срокът е изтекъл› and ‹Действието вече не е възможно› (answer under 58).
- Why: new copy.

**86. The month the booking register opens on** — `/admin/rezervacii`
- Now: the current month, or the next month that has events. In the demo that is May 2026 with one booking; the prototype's June 2026 is one click away.

**87. The ‹Изискват намеса› card** (D93) — `/admin/rezervacii`
- Now: lists only payment deadlines within 4 h and open disputes. The prototype's ‹Изпълнителят не потвърди› row (2026-0530-РД) matches no rule, so that booking is an ordinary confirmed one.

**88. The review-gating switch** (D53) — `/admin/nastroyki`
- Now: ‹Ревюта само от платени резервации› is shown on and locked. Clicking it does nothing, with no toast.
- Why: there is no "off" mode in v1; a toast explaining that would be new copy.

**89. Client status badge** (D96) — `/admin/klienti`
- Now: one status per client, in this order of priority: ‹Блокиран›, ‹Отворен спор›, ‹Активен›. The client type moves to the sub-line.
- Why: ‹Блокиран› is a new badge.

**90. ‹Последна активност› of team members** — `/admin/nastroyki/ekip`
- Now: a time, for example ‹Вчера, 17:40›. The prototype shows what the person did (‹одобри 2 обяви›).
- Why: that needs wording for each kind of action.

**91. Initials for Технолинк ЕООД** — `/admin/klienti`, `/admin/sporove/[nomer]`
- Now: ‹ТЕ›. The prototype has ‹ТЛ›, which no general rule produces.

**92. Extending a payment deadline past the event** — `/admin/rezervacii/[nomer]`, `/admin/sporove/[nomer]`
- Now: ‹Удължи срока› always adds 24 h, even when that passes the start of the event.
- Proposed: stop the extension at the start of the event.

**93. Declining a partner's cancellation request after the event date** — `/admin/rezervacii/[nomer]`
- Now: the booking stays ‹Потвърдена› for good; it is never closed and never paid out.
- Proposed: close it as if no request had been made. We fix this unless you object.

**94. Reminders after ‹Върни одобрената цена›** — `/admin/sporove/[nomer]`
- Now: the decision opens a new 24 h payment window, but the payment reminders and alerts are not scheduled again.
- Proposed: schedule them for the new window. We fix this unless you object.

**95. Who may see money figures** — `/admin`, `/admin/rezervacii`, `/admin/plashtaniya`
- Now: each page checks that the team member may see finances.
- Proposed: a second check behind the pages. No visible change; we add it unless you object.

---

## Emails

**96. Emails that do not exist yet** (D68)
- Now: these actions only show a toast and record the event: (a) an admin export is ready (‹Експорт›, ‹Счетоводна справка›); (b) the team opens a case itself, so client and partner are not told; (c) a case is withdrawn, so the other side is not told.
- Needed: copy for these emails, or confirm that none are sent.

**97. ‹Справката ви е готова› for request and booking exports** — `/admin/imeyli/vendor-report-ready`
- Now: the same email follows the earnings report and ‹Експорт› on `/partner/zayavki` and `/partner/rezervacii`. It always says ‹Справката за приходите за {период} е готова› and links to `/partner/prihodi`. The export file itself is at `/partner/eksport/[id]`, which the email does not link to.
- Needed: wording and link for exports.

**98. Code for a new email address** (D55) — `/akaunt/nastroyki/imeyl`, `/admin/imeyli/client-verify-code`
- Now: the code goes in the sign-up code email; there is no email of its own. Five wrong tries need a new code.
- Needed: copy for an email-change code email, or keep the reuse.

**99. Singular forms** (D38) — emails and countdowns
- Now: ‹Остава 1 час›, ‹Остава 1 ден›, ‹1 звезда›: singular forms of the prototype's ‹Остават 6 часа›, ‹Остават 7 дни›, ‹5 звезди›.

**100. A declined request always blames the date** — `/admin/imeyli/client-request-declined`
- Now: ‹{партньор} отказа заявката ви, защото датата {дата} е заета.› even when the partner chose ‹Друга причина›. The ‹Причина› line shows the real reason.
- Needed: a sentence for other reasons.

**101. The team cancels; partial refunds** — `/admin/imeyli/client-vendor-cancelled`, `/admin/imeyli/vendor-cancel-completed`, `/admin/imeyli/client-refund-sent`
- Now: when the team cancels a booking itself, client and partner get the emails written for a partner's cancellation (‹{партньор} анулира резервацията ви за {дата}›, ‹Резервацията за {дата} е анулирана по ваше искане›). When a cancellation is not in the free period (part or none of the money comes back) the emails leave out the sentences written for a full refund — ‹Анулирането е в безплатния срок и сумата се възстановява изцяло.› (`client-cancel-confirmed`), ‹…Сумата се връща изцяло на клиента и по тази резервация няма изплащане.› (`vendor-client-cancelled`), ‹…затова се връща цялата сума без удръжки.› (`client-refund-sent`) — and give only the amounts (‹Връща се›, ‹Задържа се›, ‹Получавате›). With nothing to refund, `client-cancel-confirmed` promises nothing to the card, and for ‹Строга› its ‹Политика› line gives the policy (‹Строга — депозитът не се връща; остатъкът се възстановява до 14 дни преди събитието›) instead of a free-cancel date.
- Needed: wording for a team cancellation and for a partial or no refund.

**102. ‹Излязохте от всички устройства› with an unknown city** — `/admin/imeyli/client-signout-all`
- Now: a session with no known city is listed as ‹София›; if no session is found at all, the device reads ‹Браузър›.
- Proposed: leave the city out when it is unknown.

---

## Demo data (seed)

**103. Demo "now"** (D4)
- Now: Sunday 31 August 2025, 12:00 Sofia time, not 10:00. Open requests are re-dated so every countdown holds. 2026-0614-ЕА is paid.

**104. Emails and phones of demo people**
- Now: clients other than Мария, Технолинк, Ивелина, Петя и Николай, Стефка and СУ „Христо Ботев“, and partners other than Студио Мелодия and Лунна Фотография, have made-up ‹…@example.invalid› addresses. Phones other than Мария's, Студио Мелодия's and Лунна Фотография's are placeholders +359 0000000NN, which cannot be dialled.

**105. Sign-up and approval dates**
- Now: a client registered 2 days before her first request. Every approved partner except Студио Мелодия was approved on 1 March 2025 at 10:00, submitted 2 days before and registered 2 days before that.

**106. Студио Мелодия, ‹партньор от …›** (D86)
- Now: approved on 1 February 2025 at 10:00 (the time is assumed). The prototype's ‹февруари 2026› is later than "now".

**107. Payment times**
- Now: one pattern: sent 09:00, approved 11:00, paid 14:00 on the paid date (2026-0614-ЕА paid at 14:05). Assumed paid dates: 2026-0630-АБ 20.08.2025, Ана и Виктор 25.08.2025, 2026-0628-ФК 18.08.2025, 2026-0628-КТ 19.08.2025, 2026-0530-РД 21.08.2025, 2025-0424-СЛ 10.04.2025, 2026-0607-СВ 14.08.2025, 2025-0517-РД 01.04.2025. Студио Мелодия's past bookings: Нетера 10.02.2025, Деница и Иван 20.02.2025, Стефка 02.04.2025, Петя и Николай 15.04.2025. 2025-0426-ФТ was charged twice on 12.03.2025, at 14:00 and 14:00:40.

**108. Placeholder package names and prices**
- Now: Трапеза & Co, Фолклорна Трапеза, Градина и Маса and Бяла Покривка have one package each named ‹Кетъринг›, at the card's from-price: 980 / 1 450 / 890 / 1 100 €. The applicants have one each: Балон Градина ‹Декорация› 320 €, DJ Живко ‹DJ и озвучаване› 520 €, Тортите на Мими ‹Торти и десерти› 290 €. Вкусна История's ‹Коледно меню за 40 гости› costs 1 980,00 €.

**109. Вкусна История's starting price** (D34)
- Now: ‹от 1 980 €›, computed from its active packages. The prototype shows ‹от 1 200 €› and ‹от 24 € на гост›; the spec expected ‹от 28 € на гост› (Меню „Градина“).

**110. Bank details of demo partners**
- Now: bank ‹Обединена банка› for every account the prototype does not show. IBAN ending in 0000 for Флора Студио, Мед и мляко, Трапеза & Co, Фолклорна Трапеза, Градина и Маса, Бяла Покривка, Балон Градина, Тортите на Мими and Лунна Фотография (‹Пощенска банка›, waiting for a check). Deposit 30 % for every partner except Студио Мелодия. Балон Градина and Тортите на Мими have confirmed accounts, because their checks are complete.

**111. Venues, cities and guests**
- Now: Ресторант „Тера“ is in София. Past events and 2026 events without a venue: София, no venue. Guests: Петя и Николай 2025 100, Стефка 2025 and 2026 40, Нетера 120, Деница и Иван 100, Ралица и Георги 100.

**112. Cities of two catering partners** (D33)
- Now: Градина и Маса in София and Бяла Покривка in Варна (the prototype's data), not the cities printed on their cards.

**113. Reviews**
- Now: published at 12:00 the day after the event, replies one day later. Each criterion rating equals the overall rating. The bell item ‹Ново ревю с 5 звезди› is at 18.05.2025 12:00, already read. Only Студио Мелодия has reviews, so no other partner card shows a rating.

**114. Invoice numbers**
- Now: each issuer counts from 1 in payment order, credit notes included. Студио Мелодия runs 0000000407 to 0000000414, so 2026-0614-ЕА is 0000000412.

**115. Two details in the approval queues**
- Now: DJ Живко's open checks are gallery and bank account. ‹Струнен дует за церемония› was submitted on 30.08.2025 at 15:00.

**116. Contact and legal names**
- Now: approved partners other than Студио Мелодия use the business name as contact person and user name. Legal names are ‹{бизнес} ЕООД›, legal form ЕООД, no ЕИК.

**117. Team checks on partners**
- Now: approved partners that are not verified have the company check waiting and contacts confirmed. Студио Мелодия's check details are not in the prototype and follow the spec's examples: ‹ЕИК 204512389 · Студио Мелодия ЕООД · проверено в Търговския регистър›, ‹Телефон и имейл потвърдени›, ‹5 снимки · няма водни знаци от други студия›.

**118. Partner photos**
- Now: the avatar and cover of every partner except Студио Мелодия are its catalogue photo. Лунна Фотография's gallery has the 7 photos of the admin application page, in that order (the gallery holds 8 at most; the prototype mentions 14).

**119. Service descriptions, event types and covers**
- Now: no description where the prototype shows none: every service of the approved partners except Студио Мелодия's four and the three in moderation. A service's event types are its partner's, except Пакет „Цял ден“ (Сватба), Пакет „Вечер“ (Рожден ден, Абитуриентски бал), Фирмени събития (Фирмено събитие) and Сватбена арка „Пастел“ (Сватба). Services without a cover in the prototype have none.

**120. When Студио Мелодия last changed things**
- Now: services on 27.08.2025 (‹преди 4 дни›), the profile on 25.08.2025 (‹преди 6 дни›), both at 12:00.

**121. Team dates**
- Now: Моника joined on 15.01.2025 and Красимир on 01.03.2025. ‹В екипа от май / юли 2025› is stored as the 1st of the month. Георги was last active at 11:35 (‹Преди 25 минути›), Даниела at 09:00 (‹Преди 3 часа›).

**122. Мария's account history**
- Now: password changed on 31.08 at 12:00. The iPhone session was last active on 29.08.2025 at 21:00. Search history, newest first: 31.08 09:30, 30.08 18:10, 29.08 20:15. Saved searches were created at 12:00 on their dates. The date watches started on 10.08 at 10:05 and 09.08 at 09:05, just after the declines.

**123. Times of declines, requests, a cancellation and a refund**
- Now: 2026-0614-ФТ declined on 10.08.2025 at 10:00, 2026-1219-ФК on 09.08.2025 at 09:00. Георги Колев's request on 30.08.2025 at 20:00, Технолинк's 2026-0621-ТЛ on 30.08.2025 at 10:00. Деница и Иван cancelled on 05.05.2025 at 10:00 with the reason ‹Събитието се отменя› (‹по семейни причини›). The refund of 2025-0517-РД went through on 21.05.2025 at 10:00.

**124. Bookings made from offers** (D31)
- Now: Мария's Коледно парти with Студио Мелодия (‹Парти програма, 5 часа›, 680 €) matches no package, so it is an offer on the ‹Фирмени събития› service: request 04.08 10:00, offer 04.08 16:00, chosen 05.08 09:00. Нетера's booking is also an offer, titled ‹Фирмени събития›: request 08.02 10:00, offer 09.02 09:00, chosen 10.02 09:00.

**125. Service titles on bookings**
- Now: 2026-0621-ТЛ is ‹Кетъринг · меню „Градина“› for ‹100 гости›; its request keeps the approved 3 200,00 €, the booking is 3 600,00 €. 2026-0628-КТ and 2025-0517-РД are ‹Кетъринг›, linked to Меню „Градина“. 2026-0530-РД is the 4-hour Snap360 package (560 €).

**126. Payout batches**
- Now: released and paid at 10:00 on the batch date, by Моника. The 1 September batch has no label in the side menu.

**127. When messages were read**
- Now: a read message without a reply was read 5 minutes after it arrived; otherwise when the other side replied.

**128. Team messages on cases**
- Now: no message text for ‹Поискахме позиция› or ‹Писахме на училището›, because the prototype has none. The timeline still shows the step and its time.

**129. Two messages that differ between screens**
- Now: Студио Мелодия's ‹…настроим звука спокойно› and ‹ще ги заключим в плейлиста› follow the client's messages screen, not the partner's.

**130. Booking numbers of Мария's Коледно парти**
- Now: 2026-1219-ЕА (Студио Мелодия) and 2026-1219-ТД (Мед и мляко), as on the admin client page.

**131. Description of Пакет „Вечер“**
- Now: the full text from the partner's services page (the data model quotes only the first sentence).

**132. Пакет „Цял ден“ active since**
- Now: February 2025, its approval, which the May 2025 bookings need. The prototype's service editor says ‹Активна от юни 2025›.

**133. ‹Годежи› as a tag**
- Now: Студио Мелодия's tags are Озвучаване, Диско осветление and Годежи. The prototype's profile screen shows only the first two.

**134. Date of Лунна Фотография's moderation note**
- Now: 29.08.2025 16:20. The prototype's application page shows 31.08 16:20, which is later than "now".

**135. Time of the Меню „Градина“ edit**
- Now: submitted at 04:40, per the dispute timeline. The prototype's moderation card says ‹преди 5 часа›.

**136. Conversations**
- Now: they exist only where the prototype shows messages; the rest start when someone writes. Флора's 2026-1219-ДК awaits payment, so its link reads ‹Виж заявката›.

**137. Студио Мелодия's responsiveness**
- Now: 78 %, computed: 7 of its 9 requests since March were answered in time, and Ивелина's and Технолинк's are still inside their 24 h. The prototype typed 96 %.

**138. Петя и Николай at two weddings** (D85)
- Now: as in the prototype, in May 2025 and June 2026.

**139. Time of the Квартет „Адажио“ booking** (D87)
- Now: 16:00, as on the bookings page. The messages speak of a 17:00 ceremony.

**140. The Абитуриентски бал booking** (D90)
- Now: 2026-0630-АБ on 30 юни 2026 for СУ „Христо Ботев“, paid, 640,00 €. Надежда Стоянова's request is not in the demo.

**141. Ивелина Тодорова and Студио Мелодия** (D92)
- Now: a pending request for 28 юни 2026 (Пакет „Вечер“, 640 €). Her paid bookings with Snap360 and Вкусна История on 28 юни 2026 stay.

**142. Case 2025-0509-СВ sits on a cancelled booking**
- Now: as in the prototype, Деница и Иван filed it after cancelling. Under the rules a case can be filed only on a booking that awaits payment, is confirmed or has taken place.

**143. Intro commission during a demo**
- Now: most demo partners have fewer than three paid bookings, so paying one of their bookings during a demo charges the 5 % intro commission, not 10 %.

**144. Consent records**
- Now: demo users have no stored consent to the terms and the privacy policy.

**145. A case text with a stale deadline**
- Now: a demo case text taken from the prototype says ‹изтича след 4 часа›, while the real deadline in the demo is about 6 hours away.

**146. Dates on sent emails** — `/admin/imeyli`
- Now: sent emails carry the real date (October 2026), not the demo date (August 2025). Live use is not affected.

**147. Files to supply**
- Now: these case documents are names without files and show as plain text: 2026-0607-СВ ‹Правила на залата · PDF›, 2026-0614-ФК ‹Съобщение от Snap360 · снимка на екрана›, 2026-0621-ТЛ ‹Одобрена оферта · 30 август›, 2026-0630-АБ ‹Разговор в платформата · 4 съобщения без отговор›, 2025-0517-РД ‹Маршрут · снимка на екрана›, 2025-0426-ФТ ‹Извлечение от банката · PDF›. The legal PDFs ‹Условия за партньори (PDF)› and ‹Договор за услуга (PDF)› do not exist, so `/pravila` shows no ‹Документи› and no ‹Последна редакция› date.
- Needed: the files, or keep them as text.

---

## Not built yet, waiting on a decision

**148. Offer screens** (see 3)
- Partner: ‹Изпрати оферта› on a ‹По запитване› request (`/partner/zayavki/[nomer]`), and a page for open requests (`/partner/zapitvaniya/[id]`) with send offer and ‹Откажи›.
- Client: the offers on an open request, and choosing one, under `/akaunt/zayavki`.

**149. Deposit and balance payments** (see 1)
- The deposit and balance rows on `/plashtane/[nomer]`; the emails for balance charged, balance failed and booking cancelled for non-payment (client and partner); the ‹Плащания› block in `/admin/nastroyki` for provider, schedule and bank transfer (today it shows only ‹Банков превод›); labels for money released to partners before the event, which `/partner/prihodi` now shows as ‹Очаква събитие›.

**150. Stopping a date watch** (D21) — `/akaunt/zapazeni`
- Now: a client cannot stop watching a date; the watch ends with the event date. A stop control needs copy.

**151. A rejected payout account, seen by the partner** (D57) — `/partner/smetka`
- Now: the team can reject a new account (80), but the partner's page shows nothing about it; the previous confirmed account stays in use. Needs a state and its copy.

**152. Deactivating a partner from the admin side, and active-partner figures** — `/admin/partnyori/[id]`, `/admin`
- Now: the team cannot deactivate an active partner, and the dashboard has no figures for active partners. Both need design; the prototype has neither.

**153. A request to the client inside the partner's case** — `/partner/poddrazhka/nov`
- Now: the partner's case email can carry an extra request to the client (‹…и {ask}›), but the form has no field for it.

**154. Review photos in the partner's review list** — `/partner/revyuta`
- Now: clients can attach photos to reviews, but the partner's list does not show them, as in the prototype.

**155. Changing the email address, phone or two-step: extra safety** (security review, 9 Oct) — `/akaunt/nastroyki`
- Now: confirming a new email signs the account out everywhere else; nothing else is asked or sent.
- Recommended (needs copy and two new emails): ask for the password again before changing the email or phone or turning off two-step; email the old address with a link to undo the change; tell the user when two-step is turned off or the phone changes.

**156. Admin screens for money that needs a person** (security review, 9 Oct) — `/admin/plashtaniya`
- Now: a refund that failed at the card, a chargeback (card dispute) and a payout whose result the provider could not confirm are handled by the system and written to the audit log, but no admin screen lists them.
- Options: A — a „Изискват намеса“ block on Плащания (needs design and copy); B — keep in the audit log for now.

**157. Colour contrast (accessibility audit, 9 Oct)** — every area
The automated audit (WCAG 2.2 AA) now finds only colour contrast, all coming from the approved palette. Fixing it changes how the design looks, so nothing was changed. The worst cases:
- Light grey labels `neutral-400` #b9b1c4 on white: 2.06:1 (needs 4.5:1). Field labels in summaries (`.kv-label`), table headers, search-bar captions, weekday letters, chart labels, invoice headers.
- Mid grey hints `neutral-500` #8d8499 on white: 3.56:1, and 3.2–3.4:1 on the light backgrounds. Field hints, captions, message times, ‹EN› in the language switch, breadcrumbs.
- Rail group labels #6b6578 on the dark rail: 3.07:1.
- Brand purple #7f64ae for small bold text on #f4f4f6: 4.40:1 (eyebrows, step counters) — just under.
- Field and control borders #e7e7ec / #ddd6e3 on white: 1.2–1.4:1 (WCAG asks 3:1 for the edge of a control).
- Options: A — darken `neutral-400` to about #8a8299 and `neutral-500` to about #6f6a82 for text, and borders to about #b9b1c4 (closest change that passes; needs a visual check); B — keep the approved palette for now (the platform is likely exempt as a microenterprise under the accessibility law, Art. 46(3), but AA is the right target).
- The full measured list per element is in the audit reports; `tools/a11y.py`, `tools/a11y-panel.py`, `tools/a11y-admin.py` re-run it.

**158. ‹Покажи още› on long lists (speed check, 9 Oct)** — `/tarsene`, `/kategorii/[slug]`, `/partner/zayavki`, `/admin/rezervacii`, `/admin/klienti`
- Now: at launch-year volume these lists were slow and heavy (the client list took 3 s). They now show 24 cards (search, category), 50 rows (partner requests, clients) or 100 rows (admin bookings) and a ‹Покажи още› link, the same link the partner profile already uses for reviews. Counts and totals still cover everything. With the demo data the link never appears.
- The prototype has no paging pattern. Options: A — keep ‹Покажи още›; B — numbered pages; C — something else.

**159. Error page (production hardening, 12 Oct)** — any page that fails on the server: site, client account, partner and admin panels, partner sign-up
- Now: heading ‹Нещо се обърка. Опитайте отново.› and the button ‹Към началото› (site, sign-up) or ‹Към таблото› (partner and admin panels), laid out like the page-not-found screen (17). Inside the panels the side menu stays. On the start page or the dashboard itself the button loads that page again.
- Why: the prototype has no error screen. It reuses approved copy (28, 17) and adds none.
