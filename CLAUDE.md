# Working on Learning Pit

Static PWA. No build step, no dependencies, no backend. Open `index.html` over a local
server and it runs; copy the directory anywhere static and it's deployed.

## Rules that matter here

- **No dependencies.** Not npm, not a CDN. If something needs a library, it probably
  doesn't need to exist. The one external script is Google's `gsi/client`, loaded only
  because it *is* the OAuth provider.
- **No build step.** `app.js` and `core.js` are ES modules the browser loads directly.
  Anything that would require compiling is the wrong answer.
- **Logic lives in `core.js` and is pure** — no DOM, no network, no `Date.now()` in
  signatures without a `now` parameter, no `Math.random()` without an injectable `rnd`.
  That is what makes `node core.test.js` possible. New logic goes there with a test.
- **`app.js` is DOM and I/O**: state, storage, sync, screens, games. Rendering is
  `innerHTML` + event delegation on `data-act`. There is no framework and doesn't need
  to be one — every screen fits on a page.
- **Anything user-supplied goes through `esc()` or `fmt()`.** `fmt` escapes first, then
  re-adds a three-feature markdown subset. Never interpolate raw card text.
- **`ponytail:` comments mark deliberate shortcuts** and name their ceiling. If you lift
  one, delete the comment. Don't add complexity that isn't paid for by a real use.

## Checks before saying it works

```sh
node core.test.js          # scheduling, parsing, merge, judging, tiles
node --check app.js sw.js  # syntax
python -m http.server 8000 # then open /selftest.html — it drives the real UI — and click
                           # through whatever you changed yourself
```

`selftest.html` is the regression net for `app.js`: it runs the app in an iframe, asserts on
real DOM and real localStorage, and restores your data at the end. Add a case there when you
add a screen or a game — it is the only automated cover `app.js` has. Two things it will bite
you with: every case shares one module scope, so a `const` name used twice is a silent
`SyntaxError` that leaves the page stuck on "running…"; and the browser caches it, so load it
as `selftest.html?v=N`. If nothing renders, read the console — a parse error kills the lot.
The suite's own waits run on a Web Worker clock, so a hidden tab cannot freeze the run — but
the app inside the frame still lives on clamped tab timers, so cases that judge the app's own
pacing (reading aloud) skip themselves when `document.hidden`.

Speech does not work in an automated browser (Chrome refuses to speak without a real gesture),
so anything built on `speak()` has to stay watchable when every utterance errors instantly.

Touching sync? Open `?mock-drive`. `dev-mock-drive.js` stands in for the appDataFolder, so the
real `sync()` — lookup, multipart create, media update, merge on pull — runs without an account.
Clear `localStorage.pit.v1` (keeping `pit.mockdrive`) to play the part of a second device.

Every game and screen has been verified by driving the real UI. Do the same: a change that
only passes `node --check` has not been tested.

## Shape of the data

```js
module = { id, title, description, icon, tags[], src?,
           cards: [{ id?, front, back, hint?, note?, image?, audio?, source?, alt?[], options?[] }] }
state  = { active, settings: {clientId, lastSync, lastBackup, nudged}, custom: [module…],
           profiles: { name: { srs: { "moduleId:cardId": {reps,lapses,ease,interval,due,t,susp?,log?} },
                               stats: {reviews,correct,streak,bestStreak,lastDay,rested,stars,rank,
                                       days{},hits{},sessions:[{t,m,g,r,w,secs}…],
                                       confusions:[{a,b,n}…]},
                               opts:  {avatar,kid,tts,sound,voice,size,goal,sort,theme,lastAdd,
                                       hidden:[moduleId…], deadlines:{moduleId:'YYYY-MM-DD'}} } } }
```

- `srs[key]` also carries `star` (the learner's own mark) and `susp` (parked). `opts.t` is
  stamped by `setOpt()` whenever a setting is *chosen*, and is how sync decides which device's
  settings win — assigning to `opt().x` directly is for bookkeeping that should never win.
- Card keys are content-derived (`hash(front)`, or front + NUL + image when a card has a
  picture) so re-importing an edited module keeps history for unchanged cards. `card.mid`
  overrides the module id for mixed sessions — that is how a mock exam, a tag drill or a
  sticking-points drill grades each card back into its own module.
- A module may carry `src`: the URL it was fetched from. *Check for new cards* refetches it
  and appends only what `newCards()` says is missing. `ident()` is the one definition of
  "the same question" and both the deduper and the refresher use it.
- Bundled modules in `modules/` are read-only; editing forks a copy into `state.custom`
  which shadows it by id.
- Sync is last-write-wins per card (`t` timestamp) into Drive's `appDataFolder`. The merge
  is `mergeState()` and is tested for convergence across two devices.

## Adding things

- **The sitting log is the source for everything reflective**: `weekSummary`, `bestTime`,
  `pace`/`minutesFor`/`slowAfter` (how long things take, from this learner's own sittings) and
  the per-module accuracy all read `stats.sessions`. Anything new of that kind belongs there
  too. Schedule-shaped questions (`forecast`, `tagTotals`, `troubleSpots`, `starred`, `spreadDue`) read
  `srs` instead — both live in core with tests. `stats.confusions` is the third record: pairs the
  learner mixes up, folded in at results, merged by `mergeConfusions`, drilled from progress.
- **Content checks live in core**: `auditModule` (a module read back to its author),
  `duplicatesAcross` (the same question in two modules), `toMarkdown` (the library as one
  document, in the exact table form `parseImport` reads back). A paste with several `##`
  headings becomes several modules.
- **A game**: one entry in `GAMES` — `label, glyph, hint, min, group: 'drill'|'play'`, plus
  optional `filter` (which cards it can use), `needs` (whether the device/profile can run it
  at all), `kid: false` (hide it in kid mode), then `start(s)` and `frame()`. `frame()` re-runs
  on every state change. Grade with `grade(card, 'again'|'good'|'easy')`.
- **A screen**: a render function, a line in `draw()`, and an entry in `ACT` to reach it.
- **A setting**: a field in `opt()`'s defaults plus a `data-opt` control in `settings()`.
  Per-learner settings live in `profile.opts`, device-wide ones in `state.settings`. The
  handler coerces selects to numbers unless the key is listed as a word (`voice`, `theme`).
- **A colour**: never a literal. `app.css` defines every surface as a token twice — once for
  the pit and once for daylight — and `applyTheme()` stamps `data-theme` on `<html>`, so a
  hard-coded hex is a bug that only shows up in one of the two.
- **A keyboard shortcut**: the `keydown` handler at the bottom of `app.js` branches on
  `session.key`; add a branch there and a phrase to `ACT.shortcuts`. Everything reachable by
  key must also be reachable by tapping something.
