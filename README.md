# Agentic AI

A static marketing + education site about autonomous AI agents, with a set of
"educational blueprints" that explain how production agentic systems are designed,
governed, and deployed.

**Live site:** <https://fortune5560.github.io/agentic-ai/>

No build step, no dependencies — plain HTML, CSS, and progressive-enhancement JS.

## Project structure

```
├── index.html              # Landing page
├── 404.html                # Custom GitHub Pages 404
├── styles.css              # All site styles (design tokens in :root)
├── site.js                 # Starfield, scroll-reveal, back-to-top (optional enhancement)
├── favicon.svg             # Site icon (vector source)
├── apple-touch-icon.png    # 180×180 iOS home-screen icon
├── icon-192.png/icon-512.png # Web manifest icons
├── og-image.png            # Social preview image (1424×752)
├── site.webmanifest        # PWA/install metadata
├── rss.xml                 # RSS feed for the blueprints
├── robots.txt              # Crawler rules + sitemap reference
├── sitemap.xml             # Sitemap for search engines
└── blueprints/
    ├── index.html            # Blueprints hub
    ├── ops-agent.html        # Blueprint #1 — Autonomous Ops Agent
    ├── research-agent.html   # Blueprint #2 — Research & Reporting Agent
    └── productivity-agent.html # Blueprint #3 — Personal Productivity Agent
```

## Run locally

Serve the folder with any static file server, e.g.:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Opening `index.html` directly in a browser also works, except the 404 page,
which uses root-absolute paths (`/agentic-ai/…`) because GitHub Pages can serve
it from any nested URL.

## Design system

- Tokens live in `:root` at the top of `styles.css` (colors, widths, font stack).
- Motion: the starfield, scroll-reveal, and smooth scrolling all honor
  `prefers-reduced-motion`; keep it that way when adding animation.
- `site.js` is pure progressive enhancement: with JS disabled, every page is
  still fully readable (hidden-then-revealed styles are gated behind `html.js`).
- Blueprints print cleanly — a dedicated `@media print` sheet strips chrome.

## Deployment

Hosted on **GitHub Pages** from the repository root. Pushing to the default
branch redeploys automatically.

## Customization checklist

- **Newsletter email:** the "Subscribe by Email" button in `index.html` uses a
  `mailto:` link with the placeholder `hello@example.com` — replace it with
  your real inbox (search for `TODO` in `index.html`). To collect subscribers
  properly later, swap it for a form backend that works on static hosting
  (Formspree, Buttondown, etc.).
- **Social image:** `og-image.png` is referenced from every page with absolute
  URLs. Regenerate/replace it and keep the `og:image:width`/`height` meta tags
  in sync with the real dimensions.
- **Icons:** `favicon.svg` is the vector source; the PNG icons were rendered
  from it. Regenerate the PNGs if you change the mark.
- **Publishing a new blueprint:** add a card on `index.html` and
  `blueprints/index.html`, an `<item>` in `rss.xml` (bump `<lastBuildDate>`),
  the URL in `sitemap.xml`, and update prev/next links on neighboring blueprints.

## Housekeeping

- Line endings are normalized to LF via `.gitattributes`.
- All pages share `styles.css`; avoid inline styles — extend the stylesheet.
