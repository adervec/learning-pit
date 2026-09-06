// node core.test.js  — fails loudly if the scheduling / merge / validation logic breaks.
import assert from 'node:assert/strict';
import { DAY, LEECH_AT, STICKERS, stickersFor, stickerEarned, auditModule, bestTime, bumpStreak, cardKey, cloze, counts, dayStr, deadlinePlan, decoys, distractors, dueAcross, duplicatesAcross, weeklyTotals, esc, examScore, examSet, fmt, forecast, growPrompt, hash, ident, judgeTyped, newCards, keyPoints, coverage, letterTiles, levenshtein, mergeConfusions, mergeState, minutesFor, pace, parseImport, pickSession, rankFor, schedule, reminderIcs, sharpenPrompt, slowAfter, spreadDue, tagTotals, spellable, starred, toMarkdown, troubleSpots, validateModule, weekSummary } from './core.js';

const T = 1_700_000_000_000;
const cards = Array.from({ length: 10 }, (_, i) => ({ front: `q${i}`, back: `a${i}` }));

// --- schedule ---
// mid() is "no jitter": the fuzz is centred, so half of nothing is exactly the plain interval
const mid = () => 0.5;
let s = schedule(undefined, 'good', T, mid);
assert.equal(s.interval, 1, 'first good = 1 day');
assert.equal(s.due, T + DAY);
s = schedule(s, 'good', T, mid);
assert.equal(s.interval, 3, 'second good = 3 days');
s = schedule(s, 'good', T, mid);
assert.equal(s.interval, Math.round(3 * 2.5), 'third good uses ease');

// the same card learned on the same day must not come back on the same day forever
{
  let a = { reps: 5, lapses: 0, ease: 2.5, interval: 40, due: T };
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(schedule(a, 'good', T).interval);
  assert.ok(seen.size > 1, 'long intervals are jittered');
  const plain = Math.round(40 * 2.5);
  assert.ok([...seen].every(n => Math.abs(n - plain) <= Math.round(plain * 0.05) + 1),
    'but only by a few per cent', [...seen].join(','));
  assert.equal(schedule(a, 'good', T, mid).interval, plain, 'and the centre is the plain interval');
  assert.equal(schedule(undefined, 'good', T, () => 0).interval, 1, 'the first steps never move');
  assert.equal(schedule(schedule(undefined, 'good', T), 'good', T, () => 1).interval, 3,
    'nor the second');
}
const lapsed = schedule(s, 'again', T);
assert.equal(lapsed.reps, 0);
assert.equal(lapsed.lapses, 1);
assert.ok(lapsed.due - T <= 600000, 'lapse returns inside the session');
assert.ok(lapsed.ease < s.ease, 'lapse lowers ease');
assert.ok(schedule({ ease: 1.3, reps: 0, lapses: 9, interval: 0, due: T }, 'again', T).ease >= 1.3, 'ease floor');
assert.ok(schedule({ ease: 3, reps: 9, interval: 300, due: T }, 'easy', T).interval <= 365, 'interval cap');
assert.ok(schedule({ ease: 3, reps: 9, interval: 300, due: T }, 'easy', T, () => 1).interval <= 365,
  'even at the top of the jitter');

// each grade is appended to a short history, newest last, capped
let logged = schedule(undefined, 'good', T);
assert.equal(logged.log, 'g', 'the first grade starts the log');
logged = schedule(schedule(logged, 'again', T), 'easy', T);
assert.equal(logged.log, 'gae', 'and each one appends');
for (let i = 0; i < 20; i++) logged = schedule(logged, 'good', T);
assert.equal(logged.log.length, 12, 'the log is capped');
assert.ok(logged.log.endsWith('gggg'), 'keeping the most recent');

// a card that keeps failing gets parked instead of being asked forever
let leech = { reps: 0, lapses: 0, ease: 2.5, interval: 0, due: T };
for (let i = 0; i < LEECH_AT - 1; i++) leech = schedule(leech, 'again', T);
assert.ok(!leech.susp, `${LEECH_AT - 1} misses is not yet a leech`);
leech = schedule(leech, 'again', T);
assert.ok(leech.susp, `${LEECH_AT} misses parks the card`);
assert.ok(schedule(leech, 'good', T).susp, 'and only the learner can unpark it, not a grade');

// --- counts / pickSession ---
const srs = {};
srs[cardKey('m', cards[0])] = schedule(undefined, 'good', T - 2 * DAY); // overdue
srs[cardKey('m', cards[1])] = schedule(undefined, 'easy', T);           // not due
assert.deepEqual(counts(cards, srs, 'm', T), { due: 1, fresh: 8, learned: 1, paused: 0, total: 10 });

const paused = { ...srs };
paused[cardKey('m', cards[0])] = { ...srs[cardKey('m', cards[0])], susp: true };
assert.equal(counts(cards, paused, 'm', T).paused, 1, 'paused cards are counted apart');
assert.equal(counts(cards, paused, 'm', T).due, 0, 'and not as due');
assert.ok(!pickSession(cards, paused, 'm', { size: 10, now: T }).includes(cards[0]), 'paused cards never appear');

const picked = pickSession(cards, srs, 'm', { size: 4, newPerSession: 5, now: T, rnd: () => 0 });
assert.equal(picked.length, 4);
assert.ok(picked.includes(cards[0]), 'overdue card is in the session');
assert.ok(!picked.includes(cards[1]), 'card scheduled for the future is not');

const allFuture = {};
for (const c of cards) allFuture[cardKey('m', c)] = schedule(undefined, 'easy', T);
assert.equal(pickSession(cards, allFuture, 'm', { size: 3, now: T }).length, 3, 'nothing due still gives practice');

// --- distractors ---
const d = distractors(cards[0], cards, 3, () => 0);
assert.equal(d.length, 3);
assert.ok(!d.includes(cards[0].back), 'never offers the right answer twice');
assert.equal(new Set(d).size, 3, 'distractors are distinct');

// length-similar options first: a one-word answer should not sit among three essays
const mixed = [
  { front: 'q', back: 'Mercury' }, { front: 'r', back: 'Venus' }, { front: 's', back: 'Jupiter' },
  { front: 't', back: 'A long explanatory sentence that gives the whole thing away immediately' },
  { front: 'u', back: 'Another long explanatory sentence that no one would ever pick here' },
];
const short = distractors({ front: 'x', back: 'Saturn' }, mixed, 3, () => 0);
assert.deepEqual(short.sort(), ['Jupiter', 'Mercury', 'Venus'], 'short answers get short distractors');
const long = distractors(mixed[3], mixed, 1, () => 0);
assert.ok(long[0].length > 20, 'long answers get long distractors');
assert.equal(distractors({ front: 'x', back: 'z' }, [{ front: 'y', back: 'z' }], 3).length, 0,
  'a pool with nothing but the answer yields no distractors');

// --- the week in review ---
const wkNow = Date.UTC(2024, 4, 20, 12);
const wkStats = {
  days: { [dayStr(wkNow)]: 10, [dayStr(wkNow - DAY)]: 30, [dayStr(wkNow - 3 * DAY)]: 5,
          [dayStr(wkNow - 9 * DAY)]: 99 },
  hits: { [dayStr(wkNow)]: 9, [dayStr(wkNow - DAY)]: 21, [dayStr(wkNow - 3 * DAY)]: 5 },
};
const wk = weekSummary(wkStats, wkNow);
assert.equal(wk.reviews, 45, 'only the last seven days count');
assert.equal(wk.correct, 35, 'and their hits');
assert.equal(wk.pct, 78, 'accuracy is rounded');
assert.equal(wk.active, 3, 'three days of the seven had anything in them');
assert.equal(wk.best.n, 30, 'the best day is the biggest');
assert.equal(weekSummary({}, wkNow).pct, 0, 'a blank week divides by nothing');

