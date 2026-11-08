# Learning Pit

Flashcards and learning games with spaced repetition. Static files, no build, no backend.
Sync is Google Drive's private app folder, so there is nothing to host but this directory.

**Live at [adervec.github.io/learning-pit](https://adervec.github.io/learning-pit/)** — open it
on any phone, tablet or desktop and install it from the browser menu (or the *install on this
device* link on the shelf).

## Run it

```sh
python -m http.server 8000      # or: npx serve
```

Open `http://localhost:8000`. `file://` mostly works too, but `modules/index.json` won't
load and there's no service worker — import modules by hand instead.

Deploy = copy the directory anywhere static (GitHub Pages, Netlify, a Raspberry Pi).
This repository *is* the live site: GitHub Pages serves the `main` branch directly
(Settings → Pages → Deploy from a branch), so pushing to `main` is deploying. Run the two
checks below before you push — nothing runs them for you.

On a tablet: open the URL in Chrome/Safari → *Add to Home Screen*. It then runs offline, keeps
its own icon, and appears in the Android share sheet. (Offline is not a hope: with the server
stopped, the app still boots from cache with every module and records a full session.)

Two checks, both cheap to run:

- `node core.test.js` — scheduling, import parsing, answer judging, streaks, merge.
- `/selftest.html` in the browser — around four hundred assertions driving the real app: sessions, undo,
  import, search, exam mode, resume, editing, kid mode, visibility, spelling, pictures,
  deadlines, stickers, duelling, splitting and merging, and a full Match board. It snapshots
  your own data and puts it back at the end.

## What's in the box

Twenty-three modules ship with it, chosen to exercise every game — including **Using the Pit** (the
app taught the way the app teaches everything else) and **Premiers Mots** (twenty first words
of French, read aloud by an actual French voice via the module's `lang` tag) with **Petites
Phrases** (sixteen small sentences you can actually say) beside it. For the youngest: **Letters & Numbers** (every letter and digit, traced on the slate), **Colours** (a
patch of colour, tap the one that is named), **Shapes**, **Picture Words** (sixteen drawings and
a word to spell), **Counting** (how many shapes, tapped in on the number pad), **Division** (the times tables asked backwards), **Telling the Time** (a drawn clock face, read aloud — hours, halves and quarters), **Days & Months** (what comes next), **Animal Sounds** (which animal says moo?), **Opposites** and
**First Words**. Then
**Times Tables**, **Commonly Confused Words** (word pairs that blur together, asked in the sentences that settle them — bait for the mix-up tracker), **Flags**, **World Capitals**, **The Solar System**, **Logical Fallacies**,
**Cognitive Biases**, **How Language Models Work**, and **Learning Science** — the rules this
app is built on, with the *why* on the back of each card.

The drawn ones are generated, not downloaded: `python tools/make-picture-module.py` redraws
both from stdlib alone, on a transparent ground so they suit either theme.

## Getting knowledge in

A paste with several `## headings`, each with cards under it, becomes several modules at once —
so one long answer covering four topics arrives as four.

Paste this at the end of any Claude conversation you want to keep (the import screen has
a **Copy the prompt** button that puts it on your clipboard):

> Turn what we just covered into a Learning Pit module. Reply with **only** a JSON code block:
> `{"id":"kebab-case-id","title":"…","icon":"one emoji","description":"…","tags":["…"],`
> `"cards":[{"front":"question or cue","back":"answer","hint":"optional nudge",`
> `"note":"optional why, shown after answering","options":["optional plausible wrong answers"]}]}`
> Rules: one idea per card, front is a question or a cue (never "explain X" essays),
> back is under ~20 words, 15–40 cards, no card answerable from the wording of another.

For a module you actually care about, paste **[PROMPT.md](PROMPT.md)** instead — a full
authoring brief with the rules that separate a card worth reviewing from a card that just
looks like one, plus good/bad examples.

Variations worth keeping to hand:

- **Sharpen what I got wrong.** *"Here are the cards I keep failing: … Rewrite each one so it
  asks a single thing, and split any that ask two."*
- **Multiple choice with real traps.** *"…and give each card three `options` that are the
  mistakes someone actually makes, not obviously wrong filler."*
- **For a child.** *"Make it for a seven-year-old: one-word answers, no jargon, `icon` an emoji,
  and a `hint` that nudges without giving it away."*
- **From a document.** *"Read this page and turn only the load-bearing facts into a module —
  skip anything I could look up in a second."*

The importer takes more than that JSON, because Claude answers in whatever shape the
conversation was in. All of these work, pasted raw, with or without surrounding chatter
and code fences:

| Shape | Example |
|---|---|
| Module JSON | `{"title":"…","cards":[{"front":"…","back":"…"}]}` |
| Bare card array | `[{"q":"…","a":"…"}]` |
| Markdown table | `\| Term \| Definition \|` with a header row |
| Q/A lines | `Q:`, `**Q:**`, `**Q**:`, `Question:` — answers may wrap over lines |
| Bullet glossary | `- **Idempotent**: same result when applied twice`, nested lists too |
| Numbered list | `1. **Mitosis** — division into two identical cells` |
| Delimited | `front :: back`, also tab, `—`, `\|`, `:`, `-` |
| Two-line blocks | question line, answer line, blank line between |
| Anki cloze | `The capital of France is {{c1::Paris}}` — one card per gap, `{{c1::Paris::city}}` carries a hint, a tab-separated extra column becomes the note |

Greetings above the cards and "let me know if you'd like more" below them are dropped, and a
blank line ends an answer — so a whole reply can go in as-is.

**Ask Claude for more** on any module copies a prompt built from that module — its title, its
subject and every question it already asks — so the reply comes back on-topic and without
repeats. Paste the reply into Import and choose *add only its new cards to a module you already
have*: the module grows and nothing you have studied is disturbed.

**Linked modules** remember the URL they were fetched from, and the module screen then offers
*Check ‹host› for new cards*: it refetches, shows what is new, and appends only what you do not
already have.

Every import shows a preview, with **a tick box on every card** — untick the ones that missed
and only the rest are added. Re-importing an updated module keeps the review history of every
card whose question is unchanged, and the preview says how many that is before you commit.
Other ways in:

- **Paste from clipboard** in one tap, or **drop a file** anywhere on the import screen
  (`.json`, `.md`, `.txt`, `.csv` — an Anki tab-separated export works too). Spreadsheet
  quoting is honoured: `"Paris, France",capital` keeps its comma, and `""` is a literal quote.
- **Fetch a URL** that serves module JSON — or just paste the URL into the big paste box;
  it is fetched rather than parsed.
- **Open with it**: once installed, module files (`.json`, `.md`, `.txt`, `.csv`) can be opened
  with Learning Pit from the file manager — they land on the import preview.
- **Share to it**: once installed on Android, Learning Pit appears in the system share sheet,
  so sharing Claude's answer from any app lands on the import preview.
- **Write one** from the home screen and type cards in.
- **Ship it with the app** — drop a file in `modules/` and list it in `modules/index.json`.

A module can carry a **`lang`** tag (`"fr"`, `"de-AT"`): cards are then read aloud as that
language, with a matching voice picked automatically — the difference between hearing *le chat*
and hearing an English robot guess at it. A module can carry an `icon` (one or two emoji). Without one it takes an icon from its tags,
so every module has a face a pre-reader can aim at.

A card can carry a **sound** (`audio`) as well — record it straight into the card in the editor
(ten seconds, stored inline). Where a card has one, the 🔊 button plays the recording instead of
the synthesised voice, which is the difference between hearing a pronunciation and hearing a
robot spell it.

A card can carry a **picture** (`image`): an inline `data:` URI or an `https:` URL, shown with
the question. In the editor, *Add a picture* takes a photo or a file and shrinks it to 480px
locally before storing — a 3 MB phone photo lands at around 30 KB. Nothing is uploaded. *Find
one* searches Wikimedia Commons for the word, offers six, and keeps the file's page as the
card's source — finding pictures was the slow part of making a picture module. Pictures and
recordings live in IndexedDB rather than beside the progress in localStorage, so a picture-heavy
library no longer runs into the browser's five-megabyte wall; backups, shares and sync carry them
inline as before. Picture
plus *Spell it* is the combination that lets a child who cannot read yet use the app on their
own. `tools/make-picture-module.py` draws the bundled set with nothing but Python's stdlib.

## Studying

Nineteen exercises, all fed by the same scheduler. **▶ Just start** at the top of every module
picks one the module can actually support — weighted towards drills, never the same one twice
running, and never one that kid mode hides — so studying is one tap rather than a menu.

*Drills — the ones that carry the learning:*

| | |
|---|---|
| **Recall** | flip the card, rate yourself Again / Good / Easy — each button says what it would do (*1 day*, *3 days*), and a card with no hint of its own offers the shape of its answer, *P _ _ _ _*, on request |
| **Ladder** | each card asked the way it has earned: new ones recognised among options, young ones with a blank in the answer, mature ones typed or recalled from nothing. A miss drops a card back to the first rung. **Review N due** is this |
| **Study first** | six cards shown with their answers and notes, then asked back in a different order — the read-through and the drill in one sitting |
| **Identify** | multiple choice, distractors drawn from the module and length-matched |
| **Explain it** | free recall in writing; it marks which of the answer's key words you actually said and leaves the grade to you |
| **Write it** | type the answer; typos, case, accents and articles are forgiven — but never a wrong answer the author listed in `options`, so *effect* typed for *affect* fails even at one letter's distance. A miss is shown letter by letter: what you typed with the stray letters struck out, the answer with the ones you missed marked |
| **Fill the blank** | one word removed from the answer — the **bolded** term if the author marked one, otherwise a content word, never a function word |
| **Hands free** | it asks aloud, you answer out loud — no reading, no typing |
| **Say it** | for a module with a `lang`: hear the answer said properly, then say it yourself, and see which words came out. Recognition runs in that language |

*Games — the same scheduler, more play:*

| | |
|---|---|
| **Duel** | everyone on the device (up to four) takes turns, each answer scored to whoever gave it, ending on a table of who got what |
| **Sort** | which of two modules does this card belong to? |
| **True or false** | a question paired with an answer that is right half the time and borrowed from another card the rest; the real answer is always shown afterwards |
| **Point at it** | hear the word, tap the right picture — the one game a child who cannot read yet can play alone |
| **Number pad** | tap a numeric answer in on big keys, no keyboard covering half a tablet |
| **Write it out** | a slate: write the answer with a finger, reveal it in faint outline to trace, then say whether you had it. Nothing here recognises handwriting — the eye that matters is already in the room |
| **Spell it** | build a one-word answer from letter tiles |
| **Order it** | an answer that is a sequence — *Mercury → Venus → Earth*, *mix; knead; prove; bake* — dealt as steps to tap into order. Commas count when the question asks for an order |
| **Speed round** | one minute of multiple choice, auto-advancing |
| **Match** | pair six prompts with their answers, no timer |

An exercise a module can't support simply isn't offered, and the module screen names the ones
it left out — *Fill the blank* needs multi-word answers, *Point at it* needs four pictures,
*Number pad* needs numeric answers, *Explain it* needs answers with something in them, *Match*
needs six cards, *Duel* needs two learners, *Sort* needs a second module to confuse it with,
*Order it* needs sequence answers and *Say it* needs a module with a language.
Sessions are sampled from the cards each exercise can actually use.

*Hands free* and the 🎤 button in the typed games use the browser's speech recognition, so they
appear only where it exists (Chrome). Chrome sends that audio to Google's speech service — the
mic button and starting *Hands free* are the consent points, and both games have manual
buttons so a misheard answer is one tap to correct.

A card can carry its own **wrong answers** (`options`), which multiple choice and the speed round
use instead of picking other cards' answers — Claude writes better distractors than a heuristic
can. It can also carry **Also accept**: other wordings that count as right, *USA* and *US* for
*the United States*. Spacing and punctuation never count either way — *U.S.A* and *USA* are the
same answer.

### Sittings that aren't one module

- A module screen shows how it has actually gone — *73% you get right* — once there are ten
  answers behind it, and how long a sitting on it will take.
- **Review N due** on the home screen mixes everything due across every module as a **Ladder**
  sitting, so each card is asked the way it has earned; each card's progress still lands back in
  its own module. It says how many it will ask now and roughly how
  long that takes — measured from your own last few sittings, not guessed — because a pile of
  forty is only frightening until you know it is four minutes of it. With nothing due it offers
  new cards instead.
- **Spread it over the week** appears under the due button when the pile passes twice your
  daily goal — the returned-from-holiday case. One tap deals the overdue cards out evenly
  across the next seven days, oldest debts first, today keeping a day-sized share; an Undo
  puts every one of them back. Parked cards and cards never seen stay where they are.
- **Re-pasting an updated module shows a real diff** before you commit: how many cards keep
  their history, which ones are **new** (badged in the list), and how many old cards are not
  in the paste and will go. Iterating on a Claude-generated module stops being a leap of faith.
- **Mix with…** on a module shuffles half a sitting of it with half a sitting of another —
  interleaving, which the Learning Science module itself says is harder in the moment and
  better remembered afterwards.
- **★ starred (n)** drills the cards you marked, across every module at once.
- **Sticking points** (progress screen) ranks the cards that keep going wrong — recent misses
  count double against an old lapse count — and drills them in one mixed session.
- **◷ Mock exam** draws 10, 25 or 50 cards from the whole library or from one tag, asks each
  exactly once, and reports the score broken down by module, weakest first, with a button to
  drill what you missed. Like a module's own **◷ Exam**, it touches neither the schedule, the
  streak nor the stars — for checking, not for practice.
- **⏰ Daily reminder** (Settings) writes a repeating event to an `.ics` file — a static app
  has no push server, so the calendar the device already checks does the nagging, with the
  app's address on the event.
- **Rough spots** on the module screen names the cards this learner keeps missing — lapse
  count and recent misses, straight from the schedule — with a one-tap drill of just those.
- **⇄** on a module asks answer → question instead. Both directions share one schedule, so
  reversing doesn't double the workload.

### While a card is on screen

- **Undo last answer** puts the grade and the day's count back.
- **★ star it** (or the `s` key) is the one thing the scheduler cannot work out for itself:
  *come back to this, whatever the algorithm thinks*.
- **⏻ park it** takes a card out of rotation for good, until the editor lets it back in.
- **⏾ not today** puts a card off until tomorrow, ungraded — the one between skip and park.
- **✎ fix this card** opens the editor on that very card and drops you back into the same
  sitting when you're done.
- Results end with **Again** and **Another way** — the same module rolled into a different
  exercise, repetition without the monotony.
- **✔ end here** appears once anything has been answered: the sitting is scored and logged as
  it stands, and the unasked cards simply wait their turn. Stopping is not abandoning.
- The typed exercises have a **skip** for a card you'd rather not guess at; it comes back
  later in the session, ungraded.
- On a phone, **swipe** a revealed card left for Again or right for Good.
- **Resume** picks up an interrupted session for six hours.

### What the scheduler is doing

Scheduling is SM-2 with three grades: 1 day → 3 days → interval × ease. A miss brings the card
back inside the same session, and so does a brand-new card you got right — seeing something
once is presentation, not learning. Long intervals carry a few per cent of jitter, so forty
cards learned on the same evening do not all come back on the same evening for the rest of the
year.

- A card missed **eight** times parks itself and says so: at that point the card is wrong, not
  the learner. Rewrite it and resume it from the editor, which gives it a clean slate.
- A **daily goal** (Settings, default 20) drives the bar under the home heading and rings a
  small fanfare when it's met.
- The progress screen keeps your **longest streak ever** once it beats the current one —
  a broken streak leaves a high-water mark instead of nothing.
- **Rest days**: missing a single day does not break a streak — once a week, the pit forgives
  it and says so. Miss two, or miss again inside the same week, and the count starts over. A
  streak is there to reward the habit, not to punish a busy Tuesday. If you have one and have
  not studied today, the home screen says so.
- **📅 Set a deadline** on a module — "learn it all by the 24th". The date shows on the
  module's shelf tile too. The module screen then says
  how many a day that takes, sessions grow to hit that pace instead of the usual five new
  cards, and the home screen leads with the nearest deadline ahead of the ordinary due pile.
  In the last three days "due" comes to mean "due before the exam": a card the schedule had
  pushed past the date, which you would otherwise never see again before it, is asked once
  more. Deadlines are per learner, so two kids can have different exams on the same tablet.

## Progress

The streak chip opens it. **Rank** is the pit's own ladder — Initiate, Cadet, Adept, Scholar,
Archivist, Keeper of the Pit — and it moves only on cards actually learned, never on time spent
or answers ground out; a promotion is announced once.

- **This week**: reviews, accuracy, how many of the seven days had anything in them, the best
  one — and *share it* hands the sentence to the system share sheet or the clipboard.
- **When you are sharp**: once there are enough sittings to compare, which part of the day you
  actually answer best in, and which one you are wasting. The daily reminder defaults to it.
- **Last twelve months**: once a month of days is in, the long view — reviews, days, accuracy,
  busiest month.
- A 17-week **activity heatmap**, the **next week's load** with a one-line 30-day outlook —
  *Next 30 days: 220 reviews, heaviest on Sep 2* — and **mastery** per module.
- **Recent sittings**: the last eight — module, exercise, how long ago, and the score, green
  when it was clean. The heatmap says how much you studied; this says what. Exams are measured
  but never recorded as study.
- **Sticking points**: the cards that keep going wrong, to drill, rewrite or pause on the spot.

**Ask a tutor** (bottom of the progress screen) hands the whole picture to an agent through a
folder on the device — the maker's cowork panel writes `coach/request.json` into a folder you
pick, and shows whatever the agent writes back to `coach/reply.json`. The request is built to be
read whole by a coach, a daily brief or a weekly brief: the learner and the day, streak and
lifetime figures, the week and the year, thirty-five days of counts, the due pile and its
thirty-day forecast, every module with its accuracy, last sitting and deadline plan, the last
fifty sittings with their times, sticking points, mix-ups, starred and parked cards, and the
family board. Once a folder is connected the file is rewritten after every finished sitting and
on every visit to the progress screen, so it is never yesterday's. Nothing is uploaded; the
folder is on this device.

When every card in a module is resting, the module screen offers a **🎓 certificate** — the
learner's name, the module, the date and their rank, laid out to print and put on the fridge.
Sessions earn **stars** (three for a clean sweep), stars unlock **stickers**, and the kid
progress screen shows the shelf: earned ones in colour, the next one dim with its price on it.
It is the smallest honest reward loop that still makes a six-year-old come back tomorrow.

## Several learners, one tablet

**First run** asks one question — is this for you or for a child. A child gets their own learner
with kid mode, reading aloud, a six-card sitting, a ten-card daily goal, and a library narrowed
to the modules tagged *kids*; the unused starter profile is quietly retired so the pit is simply
theirs. Nobody has to find any of that in a settings screen before handing
the tablet over; everything hidden is one tick away afterwards.

Settings → **Who is learning** holds a profile per kid, each with their own scheduling, streak,
stars and switches. Each one picks an animal, and can be renamed without losing a day of history:

- In kid mode the home screen leads with one giant **▶ Play**: it picks whichever module has
  the most waiting and starts an exercise that suits it — never Duel, which needs a second
  human in the room, and never anything with typing.
- **Kid mode** — two big buttons instead of three, stars instead of percentages, a simplified
  progress screen, bigger module icons, only the exercises that don't need typing, and no
  *quick card* or *mock exam* cluttering the home screen. Settings itself gets a latch: a
  multiplication a small child cannot do. It is a child-proof catch, not a password — it exists
  so a tablet handed over for ten minutes comes back with its library intact.
- An **animal** and a **colour** of their own — the accent recolours the whole interface, so
  whose turn it is is obvious from across the room.
- **Which modules they can see** — hide the ones meant for someone else, per learner.

No kid needs a Google account: profiles all ride along on the one signed-in adult account.
With more than one profile, the progress screen shows a **This week** board — cousins keep
score whether you build it or not.

## Making it yours

Every one of these is per learner, so one tablet can suit a four-year-old and an adult.

- **Look** — follow the device, always dark, always light, or high contrast (black, white, hard
  edges). The whole interface is built from
  a handful of colour tokens, so each is a palette swap rather than a second stylesheet, and
  the bundled pictures are drawn on a transparent ground so they sit on any of them.
- **Text size** — small to very large, the same layouts just bigger, with no horizontal
  scrolling at any size.
- **Read cards aloud** with a **voice** picked from whatever the device has installed (*Try it*
  speaks a sample), at a **reading speed** of slow, normal or quick.
- **Sound effects**, **cards per session** (6–40), **daily goal**.
- **Keyboard**: space or enter reveals and grades, 1/2/3 are Again/Good/Easy, 1–4 pick an option
  or a picture, 1–8 place the next step in *Order it*, digits and enter drive the number pad,
  ctrl/⌘+enter checks a written recall, `s` stars, `/` jumps to search, `esc` goes back and `?`
  lists the lot. Every one of them has a button too — nothing is gesture-only or key-only.
- **Search** matches modules and cards, including their hints, notes and alternative answers, so
  a half-remembered detail is enough to find something again — and drills the matches directly
  (Enter in the box launches the drill).
  Tapping a **tag** filters the library and offers to drill everything under it; **⇅** sorts the
  shelf by what needs work instead of by name. Tiles say when you last studied them.

## Cards and modules

**Quick card** (home screen) is one screen: a question, an answer, an optional why and an
optional picture. It drops the card straight into a module you already study, clears itself and
stays open — Ctrl/⌘+Enter for the next one. Pick *＋ a new module…* and the card starts one.
Asking a question the module already asks is refused rather than silently duplicated.

**Read through** lists a module in order — pictures, hints, answers, notes and where each card
stands — so you can check a fresh import or see what a child is about to be asked. Nothing there
is graded, and every row carries a ✎: a typo spotted while reading is one tap from its editor. **▶ Read it to me** speaks each card and its answer in turn, marking the one being
read and moving on by itself: the module as an audiobook.

**Edit cards** opens the editor: rename, retag, fix a card, add one, delete one, add a picture
or a recording, or **pause** a card so it stops being scheduled. Each row shows where the card
stands and how the last few answers went (● missed, ○ got it). Tick several rows to drill, pause,
resume or delete them together — pruning a careless 200-card import is otherwise the worst job in
the app. Bundled modules are copied on first edit: the file on disk stays as shipped, your copy
shadows it.

**The editor reads the cards back to you.** Above the list it flags anything that looks badly
written — a question that contains its own answer, two cards asking the same thing, two cards
with the same answer, an essay where an answer should be — and tapping one opens it. They are
heuristics, not judgements: *Mexico → Mexico City* is flagged and is perfectly fine.

**The same question, twice.** Settings lists any question that appears in more than one module —
which happens the moment you ask Claude about a subject twice — because each copy carries its own
schedule and neither one's history is the whole story.

**You mixed these up.** A wrong pick in *Identify* or the *speed round* is rarely random — it
is usually another card's answer. The results screen says which: *you gave "Wellington" — that
belongs to "New Zealand"*, which is the actual confusion to fix rather than a bare "wrong".

Mix-ups also accumulate: once the same two cards have blurred together twice, the progress
screen lists them under **Often confused** — one mix-up is noise, the same pair three times is
a diagnosis — with the pair drill one tap away. The record syncs and merges like everything else.

A sitting that ends with misses offers **Ask Claude to sharpen these**: the missed cards go
onto the clipboard as a brief — diagnose why each was missable, reply as an importable table —
and the reply pastes straight back through Import, where the diff shows what changed.

Each mix-up carries a **drill the pair** button: the two confused cards alone, each asked
twice, shuffled — telling them apart becomes the whole exercise.

**Right, but slowly.** An answer that took three times your usual pace (measured, not guessed)
is one the schedule is over-trusting; the results screen lists them, because fluent recall is
the goal and hesitation is data. Its twin is **Wrong in a flash**: a miss in under a third of
your pace never tried to retrieve — a guess or a blank — and the attempt is the learning.

Installed as an app, the icon carries a **badge** with the due count — the one reminder that
costs nothing and nags nobody.

**＋ note** sits beside every card in *Worth another look* on the results screen. The moment you
know why a card caught you out is the moment worth writing it down, so the note goes on the card
there and then.

Each card carries an optional **hint** (shown before the answer), **note** (the *why*, shown
after grading — `note`, `why`, `explanation` and `extra` all import into it), **picture**,
**recording**, **also accept**, and **source** — an `https:` link back to wherever the fact came
from, shown under the answer. A knowledge base you can't trace is a knowledge base you stop
trusting.

**By subject** on the progress screen rolls mastery up to the tag level — *words 8/87, 3 due*
— and tapping one lands on the shelf filtered to it, drill button waiting. It is the level
"what should I study?" is actually asked at.

**Importing is undoable too**: the toast after a commit carries an *Undo* that takes the whole
import back, including the case where it replaced a module you already had.

**Deleting is undoable.** A card, a batch of cards, an imported module or a whole learner — each
deletion leaves a toast with an *Undo* that puts it back exactly as it was.

**Move to…** on an open card in the editor moves that one card to another module — your own
modules offered first — and carries every learner's history for it along, because it is still
the same question. **Merge into…** on a module moves every card into another one, skipping any
it already has. In
the editor, filtering the cards puts a **split** button below them: the matches move out into a
module of their own. Between them you can reshape a library that grew by accident.

A card whose front runs long is set as prose — smaller, left-aligned — rather than as a poster,
because pasted answers from a conversation are paragraphs.

## Getting it out again

- **Share link** puts a small module (deflate-compressed) in a URL fragment. Send it; whoever
  opens it gets an import preview. No server, no upload, no account. One with pictures in it
  will not fit, so on a phone it goes to the share sheet as a *file* instead, and on a desktop
  it saves as one.
- **Export history CSV** (Settings) writes the sitting log out — when, module, exercise, right,
wrong, seconds — for whoever wants to make their own charts.

**Export as markdown** (Settings) writes the whole visible library out as one document — every
  module a heading, every card a table row with its hint and its why. It is readable on its own,
  and it is written in the exact table form this app's importer reads: paste the whole document
  back and it comes home as the same modules. Pictures and recordings stay behind.
- **Export JSON** for a file that carries everything, **Export TSV** for a spreadsheet or Anki
  (and it re-imports here unchanged), **Print sheet** for a revision list, **Print cut-outs** for
  real cards a child can hold (cut the solid lines, fold the dashed), and **Export backup** in
  Settings for the lot. **Restore backup** merges rather than overwrites, so restoring one
  tablet's backup onto another never wipes the second one's work.
- If there is no sync and no backup and there is something worth losing, the app says so once a
  month rather than letting a cleared cache take a year of reviews with it. And once the library
  passes two megabytes, Settings lists which modules are carrying the weight — pictures and
  recordings, usually — each one tap from its editor.

The sync path itself is covered by the self-test: it runs the real `sync()` — lookup,
multipart create, media update, merge on pull — against the `?mock-drive` stand-in, as two
devices sharing one account.

## Sync (optional, ~3 minutes)

No client ID → the app runs fine, progress just stays on the device.

1. [console.cloud.google.com](https://console.cloud.google.com) → new project.
2. APIs & Services → Library → enable **Google Drive API**.
3. OAuth consent screen → External → add yourself as a test user.
4. Credentials → Create → **OAuth client ID** → *Web application*.
   Authorised JavaScript origins: `http://localhost:8000` and wherever you deploy it.
5. Copy the client ID, then either paste it in ⚙ Settings on each device, or — better for a
   family — copy `config.example.json` to `config.json`, put the ID in it, and deploy that.
   Every device that loads the app is then one **Connect Google** tap from syncing.

To try the sync flow without any of this, open `?mock-drive`: the real sync code runs against
a local stand-in (see `dev-mock-drive.js`), so nothing leaves the device.

Scope is `drive.appdata` only: the app can read and write its own hidden file and nothing
else in your Drive. Progress, profiles and imported modules live in
`learning-pit-state.json` there, merged per card (newest review wins) on every sync.

## Adding a game

`GAMES` in `app.js` is a plain object. Add an entry:

```js
GAMES.anagram = {
  label: 'Unscramble', glyph: '⤨', hint: 'Put the letters in order', min: 1,
  group: 'play',                 // 'drill' or 'play' — which heading it appears under
  filter: c => spellable(c.back), // optional: which cards it can use at all
  start(s) { s.queue = s.cards.slice(); s.total = s.queue.length; },
  frame() { /* set app.innerHTML, use data-act="…" on buttons, call grade(card, 'good'|'again') */ },
};
```

`frame()` runs after every state change (no framework, no diffing — the screens are small).
Anything user-supplied goes through `esc()` or `fmt()`. `ACT` holds the click handlers, keyed by
`data-act`. `launch(module, key, cards)` starts a session on any card list, including a synthetic
one. Optional `needs()` hides a game the device or profile can't run; `module(m)` hides it for
modules it does not suit (*Say it* wants a `lang`); `kid: false` hides it in
kid mode. Add a case to `selftest.html` while you are there.

## Files

| | |
|---|---|
| `core.js` | scheduling, session picking, import parsing, typed-answer judging, merge, validation |
| `core.test.js` | `node core.test.js` |
| `selftest.html` | browser regression run against the real UI |
| `app.js` | state, storage, Drive sync, screens, games |
| `sw.js` | offline cache (network-first) |
| `modules/` | bundled modules + `index.json` listing them |
| `tools/make-icons.py` | regenerates the PNG icons (stdlib only) |
| `dev-mock-drive.js` | stand-in for Drive, loaded only by `?mock-drive` |
| `config.example.json` | copy to `config.json` to bake in the OAuth client ID |
| `PROMPT.md` | the full authoring brief to paste into a Claude conversation |
| `CLAUDE.md` | conventions, data shapes, and where to add a game or a screen |

## What it needs to run

Anything current: Chrome/Edge 105+, Safari 16.4+, Firefox 121+. Nothing is polyfilled, and a
few things degrade rather than break on older versions — share links fall back to uncompressed
(Safari < 16.4), the side-by-side landscape layout needs `:has()`, and the horizontal-overflow
guard uses `overflow: clip`. Speech recognition (*Hands free*, the 🎤 button) is Chrome-only and
those entry points simply don't appear elsewhere.

## Deliberate omissions

Every shortcut with a known ceiling is marked `ponytail:` in the source and listed here, so
none of them is a surprise later:

| Shortcut | Ceiling | When to lift it |
|---|---|---|
| **SM-2**, three grades, no learning steps | good enough retention for a few thousand cards | if retention disappoints — the stored shape survives an FSRS swap |
| **Last-write-wins sync**, per card | two devices answering the same card in the same minute lose one review | if that ever actually happens |
| **No CSV quoting** in the importer | a comma inside a quoted field splits wrong | if someone pastes real CSV rather than JSON or a table |
| **Editor caps at 200 rows** | filter to reach the rest of a huge module | if modules routinely run into the thousands |
| **Media keyed by hash + length** | a 32-bit hash of a picture plus its length names it in IndexedDB | if two different pictures ever collide — a real digest is one line |
| **Two-oscillator sounds** | no audio files to load or cache | if you want real sound design |
| **Debounced sync, no retry queue** | a failed sync self-heals on the next save, and the bar shows ⚠ | if offline stretches get long |
| **Dark theme only** | the pit is a pit | if a kid ends up using it in direct sunlight |
| **No CSS/JS build** | you edit what ships | never, ideally |
