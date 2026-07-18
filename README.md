# Agentic AI

A static marketing + education site about autonomous AI agents, with a set of
"educational blueprints" that explain how production agentic systems are designed,
governed, and deployed.

**Live site:** <https://fortune5560.github.io/agentic-ai/>

No build step, no dependencies — plain HTML, CSS, and a sprinkle of vanilla JS.

## Project structure

```
├── index.html              # Landing page
├── 404.html                # Custom GitHub Pages 404
├── styles.css              # All site styles (design tokens in :root)
├── favicon.svg             # Site icon
├── og-image.png            # Social preview image (1424×752)
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
- **RSS:** update `rss.xml` (`<lastBuildDate>`, new `<item>` entries) whenever a
  new blueprint is published, and add the URL to `sitemap.xml`.

## Housekeeping

- Line endings are normalized to LF via `.gitattributes`.
- All pages share `styles.css`; avoid inline styles — extend the stylesheet.
- The decorative starfield respects `prefers-reduced-motion`; keep it that way
  if you add more animation.
