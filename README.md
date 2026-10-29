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
├── resume/
│   ├── index.html              # Print-ready resume page (generated)
│   └── Fortune-Owivri-Resume.pdf  # ATS-friendly PDF (generated)
├── scripts/
│   ├── check-site.py           # Stdlib-only link/markup/a11y checks
│   └── build-resume.py         # Single source of truth for the resume
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

## Resume

The resume is generated from one file so the PDF and the web version can't drift:

```bash
python3 scripts/build-resume.py     # needs: pip install reportlab pypdf
```

Edit only the `CONTENT` block at the top of `scripts/build-resume.py`
(`SUMMARY`, `SKILLS`, `EXPERIENCE`, `PROJECTS`, `EDUCATION`, `CERTIFICATIONS`), then
re-run. The build fails if the PDF spills past two pages, if any required section
is missing from the extracted text, or if agency voice ("we/our/us") creeps into
the copy.

Design constraints worth keeping:

- **ATS-parsable:** single column, no tables of content, no icons, no text baked
  into images; every heading is real text and extracts cleanly with `pypdf`.
- **No invented facts.** Only skills, dates and metrics present in the source
  resume appear. Anything aspirational is labelled (In progress / Ongoing / Planned).
- **One metric, one project.** See the evidence policy below — this is the rule the
  resume enforces on the site.

## Copy and evidence policy

- **Voice:** first person ("I build…"). Never "we/our" — agency voice was
  deliberately removed.
- **Numbers:** three are quoted, and each is tied to the **job it came from**, not
  to an AI agent:
  - **40% faster retrieval** — digitizing the inventory database, Rom Oil (2024–2025)
  - **90% issue resolution** — first-contact resolution, IT support role at
    Pitason & Smart Pro (2022)
  - **18% less stock loss** — stock reconciliation procedures, warehouse manager at
    PADVAP Publications (2023–2024)

  All three are self-reported from Fortune's own records and are not independently
  audited. An earlier revision attached the 40% and 90% figures to the research and
  ops *agents*; that attribution was wrong and was corrected on the homepage, in both
  blueprints, and in the resume. Do not re-attach them to the agents.
- **The only test-derived number on the site** is the sandbox suite result
  (14/14 scenario agreement), and it is only ever described as that.
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
2. ~~**Resume PDF**~~ — done: `resume/Fortune-Owivri-Resume.pdf`, generated by
   `scripts/build-resume.py`, linked from the hero, About section and every footer.
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
