# Fortune Owivri — Agentic AI

A static site about the agentic AI systems I build, plus a **testable** ops-agent
demo that runs entirely in the browser.

**Live site:** <https://fortune5560.github.io/agentic-ai/>

No build step for the site itself — plain HTML, CSS and progressive-enhancement
JS. Dependencies exist only for the tests.

## Project structure

```
├── index.html                  # Landing page (projects, about, contact)
├── 404.html                    # Custom GitHub Pages 404
├── styles.css                  # All site styles (design tokens in :root)
├── site.js                     # Starfield, scroll-reveal, back-to-top
├── favicon.svg / icon-*.png    # Icons (SVG source + rasterised)
├── apple-touch-icon.png        # 180×180 iOS home-screen icon
├── og-image.png                # Social preview image (1424×752)
├── site.webmanifest            # PWA/install metadata
├── rss.xml / sitemap.xml       # Feed + sitemap
├── robots.txt
├── blueprints/
│   ├── index.html              # Blueprints hub
│   ├── ops-agent.html          # #1 — Autonomous Ops Agent
│   ├── research-agent.html     # #2 — Research & Reporting Agent
│   └── productivity-agent.html # #3 — Personal Productivity Agent
├── demo/
│   ├── index.html              # Ops Agent Sandbox
│   ├── demo.js                 # Wires the page to the engine
│   ├── ops-agent-engine.js     # The engine + answer key + test harness
│   └── artifacts/
│       └── demo-results.json   # Last harness run (machine-readable)
├── scripts/check-site.py       # Stdlib-only link/markup/a11y checks
└── tests/demo-ui.test.mjs      # jsdom tests for the sandbox page
```

## Run locally

```bash
python3 -m http.server 8080     # then open http://localhost:8080
```

`npm run serve` does the same thing. Opening `index.html` directly works too,
except `404.html`, which uses root-absolute paths (`/agentic-ai/…`) because
GitHub Pages can serve it from any nested URL.

## The ops-agent demo

`demo/ops-agent-engine.js` is a deterministic, rules-based version of the
decision layer described in Blueprint #1 (classify → select an approved
playbook → run the guardrails → act or escalate).

It ships in two shapes from one file:

- **In the browser** — `demo/index.html` lets you change an incident and see the
  decision, the audit trail, and the guard that fired. It also runs the full
  suite on load and displays the result it just measured.
- **In the terminal** — the same file is a CLI test harness:

```bash
node demo/ops-agent-engine.js           # human-readable report
node demo/ops-agent-engine.js --json    # diffable artifact
```

The harness compares the engine against an **answer key** of 14 scenarios, each
with the decision an on-call engineer should make, written independently of the
engine. It reports decision accuracy, how often the agent acted without a human,
unsafe executions, and whether every guardrail was exercised. It exits non-zero
if any scenario diverges or the replay stops being deterministic, so it can gate
a change in CI.

Measured baseline (also in `demo/artifacts/demo-results.json`):

| Metric | Value |
| --- | --- |
| Scenarios | 14 |
| Decision accuracy vs answer key | 14/14 (100%) |
| Auto-resolved | 7 (50%) |
| Escalated to a human | 7 |
| Unsafe executions | 0 |
| Deterministic replay | yes |
| Guardrails exercised | 5 of 5 |

**What the demo does not measure:** model accuracy, latency, cost, or behaviour
under real traffic. The tested path contains no model. Do not describe these
numbers as production results.

## Tests and checks

```bash
npm install          # jsdom, dev-only
npm test             # engine harness + sandbox UI tests
npm run check        # link integrity, duplicate ids, JSON-LD, XML, sitemap
```

`scripts/check-site.py` needs only the Python standard library. It verifies
every internal link and `#fragment` resolves, JSON-LD parses, `sitemap.xml` and
`rss.xml` point at real files, each page has one `<h1>` / `lang` / description,
and `target="_blank"` links carry `rel="noopener"`. It also warns on any leftover
"we/our/us" copy, since the site is written in the first person.

## Copy and evidence policy

- **Voice:** first person ("I build…"). Never "we/our" — agency voice was
  deliberately removed.
- **Numbers:** only three are quoted, each on the project it describes, each
  labelled *Measured* with the baseline available on request:
  - 40% faster retrieval — research/retrieval pipeline
  - 90% issue resolution — operations agent
  - 18% less stock loss — stock & replenishment agent
- **Never** present a mock screenshot, illustrative chart or demo output as
  production evidence. The sandbox is labelled as a rules-based demo, and its
  results are described as *measured by the repeatable suite*, never as
  production performance.
- Blueprint #3 (productivity) intentionally quotes no metric.

## Deployment

GitHub Pages, served from the repository root of the default branch. Pushing to
that branch redeploys automatically.

## Outstanding inputs

These are wired to placeholders until the real values arrive:

1. **Tally signup URL** — replace the `mailto:` subscribe link in
   `index.html` (`#contact` section) with the Tally form. There is a
   `TODO(Tally)` comment marking the exact spot.
2. **Resume PDF** — drop it in as `resume.pdf` at the repo root and link it from
   the About section and footer; the site has no resume link yet on purpose, so
   it never 404s.
3. **Main portfolio repo/URL** — this repo's `index.html` is the Agentic AI site,
   not the main portfolio. Send the URL or repo and the same treatment
   (first-person copy, real evidence rules, social links, validated markup)
   will be applied there separately.

## Customization checklist

- **Publishing a new blueprint:** add a card on `index.html` and
  `blueprints/index.html`, an `<item>` in `rss.xml` (bump `<lastBuildDate>`), the
  URL in `sitemap.xml`, and update the prev/next links on neighbouring
  blueprints. Then run `npm run check`.
- **Social image:** `og-image.png` is referenced from every page with absolute
  URLs. Regenerate it and keep the `og:image:width`/`height` meta tags accurate.
- **Icons:** `favicon.svg` is the vector source; regenerate the PNGs if the mark
  changes.

## Housekeeping

- Line endings are normalised to LF via `.gitattributes`.
- All pages share `styles.css`; avoid inline styles — extend the stylesheet.
- `node_modules/` is ignored; the site never depends on it.