// --- exams across modules ---
const examMods = [
  { id: 'a', title: 'Alpha', cards: [{ front: 'a1', back: '1' }, { front: 'a2', back: '2' }] },
  { id: 'b', title: 'Beta', cards: [{ front: 'b1', back: '1' }, { front: 'b2', back: '2' }] },
];
const examSrs = { ['a:' + hash('a2')]: { due: 0, susp: true } };
const drawn = examSet(examMods, examSrs, 10, () => 0);
assert.equal(drawn.length, 3, 'a parked card is not examined');
assert.ok(drawn.every(c => c.mid && c.from), 'every card knows the module it came from');
assert.equal(examSet(examMods, {}, 2, () => 0).length, 2, 'and the sitting is capped');
const score = examScore(drawn, [drawn.find(c => c.from === 'Alpha')]);
assert.equal(score[0].name, 'Alpha', 'the weakest module comes first');
assert.equal(score[0].pct, 0, 'Alpha had its only card wrong');
assert.equal(score[1].pct, 100, 'Beta had both right');
const twice = examScore(drawn, [drawn[0], drawn[0]]);
assert.equal(twice.reduce((n, r) => n + r.wrong, 0), 1, 'the same card missed twice counts once');

// --- a merge must not lose anything ---
{
  const local = { active: 'A', settings: {}, custom: [], profiles: { A: {
    srs: {}, opts: { t: 2000, avatar: '🦊', kid: true, theme: 'light', deadlines: { m: '2026-01-01' } },
    stats: { reviews: 10, correct: 8, stars: 5, streak: 3, lastDay: '2026-08-10',
             rested: '2026-08-04', rank: 'Cadet', days: {}, hits: {} } } } };
  const remote = { active: 'A', settings: {}, custom: [], profiles: { A: {
    srs: {}, opts: { t: 1000, avatar: '🐧', voice: 'Daniel' },
    stats: { reviews: 4, correct: 3, stars: 9, streak: 1, lastDay: '2026-08-09',
             rested: '', rank: 'Initiate', days: {}, hits: {} } } } };
  const merged = mergeState(local, remote).profiles.A;
  assert.equal(merged.opts.avatar, '🦊', 'the device that changed them last wins');
  assert.equal(merged.opts.voice, 'Daniel', 'and the other fills in what it never set');
  const fresh = mergeState({ active: 'A', settings: {}, custom: [],
    profiles: { A: { srs: {}, opts: { avatar: '◎', kid: false }, stats: {} } } }, local).profiles.A;
  assert.equal(fresh.opts.kid, true, 'a device with only defaults does not overwrite real settings');
  assert.equal(fresh.opts.avatar, '🦊', 'it takes them wholesale');
  assert.equal(merged.opts.kid, true, 'kid mode is not lost in a sync');
  assert.deepEqual(merged.opts.deadlines, { m: '2026-01-01' }, 'nor are deadlines');
  assert.equal(merged.stats.stars, 9, 'stars take the higher count');
  assert.equal(merged.stats.bestStreak, 3, 'the longest streak either device ever saw survives');
  assert.equal(merged.stats.rank, 'Cadet', 'rank comes from whichever studied most recently');
  assert.equal(merged.stats.rested, '2026-08-04', 'and the rest day is remembered');
}

// --- the session log survives both devices ---
{
  const l = { active: 'A', settings: {}, custom: [], profiles: { A: { srs: {}, opts: {}, stats: {
    sessions: [{ t: 3, m: 'Capitals', g: 'recall', r: 8, w: 2 }, { t: 1, m: 'Tables', g: 'pad', r: 5, w: 0 }] } } } };
  const r = { active: 'A', settings: {}, custom: [], profiles: { A: { srs: {}, opts: {}, stats: {
    sessions: [{ t: 2, m: 'Fallacies', g: 'choice', r: 4, w: 1 }, { t: 1, m: 'Tables', g: 'pad', r: 5, w: 0 }] } } } };
  const log = mergeState(l, r).profiles.A.stats.sessions;
  assert.equal(log.length, 3, 'the same sitting is not counted twice');
  assert.deepEqual(log.map(x => x.t), [3, 2, 1], 'and the log runs newest first');
  const many = { active: 'A', settings: {}, custom: [], profiles: { A: { srs: {}, opts: {}, stats: {
    sessions: Array.from({ length: 80 }, (_, i) => ({ t: i, m: 'M', g: 'recall', r: 1, w: 0 })) } } } };
  assert.equal(mergeState(many, many).profiles.A.stats.sessions.length, 50, 'and it is capped');
}

// --- alternative answers ---
assert.equal(judgeTyped('USA', 'the United States'), 'wrong', 'without alternatives it is wrong');
assert.equal(judgeTyped('USA', 'the United States', ['USA', 'US']), 'exact', 'with one it is exact');
assert.equal(judgeTyped('U.S.A', 'the United States', ['USA']), 'exact', 'punctuation and case are ignored');
assert.equal(judgeTyped('USAA', 'the United States', ['USA']), 'close', 'a typo in an alternative is close');
assert.equal(judgeTyped('Canada', 'the United States', ['USA']), 'wrong', 'and a different answer is still wrong');
const altCard = validateModule({ title: 'T', cards: [
  { front: 'q', back: 'the United States', accept: ['USA', 'US', 'the United States', ''] }] }).cards[0];
assert.deepEqual(altCard.alt, ['USA', 'US'], 'blanks and the answer itself are dropped from the list');
assert.ok(!('alt' in validateModule({ title: 'T', cards: [{ front: 'q', back: 'a' }] }).cards[0]),
  'a card without them carries no empty field');

// --- module audit ---
{
  const rough = [
    { front: 'What is the capital of France?', back: 'Paris' },
    { front: 'what is the CAPITAL of France?', back: 'Lyon' },          // duplicate question
    { front: 'Which city is Paris?', back: 'Paris' },                    // gives itself away
    { front: 'Another French city', back: 'Paris' },                     // same answer
    { front: 'Describe the Krebs cycle', back: 'x'.repeat(130) },        // an essay
    { front: 'Which planet is red?', back: 'Mars' },
  ];
  const found = auditModule(rough);
  const kinds = i => found.filter(f => f.i === i).map(f => f.kind);
  assert.ok(kinds(1).includes('duplicate'), 'a repeated question is flagged');
  assert.ok(kinds(2).includes('gives itself away'), 'an answer in the question is flagged');
  assert.ok(kinds(3).includes('same answer'), 'two cards with one answer are flagged');
  assert.ok(kinds(4).includes('long answer'), 'an essay on the back is flagged');
  assert.equal(kinds(5).length, 0, 'and a good card is left alone');
  assert.equal(auditModule([{ front: 'a', back: 'b' }]).length, 0, 'a single clean card is clean');
}

// --- when the learner is sharp ---
{
  const at = (h, r, w) => ({ t: new Date(2026, 0, 5, h).getTime(), m: 'M', g: 'recall', r, w });
  const none = bestTime([at(9, 10, 0)]);
  assert.equal(none, null, 'one part of the day is nothing to compare');
  const both = bestTime([at(9, 10, 0), at(10, 9, 1), at(22, 4, 6), at(21, 3, 7)]);
  assert.equal(both.best.name, 'morning', 'the sharper part of the day wins');
  assert.equal(both.worst.name, 'evening', 'and the other one is the weak spot');
  const three = bestTime([at(9, 19, 1), at(14, 12, 8), at(21, 4, 16)]);
  assert.equal(three.best.name, 'morning', 'mornings here');
  assert.equal(three.worst.name, 'evening', 'evenings are the weak spot');
  assert.equal(three.best.pct, 95, 'with the accuracy that says so');
  assert.equal(bestTime([at(9, 1, 0), at(21, 1, 0)]), null, 'and a handful of answers is not evidence');
}

