/**
 * chronicle.ts — turns game events into short "history book" sentences.
 *
 * Each event kind has 2-3 template variants so the log doesn't feel
 * repetitive. Placeholders in {braces} are filled from the params object.
 * Tone: dry history book with a little drama. No modern slang, no emojis.
 */

export const CHRONICLE_TEMPLATES: Record<string, string[]> = {
  founding: [
    'The {a} raised a great hall at {town} and named it their capital.',
    'At {town}, the {a} laid the first stones of a kingdom.',
  ],
  alliance: [
    'The {a} and the {b} swore an alliance.',
    'A pact was sealed between the {a} and the {b}.',
    'Envoys clasped hands: the {a} and the {b} are now allies.',
  ],
  betrayal: [
    'The {a} broke its pact with the {b}. Trust died that season.',
    'Betrayal! The {a} turned its back on its allies, the {b}.',
    'The {a} tore up the treaty with the {b}, to the shock of all.',
  ],
  war: [
    'The {a} declared war upon the {b}.',
    'War horns sounded: the {a} marches against the {b}.',
    'The {a} named the {b} its enemy. Blood will follow.',
  ],
  muster: [
    'The {a} mustered {troops} and marched on the {b}.',
    'War drums beat in the halls of the {a}; {troops} set out against the {b}.',
    'The {a} sent {troops} against the {b}.',
  ],
  barracks: [
    'The {a} began raising a barracks at {town}. Their neighbours took note.',
    'At {town}, the {a} laid the foundations of a barracks.',
  ],
  tribute_demand: [
    'The {a} demanded {n} {res} in tribute from the {b}.',
    'Envoys of the {a} came to the {b} demanding {n} {res}.',
  ],
  peace: [
    'The {a} and the {b} laid down their arms and made peace.',
    'A weary peace settled between the {a} and the {b}.',
  ],
  tribute: [
    'The {a} sent {n} {res} to the {b} as tribute.',
    'Wagons of {res} ({n}) rolled from the {a} to the {b}.',
  ],
  attack_win: [
    'The {a} stormed the {bld} of {town} and burned it.{fell}',
    'The {a} overran the {b} at the {bld} near {town}.{fell}',
    'Fire took the {bld} of {town}; the {a} were victorious.{fell}',
  ],
  attack_lose: [
    'The {b} held firm at {town}. The {a} were driven back.{fell}',
    'The {a} broke upon the defenders of {town}.{fell}',
  ],
  raid: [
    'Raiders of the {a} plundered the {bld} of {town}, carrying off {loot}.',
    'The {a} raided {town} and fled with {loot}.',
  ],
  raid_again: [
    'Again the {a} raided {town}, their {nth} raid in a row. The {b} could not stop them.',
    'The {a} returned to plunder {town} once more ({n} raids running), taking {loot}.',
  ],
  field_battle: [
    'The armies of the {a} and the {b} clashed in the field. The {w} prevailed.{fell}',
    'Steel met steel between the {a} and the {b}. The {w} won the day.{fell}',
  ],
  starvation: [
    'Famine struck the {a}. {n} perished for want of bread.',
    'The granaries of {town} ran empty; {n} of the {a} starved.',
  ],
  council_fail: [
    "The {a}'s council could not agree, and nothing was done.",
    'The elders of the {a} quarrelled through the season; no orders were given.',
  ],
  monsters_appear: [
    'Wild raiders emerged from the wilds, {n} strong.',
    'A warband of {n} raiders crawled out of the wastes.',
  ],
  monsters_win: [
    'Raiders burned the {bld} of {town}.{fell}',
    'The wild raiders sacked the {bld} near {town}.{fell}',
  ],
  monsters_lose: [
    'The {a} slew the raiders at {town}.',
    'Raiders were cut down by the {a} near {town}.',
  ],
  monsters_lose_after: [
    'The {a} finally slew the raiders at {town}, but not before {burned} burned.',
    'Raiders burned {burned} near {town} before the {a} cut them down.',
  ],
  god_bless: [
    'A blessing fell upon the {a}: {n} {res} appeared in their stores.',
    'The heavens smiled on the {a}, granting {n} {res}.',
  ],
  god_drought: [
    'A drought withered the fields of the {a}.',
    'The rains forsook the {a}. Their farms cracked and dried.',
  ],
  god_plague: [
    'Plague swept through {town}. {n} of the {a} died.',
    'A sickness came to the {a}, and {n} did not rise again.',
  ],
  god_meteor: [
    'Fire fell from the sky near {place}.',
    'A star struck the earth near {place}, leaving only ash.',
  ],
  god_whisper: [
    'A voice was heard in the halls of the {a}.',
    'The rulers of the {a} heard a whisper no one else could hear.',
  ],
  fall: [
    'The town hall of {town} fell. The {a} are no more, undone by the {b}.',
    '{town} burned, and with it the kingdom of the {a}. The {b} stand over the ashes.',
  ],
  fall_other: [
    'The town hall of {town} fell. The {a} are no more.',
  ],
  victory: [
    'The age ends. The {a} stand supreme over the land.',
    'So ends the age, with the {a} as masters of the realm.',
  ],
};

export function chronicleLine(kind: string, params: Record<string, string | number>, rand: () => number): string {
  const variants = CHRONICLE_TEMPLATES[kind] ?? ['{a}: ' + kind];
  const tpl = variants[Math.floor(rand() * variants.length)];
  return tpl.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? ''));
}

/** Syllables used to generate capital names (fantasy, not real places). */
const PRE = ['Moss', 'Iron', 'Ash', 'Raven', 'Stone', 'Elder', 'Thorn', 'Gold', 'Frost', 'Brook', 'Amber', 'Wolf', 'Oak', 'Dusk', 'Salt'];
const SUF = ['ford', 'hold', 'mere', 'watch', 'stead', 'gate', 'vale', 'crest', 'haven', 'reach', 'fall', 'moor'];
export function townName(rand: () => number, taken: Set<string>): string {
  for (let i = 0; i < 50; i++) {
    const n = PRE[Math.floor(rand() * PRE.length)] + SUF[Math.floor(rand() * SUF.length)];
    if (!taken.has(n)) {
      taken.add(n);
      return n;
    }
  }
  return 'Newstead';
}
