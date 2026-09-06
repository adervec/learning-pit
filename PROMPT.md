# Authoring brief for Claude

Paste this whole file into a conversation when you want a module built properly — it costs a
few hundred tokens and buys cards that are actually worth reviewing. For a quick one, the
**Copy the prompt** button on the import screen has the short version.

---

Turn what we have covered into a **Learning Pit module**. Reply with only a JSON code block:

```json
{
  "id": "kebab-case-id",
  "title": "Short human title",
  "icon": "🧠",
  "description": "One line on what this covers.",
  "tags": ["two or three", "lowercase"],
  "cards": [
    {
      "front": "A question or a cue",
      "back": "The answer, under about 20 words",
      "hint": "Optional nudge shown before the answer",
      "note": "Optional why, shown after answering",
      "lang": "optional BCP-47 tag like fr — the app reads the cards aloud as that language",
      "alt": ["other wordings that should count as right"],
      "options": ["optional", "plausible", "wrong answers"]
    }
  ]
}
```

## What makes a card worth reviewing

- **One idea per card.** If the answer contains "and", consider two cards. A card that asks
  two things cannot be graded honestly — I half-remember it and the schedule learns nothing.
- **The front is a question or a cue, never an instruction.** "Explain the Krebs cycle" is an
  essay prompt. "What does the Krebs cycle produce per turn?" is a card.
- **The back is the smallest complete answer.** Anything longer than about 20 words belongs in
  `note`, which is shown after I answer and never used to test me.
- **No card should be answerable from the wording of another.** Vary the phrasing so the set
  can't be pattern-matched.
- **No card should be answerable from its own wording.** "Which planet is the Red Planet?"
  gives itself away; "Which planet is rust-red from iron oxide?" does not.
- **Bold the term that matters** — `the **transformer** replaced recurrence` — and the
  fill-the-blank exercise will blank exactly that instead of guessing which word to hide.
- **Prefer why and when over what.** Definitions are easy to write and weak to know. Cards that
  ask when a thing applies, or why it beats the alternative, are the ones worth spacing.
- **Use `alt` when the answer has more than one honest wording.** "USA" and "US" for "the
  United States". Typing exercises accept them; without it, a right answer is marked wrong.
- **Use `options` when the mistakes are predictable.** Three wrong answers that are the errors
  someone actually makes are worth far more than three obviously wrong ones.
- **15–40 cards.** Below 15 it isn't a module; above 40 it's usually two.

## Good and bad, side by side

| Weak | Better |
|---|---|
| "Explain spaced repetition." | "Why does spacing beat cramming for the same total minutes?" |
| "Define idempotent." | "What can you safely do twice with an idempotent operation?" |
| "List the noble gases." | "What property do the noble gases share, and why?" |
| back: a 60-word paragraph | back: the claim; the paragraph moved to `note` |

## Variations to ask for

- *"Here are the cards I keep failing: … Rewrite each so it asks a single thing, and split
  any that ask two."*
- *"Add three `options` to each card — the mistakes someone actually makes."*
- *"Make it for a seven-year-old: one-word answers, no jargon, a `hint` that nudges without
  giving it away, and an emoji `icon`."*
- *"Read this document and turn only the load-bearing facts into a module — skip anything I
  could look up in a second."*
- *"Same material, but as `front: term` / `back: one-word answer` so the Spell it and Hands
  free games work."*
- *"Add an `image` to each card — an `https:` URL to a plain, high-contrast picture, or say
  which cards would benefit from one and I'll add photos myself."*

## Getting it into the app

Paste the JSON into the import screen (or the whole reply — surrounding chatter and code
fences are stripped), check the preview, and add it. Re-importing a module with the same `id`
keeps the review history of every card whose `front` is unchanged; the preview says how many.