// --- header rows go, cards about flashcards stay ---
{
  const placeholder = parseImport('front :: back\nother :: thing')[0].cards;
  assert.deepEqual(placeholder.map(c => c.front), ['other'], 'the placeholder line is a header, not a card');
  const meta = parseImport('Front :: The side you see first\nBack :: The side to remember')[0].cards;
  assert.equal(meta.length, 2, 'but a real answer makes it a real card');
  const table = parseImport('Question | Answer\nalpha | first\nbeta | second')[0].cards;
  assert.deepEqual(table.map(c => c.front), ['alpha', 'beta'], 'and a header row is still dropped');
}

// --- a heading is not a card ---
{
  const doc = ['## Some Module', '*what it covers*', '',
    '- **What is X?** \u2014 The answer to X', '- **What is Y?** \u2014 The answer to Y'].join('\n');
  const [m] = parseImport(doc);
  assert.equal(m.title, 'Some Module', 'the heading titles the module');
  assert.deepEqual(m.cards.map(c => c.front), ['What is X?', 'What is Y?'],
    'and neither it nor the line under it becomes a card');
}

// --- one paste, several modules ---
{
  const doc = [
    '# Everything we covered', '',
    '## Photosynthesis', 'How plants eat.', '',
    '| Question | Answer |', '|---|---|', '| What do plants take in? | Carbon dioxide |',
    '| What do they give out? | Oxygen |', '',
    '## Respiration', '', 'Q: What do animals take in?', 'A: Oxygen',
    'Q: What do they give out?', 'A: Carbon dioxide', '',
  ].join('\n');
  const mods = parseImport(doc);
  assert.equal(mods.length, 2, 'two headings with cards make two modules');
  assert.deepEqual(mods.map(m => m.title), ['Photosynthesis', 'Respiration'], 'each keeps its heading');
  assert.equal(mods[0].cards.length, 2, 'the table section parses');
  assert.equal(mods[1].cards.length, 2, 'and so does the Q/A one');
  assert.equal(mods[0].description, 'How plants eat.', 'the line under the heading is the description');
  // one heading is still one module, exactly as before
  const single = parseImport('## Just One\n\n| a | b |\n|---|---|\n| x | y |');
  assert.equal(single.length, 1, 'a single section is a single module');
  assert.equal(single[0].title, 'Just One', 'with its heading as the title');
}

// --- the library as markdown, and back again ---
{
  const lib = [{ id: 'a', title: 'Alpha', description: 'first things', tags: ['x'], cards: [
    { front: 'What is A?', back: 'The first letter', hint: 'alphabet', note: 'from the Greek alpha' },
    { front: 'What is B | with a pipe?', back: 'Trouble' }] }];
  const md = toMarkdown(lib);
  assert.ok(md.includes('## Alpha') && md.includes('first things'), 'the module heads its section');
  const rows = md.split('\n');
  assert.ok(rows.every(l => (l.match(/[|]/g) || []).length <= 5),
    'a pipe inside a card cannot break the table');
  const back = parseImport(md);
  assert.equal(back.length, 1, 'it reads back as one module');
  assert.equal(back[0].title, 'Alpha', 'with its title');
  assert.equal(back[0].cards.length, 2, 'and both cards');
  assert.equal(back[0].cards[0].front, 'What is A?', 'front intact');
  assert.equal(back[0].cards[0].back, 'The first letter', 'back intact');
  assert.equal(back[0].cards[0].hint, 'alphabet', 'hint intact');
  assert.equal(back[0].cards[0].note, 'from the Greek alpha', 'and the why intact');
}

// --- the same question in two modules ---
{
  const a = { id: 'a', title: 'A', cards: [{ front: 'What is X?', back: '1' }, { front: 'Only here', back: '2' }] };
  const b = { id: 'b', title: 'B', cards: [{ front: 'what is  x?', back: '1 again' }] };
  const c = { id: 'c', title: 'C', cards: [{ front: 'What is X?', back: 'third' }] };
  const dupes = duplicatesAcross([a, b, c]);
  assert.equal(dupes.length, 1, 'one question is in more than one module');
  assert.deepEqual(dupes[0].map(w => w.id), ['a', 'b', 'c'], 'and every module holding it is named');
  assert.equal(duplicatesAcross([a]).length, 0, 'one module cannot duplicate across modules');
  const twice = { id: 'd', title: 'D', cards: [{ front: 'Same', back: '1' }, { front: 'same', back: '2' }] };
  assert.equal(duplicatesAcross([twice]).length, 0, 'a repeat inside one module is the module audit\'s job');
}

// --- how long a sitting takes ---
{
  const sitting = (r, w, secs) => ({ t: 1, m: 'M', g: 'recall', r, w, secs });
  assert.equal(pace([]), 6, 'with no history it guesses');
  assert.equal(pace([sitting(10, 0, 50)]), 6, 'and one sitting is not history');
  assert.equal(pace([sitting(10, 0, 50), sitting(10, 0, 60), sitting(8, 2, 50)]), 5,
    'three sittings give the median seconds a card');
  assert.equal(pace([sitting(10, 0, 50), sitting(10, 0, 60), sitting(10, 0, 40000), sitting(10, 0, 50)]), 5,
    'a phone left on the sofa is thrown away, and the rest still count');
  assert.equal(pace([sitting(10, 0, 50), sitting(10, 0, 40000)]), 6,
    'and too few real sittings falls back to the guess');
  assert.equal(minutesFor(60, [sitting(10, 0, 50), sitting(10, 0, 60), sitting(8, 2, 50)]), 5,
    'sixty cards at five seconds is five minutes');
  assert.equal(minutesFor(1, []), 1, 'and nothing is ever "0 min"');
}

// --- what counts as a laboured answer ---
{
  const quick = [{ t: 1, m: 'M', g: 'recall', r: 10, w: 0, secs: 20 },
                 { t: 2, m: 'M', g: 'recall', r: 10, w: 0, secs: 20 },
                 { t: 3, m: 'M', g: 'recall', r: 10, w: 0, secs: 20 }];
  assert.equal(slowAfter(quick), 8, 'a fast learner is held to a fast bar, floored at 8s');
  assert.equal(slowAfter([]), 18, 'no history means three times the default pace');
  const glacial = quick.map(s => ({ ...s, secs: 400 }));
  assert.equal(slowAfter(glacial), 30, 'and the bar never drifts past 30 seconds');
}

// --- the due forecast ---
{
  const now = 1_700_000_000_000;
  const mods = [{ id: 'm', title: 'M', cards: [
    { front: 'a', back: '1' }, { front: 'b', back: '2' }, { front: 'c', back: '3' }, { front: 'd', back: '4' }] }];
  const srs = {
    ['m:' + hash('a')]: { due: now + DAY * 2.5 },
    ['m:' + hash('b')]: { due: now + DAY * 2.1 },
    ['m:' + hash('c')]: { due: now + DAY * 40 },          // beyond the horizon
    ['m:' + hash('d')]: { due: now + DAY, susp: true },   // parked cards never come due
  };
  const f = forecast(mods, srs, 30, now);
  assert.equal(f.length, 30, 'one bucket per day');
  assert.equal(f[2], 2, 'both land on the day they fall due');
  assert.equal(f.reduce((a, b) => a + b, 0), 2, 'nothing parked, nothing past the horizon');
  assert.equal(forecast(mods, {}, 7, now).reduce((a, b) => a + b, 0), 0, 'an unstudied module has no forecast');
}

