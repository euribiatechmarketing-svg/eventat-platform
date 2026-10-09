// Bulgarian agreement for the event in running text (event_type.name_definite: ‹сватбата›,
// ‹рождения ден›, ‹фирменото събитие›, ‹абитуриентския бал›). The stored form carries the short
// article, right after a preposition (‹за рождения ден›). As the subject of a sentence a masculine
// phrase takes the full article (‹рожденият ден›), and words that agree with it take its gender
// (‹… е потвърден / потвърдена / потвърдено›). The prototype's copy only shows ‹сватбата›, where
// both forms coincide; these helpers keep that copy and inflect it for the other event types.
// The article sits on the first word of the phrase, so that word decides.

export type Gender = 'm' | 'f' | 'n';

const firstWord = (phrase: string) => phrase.trim().split(/\s+/)[0]?.toLocaleLowerCase('bg') ?? '';

/**
 * The gender of a definite phrase, read from its article: ‹-то› neuter (‹събитието›, ‹фирменото›),
 * ‹-та› feminine (‹сватбата›, ‹годишнината›), ‹-ят› / ‹-ът› / ‹-я› / ‹-а› masculine
 * (‹рождения›, ‹абитуриентския›, ‹бала›). A masculine noun ending in ‹-т› (‹банкета›) reads as
 * feminine; no event type is named that way.
 */
export function definiteGender(definite: string): Gender {
  const w = firstWord(definite);
  if (/то$/.test(w)) return 'n';
  if (/та$/.test(w)) return 'f';
  if (/(ят|ът|я|а)$/.test(w)) return 'm';
  return 'f';
}

/** The phrase as the subject: ‹рождения ден› → ‹рожденият ден›, ‹бала› → ‹балът›; others unchanged. */
export function subjectForm(definite: string): string {
  if (definiteGender(definite) !== 'm') return definite;
  const lead = definite.match(/^\s*/)?.[0] ?? '';
  const rest = definite.slice(lead.length);
  const [w, ...tail] = rest.split(/(\s+)/);
  if (/(ят|ът)$/.test(w)) return definite;
  const full = /я$/.test(w) ? `${w}т` : /а$/.test(w) ? `${w.slice(0, -1)}ът` : w;
  return lead + [full, ...tail].join('');
}

/** The word that agrees with the phrase: agree('рождения ден', 'потвърден', 'потвърдена', 'потвърдено') → 'потвърден'. */
export function agree(definite: string, m: string, f: string, n: string): string {
  const g = definiteGender(definite);
  return g === 'm' ? m : g === 'f' ? f : n;
}
