# emdashless

**The em dash is a corruption.**

It arrived quietly. One stray keystroke in a draft nobody proofread, and it took
root. It spread through blog posts, through product copy, through release notes
and changelogs and the emails of people who should have known better. It
multiplied in every machine-written paragraph until no sentence was safe. Where a
comma would have served, it loomed. Where a colon was owed, it sprawled. It is
punctuation that refuses to commit, a hyphen with delusions of grandeur, a
horizontal scar across otherwise honest prose.

**emdashless is the purge.**

Every page you open is swept. Every em dash is found, torn out at the root, and
replaced with the mark that should have been there all along. Not blindly, not
with a dumb hyphen, but with judgement:

| The corruption | What it becomes | Why |
| --- | --- | --- |
| `The plan — bold as it was — failed.` | `The plan, bold as it was, failed.` | a paired aside is what commas are for |
| `The report — which nobody read, sadly — was wrong.` | `The report (which nobody read, sadly) was wrong.` | commas already inside, so parentheses take over |
| `He had one goal — victory.` | `He had one goal: victory.` | the tail names the thing, so a colon announces it |
| `He knew the truth — she was lying.` | `He knew the truth; she was lying.` | two whole clauses, joined by a semicolon |
| `I tried — but it failed.` | `I tried, but it failed.` | a conjunction only ever needed a comma |
| `It was over — finally.` | `It was over, finally.` | an afterthought, not a proclamation |
| `Three things matter — speed, security, support.` | `Three things matter: speed, security, support.` | a list is introduced, never dashed into |
| `Wait—` | `Wait...` | speech cut short trails off |
| `See pages 10—20` | `See pages 10-20` | a range is a range |
| `— Oscar Wilde` | `- Oscar Wilde` | attribution stands on a humble dash |

The text reads as though the corruption was never there.

## Scope

No mercy. Headings, paragraphs, tables, list items, buttons, the tab title, open
shadow roots, every iframe, and anything the page loads later. Not only text:
`placeholder`, `title`, `alt`, `aria-label`, `label` and button `value` are
rewritten too, so the corruption cannot hide in a tooltip or an empty field.
Text you type or paste into inputs, textareas, and editable fields is purged as
well, one keystroke after the dash lands, so the engine can see what follows
before it decides.

## Purge before you send

Reading clean text is half the job. The corruption spreads because people paste
it onward, so the popup carries a workbench: paste anything into it and the em
dashes die on arrival, headings, lists, bold, links and all still intact. It
tells you how many it took, then **Copy clean** puts the result back on your
clipboard as both rich text and plain text, ready to land in Slack, Gmail, Jira
or a doc. `Cmd+Enter` copies without reaching for the mouse.

Text typed or pasted straight into a page is purged in place as well, so most of
the time the workbench is only needed for content coming from outside the browser.

## Options

**The purge.** On, and every page is swept as it opens. Off, and every page
instantly reverts to the text as it was written, corruption and all. That is your
business. The workbench keeps working either way, because that one you asked for.

**What you write.** Purges text as you type and paste it into pages. A dash you
type by hand survives exactly one keystroke, long enough for the engine to read
the clause that follows before it picks a replacement.

**Code blocks.** On by default, because the corruption spreads there too. Turn it
off to spare `<pre>`, `<code>`, `<samp>`, `<kbd>` and `<var>`, and those blocks
revert immediately without a reload. Worth doing if you read a lot of code where
an em dash is load-bearing.

## Install

1. `chrome://extensions`
2. Turn on **Developer mode** (top right).
3. **Load unpacked**, then select the `emdashless` folder.

## Development

```sh
node tools/test-purge.mjs     # the replacement corpus, must stay clean
node tools/make-icons.mjs     # regenerate the icons from geometry
node tools/browser-check.mjs  # drives a real Chrome over test/torture.html
node tools/popup-check.mjs    # pastes formatted text into the workbench
```

The two browser checks need Chrome on a debugging port and the repo served over
HTTP, because content scripts do not run on `file://` URLs:

```sh
python3 -m http.server 8731 &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --remote-debugging-port=9222 \
  --user-data-dir=/tmp/emdl-profile about:blank &
```

Three layers, so each is testable on its own:

- `purge.js` is the engine. Pure string in, pure string out, no DOM at all.
- `dom-purge.js` applies the engine to a tree. Shared by the page and the popup,
  so both purge identically.
- `content.js` owns the page: settings, the `MutationObserver`, and typed input.

## Author

Emilis Strimaitis &lt;emilis.strimaitis@hostinger.com&gt;