// --- confusions fold and merge ---
{
  const one = mergeConfusions([], [{ a: 'Kenya', b: 'Uganda' }, { a: 'Kenya', b: 'Uganda' }, { a: 'Chad', b: 'Mali' }]);
  assert.deepEqual(one[0], { a: 'Kenya', b: 'Uganda', n: 2 }, 'repeats count up and lead');
  const both = mergeConfusions(one, [{ a: 'Kenya', b: 'Uganda', n: 3 }]);
  assert.equal(both[0].n, 5, 'two records sum');
  assert.equal(mergeConfusions([], []).length, 0, 'nothing in, nothing out');
  const many = Array.from({ length: 30 }, (_, i) => ({ a: 'x' + i, b: 'y', n: i }));
  assert.equal(mergeConfusions(many, []).length, 20, 'and the record is capped');
}

// --- known-wrong options are never forgiven ---
assert.equal(judgeTyped('effect', 'affect', [], ['effect']), 'wrong',
  'the listed twin is the mistake, not a typo');
assert.equal(judgeTyped('its', "it's", [], ['its']), 'wrong',
  'even when normalising would call it exact');
assert.equal(judgeTyped("it's", "it's", [], ['its']), 'exact', 'the right twin still wins');
assert.equal(judgeTyped('affct', 'affect', [], ['effect']), 'close', 'a real typo is still forgiven');

// --- the calendar reminder ---
{
  const ics = reminderIcs('7:30', 'https://pit.example', 1_700_000_000_000);
  assert.ok(ics.includes('RRULE:FREQ=DAILY'), 'repeats daily');
  assert.ok(/DTSTART:\d{8}T073000/.test(ics), 'at the chosen minute', ics.match(/DTSTART:[^\r]*/)[0]);
  assert.ok(ics.includes('URL:https://pit.example'), 'carries the way back in');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR') && ics.endsWith('END:VCALENDAR'), 'is a whole calendar');
  assert.equal(reminderIcs('25:00'), null, 'a nonsense time is refused');
  assert.equal(reminderIcs('tea time'), null, 'words are not a time');
}

// --- the sharpening prompt ---
{
  const p = sharpenPrompt([
    { front: 'What is X and Y?', back: 'Two things', note: 'why' },
    { front: 'Where is Z?', back: 'There' },
  ], 'My Module');
  assert.ok(p.includes('My Module'), 'names the module');
  assert.ok(p.includes('What is X and Y?') && p.includes('Where is Z?'), 'lists every miss');
  assert.ok(p.includes('(note: why)'), 'carries the note along');
  assert.ok(p.includes('| Question | Answer |'), 'asks for the exact shape the importer reads');
}

// --- spreading an overdue pile over the week ---
{
  const now = 1_700_000_000_000;
  const srs = {};
  for (let i = 0; i < 20; i++) srs['m:c' + i] = { reps: 1, due: now - (20 - i) * DAY };
  srs['m:parked'] = { reps: 1, due: now - DAY, susp: 1 };
  srs['m:future'] = { reps: 1, due: now + DAY };
  srs['m:unseen'] = { reps: 0, due: now - DAY };
  const moves = spreadDue(srs, 7, now);
  assert.equal(moves.length, 20, 'only seen, unparked, overdue cards move');
  assert.equal(moves[0][0], 'm:c0', 'the oldest debt lands first');
  assert.equal(moves[0][1], now, 'and lands today');
  const byDay = {};
  for (const [, due] of moves) byDay[(due - now) / DAY] = (byDay[(due - now) / DAY] || 0) + 1;
  assert.deepEqual(byDay, { 0: 3, 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2 }, 'dealt evenly, today included');
  assert.equal(spreadDue({}, 7, now).length, 0, 'an empty pile spreads to nothing');
}

// --- mastery by tag ---
{
  const mods = [
    { id: 'a', title: 'A', tags: ['maths', 'kids'], cards: [{ front: 'a1', back: '1' }, { front: 'a2', back: '2' }] },
    { id: 'b', title: 'B', tags: ['maths'], cards: [{ front: 'b1', back: '1' }] },
    { id: 'c', title: 'C', tags: [], cards: [{ front: 'c1', back: '1' }] },
  ];
  const now = 1_700_000_000_000;
  const srs = { ['a:' + hash('a1')]: { due: now + DAY }, ['b:' + hash('b1')]: { due: now - 1 } };
  const tags = tagTotals(mods, srs, now);
  assert.deepEqual(tags.map(t => t.tag), ['maths', 'kids'], 'biggest subject first');
  assert.equal(tags[0].total, 3, 'maths spans both modules');
  assert.equal(tags[0].learned, 1, 'one card of it rests');
  assert.equal(tags[0].due, 1, 'one is due');
  assert.equal(tagTotals(mods, {}).find(t => t.tag === 'kids').total, 2, 'a tag counts only its own cards');
}

// --- starred cards ---
{
  const mods = [{ id: 'm', title: 'M', cards: [{ front: 'a', back: '1' }, { front: 'b', back: '2' }] },
                { id: 'n', title: 'N', cards: [{ front: 'c', back: '3' }] }];
  const srs = { ['m:' + hash('b')]: { due: 0, star: true }, ['n:' + hash('c')]: { due: 0, star: true },
                ['m:' + hash('a')]: { due: 0 } };
  const list = starred(mods, srs);
  assert.deepEqual(list.map(c => c.front), ['b', 'c'], 'starred cards come from every module');
  assert.deepEqual(list.map(c => c.mid), ['m', 'n'], 'each remembering where it lives');
  assert.equal(starred(mods, {}).length, 0, 'and nothing is starred by default');
}

// --- ranks ---
assert.equal(rankFor(0).rank.name, 'Initiate', 'everyone starts at the top of the pit');
assert.equal(rankFor(19).rank.name, 'Initiate', 'and stays there until the threshold');
assert.equal(rankFor(20).rank.name, 'Cadet', 'which promotes exactly on the number');
assert.equal(rankFor(20).next.name, 'Adept', 'the next rank is named');
assert.equal(rankFor(20).toGo, 40, 'with the distance to it');
assert.equal(rankFor(40).pct, 50, 'and the progress through the current rank');
assert.equal(rankFor(99999).next, null, 'the last rank has nothing after it');
assert.equal(rankFor(99999).pct, 100, 'and is complete');
assert.equal(rankFor(-5).rank.name, 'Initiate', 'a nonsense count cannot demote anyone');

// --- growing a module with Claude ---
const growMod = { title: 'World Capitals', description: 'every capital',
  cards: [{ front: 'Japan', back: 'Tokyo' }, { front: 'Peru', back: 'Lima' }] };
const prompt = growPrompt(growMod, 5);
assert.ok(prompt.includes('World Capitals') && prompt.includes('every capital'), 'the prompt names the module');
assert.ok(prompt.includes('5 more cards'), 'and how many are wanted');
assert.ok(prompt.includes('- Japan') && prompt.includes('- Peru'), 'and lists what is already held');
assert.ok(!prompt.includes('Tokyo'), 'but not the answers — the questions are what must not repeat');
const big = growPrompt({ title: 'T', cards: Array.from({ length: 30 }, (_, i) => ({ front: 'q' + i, back: 'a' })) }, 10, 4);
assert.ok(big.includes('…and 26 more'), 'a long module lists a sample and says so');
assert.equal(big.split('\n').filter(l => l.startsWith('- q')).length, 4, 'the listing is capped');

// --- a module can name its language ---
assert.equal(validateModule({ title: 'T', lang: 'fr', cards: [{ front: 'a', back: 'b' }] }).lang, 'fr',
  'a plain language tag is kept');
assert.equal(validateModule({ title: 'T', lang: 'de-AT', cards: [{ front: 'a', back: 'b' }] }).lang, 'de-AT',
  'and a regioned one');
assert.ok(!('lang' in validateModule({ title: 'T', lang: 'not a lang!', cards: [{ front: 'a', back: 'b' }] })),
  'gibberish is dropped');

// --- linked modules: same question, and what is new in a re-fetch ---
assert.equal(ident({ front: '  Where is  Paris? ' }), ident({ front: 'where is paris?' }),
  'wording is the same question regardless of case and spacing');
