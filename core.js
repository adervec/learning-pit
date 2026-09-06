// core.js — pure logic: scheduling, session picking, merge, validation.
// No DOM, no network, so it is testable: `node core.test.js`

export const DAY = 86400000;

export function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Key is content-derived so reordering or re-generating a module keeps progress.
// `card.mid` wins when present: mixed sessions carry cards out of their home module
// and their progress must still land back in it.
export function cardKey(moduleId, card) {
  // Picture cards often share their wording ("What is this?"), so the image is part of the
  // identity. Cards without one keep exactly the key they had before pictures existed.
  // The separator is a NUL: no real card text contains one, so no two cards can collide.
  const identity = card.image ? card.front + '\0' + card.image : card.front;
  return (card.mid || moduleId) + ':' + (card.id || hash(identity));
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Card text is escaped first, then a deliberately tiny subset of markdown is put back:
// code spans, bold, and line breaks. Anything else stays literal, so pasted HTML in a
// card can never become markup.
export function fmt(s) {
  return esc(s)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ponytail: SM-2 minus the fiddly bits — 3 grades, no separate learning steps.
// Upgrade path: add FSRS if retention actually disappoints; the state shape survives it.
export const LEECH_AT = 8;

export function schedule(prev, grade, now = Date.now(), rnd = Math.random) {
  const s = Object.assign({ reps: 0, lapses: 0, ease: 2.5, interval: 0, due: now }, prev);
  if (grade === 'again') {
    s.reps = 0;
    s.lapses++;
    s.ease = Math.max(1.3, s.ease - 0.2);
    s.interval = 0;
    s.due = now + 600000; // 10 min: comes back inside this session
    // Eight failures means the card is wrong, not the learner. Park it rather than let it
    // eat a slot in every session; the progress screen says so and resuming is one tap.
    if (s.lapses >= LEECH_AT) s.susp = true;
  } else {
    s.reps++;
    if (grade === 'easy') s.ease = Math.min(3, s.ease + 0.15);
    const plain =
      s.reps === 1 ? (grade === 'easy' ? 3 : 1) :
      s.reps === 2 ? (grade === 'easy' ? 6 : 3) :
      Math.min(365, Math.round(s.interval * s.ease * (grade === 'easy' ? 1.3 : 1)));
    // Learn forty cards on Sunday and, unfuzzed, all forty come back on the same Sunday for
    // the rest of the year. A few per cent of jitter, growing with the interval, spreads a
    // cohort out without meaningfully changing when any one card is asked.
    // The first two steps are fixed on purpose — jitter belongs to the long intervals.
    const spread = Math.max(1, Math.round(plain * 0.05));
    const jitter = s.reps <= 2 ? 0 : Math.round((rnd() * 2 - 1) * spread);
    s.interval = Math.max(1, Math.min(365, plain + jitter));
    s.due = now + s.interval * DAY;
  }
  // A compact record of how it has actually gone: newest last, capped at twelve.
  // "aagge" tells you more about a card than one lapse count ever will.
  s.log = ((s.log || '') + grade[0]).slice(-12);
  s.t = now; // last touched — the merge tiebreaker
  return s;
}

/**
 * Overload relief: take everything overdue and deal it out over the coming days instead.
 * Oldest debts land soonest. Returns [key, due] pairs for the caller to apply — parked
 * cards and cards never seen are not scheduled, so they are not touched.
 */
export function spreadDue(srs, days = 7, now = Date.now()) {
  const late = Object.entries(srs)
    .filter(([, s]) => s && !s.susp && s.reps > 0 && s.due <= now)
    .sort((a, b) => a[1].due - b[1].due);
  const perDay = Math.ceil(late.length / days);
  return late.map(([k], i) => [k, now + Math.floor(i / perDay) * DAY]);
}

/**
 * The prompt for turning a sitting's misses into better cards. A card missed repeatedly is
 * usually the card's fault — this asks Claude to diagnose each one and reply in the exact
 * table shape the importer reads, so the fixes flow back in through the normal door.
 */
export function sharpenPrompt(cards, moduleTitle) {
  const rows = cards.map(c => `- Q: ${String(c.front).replace(/\s+/g, ' ').trim()} → A: `
    + String(c.back).replace(/\s+/g, ' ').trim()
    + (c.note ? ` (note: ${String(c.note).replace(/\s+/g, ' ').trim()})` : ''));
  return `I keep missing these flashcards from "${moduleTitle}". For each one, first say in one `
    + `line why it is easy to miss — two ideas in one? answerable from its own wording? too vague? `
    + `— then reply with ONLY a markdown table, no preamble:\n\n| Question | Answer |\n|---|---|\n\n`
    + `containing replacement cards: the same fact asked more sharply, split into two cards `
    + `wherever one card asked two things. Keep any question that was already sound, reworded `
    + `only if the wording was the problem.\n\n${rows.join('\n')}\n`;
}

/**
 * A daily calendar reminder as an .ics file — the one reminder channel a static app with no
 * push server actually has. The calendar carries the nagging; the app stays quiet.
 */
export function reminderIcs(hhmm, url = '', now = Date.now()) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  const d = new Date(now);
  const pad = n => String(n).padStart(2, '0');
  const start = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(+m[1])}${pad(+m[2])}00`;
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Learning Pit//EN',
    'BEGIN:VEVENT', `UID:learning-pit-daily-${start}`, `DTSTART:${start}`,
    'RRULE:FREQ=DAILY', 'SUMMARY:Learning Pit — a few cards',
    ...(url ? [`URL:${url}`, `DESCRIPTION:${url}`] : []),
    'BEGIN:VALARM', 'TRIGGER:PT0S', 'ACTION:DISPLAY', 'DESCRIPTION:Learning Pit', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

export function counts(cards, srs, moduleId, now = Date.now()) {
  let due = 0, fresh = 0, learned = 0, paused = 0;
  for (const c of cards) {
    const s = srs[cardKey(moduleId, c)];
    if (s?.susp) paused++;
    else if (!s) fresh++;
    else if (s.due <= now) due++;
    else learned++;
  }
  return { due, fresh, learned, paused, total: cards.length };
}

export function pickSession(cards, srs, moduleId, opts = {}) {
  const { size = 12, newPerSession = 5, now = Date.now(), rnd = Math.random } = opts;
  const withState = cards
    .map(c => ({ c, s: srs[cardKey(moduleId, c)] }))
    .filter(x => !x.s?.susp);   // paused cards are out of rotation entirely
  const due = withState.filter(x => x.s && x.s.due <= now).sort((a, b) => a.s.due - b.s.due);
  const fresh = withState.filter(x => !x.s);
  const out = due.slice(0, size).map(x => x.c);
  const room = Math.min(size - out.length, newPerSession);
  if (room > 0) out.push(...fresh.slice(0, room).map(x => x.c));
  // Nothing due and nothing new: let them practise anyway, soonest-due first.
  if (!out.length) {
    out.push(...withState.sort((a, b) => (a.s?.due || 0) - (b.s?.due || 0)).slice(0, size).map(x => x.c));
  }
  return shuffle(out, rnd);
}

// ---- stickers ----
// Stars accumulate from sessions; stickers are what a small child actually plays for.
// Thresholds grow so the next one is always visible but never immediate.
// The pit has depths. Rank comes from cards actually learned, never from time spent or
// answers ground out — the only way down the levels is to know more than you did.
export const RANKS = [
  { at: 0, name: 'Initiate', glyph: '◌' },
  { at: 20, name: 'Cadet', glyph: '◍' },
  { at: 60, name: 'Adept', glyph: '◑' },
  { at: 150, name: 'Scholar', glyph: '◕' },
  { at: 350, name: 'Archivist', glyph: '◉' },
  { at: 700, name: 'Keeper of the Pit', glyph: '✦' },
];

/** Where a learner stands: the rank held, the next one, and how far along the way. */
export function rankFor(learned) {
  const n = Math.max(0, learned | 0);
  let i = 0;
  while (i + 1 < RANKS.length && n >= RANKS[i + 1].at) i++;
  const rank = RANKS[i], next = RANKS[i + 1] || null;
  return {
    rank,
    next,
    toGo: next ? next.at - n : 0,
    pct: next ? Math.round((100 * (n - rank.at)) / (next.at - rank.at)) : 100,
  };
}

export const STICKERS = [
  { at: 3, emoji: '🐣', name: 'Hatchling' },
  { at: 10, emoji: '🦋', name: 'Butterfly' },
  { at: 20, emoji: '🐢', name: 'Steady' },
  { at: 35, emoji: '🦊', name: 'Quick' },
  { at: 50, emoji: '🐬', name: 'Diver' },
  { at: 75, emoji: '🦉', name: 'Night owl' },
  { at: 100, emoji: '🐉', name: 'Dragon' },
  { at: 140, emoji: '🚀', name: 'Launch' },
  { at: 200, emoji: '🪐', name: 'Far out' },
  { at: 280, emoji: '👑', name: 'Crown' },
];

export const stickersFor = stars => STICKERS.filter(s => (stars || 0) >= s.at);

/** The sticker crossed by going from `before` to `after` stars, if any. */
export const stickerEarned = (before, after) =>
  STICKERS.find(s => (before || 0) < s.at && (after || 0) >= s.at) || null;

// ---- days and streaks ----

// Local date, not UTC. With toISOString() the "day" rolls over during the evening for
// anyone west of Greenwich, which silently double-counts a streak.
export function dayStr(ms = Date.now()) {
  const d = new Date(ms);
  return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/**
 * Returns the updated {streak, lastDay, rested} for a day of study. Pure: pass the clock in.
 *
 * One missed day is forgiven, once a week: a streak is meant to reward the habit, and a
 * habit that punishes a single busy Tuesday is one people abandon rather than repair.
 * `rested` is the day the last forgiveness was spent, so it cannot be spent twice in a week.
 */
export function bumpStreak(stats, now = Date.now()) {
  const today = dayStr(now);
  const streak = stats.streak || 0;
  if (stats.lastDay === today) return { streak, lastDay: today, rested: stats.rested || '' };
  if (stats.lastDay === dayStr(now - DAY)) {
    return { streak: streak + 1, lastDay: today, rested: stats.rested || '' };
  }
  // Exactly one day missed, and no rest day taken in the last week: the streak survives it.
  const restedAgo = stats.rested ? (Date.parse(today) - Date.parse(stats.rested)) / DAY : Infinity;
  if (stats.lastDay === dayStr(now - 2 * DAY) && streak > 0 && restedAgo >= 7) {
    return { streak: streak + 1, lastDay: today, rested: today };
  }
  return { streak: 1, lastDay: today, rested: stats.rested || '' };
}

/**
 * What a deadline demands today: every card still unseen or unlearned, divided by the days
 * left. Returns null when there is no deadline or it has passed.
 */
export function deadlinePlan(cards, srs, moduleId, deadline, now = Date.now()) {
  if (!deadline) return null;
  const end = new Date(deadline + 'T23:59:59').getTime();
  const daysLeft = Math.max(0, Math.ceil((end - now) / DAY));
  const c = counts(cards, srs, moduleId, now);
  const remaining = c.fresh + c.due;              // not yet learned, or waiting to be re-seen
  if (end < now) return { daysLeft: 0, remaining, perDay: remaining, passed: true };
  return { daysLeft, remaining, perDay: Math.ceil(remaining / Math.max(1, daysLeft)), passed: false };
}

/** Every due card across a set of modules, oldest first, tagged with where it came from. */
export function dueAcross(modules, srs, now = Date.now()) {
  const out = [];
  for (const m of modules) {
    for (const c of m.cards) {
      const s = srs[cardKey(m.id, c)];
      if (!s || s.susp || s.due > now) continue;
      out.push({ ...c, mid: m.id, from: m.title, due: s.due });
    }
  }
  return out.sort((a, b) => a.due - b.due);
}

/** Cards reviewed per profile over the last `days`, busiest first. */
export function weeklyTotals(profiles, now = Date.now(), days = 7) {
  const window = Array.from({ length: days }, (_, i) => dayStr(now - i * DAY));
  return Object.entries(profiles || {})
    .map(([name, p]) => ({
      name,
      avatar: p.opts?.avatar || '◎',
      total: window.reduce((sum, d) => sum + ((p.stats?.days || {})[d] || 0), 0),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

// ---- typed answers ----

// Forgive case, accents, punctuation, and leading articles — the learner is being
// tested on the idea, not on typing.
function normalize(s) {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // strip combining accents
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')            // parenthetical asides are optional
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/^\s*(the|a|an)\s+/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

const RANK = ['exact', 'close', 'wrong'];

/**
 * 'exact' | 'close' (typo, or the key part of a longer answer) | 'wrong'.
 * `alts` are other answers the card says it will accept — "USA" for "the United States" —
 * and the best verdict across all of them wins.
 */
export function judgeTyped(guess, answer, alts = [], wrong = []) {
  // An answer the author listed as a wrong option is never forgiven into a win: "effect"
  // typed for "affect" is the mistake the card exists to catch, not a typo. The comparison
  // keeps punctuation, because for pairs like its / it's that is the entire difference.
  const g = String(guess).trim().toLowerCase();
  if ((Array.isArray(wrong) ? wrong : []).some(w => String(w).trim().toLowerCase() === g)) return 'wrong';
  const all = [answer, ...(Array.isArray(alts) ? alts : [])];
  return all.map(a => judgeOne(guess, a)).sort((x, y) => RANK.indexOf(x) - RANK.indexOf(y))[0];
}

function judgeOne(guess, answer) {
  const g = normalize(guess), a = normalize(answer);
  if (!g) return 'wrong';
  if (g === a) return 'exact';
  // "U.S.A" against "USA", "north east" against "northeast": spacing is not knowledge.
  if (g.replace(/ /g, '') === a.replace(/ /g, '')) return 'exact';
  const slack = Math.max(1, Math.floor(a.length / 8));
  if (levenshtein(g, a) <= slack) return 'close';
  // Answers often carry an explanation after the term: accept the term alone.
  const head = a.split(/\s+(?:is|are|means|the|a|an)\s+/)[0];
  if (head.length >= 4 && (g === head || levenshtein(g, head) <= Math.max(1, Math.floor(head.length / 8)))) return 'close';
  return 'wrong';
}

// ---- cloze ----
// Blank one content word out of an answer. Function words carry no recall value, so
// they are never the blank.
const STOP = new Set(('the and for that this with from they them then than there here when '
  + 'what which while your yours their about into over under more most some such only just '
  + 'both each other same very will would could should have been were are was its it is of '
  + 'to in on at by or as an a but not can may might must does did done also because').split(' '));

export function cloze(text, rnd = Math.random) {
  const parts = String(text).split(/(\s+)/);        // keeps the whitespace as elements
  // Blanking the only word leaves no sentence to reason from — that is just a normal card.
  if (parts.filter(p => p.trim()).length < 2) return null;
  // An author who bolded a term has already said which word matters — blank that one,
  // not whatever the heuristic below happens to like. Several bolds share the honour.
  const bold = [...String(text).matchAll(/\*\*([^*\n]{2,40})\*\*/g)];
  if (bold.length) {
    const pick = bold[Math.floor(rnd() * bold.length)];
    const answer = pick[1].replace(/[.,;:!?)']+$/, '');
    return { answer, masked: text.replace(pick[0], '_'.repeat(Math.min(10, answer.length))) };
  }
  const targets = parts
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => /^[^\W\d_]{4,}[.,;:!?)']*$/u.test(w) && !STOP.has(w.replace(/\W/g, '').toLowerCase()));
  if (!targets.length) return null;
  const pick = targets[Math.floor(rnd() * targets.length)];
  const bare = pick.w.replace(/[.,;:!?)']+$/, '');
  return {
    answer: bare,
    masked: parts.map((w, i) => i === pick.i ? '_'.repeat(Math.min(10, bare.length)) + pick.w.slice(bare.length) : w).join(''),
  };
}

// Wrong answers that are obviously the wrong *shape* — a sentence among one-word answers —
// give the game away. Prefer options of comparable length, fall back to anything.
// A card that authored its own options uses those instead.
export function distractors(card, cards, n = 3, rnd = Math.random) {
  if (card.options?.length) return shuffle(card.options, rnd).slice(0, n);
  const len = card.back.length;
  const pool = shuffle(cards.filter(c => c.back !== card.back), rnd);
  const near = [], far = [];
  for (const c of pool) {
    const l = c.back.length;
    (Math.max(l, len) <= Math.max(2 * Math.min(l, len), 12) ? near : far).push(c.back);
  }
  const seen = new Set([card.back]);
  const out = [];
  for (const back of [...near, ...far]) {
    if (seen.has(back)) continue;
    seen.add(back);
    out.push(back);
    if (out.length === n) break;
  }
  return out;
}

/**
 * The last seven days at a glance: how much, how well, how often, and which day was best.
 * Days with no reviews are counted as days, not skipped, so "5 of 7" means what it says.
 */
export function weekSummary(stats, now = Date.now()) {
  const days = stats.days || {}, hits = stats.hits || {};
  let reviews = 0, correct = 0, active = 0, best = { day: '', n: 0 };
  for (let i = 0; i < 7; i++) {
    const key = dayStr(now - i * DAY);
    const n = days[key] || 0;
    reviews += n;
    correct += hits[key] || 0;
    if (n) active++;
    if (n > best.n) best = { day: key, n };
  }
  return { reviews, correct, active, best, pct: reviews ? Math.round((100 * correct) / reviews) : 0 };
}

/**
 * A sitting drawn from several modules at once. Everything is fair game except parked
 * cards, and each card carries the module it came from so the result can be broken down.
 */
export function examSet(modules, srs, n = 25, rnd = Math.random) {
  const all = [];
  for (const m of modules) {
    for (const c of m.cards) {
      if (srs[cardKey(m.id, c)]?.susp) continue;
      all.push({ ...c, mid: m.id, from: m.title });
    }
  }
  return shuffle(all, rnd).slice(0, n);
}

/**
 * When this learner does best. Sittings carry the hour they happened, so grouping by part of
 * the day answers "am I wasting my evenings?" — with enough sittings to mean anything.
 */
export function bestTime(sessions = [], minimum = 6) {
  const parts = [
    { name: 'morning', from: 5, to: 12 },
    { name: 'afternoon', from: 12, to: 18 },
    { name: 'evening', from: 18, to: 23 },
    { name: 'late at night', from: 23, to: 5 },
  ].map(p => ({ ...p, right: 0, asked: 0 }));
  for (const s of sessions) {
    const h = new Date(s.t).getHours();
    const p = parts.find(x => (x.from < x.to ? h >= x.from && h < x.to : h >= x.from || h < x.to));
    if (!p) continue;
    p.right += s.r || 0;
    p.asked += (s.r || 0) + (s.w || 0);
  }
  const ranked = parts.filter(p => p.asked >= minimum)
    .map(p => ({ name: p.name, asked: p.asked, pct: Math.round((100 * p.right) / p.asked) }))
    .sort((a, b) => b.pct - a.pct);
  // One part of the day on its own says nothing to compare against.
  return ranked.length >= 2 ? { best: ranked[0], worst: ranked[ranked.length - 1] } : null;
}

/**
 * Seconds per card, from what this learner's sittings actually took. Wildly long gaps are a
 * phone left on the sofa rather than a hard card, and are thrown away; with no history at all
 * the fallback is a plain guess.
 */
export function pace(sessions = [], fallback = 6) {
  const rates = [];
  for (const s of sessions) {
    const asked = (s.r || 0) + (s.w || 0);
    if (!asked || !s.secs) continue;
    const each = s.secs / asked;
    if (each >= 1 && each <= 45) rates.push(each);
  }
  if (rates.length < 3) return fallback;
  rates.sort((a, b) => a - b);
  return Math.round(rates[Math.floor(rates.length / 2)] * 10) / 10;   // the median, to a tenth
}

/**
 * The seconds after which a *right* answer counts as laboured, for this learner. Fluency is
 * the goal: an answer dredged up in twenty seconds is one the schedule thinks is safe and
 * is not. Three times their own pace, kept within sane bounds.
 */
export function slowAfter(sessions) {
  return Math.min(30, Math.max(8, 3 * pace(sessions)));
}

/** "about 4 min" for a pile of n cards, at this learner's own pace. */
export function minutesFor(n, sessions) {
  return Math.max(1, Math.round((n * pace(sessions)) / 60));
}

/** Where an exam went, module by module, weakest first. */
export function examScore(cards, missed) {
  const by = new Map();
  for (const c of cards) {
    const name = c.from || '';
    by.set(name, { asked: (by.get(name)?.asked || 0) + 1, wrong: by.get(name)?.wrong || 0 });
  }
  const seen = new Set();
  for (const c of missed) {
    const k = cardKey(c.mid || '', c);
    if (seen.has(k)) continue;               // a card missed twice is still one card missed
    seen.add(k);
    const e = by.get(c.from || '');
    if (e) e.wrong++;
  }
  return [...by].map(([name, v]) => ({ name, ...v, pct: Math.round((100 * (v.asked - v.wrong)) / v.asked) }))
    .sort((a, b) => a.pct - b.pct || b.asked - a.asked);
}

/**
 * Cards that are probably badly written, with the reason. Generated modules are quick to
 * make and quick to be sloppy: a question that contains its own answer never gets tested,
 * two cards asking the same thing split one schedule, and a paragraph on the back is a note
 * pretending to be an answer. Heuristics, not judgements — the list is for a human to read.
 */
export function auditModule(cards) {
  const out = [];
  const seenFront = new Map(), seenBack = new Map();
  cards.forEach((c, i) => {
    const front = normalize(c.front), back = normalize(c.back);
    // Ten cards asking "What is this?" over ten pictures are ten questions, not one.
    const asks = ident(c);
    if (seenFront.has(asks)) {
      out.push({ i, kind: 'duplicate', why: `asks the same as card ${seenFront.get(asks) + 1}` });
    } else seenFront.set(asks, i);
    // Arithmetic shares answers honestly — 3×4 and 6×2 are both 12 and both worth knowing.
    const numeric = /^-?[\d.,\s]+$/.test(String(c.back).trim());
    if (back && !numeric && seenBack.has(back)) {
      out.push({ i, kind: 'same answer', why: `same answer as card ${seenBack.get(back) + 1}` });
    } else if (back && !numeric) seenBack.set(back, i);
    // The answer, or a distinctive word of it, sitting in the question.
    const words = back.split(' ').filter(w => w.length >= 5);
    const giveaway = (back.length >= 4 && front.includes(back))
      || words.some(w => front.includes(w));
    if (giveaway) out.push({ i, kind: 'gives itself away', why: 'the answer is in the question' });
    if (String(c.back).length > 120) {
      out.push({ i, kind: 'long answer', why: 'over 120 characters — the rest belongs in a note' });
    }
    if (!String(c.front).trim() || !String(c.back).trim()) {
      out.push({ i, kind: 'empty', why: 'one side is blank' });
    }
  });
  return out;
}

/**
 * The whole library as one markdown document: readable on its own, and written in the table
 * form this app's own importer reads, so it can go back into a conversation and come home.
 */
export function toMarkdown(modules) {
  // A pipe would end the cell and a newline would end the row, so neither survives.
  const cell = s => String(s || '').replace(/[|]/g, '/').replace(/\s*\n\s*/g, ' ').trim();
  const out = [];
  for (const m of modules) {
    out.push(`## ${m.title}`);
    if (m.description) out.push('', m.description);
    if (m.tags?.length) out.push('', `Tags: ${m.tags.join(', ')}`);
    out.push('', '| Question | Answer | Hint | Why |', '|---|---|---|---|');
    for (const c of m.cards) {
      out.push(`| ${cell(c.front)} | ${cell(c.back)} | ${cell(c.hint)} | ${cell(c.note)} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

/**
 * Questions that appear in more than one module. Ask Claude about a subject twice and you
 * get two modules that overlap; each copy then carries its own schedule, so the same fact
 * is drilled twice and neither copy's history is the whole story.
 */
export function duplicatesAcross(modules, limit = 20) {
  const byQuestion = new Map();
  for (const m of modules) {
    for (const c of m.cards) {
      const k = ident(c);
      const where = byQuestion.get(k) || [];
      if (!where.some(w => w.id === m.id)) where.push({ id: m.id, title: m.title, front: c.front });
      byQuestion.set(k, where);
    }
  }
  return [...byQuestion.values()].filter(w => w.length > 1).slice(0, limit);
}

/** Reviews falling due per day for the next `days`, bucket 0 being today. */
export function forecast(modules, srs, days = 7, now = Date.now()) {
  const buckets = Array(days).fill(0);
  for (const m of modules) {
    for (const c of m.cards) {
      const s = srs[cardKey(m.id, c)];
      if (!s || s.susp) continue;
      const d = Math.floor((s.due - now) / DAY);
      if (d >= 0 && d < days) buckets[d]++;
    }
  }
  return buckets;
}

/**
 * Two lists of confused pairs folded into one, counts summed, worst first. The same shape
 * merges a sitting's mix-ups into the record and two devices' records into each other.
 */
export function mergeConfusions(a = [], b = [], cap = 20) {
  const by = new Map();
  for (const x of [...a, ...b]) {
    if (!x?.a || !x?.b) continue;
    const k = x.a + '|' + x.b;
    const r = by.get(k) || { a: x.a, b: x.b, n: 0 };
    r.n += x.n || 1;
    by.set(k, r);
  }
  return [...by.values()].sort((p, q) => q.n - p.n).slice(0, cap);
}

/** Mastery rolled up by tag — the subject level, where "what should I study?" is asked. */
export function tagTotals(modules, srs, now = Date.now()) {
  const by = new Map();
  for (const m of modules) {
    const c = counts(m.cards, srs, m.id, now);
    for (const tag of m.tags || []) {
      const t = by.get(tag) || { tag, total: 0, learned: 0, due: 0 };
      t.total += c.total;
      t.learned += c.learned;
      t.due += c.due;
      by.set(tag, t);
    }
  }
  return [...by.values()].filter(t => t.total).sort((a, b) => b.total - a.total);
}

/** Cards the learner marked to come back to, across every module they can see. */
export function starred(modules, srs) {
  const out = [];
  for (const m of modules) {
    for (const card of m.cards) {
      if (srs[cardKey(m.id, card)]?.star) out.push({ ...card, mid: m.id, from: m.title });
    }
  }
  return out;
}

/**
 * The cards that keep going wrong, worst first. A recent miss says more than an old one,
 * so the last few grades count double against a card's lapse total.
 */
export function troubleSpots(modules, srs, limit = 20) {
  const out = [];
  for (const m of modules) {
    for (const card of m.cards) {
      const s = srs[cardKey(m.id, card)];
      if (!s || s.susp) continue;                     // a parked card is not a to-do
      const misses = [...(s.log || '').slice(-6)].filter(g => g === 'a').length;
      const lapses = s.lapses || 0;
      const score = lapses + 2 * misses;
      if (score >= 2) out.push({ card: { ...card, mid: m.id, from: m.title }, module: m, lapses, misses, score });
    }
  }
  return out.sort((a, b) => b.score - a.score || b.lapses - a.lapses).slice(0, limit);
}

// ---- free recall: how much of an answer a written attempt actually covered ----

// ponytail: the cloze stop list and a crude stemmer, not a language model. Both sides are
// stemmed the same way, so consistency matters more than linguistic correctness here.
// "forgetting" -> "forgett" -> "forget": the doubled consonant has to go too.
const stem = w => (w.length > 4 ? w.replace(/(ings|ing|ies|ed|es|s)$/, '').replace(/([^aeiou])\1$/, '$1') : w);
const words = t => String(t).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];

/** The words an answer is really made of — content words, deduped, in order. */
export function keyPoints(text, max = 12) {
  const out = [], seen = new Set();
  for (const w of words(text)) {
    const s = stem(w);
    if (w.length < 4 || STOP.has(w) || seen.has(s)) continue;
    seen.add(s);
    out.push(w);
    if (out.length === max) break;
  }
  return out;
}

/** Which of those an attempt mentioned. Guidance for self-grading, never a grade itself. */
export function coverage(answer, attempt) {
  const said = new Set(words(attempt).map(stem));
  const points = keyPoints(answer);
  const hit = points.filter(p => said.has(stem(p)));
  return { points, hit, pct: points.length ? Math.round((100 * hit.length) / points.length) : 0 };
}

/** Wrong-answer *cards*, for games whose options are pictures rather than words. */
export function decoys(card, cards, n = 3, rnd = Math.random) {
  const seen = new Set([card.back]);
  const out = [];
  for (const c of shuffle(cards, rnd)) {
    if (seen.has(c.back)) continue;
    seen.add(c.back);
    out.push(c);
    if (out.length === n) break;
  }
  return out;
}

// ---- spelling tiles ----

export const spellable = s => /^[^\W\d_]{3,12}$/u.test(String(s).trim());

/** The answer's letters plus a few decoys, shuffled. */
export function letterTiles(answer, rnd = Math.random, extras = 3) {
  const letters = [...String(answer).trim().toUpperCase()];
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const decoys = Array.from({ length: extras }, () => alphabet[Math.floor(rnd() * 26)]);
  return shuffle([...letters, ...decoys], rnd);
}

// ---- validation (trust boundary: pasted / fetched JSON ends up on screen) ----

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);

/**
 * A prompt that asks for more cards on a module's own subject. It carries the questions
 * already held so the reply does not repeat them — fronts only, since the answers are the
 * one part the model does not need to see to avoid duplicating a question.
 */
export function growPrompt(m, want = 20, maxListed = 200) {
  const listed = m.cards.slice(0, maxListed).map(c => '- ' + String(c.front).replace(/\s+/g, ' ').trim());
  const over = m.cards.length - listed.length;
  return `I am studying a flashcard module called "${m.title}"`
    + (m.description ? ` (${m.description})` : '') + ` and I want ${want} more cards for it.\n\n`
    + `Reply with ONLY a markdown table, no preamble:\n\n| Question | Answer |\n|---|---|\n\n`
    + `One idea per card, the question is a real question or cue, the answer is under about 20 words, `
    + `and no new card may be answerable from the wording of another. Same subject and same level as `
    + `the ${m.cards.length} questions I already have — do not repeat any of them:\n\n`
    + listed.join('\n') + (over > 0 ? `\n- …and ${over} more in the same vein` : '') + '\n';
}

/** What makes two cards the same question. The picture is part of the question. */
export const ident = c => String(c.front).toLowerCase().replace(/\s+/g, ' ').trim() + '\0' + (c.image || '');

/** Cards in a re-fetched module that are not already in the copy being held. */
export function newCards(have, fetched) {
  const known = new Set(have.map(ident));
  return fetched.filter(c => !known.has(ident(c)));
}

export function validateModule(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('module must be an object');
  const name = str(m.id, 64) || str(m.title, 64);
  if (!name) throw new Error('module needs an "id" or "title"');
  if (!Array.isArray(m.cards) || !m.cards.length) throw new Error(`${name}: needs a non-empty "cards" array`);
  if (m.cards.length > 2000) throw new Error(`${name}: too many cards (max 2000)`);
  const cards = m.cards.map((c, i) => {
    if (!c || typeof c !== 'object') throw new Error(`${name}: card ${i + 1} is not an object`);
    const front = str(c.front ?? c.q ?? c.question, 2000);
    const back = str(c.back ?? c.a ?? c.answer, 4000);
    if (!front || !back) throw new Error(`${name}: card ${i + 1} needs a front and a back`);
    const out = { front, back };
    if (str(c.id, 64)) out.id = str(c.id, 64);
    if (str(c.hint, 500)) out.hint = str(c.hint, 500);
    // The "why" behind the answer — shown after grading, never used to test.
    const note = str(c.note ?? c.why ?? c.explanation ?? c.extra, 2000);
    if (note) out.note = note;
    // A recording of the answer — a pronunciation is not something text can carry.
    const snd = str(c.audio ?? c.sound, 400000);
    if (/^(data:audio\/(webm|ogg|mpeg|mp4|wav);base64,|https?:\/\/)/i.test(snd)) out.audio = snd;
    // Where the card came from, so a fact can be traced back to its source. https only.
    const src = str(c.source ?? c.url ?? c.link, 500);
    if (/^https?:\/\//i.test(src)) out.source = src;
    // A picture on the front, for learners who cannot read the question yet. Only inline
    // data URIs and http(s) — never javascript: or anything else that could execute.
    const img = str(c.image ?? c.img ?? c.picture, 400000);
    if (/^(data:image\/(png|jpe?g|webp|gif|avif);base64,|https?:\/\/)/i.test(img)) out.image = img;
    // Other wordings this card will accept: "USA" as well as "the United States".
    const alts = (Array.isArray(c.alt ?? c.also ?? c.accept) ? (c.alt ?? c.also ?? c.accept) : [])
      .map(x => str(x, 200)).filter(x => x && x !== back).slice(0, 5);
    if (alts.length) out.alt = [...new Set(alts)];
    // Authored wrong answers beat generated ones: they can be plausible on purpose.
    const opts = (Array.isArray(c.options ?? c.choices) ? (c.options ?? c.choices) : [])
      .map(o => str(o, 200)).filter(o => o && o !== back).slice(0, 5);
    if (opts.length) out.options = [...new Set(opts)];
    return out;
  });
  // Two cards asking the same thing would share one schedule and confuse every count, so
  // the first wins. The picture is part of the question — ten "What is this?" cards with
  // ten different pictures are ten questions.
  const byQuestion = new Map();
  for (const c of cards) {
    if (!byQuestion.has(ident(c))) byQuestion.set(ident(c), c);
  }
  const unique = [...byQuestion.values()];

  const tags = (Array.isArray(m.tags) ? m.tags : []).slice(0, 12).map(t => str(t, 32)).filter(Boolean);
  return {
    id: slug(name),
    title: str(m.title, 120) || name,
    description: str(m.description, 500),
    tags,
    icon: [...str(m.icon, 8)].slice(0, 2).join('') || iconFor(name, tags),
    // A language tag ("fr", "de-AT") makes the speech engine pronounce the cards as that
    // language instead of mangling them in the device's own.
    ...(/^[a-z]{2,3}(-[A-Za-z]{2,8})?$/.test(str(m.lang, 12)) ? { lang: str(m.lang, 12) } : {}),
    // Where this came from, so it can be fetched again later. http(s) only — the app hands
    // it straight to fetch() and shows the host on the module screen.
    ...(/^https?:\/\//i.test(str(m.src, 500)) ? { src: str(m.src, 500) } : {}),
    cards: unique,
  };
}

// A module needs a face a four-year-old can aim at. Explicit `icon` wins; otherwise a
// tag we recognise; otherwise a stable pick from the title.
const TAG_ICONS = {
  maths: '➗', math: '➗', numbers: '🔢', space: '🪐', science: '🔬', biology: '🧬',
  chemistry: '⚗️', physics: '⚛️', history: '🏛️', geography: '🗺️', language: '💬',
  words: '🔤', spelling: '🔤', music: '🎵', art: '🎨', code: '⌨️', programming: '⌨️',
  logic: '🧩', reasoning: '🧩', animals: '🦊', food: '🍎', body: '🫀', kids: '🧸',
};
const FALLBACK_ICONS = ['◈', '◉', '⬡', '✦', '❖', '⬟', '◐', '✧'];

function iconFor(title, tags = []) {
  for (const t of tags) {
    const hit = TAG_ICONS[String(t).toLowerCase()];
    if (hit) return hit;
  }
  return FALLBACK_ICONS[parseInt(hash(title), 36) % FALLBACK_ICONS.length];
}

// ---- import parsing ----
// Claude answers in whatever shape the conversation was in: a JSON block, a markdown
// table, Q:/A: lines, a bullet glossary. Accept all of them so a module is one paste.

const stripFences = t => {
  const m = t.match(/```[a-z]*\n([\s\S]*?)```/i);
  return m ? m[1].trim() : t;
};

const clean = s => String(s || '')
  .replace(/^\s*\|\s*|\s*\|\s*$/g, '')           // stray table pipes on a lone row
  .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '')     // list bullets
  .replace(/^\s*[#>]+\s*/, '')                   // headings, quotes
  .replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2')   // bold
  .replace(/^\s*(?:\*\*|__)\s*|\s*(?:\*\*|__)\s*$/g, '')   // a marker left orphaned by a split
  .replace(/^`(.+)`$/, '$1')
  .trim();

const isSeparatorRow = cells => cells.length >= 2 && cells.every(c => /^:?-{2,}:?$/.test(c) || !c);

function parseTable(t) {
  const rows = t.split('\n').map(l => l.trim()).filter(l => l.startsWith('|'));
  if (rows.length < 2) return null;
  const cells = rows.map(r => r.replace(/^\||\|$/g, '').split('|').map(c => clean(c)));
  // A `|---|---|` row is markdown saying "the row above was the header" — that beats guessing
  // from the wording, which turned `| Country | Capital |` into a card.
  const headed = cells.length > 1 && isSeparatorRow(cells[1]);
  const body = cells.filter(r => r.length >= 2 && !isSeparatorRow(r));
  if (!body.length) return null;
  const start = headed || /front|question|term|prompt|word|concept/i.test(body[0][0]) ? 1 : 0;
  // A third column is a hint and a fourth is the why — which is what the library exports,
  // so a table written out here reads back in with everything it left with.
  return body.slice(start)
    .map(r => ({ front: r[0], back: r[1], hint: r[2], note: r[3] }))
    .filter(c => c.front && c.back);
}

function parseQA(t) {
  const lines = t.split('\n');
  const cards = [];
  let cur = null;
  // Claude writes `Q:`, `**Q:**` and `**Q**:` about equally often — take all of them.
  // A single colon, a dot or a bracket marks a Q/A line. `::` does not: "front :: back"
  // is a term and its definition, and the word before it is a card, not a label.
  const head = /^\s*(?:\*\*|__)?(q|question|front|a|answer|back)(?:\*\*|__)?\s*(?::(?!:)|[.\)])\s*(?:\*\*|__)?\s*/i;
  let open = false;   // are we still inside the answer we last saw?
  for (const line of lines) {
    const m = line.match(head);
    if (m) {
      const isQ = /^[qfQF]/.test(m[1]);
      if (isQ) { if (cur?.front && cur?.back) cards.push(cur); cur = { front: clean(line.slice(m[0].length)), back: '' }; }
      else if (cur) cur.back = clean(line.slice(m[0].length));
      open = true;
    } else if (!line.trim()) {
      // A blank line ends the answer. Without this, Claude's closing "let me know if…"
      // gets glued onto the last card.
      open = false;
    } else if (cur && open) {
      cur[cur.back ? 'back' : 'front'] += ' ' + clean(line);
    }
  }
  if (cur?.front && cur?.back) cards.push(cur);
  return cards.length ? cards : null;
}

// ponytail: quoted fields are honoured on one line ("Paris, France",capital) — a newline inside
// quotes still splits the card. Card decks almost never have those; revisit if one does.
const DELIMS = ['::', '\t', ' — ', ' – ', ' | ', ' -- ', ': ', ' - ', ','];

// One line into fields, the spreadsheet way: quotes hide the delimiter, "" is a quote.
function splitFields(line, d) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch !== '"') cur += ch;
      else if (line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = false;
    } else if (ch === '"' && !cur) quoted = true;
    else if (line.startsWith(d, i)) { out.push(cur); cur = ''; i += d.length - 1; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseDelimited(t) {
  const lines = t.split('\n').map(l => l.trim()).filter(l => l && !/^[-=_*]{3,}$/.test(l));
  if (!lines.length) return null;
  let best = null;
  for (const d of DELIMS) { // earlier delimiters are the more deliberate ones: first match wins
    const hits = lines.filter(l => {
      const i = l.indexOf(d);
      return i > 0 && l.slice(i + d.length).trim();
    });
    if (hits.length / lines.length >= 0.6) { best = { d, hits }; break; }
  }
  if (!best) return null;
  return best.hits.map(l => {
    // Tabs are a real column separator (Anki exports, spreadsheets, our own TSV export),
    // so a third and fourth column are the hint and note. Prose delimiters split once.
    // A comma line only gets the column treatment when it is visibly a CSV row (it carries
    // quotes); plain prose with commas keeps splitting once, so "a fruit, red" stays whole.
    if (best.d === '\t' || (best.d === ',' && l.includes('"'))) {
      const [front, back, hint, note] = splitFields(l, best.d).map(clean);
      return { front, back, hint: hint || undefined, note: note || undefined };
    }
    const i = l.indexOf(best.d);
    return { front: clean(l.slice(0, i)), back: clean(l.slice(i + best.d.length)) };
    // "Q: something" is a marker with no answer, not a term and its definition. A bare "a"
    // is only a marker after a colon — with `::` or a dash it is a legitimate term.
  }).filter(c => c.front && c.back
    // "Question | Answer" and "front :: back" are headers, and both sides say so. A card
    // whose front happens to be the word "Front" with a real answer behind it is a card.
    && !(/^(question|answer|front|back)$/i.test(c.front) && /^(question|answer|front|back)$/i.test(c.back))
    && !(best.d === ': ' && /^[qa]$/i.test(c.front)));
}

// Two lines per card, blank line between — the shape a plain list of prompts takes.
function parsePairs(t) {
  const blocks = t.split(/\n\s*\n/).map(b => b.split('\n').map(clean).filter(Boolean));
  const pairs = blocks.filter(b => b.length === 2);
  if (pairs.length < 2 || pairs.length < blocks.length * 0.6) return null;
  return pairs.map(([front, back]) => ({ front, back }));
}

/** `## Heading` sections, with the prose under each kept as its description. */
function splitSections(t) {
  const lines = t.split('\n');
  const out = [];
  for (const line of lines) {
    const h = line.match(/^#{2,3}\s+(.+?)\s*#*$/);
    if (h) out.push({ title: clean(h[1]), body: [], description: '' });
    else if (out.length) out[out.length - 1].body.push(line);
  }
  return out.map(s => {
    const body = s.body.join('\n');
    // The first ordinary line under a heading, before any card, reads as a description.
    const lead = s.body.find(l => l.trim() && !/^[|>#*-]|^Tags:/.test(l.trim()));
    return { title: s.title, body, description: clean(lead || '').slice(0, 200) };
  });
}

/** Text of almost any shape in, array of modules out. Throws with a readable reason. */
export function parseImport(text, fallbackTitle = '') {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Nothing to import.');
  const t = stripFences(raw);
  try {
    const j = JSON.parse(t);
    const list = Array.isArray(j) ? j : [j];
    if (list.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
      // A bare array of cards is also fair game.
      if (Array.isArray(j) && j.every(x => x.front || x.q || x.question)) {
        return [validateModule({ title: fallbackTitle || 'Pasted ' + hash(t).slice(0, 4), cards: j })];
      }
      return list.map(validateModule);
    }
  } catch (e) {
    if (/^[[{]/.test(t)) throw new Error('That looks like JSON but is malformed: ' + e.message);
  }
  // A document with several `## headings`, each with cards under it, is several modules —
  // which is how a long answer covering four topics arrives, and how this app writes its
  // own library out.
  const sections = splitSections(t);
  if (sections.length > 1) {
    const built = sections
      .map(sec => {
        const found = parseTable(sec.body) || parseQA(sec.body) || parsePairs(sec.body) || parseDelimited(sec.body);
        return found && found.length
          ? validateModule({ title: sec.title, description: sec.description, cards: found })
          : null;
      })
      .filter(Boolean);
    if (built.length > 1) return built;
  }
  // Headings name the module; they are never cards. Left in, a heading and the line under it
  // look exactly like a two-line pair to the glossary parser.
  const body = t.replace(/^#{1,6}\s+.*$/gm, '').trim();
  const cards = parseTable(body) || parseQA(body) || parsePairs(body) || parseDelimited(body);
  if (!cards || cards.length < 1) {
    throw new Error('No cards found. Use JSON, a markdown table, Q:/A: lines, or "front :: back" per line.');
  }
  const heading = t.match(/^#{1,3}\s+(.+)$/m)?.[1];
  return [validateModule({
    title: clean(heading) || fallbackTitle || 'Pasted ' + hash(t).slice(0, 4),
    description: `Imported from pasted text · ${cards.length} cards`,
    cards,
  })];
}

// ---- sync merge ----

function mergeStats(a = {}, b = {}) {
  const newer = (b.lastDay || '') > (a.lastDay || '') ? b : a;
  const days = Object.assign({}, a.days);
  for (const [d, n] of Object.entries(b.days || {})) days[d] = Math.max(days[d] || 0, n);
  const hits = Object.assign({}, a.hits);
  for (const [d, n] of Object.entries(b.hits || {})) hits[d] = Math.max(hits[d] || 0, n);
  // Sittings are appended on whichever device did them, so a merge is a union: same stamp
  // means the same sitting, and only the most recent fifty are worth keeping.
  const seen = new Map();
  for (const x of [...(a.sessions || []), ...(b.sessions || [])]) seen.set(x.t, x);
  const sessions = [...seen.values()].sort((x, y) => y.t - x.t).slice(0, 50);
  return {
    // Anything either side carries survives the merge — a field added later must not be
    // quietly dropped the first time two devices meet.
    ...a,
    ...b,
    reviews: Math.max(a.reviews || 0, b.reviews || 0),
    correct: Math.max(a.correct || 0, b.correct || 0),
    streak: Math.max(a.streak || 0, b.streak || 0),
    bestStreak: Math.max(a.bestStreak || 0, b.bestStreak || 0, a.streak || 0, b.streak || 0),
    stars: Math.max(a.stars || 0, b.stars || 0),
    lastDay: newer.lastDay || '',
    rested: ((b.rested || '') > (a.rested || '') ? b.rested : a.rested) || '',
    rank: newer.rank || a.rank || b.rank || '',
    days,
    hits,
    ...(sessions.length ? { sessions } : {}),
    ...((a.confusions?.length || b.confusions?.length)
      ? { confusions: mergeConfusions(a.confusions, b.confusions) } : {}),
  };
}

// ponytail: last-write-wins per card, per module. Two devices reviewing the same
// card in the same minute lose one review — acceptable; real conflict resolution
// only if that ever actually bites.
export function mergeState(local, remote) {
  const out = {
    active: local.active || remote.active,
    settings: Object.assign({}, remote.settings, local.settings),
    profiles: {},
    custom: [],
  };
  const names = new Set([...Object.keys(local.profiles || {}), ...Object.keys(remote.profiles || {})]);
  for (const n of names) {
    const a = (local.profiles || {})[n] || {};
    const b = (remote.profiles || {})[n] || {};
    const srs = Object.assign({}, a.srs);
    for (const [k, v] of Object.entries(b.srs || {})) {
      if (!srs[k] || (v.t || 0) > (srs[k].t || 0)) srs[k] = v;
    }
    // Settings belong to the learner, not to the device syncing: whichever device changed
    // them last wins, and anything it never set is filled in from the other. Without the
    // stamp a device that has only ever filled in defaults would overwrite real choices.
    const newer = ((b.opts || {}).t || 0) > ((a.opts || {}).t || 0) ? b.opts : a.opts;
    const older = newer === a.opts ? b.opts : a.opts;
    out.profiles[n] = { srs, stats: mergeStats(a.stats, b.stats), opts: Object.assign({}, older, newer) };
  }
  const byId = new Map();
  for (const m of [...(remote.custom || []), ...(local.custom || [])]) {
    const prev = byId.get(m.id);
    if (!prev || (m.savedAt || 0) >= (prev.savedAt || 0)) byId.set(m.id, m);
  }
  out.custom = [...byId.values()];
  return out;
}
