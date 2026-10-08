/** "Мария Димитрова" -> "МД"; "Студио Мелодия" -> "СМ". */
export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');
}
/** "Мария Димитрова" -> "Мария Д." */
export function shortName(name: string): string {
  const [first, last] = name.split(/\s+/);
  return last ? `${first} ${last[0]}.` : first;
}