assert.notEqual(ident({ front: 'What is this?', image: 'a.png' }),
  ident({ front: 'What is this?', image: 'b.png' }), 'but two pictures are two questions');
const held = [{ front: 'Japan', back: 'Tokyo' }, { front: 'Peru', back: 'Lima' }];
assert.deepEqual(newCards(held, [{ front: 'japan', back: 'Tokyo' }, { front: 'Chad', back: "N'Djamena" }])
  .map(c => c.front), ['Chad'], 'a re-fetch only offers what is not already held');
assert.equal(newCards(held, held).length, 0, 'an unchanged source adds nothing');
assert.equal(validateModule({ title: 'T', src: 'https://x/y.md', cards: [{ front: 'a', back: 'b' }] }).src,
  'https://x/y.md', 'a module remembers an http source');
assert.ok(!('src' in validateModule({ title: 'T', src: 'javascript:alert(1)', cards: [{ front: 'a', back: 'b' }] })),
  'and never a source that could execute');

// --- trouble spots ---
const tsMods = [{ id: 'm', title: 'M', cards: [{ front: 'a', back: '1' }, { front: 'b', back: '2' },
  { front: 'c', back: '3' }, { front: 'd', back: '4' }] }];
const tsSrs = {
  ['m:' + hash('a')]: { due: 0, lapses: 5, log: 'gggg' },       // old trouble, currently fine
  ['m:' + hash('b')]: { due: 0, lapses: 0, log: 'gaaga' },      // new trouble
  ['m:' + hash('c')]: { due: 0, lapses: 0, log: 'gggg' },       // no trouble at all
  ['m:' + hash('d')]: { due: 0, lapses: 9, log: 'aaaa', susp: true },  // parked, not a to-do
};
const trouble = troubleSpots(tsMods, tsSrs);
assert.deepEqual(trouble.map(t => t.card.front), ['b', 'a'], 'recent misses outrank an old lapse count');
assert.equal(trouble[0].score, 6, 'three recent misses count double');
assert.ok(trouble.every(t => t.card.mid === 'm'), 'each card remembers the module it came from');
assert.equal(troubleSpots(tsMods, tsSrs, 1).length, 1, 'the list is capped');
assert.equal(troubleSpots(tsMods, {}).length, 0, 'an unstudied library has no trouble spots');

// --- free recall coverage ---
const answer = 'Spaced repetition schedules a card just before you would forget it';
assert.deepEqual(keyPoints(answer), ['spaced', 'repetition', 'schedules', 'card', 'before', 'forget'],
  'key points are the content words, in order');
assert.equal(keyPoints('the and for that this with').length, 0, 'function words are never key points');
assert.equal(keyPoints('alpha beta gamma delta', 2).length, 2, 'the list is capped');
const cov = coverage(answer, 'you review a card just before forgetting it');
assert.deepEqual(cov.hit, ['card', 'before', 'forget'], 'inflections still count as hits');
assert.equal(cov.pct, 50, 'coverage is a percentage of the key points');
assert.equal(coverage(answer, '').hit.length, 0, 'an empty attempt covers nothing');
assert.equal(coverage('', 'anything').pct, 0, 'and an answer with no key points cannot be under-covered');
assert.equal(coverage(answer, answer).pct, 100, 'saying the answer back covers all of it');

// --- decoys: whole cards, for picture options ---
const pics = ['sun', 'moon', 'star', 'tree', 'sun'].map((w, i) =>
  ({ front: 'What is this?', back: w, image: 'https://x/' + i + '.png' }));
const dc = decoys(pics[0], pics, 3, () => 0);
assert.equal(dc.length, 3, 'three picture decoys');
assert.ok(dc.every(c => c.image), 'decoys keep their pictures');
assert.ok(!dc.some(c => c.back === 'sun'), 'and never repeat the answer, even a duplicate of it');
assert.equal(new Set(dc.map(c => c.back)).size, 3, 'decoys are distinct from each other');
assert.equal(decoys(pics[0], [pics[0]], 3).length, 0, 'a pool of one yields none');

// a card carrying its own options uses them, and never offers the right answer twice
const authored = validateModule({
  title: 'MCQ', cards: [{ front: 'q', back: 'Right', options: ['Plausible', 'Tempting', 'Right', 'Wrong'] }],
}).cards[0];
assert.deepEqual(authored.options.sort(), ['Plausible', 'Tempting', 'Wrong'], 'the answer is stripped from its own options');
assert.deepEqual(distractors(authored, mixed, 3, () => 0).sort(), ['Plausible', 'Tempting', 'Wrong'],
  'authored options win over generated ones');

// --- typed answers ---
assert.equal(judgeTyped('Dopamine', 'dopamine'), 'exact', 'case ignored');
assert.equal(judgeTyped('  the Krebs cycle ', 'Krebs cycle'), 'exact', 'article and padding ignored');
assert.equal(judgeTyped('Schrodinger', 'Schrödinger'), 'exact', 'accents ignored');
assert.equal(judgeTyped('mitocondria', 'mitochondria'), 'close', 'one typo forgiven');
assert.equal(judgeTyped('ad hominem', 'Ad hominem (attacking the person)'), 'exact', 'parenthetical optional');
assert.equal(judgeTyped('Venus', 'Mercury'), 'wrong');
assert.equal(judgeTyped('', 'anything'), 'wrong', 'blank is never right');
assert.equal(judgeTyped('cat', 'dog'), 'wrong', 'short words do not slip through slack');
assert.equal(levenshtein('kitten', 'sitting'), 3);
assert.equal(levenshtein('', 'abc'), 3);

// mixed sessions: a card carrying `mid` scores against its home module
assert.equal(cardKey('everything', { mid: 'solar', front: 'q' }), cardKey('solar', { front: 'q' }));

// --- stickers ---
assert.equal(stickersFor(0).length, 0, 'no stars, no stickers');
assert.equal(stickersFor(3)[0].emoji, '🐣', 'the first arrives at three');
assert.equal(stickersFor(1000).length, STICKERS.length, 'and they all unlock eventually');
assert.equal(stickerEarned(2, 3)?.emoji, '🐣', 'crossing a threshold earns one');
assert.equal(stickerEarned(3, 5), null, 'staying between thresholds earns nothing');
assert.equal(stickerEarned(0, 12)?.at, 3, 'a big jump reports the first one crossed');
assert.ok(STICKERS.every((s, i) => i === 0 || s.at > STICKERS[i - 1].at), 'thresholds only ever increase');

// --- days and streaks ---
{
  const noonLocal = new Date(2026, 7, 13, 12, 0, 0).getTime();     // 13 Aug 2026, local noon
  const lateEvening = new Date(2026, 7, 13, 23, 30, 0).getTime();  // still the 13th locally
  assert.equal(dayStr(noonLocal), '2026-08-13');
  assert.equal(dayStr(lateEvening), '2026-08-13', 'the day does not roll over in the evening');

  const yesterday = dayStr(noonLocal - DAY);
  assert.deepEqual(bumpStreak({ streak: 4, lastDay: yesterday }, noonLocal),
    { streak: 5, lastDay: '2026-08-13', rested: '' }, 'studying the next day extends the streak');
  assert.deepEqual(bumpStreak({ streak: 4, lastDay: '2026-08-13' }, noonLocal),
    { streak: 4, lastDay: '2026-08-13', rested: '' }, 'a second session the same day changes nothing');
  assert.deepEqual(bumpStreak({ streak: 9, lastDay: dayStr(noonLocal - 3 * DAY) }, noonLocal),
    { streak: 1, lastDay: '2026-08-13', rested: '' }, 'two missed days reset to one');
  assert.deepEqual(bumpStreak({}, noonLocal), { streak: 1, lastDay: '2026-08-13', rested: '' }, 'first ever session');
  // one missed day is forgiven, once a week
  const skipped = dayStr(noonLocal - 2 * DAY);
  assert.deepEqual(bumpStreak({ streak: 6, lastDay: skipped }, noonLocal),
    { streak: 7, lastDay: '2026-08-13', rested: '2026-08-13' }, 'a single missed day is a rest day');
  assert.deepEqual(bumpStreak({ streak: 6, lastDay: skipped, rested: dayStr(noonLocal - 3 * DAY) }, noonLocal),
    { streak: 1, lastDay: '2026-08-13', rested: dayStr(noonLocal - 3 * DAY) },
    'but not twice in the same week');
  assert.equal(bumpStreak({ streak: 6, lastDay: skipped, rested: dayStr(noonLocal - 9 * DAY) }, noonLocal).streak,
    7, 'a rest day from last week is spent again');
  assert.equal(bumpStreak({ streak: 0, lastDay: skipped }, noonLocal).streak, 1,
    'there is nothing to forgive without a streak');
  assert.deepEqual(bumpStreak(bumpStreak({}, noonLocal), lateEvening), { streak: 1, lastDay: '2026-08-13', rested: '' },
    'morning and evening on the same day is one day');
}

