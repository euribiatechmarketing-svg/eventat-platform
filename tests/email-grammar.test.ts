// The event in running text agrees with its event type: the prototype's copy shows only ‹сватбата›;
// a birthday (‹рождения ден›), a corporate event (‹фирменото събитие›) or a prom (‹абитуриентския бал›)
// must read correctly in the same sentences (journey J1 books a birthday).
import { describe, expect, it } from 'vitest';
import { agree, definiteGender, subjectForm } from '@/lib/email/grammar';
import { TEMPLATES } from '@/lib/email/templates';
import { SAMPLES } from '@/lib/email/templates/samples';

const render = (key: string, over: Record<string, unknown>) => TEMPLATES[key].render({ ...SAMPLES[key], ...over } as never);

describe('event-type grammar', () => {
  it('reads the gender from the article and gives the subject form', () => {
    expect(['сватбата', 'рождения ден', 'фирменото събитие', 'абитуриентския бал', 'събитието', 'коледното парти', 'годишнината'].map(definiteGender))
      .toEqual(['f', 'm', 'n', 'm', 'n', 'n', 'f']);
    expect(subjectForm('рождения ден')).toBe('рожденият ден');
    expect(subjectForm('абитуриентския бал')).toBe('абитуриентският бал');
    expect(subjectForm('бала')).toBe('балът');
    expect(subjectForm('рожденият ден')).toBe('рожденият ден');
    expect(subjectForm('сватбата')).toBe('сватбата');
    expect(subjectForm('фирменото събитие')).toBe('фирменото събитие');
    expect(agree('рождения ден', 'потвърден', 'потвърдена', 'потвърдено')).toBe('потвърден');
    expect(agree('коледното парти', 'потвърден', 'потвърдена', 'потвърдено')).toBe('потвърдено');
  });

  it('keeps the prototype wording for a wedding', () => {
    expect(render('vendor-booking-confirmed', {}).subject).toBe('Получено плащане: сватбата на 14 юни 2026 е потвърдена');
  });

  it('inflects the subject sentences for a birthday', () => {
    const b = { eventTypeDefinite: 'рождения ден', eventDate: '3 януари 2026' };
    expect(render('vendor-booking-confirmed', b).subject).toBe('Получено плащане: рожденият ден на 3 януари 2026 е потвърден');
    expect(render('vendor-booking-confirmed', { ...b, eventTypeDefinite: 'фирменото събитие' }).subject)
      .toBe('Получено плащане: фирменото събитие на 3 януари 2026 е потвърдено');
    const reminder = render('vendor-event-reminder', { ...b, hosts: 'Калина Методиева', daysLeft: 7 });
    expect(reminder.subject).toBe('След 7 дни: рожденият ден на Калина Методиева, 3 януари 2026');
    expect(reminder.heading).toBe('Рожденият ден на Калина Методиева е след седмица');
    expect(render('client-event-reminder', b).paragraphs[0]).toMatch(/^Рожденият ден ви е на 3 януари 2026 /);
    expect(render('client-review-invite', b).subject).toMatch(/^Как мина рожденият ден ви\? /);
    // after a preposition the short article stays
    expect(render('vendor-booking-confirmed', b).paragraphs[0]).toContain('за рождения ден на 3 януари 2026');
  });
});
