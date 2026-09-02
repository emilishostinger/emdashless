import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const code = readFileSync(join(root, 'emdashless', 'purge.js'), 'utf8');
const { purge } = new Function(code + '\nreturn EmdashlessPurge;')();

const cases = [
  // paired aside
  ['The plan — bold as it was — failed.', 'The plan, bold as it was, failed.'],
  ['The plan—bold as it was—failed.', 'The plan, bold as it was, failed.'],
  ['The report — which nobody read, sadly — was wrong.', 'The report (which nobody read, sadly) was wrong.'],
  ['Well, the plan — bold as it was — failed.', 'Well, the plan (bold as it was) failed.'],

  // appositive / explanation
  ['He had one goal — victory.', 'He had one goal: victory.'],
  ['It was a disaster — a total collapse.', 'It was a disaster: a total collapse.'],
  ['Three things matter — speed, security, support.', 'Three things matter: speed, security, support.'],

  // independent clause
  ['He knew the truth — she was lying.', 'He knew the truth; she was lying.'],
  ['Sign up now — it is free!', 'Sign up now; it is free!'],

  // conjunctions and subordinators keep a comma
  ['I tried — but it failed.', 'I tried, but it failed.'],
  ['We shipped it — although nobody asked.', 'We shipped it, although nobody asked.'],

  // adverbial afterthought
  ['It was over — finally.', 'It was over, finally.'],

  // interrupted speech
  ['Wait—', 'Wait...'],
  ['She said "Don\u2019t—"', 'She said "Don\u2019t..."'],
  ['He left—.', 'He left...'],

  // ranges
  ['See pages 10—20 for details.', 'See pages 10-20 for details.'],
  ['Open Mon—Fri this week.', 'Open Mon-Fri this week.'],
  ['The 9:00—17:00 shift.', 'The 9:00-17:00 shift.'],

  // attribution / bullet
  ['— Oscar Wilde', '- Oscar Wilde'],
  ['Quote here.\n— Oscar Wilde', 'Quote here.\n- Oscar Wilde'],

  // multiple dashes
  ['A — b — c — d.', 'A, b, c: d.'],
  ['Stop——now.', 'Stop: now.'],

  // untouched
  ['The en dash 10\u201320 stays put.', 'The en dash 10\u201320 stays put.'],
  ['No dashes at all here.', 'No dashes at all here.'],
  ['A hyphen-joined word is fine.', 'A hyphen-joined word is fine.'],

  // no double punctuation
  ['He paused, — then spoke.', 'He paused, then spoke.'],

  // nouns that double as verbs must not read as clauses
  ['There are three things to consider — latency, cost, and correctness.', 'There are three things to consider: latency, cost, and correctness.'],
  ['It comes down to one thing — cost.', 'It comes down to one thing: cost.'],
  ['We measured two things — load and start times.', 'We measured two things: load and start times.'],
  ['Only one thing matters — the work.', 'Only one thing matters: the work.'],
  ['It happened quickly — quietly and without warning.', 'It happened quickly, quietly and without warning.'],
];

let failed = 0;
for (const [input, want] of cases) {
  const got = purge(input);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(input)}`);
  if (!ok) console.log(`       want ${JSON.stringify(want)}\n       got  ${JSON.stringify(got)}`);
}

// Inline-element boundary: a dash at the end of a text node that is not the end of its block.
const boundary = purge('Read the docs — ', { atBlockEnd: false });
if (boundary !== 'Read the docs, ') {
  failed++;
  console.log(`FAIL boundary\n       want ${JSON.stringify('Read the docs, ')}\n       got  ${JSON.stringify(boundary)}`);
} else {
  console.log('ok   inline boundary keeps a comma, not an ellipsis');
}

// A dash opening a text node that merely follows an inline tag is not an attribution.
const notAttribution = purge(' — more text here.', { atBlockStart: false });
if (notAttribution !== ', more text here.') {
  failed++;
  console.log(`FAIL mid-block lead\n       got  ${JSON.stringify(notAttribution)}`);
} else {
  console.log('ok   mid-block leading dash is not treated as attribution');
}

console.log(`\n${failed === 0 ? 'all clean' : failed + ' failing'}`);
process.exit(failed === 0 ? 0 : 1);