// --- deadlines ---
{
  const now = new Date(2026, 7, 13, 12).getTime();               // 13 Aug
  const ten = Array.from({ length: 10 }, (_, i) => ({ front: `d${i}`, back: 'x' }));
  assert.equal(deadlinePlan(ten, {}, 'm', '', now), null, 'no deadline, no plan');

  const soon = deadlinePlan(ten, {}, 'm', '2026-08-18', now);
  assert.equal(soon.daysLeft, 6, 'the 18th from midday on the 13th is six study days, today included');
  assert.equal(soon.remaining, 10, 'every unseen card counts as remaining');
  assert.equal(soon.perDay, 2, 'ten cards over six days rounds to two a day');

  const learned = {};
  for (const c of ten.slice(0, 8)) learned[cardKey('m', c)] = schedule(undefined, 'easy', now);
  assert.equal(deadlinePlan(ten, learned, 'm', '2026-08-18', now).perDay, 1,
    'cards already resting do not count against the daily target');

  assert.equal(deadlinePlan(ten, {}, 'm', '2026-08-13', now).perDay, 10, 'a deadline today means all of it today');
  assert.equal(deadlinePlan(ten, {}, 'm', '2026-08-14', now).perDay, 5, 'tomorrow means half today, half tomorrow');
  const gone = deadlinePlan(ten, {}, 'm', '2026-08-01', now);
  assert.ok(gone.passed && gone.daysLeft === 0, 'a passed deadline says so');
}

// --- due across modules, and the weekly board ---
{
  const mods = [
    { id: 'a', title: 'Alpha', cards: [{ front: 'a1', back: 'x' }, { front: 'a2', back: 'y' }] },
    { id: 'b', title: 'Beta', cards: [{ front: 'b1', back: 'z' }] },
  ];
  const store = {};
  store[cardKey('a', mods[0].cards[0])] = { due: T - 5 * DAY, t: 1 };        // most overdue
  store[cardKey('a', mods[0].cards[1])] = { due: T + DAY, t: 1 };            // not yet
  store[cardKey('b', mods[1].cards[0])] = { due: T - DAY, t: 1 };
  const due = dueAcross(mods, store, T);
  assert.deepEqual(due.map(c => c.front), ['a1', 'b1'], 'only due cards, oldest first');
  assert.equal(due[0].mid, 'a', 'each card remembers its home module');
  assert.equal(due[1].from, 'Beta');

  store[cardKey('b', mods[1].cards[0])].susp = true;
  assert.equal(dueAcross(mods, store, T).length, 1, 'paused cards stay out of the mix');

  const now = new Date(2026, 7, 13, 12).getTime();
  const board = weeklyTotals({
    Mila: { opts: { avatar: '🦕' }, stats: { days: { [dayStr(now)]: 12, [dayStr(now - 2 * DAY)]: 9, [dayStr(now - 30 * DAY)]: 500 } } },
    Theo: { stats: { days: { [dayStr(now - DAY)]: 25 } } },
    Zed: { stats: {} },
  }, now);
  assert.deepEqual(board.map(r => [r.name, r.total]), [['Theo', 25], ['Mila', 21], ['Zed', 0]],
    'last seven days only, busiest first');
  assert.equal(board[1].avatar, '🦕');
}

// --- cloze ---
const cz = cloze('The mitochondrion is the powerhouse of the cell', () => 0);
assert.ok(cz, 'a sentence yields a blank');
assert.ok(!['the','is','of'].includes(cz.answer.toLowerCase()), 'never blanks a function word');
assert.ok(cz.masked.includes('_'), 'the blank is visible');
assert.equal(cz.masked.replace(/_+/, cz.answer), 'The mitochondrion is the powerhouse of the cell',
  'restoring the answer rebuilds the sentence');
assert.equal(cloze('Tokyo', () => 0), null, 'a single short answer has nothing to blank');
assert.equal(cloze('42', () => 0), null, 'numbers are not blanked');
const cz2 = cloze('It ends with punctuation.', () => 0.99);
assert.ok(!cz2.answer.endsWith('.'), 'trailing punctuation stays outside the blank');
const cz3 = cloze('Attention is **all you need** here', () => 0);
assert.equal(cz3.answer, 'all you need', 'a bolded term is the chosen blank, even several words');
assert.ok(!cz3.masked.includes('need') && !cz3.masked.includes('**'), 'and the markers vanish with it');
const cz4 = cloze('Pick **this** or **that** term', () => 0.99);
assert.equal(cz4.answer, 'that', 'several bolds share the honour');
assert.ok(cz4.masked.includes('**this**'), 'the others keep their emphasis');
assert.equal(cloze('**Tokyo**', () => 0), null, 'a lone bolded word still has no sentence around it');

// --- spelling tiles ---
assert.ok(spellable('Mercury') && spellable('Ljubljana'), 'single words are spellable');
assert.ok(!spellable('New Delhi'), 'two words are not');
assert.ok(!spellable('42') && !spellable('ab'), 'numbers and very short answers are not');
const tiles = letterTiles('Venus', () => 0.5, 3);
assert.equal(tiles.length, 8, 'answer letters plus decoys');
for (const ch of 'VENUS') assert.ok(tiles.includes(ch), `tile set contains ${ch}`);

// --- validation ---
const m = validateModule({ title: 'Logic 101', cards: [{ q: 'a', a: 'b' }], tags: ['x'] });
assert.equal(m.id, 'logic-101');
assert.equal(m.cards[0].front, 'a', 'q/a aliases accepted');
assert.equal(validateModule({ title: 'n', cards: [{ front: 'a', back: 'b', why: 'because' }] }).cards[0].note, 'because',
  'why/explanation/extra all land in note');
assert.equal(validateModule({ title: 'Sums', tags: ['maths'], cards: [{ front: 'a', back: 'b' }] }).icon, '➗', 'tag picks the icon');
assert.equal(validateModule({ title: 'S', icon: '🐙', cards: [{ front: 'a', back: 'b' }] }).icon, '🐙', 'explicit icon wins');
assert.equal(validateModule({ title: 'Whatever', cards: [{ front: 'a', back: 'b' }] }).icon,
  validateModule({ title: 'Whatever', cards: [{ front: 'c', back: 'd' }] }).icon, 'fallback icon is stable per title');
const deduped = validateModule({ title: 'Dupes', cards: [
  { front: 'What is a monad?', back: 'first answer' },
  { front: 'Something else', back: 'b' },
  { front: '  what IS a monad?  ', back: 'a repeat with different wording of the same question' },
] });
assert.equal(deduped.cards.length, 2, 'a repeated question is dropped');
assert.equal(deduped.cards[0].back, 'first answer', 'and the first one is the one kept');

// …but the picture is part of the question: same words, different picture, different card
const picCards = validateModule({ title: 'Pics', cards: [
  { front: 'What is this?', back: 'sun', image: 'data:image/png;base64,AAA' },
  { front: 'What is this?', back: 'moon', image: 'data:image/png;base64,BBB' },
  { front: 'What is this?', back: 'dupe', image: 'data:image/png;base64,AAA' },
] }).cards;
assert.deepEqual(picCards.map(c => c.back), ['sun', 'moon'], 'differing pictures are differing questions');
assert.notEqual(cardKey('m', picCards[0]), cardKey('m', picCards[1]), 'and they schedule separately');

// recorded audio, same rules as pictures
assert.ok(validateModule({ title: 'A', cards: [{ front: 'a', back: 'b', audio: 'data:audio/webm;base64,AAA' }] }).cards[0].audio);
assert.equal(validateModule({ title: 'A', cards: [{ front: 'a', back: 'b', sound: 'data:text/html,x' }] }).cards[0].audio,
  undefined, 'and nothing that is not audio');

// a source link is kept when it is http(s), dropped otherwise
assert.equal(validateModule({ title: 'S', cards: [{ front: 'a', back: 'b', source: 'https://ex.com/p' }] }).cards[0].source,
  'https://ex.com/p');
assert.equal(validateModule({ title: 'S', cards: [{ front: 'a', back: 'b', url: 'javascript:alert(1)' }] }).cards[0].source,
  undefined, 'and never anything executable');

// pictures: inline data and remote https only, never anything executable
const px = 'data:image/png;base64,iVBORw0KGgo=';
assert.equal(validateModule({ title: 'P', cards: [{ front: 'a', back: 'b', image: px }] }).cards[0].image, px);
assert.equal(validateModule({ title: 'P', cards: [{ front: 'a', back: 'b', img: 'https://x/y.png' }] }).cards[0].image,
  'https://x/y.png', 'the img alias works too');
for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'vbscript:x', 'data:image/svg+xml,<svg onload=alert(1)>']) {
  assert.equal(validateModule({ title: 'P', cards: [{ front: 'a', back: 'b', image: bad }] }).cards[0].image, undefined,
    `refuses ${bad.slice(0, 24)}`);
}
assert.equal(validateModule({ title: 'P', cards: [{ front: 'a', back: 'b', image: '  ' + px }] }).cards[0].image, px,
  'surrounding whitespace is trimmed, not treated as an attack');

assert.throws(() => validateModule({ title: 'x' }), /cards/);
assert.throws(() => validateModule({ title: 'x', cards: [{ front: 'only' }] }), /front and a back/);
assert.throws(() => validateModule(null), /object/);
assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');

// --- card formatting: markdown subset in, no markup out ---
assert.equal(fmt('use `Array.map()` here'), 'use <code>Array.map()</code> here');
assert.equal(fmt('**bold** and\nnext line'), '<strong>bold</strong> and<br>next line');
assert.equal(fmt('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;', 'html stays literal');
assert.equal(fmt('`<b>x</b>`'), '<code>&lt;b&gt;x&lt;/b&gt;</code>', 'html inside a code span stays literal');
assert.equal(fmt('a * b * c'), 'a * b * c', 'stray asterisks are left alone');
assert.equal(fmt('2 ** 8'), '2 ** 8', 'unpaired bold markers are left alone');

// --- parseImport: every shape Claude answers in ---
const one = t => { const [m] = parseImport(t); return m; };

const fenced = one('Here you go:\n\n```json\n{"title":"Krebs","cards":[{"front":"a","back":"b"}]}\n```\nHope that helps!');
assert.equal(fenced.title, 'Krebs', 'code fence and chatter around the JSON are stripped');

const bareArray = one('[{"q":"a","a":"b"},{"q":"c","a":"d"}]');
assert.equal(bareArray.cards.length, 2, 'a bare array of cards is a module');

const table = one(`## Neurotransmitters
| Term | Definition |
|------|------------|
| Dopamine | Reward and motor control |
| **GABA** | Chief inhibitory transmitter |`);
assert.equal(table.title, 'Neurotransmitters', 'title comes from the heading');
assert.equal(table.cards.length, 2, 'header and separator rows dropped');
assert.equal(table.cards[1].front, 'GABA', 'bold stripped from cells');

const qa = one(`Q: What is a monad?
A: A monoid in the category of endofunctors,
which is less funny than it sounds.

Q: What is currying?
A: Turning an n-ary function into n unary ones.`);
assert.equal(qa.cards.length, 2);
assert.match(qa.cards[0].back, /less funny/, 'wrapped answer lines are joined');

// a real reply has chatter around the cards, and it must not end up on one
const chatty = one(`Great question! Here they are as cards.

Q: What does the spacing effect describe?
A: The same study time works better spread out

Q: What is retrieval practice?
A: Recalling something strengthens it more
than simply re-reading it

Let me know if you'd like more on the forgetting curve.`);
assert.equal(chatty.cards.length, 2, 'chatter above and below is not a card');
assert.equal(chatty.cards[1].back, 'Recalling something strengthens it more than simply re-reading it',
  'a wrapped answer still joins, but the sign-off after the blank line does not');

const bullets = one(`- **Idempotent**: same result when applied twice
- **Referentially transparent**: replaceable by its value
- **Total**: defined for every input`);
assert.equal(bullets.cards.length, 3, 'bullet glossary');
assert.equal(bullets.cards[0].front, 'Idempotent');

const dbl = one('mitosis :: division into two identical cells\nmeiosis :: division producing gametes');
assert.equal(dbl.cards.length, 2, ':: delimiter');

// tab-separated (Anki exports, spreadsheets, our own TSV export) carries hint and note columns
const tsv = one('Japan\tTokyo\nAustralia\tCanberra\tNot Sydney\tSydney is the biggest city\nCanada\tOttawa');
assert.equal(tsv.cards.length, 3);
assert.deepEqual(tsv.cards[1], { front: 'Australia', back: 'Canberra', hint: 'Not Sydney', note: 'Sydney is the biggest city' });

const pairs = one(`What year did Rome fall?\n476 AD\n\nWho wrote the Aeneid?\nVirgil\n\nWhat is a consul?\nOne of two annual magistrates`);
assert.equal(pairs.cards.length, 3, 'blank-line separated two-line blocks');
assert.equal(pairs.cards[2].back, 'One of two annual magistrates');

const twoModules = parseImport('[{"title":"One","cards":[{"front":"a","back":"b"}]},{"title":"Two","cards":[{"front":"c","back":"d"}]}]');
assert.equal(twoModules.length, 2, 'an array of modules imports as several modules');
assert.deepEqual(twoModules.map(m => m.id), ['one', 'two']);

// the shapes Windows produces: a byte-order mark and CRLF line endings
const bom = one('﻿{"title":"BOM","cards":[{"front":"a","back":"b"}]}');
assert.equal(bom.title, 'BOM', 'a leading byte-order mark does not break the JSON path');
const crlf = one('Q: one\r\nA: first\r\n\r\nQ: two\r\nA: second');
assert.deepEqual(crlf.cards, [{ front: 'one', back: 'first' }, { front: 'two', back: 'second' }],
  'CRLF line endings leave no carriage returns behind');

// a third table column is the hint, and a `|---|` row means the row above it was a header
// whatever it is called — `| Country | Capital |` used to become a card
const withHint = one('| Country | Capital | Note |\n|---|---|---|\n| Australia | Canberra | Not Sydney |');
assert.equal(withHint.cards.length, 1, 'the header row is dropped on the separator, not on wording');
assert.equal(withHint.cards[0].front, 'Australia');
assert.equal(withHint.cards[0].hint, 'Not Sydney');
assert.equal(one('| Japan | Tokyo |\n| Peru | Lima |').cards.length, 2, 'a table with no separator is all data');
assert.deepEqual(one('| Japan | Tokyo |').cards, [{ front: 'Japan', back: 'Tokyo' }], 'even a single-row table');
assert.equal(one('| Term | Meaning |\n|:---|---:|\n| a | b |').cards.length, 1, 'alignment colons are still separators');

// odd but survivable input
assert.equal(validateModule({ title: 'T', tags: 'not-an-array', cards: [{ front: 'a', back: 'b' }] }).tags.length, 0,
  'a non-array tags field is ignored rather than fatal');
assert.throws(() => validateModule({ title: 'T', cards: Array.from({ length: 2001 }, () => ({ front: 'a', back: 'b' })) }),
  /too many/, 'a runaway module is refused');
assert.throws(() => validateModule({ title: 'T', cards: [{ front: '   ', back: 'b' }] }), /front and a back/,
  'whitespace is not a question');
assert.deepEqual(mergeState({}, {}), { active: undefined, settings: {}, profiles: {}, custom: [] },
  'merging two empty states does not throw');

// the shapes Claude actually replies in, all of which must survive a raw paste
const shapes = {
  'numbered bold dash': ['1. **Mitosis** — division into two\n2. **Meiosis** — makes gametes', 2, 'Mitosis'],
  'bold colon inside': ['**Q:** What is a closure?\n**A:** A function plus its captured scope', 1, 'What is a closure?'],
  'bold colon outside': ['**Q**: What is hoisting?\n**A**: Declarations processed first', 1, 'What is hoisting?'],
  'spelled out': ['Question: What is a monad?\nAnswer: A monoid in the category of endofunctors', 1, 'What is a monad?'],
  'em dash glossary': ['Idempotent — same result twice\nPure — no side effects\nTotal — defined everywhere', 3, 'Idempotent'],
  'code in cells': ['| Method | Effect |\n|---|---|\n| `push()` | adds to the end |', 1, '`push()`'],
  'nested bullets': ['- **HTTP verbs**\n  - GET: read a resource\n  - POST: create a resource', 2, 'GET'],
};
for (const [name, [text, count, firstFront]] of Object.entries(shapes)) {
  const m = one(text);
  assert.equal(m.cards.length, count, `${name}: card count`);
  assert.equal(m.cards[0].front, firstFront, `${name}: first front is clean`);
  assert.ok(!/\*\*|^\s*\|/.test(m.cards[0].front), `${name}: no markup left on the card`);
}

// --- spreadsheet CSV: quotes hide the comma, "" is a quote, prose still splits once ---
{
  const csv = one('front,back\n"Paris, France","capital of France"\n"Rome, Italy",capital of Italy');
  assert.equal(csv.cards.length, 2, 'the header row is dropped and both rows survive');
  assert.equal(csv.cards[0].front, 'Paris, France', 'a quoted comma does not split the field');
  assert.equal(csv.cards[1].back, 'capital of Italy', 'an unquoted field beside a quoted one is fine');
  const quoted = one('"He said ""hi""",a greeting\n"She said ""bye""",a farewell');
  assert.equal(quoted.cards[0].front, 'He said "hi"', 'a doubled quote is a literal quote');
  const prose = one('apple, a fruit, red\npear, a fruit, green');
  assert.equal(prose.cards[0].back, 'a fruit, red', 'unquoted prose with commas still splits once');
  const tabbed = one('"a\tb"\tc\td\ne\tf');
  assert.equal(tabbed.cards[0].front, 'a\tb', 'a quoted tab survives in a tab file');
  assert.equal(tabbed.cards[0].hint, 'd', 'and the third column is still the hint');
}

assert.throws(() => parseImport(''), /Nothing/);
assert.throws(() => parseImport('{"title": broken'), /malformed/);
assert.throws(() => parseImport('just some prose with no structure at all'), /No cards found/);
assert.throws(() => parseImport('Q: What is a monad?'), /No cards found/,
  'a question with no answer is refused, not turned into a card called "Q"');
assert.deepEqual(one('Idempotent: same result twice\nPure: no side effects').cards.map(c => c.front),
  ['Idempotent', 'Pure'], 'while a colon glossary still parses');
assert.notEqual(one('a :: b').id, one('c :: d').id, 'untitled pastes do not collide');

// --- merge ---
const local = {
  active: 'Kid', settings: { tts: true },
  profiles: { Kid: { srs: { a: { t: 200, interval: 5 }, b: { t: 100 } }, stats: { reviews: 10, lastDay: '2026-08-13' } } },
  custom: [{ id: 'x', title: 'local', savedAt: 5 }],
};
const remote = {
  active: 'Other', settings: { tts: false, clientId: 'z' },
  profiles: {
    Kid: { srs: { a: { t: 100, interval: 1 }, c: { t: 300 } }, stats: { reviews: 4, lastDay: '2026-08-12' } },
    Sib: { srs: { d: { t: 1 } }, stats: {} },
  },
  custom: [{ id: 'x', title: 'remote', savedAt: 9 }, { id: 'y', savedAt: 1 }],
};
const merged = mergeState(local, remote);
assert.equal(merged.profiles.Kid.srs.a.interval, 5, 'newer card review wins');
assert.ok(merged.profiles.Kid.srs.b && merged.profiles.Kid.srs.c, 'both sides kept');
assert.ok(merged.profiles.Sib, 'profile only on the other device survives');
assert.equal(merged.profiles.Kid.stats.reviews, 10);
const dayMerge = mergeState(
  { profiles: { K: { srs: {}, stats: { days: { '2026-08-11': 5, '2026-08-12': 3 } } } } },
  { profiles: { K: { srs: {}, stats: { days: { '2026-08-12': 9, '2026-08-13': 2 } } } } });
assert.deepEqual(dayMerge.profiles.K.stats.days, { '2026-08-11': 5, '2026-08-12': 9, '2026-08-13': 2 },
  'activity days merge per day, busiest device wins');
assert.equal(merged.settings.clientId, 'z', 'remote-only setting kept');
assert.equal(merged.settings.tts, true, 'local setting wins');
assert.equal(merged.custom.find(c => c.id === 'x').title, 'remote', 'newer module version wins');
assert.equal(merged.custom.length, 2);
assert.deepEqual(mergeState(merged, remote), mergeState(mergeState(merged, remote), remote), 'merge is idempotent');

// Two devices, one Drive file: the round trip each does is merge(local, remote) then upload.
// After both have synced once, and one syncs again, neither device has lost a review.
{
  const base = { active: 'Kid', settings: {}, profiles: { Kid: { srs: {}, stats: { reviews: 0, days: {} } } }, custom: [] };
  const clone = o => JSON.parse(JSON.stringify(o));
  let drive = clone(base);
  let tablet = clone(base), laptop = clone(base);

  tablet.profiles.Kid.srs['m:a'] = { t: 100, interval: 1, due: 1 };   // studied on the tablet
  laptop.profiles.Kid.srs['m:b'] = { t: 110, interval: 1, due: 2 };   // studied on the laptop, offline
  laptop.custom.push({ id: 'pasted', savedAt: 111, cards: [] });      // and imported a module

  const syncWith = device => { const merged = mergeState(device, drive); drive = merged; return merged; };
  tablet = syncWith(tablet);   // tablet syncs first
  laptop = syncWith(laptop);   // laptop pulls the tablet's work, pushes its own
  tablet = syncWith(tablet);   // tablet syncs again

  for (const [name, d] of [['tablet', tablet], ['laptop', laptop], ['drive', drive]]) {
    assert.ok(d.profiles.Kid.srs['m:a'], `${name} kept the tablet's review`);
    assert.ok(d.profiles.Kid.srs['m:b'], `${name} kept the laptop's review`);
    assert.equal(d.custom.length, 1, `${name} kept the imported module`);
  }
}

console.log('core.js ok');
