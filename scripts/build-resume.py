#!/usr/bin/env python3
"""
build-resume.py — single source of truth for Fortune Owivri's resume.

Editing the resume means editing the CONTENT block below and re-running:

    python3 scripts/build-resume.py

Outputs
    resume/Fortune-Owivri-Resume.pdf   ATS-friendly, selectable text, 2 pages max
    resume/index.html                  print-ready web version (same content)

Requires: reportlab  (pip install reportlab)

Design rules this enforces:
  * single column, no tables of content, no icons, no text in images -> ATS parses it
  * every claim traces to something real; no invented metrics, no invented dates
  * one page-two maximum; the build fails if it spills past two or if a "we/our"
    voice slips in (this resume is first person by omission, i.e. verb-first bullets)
"""

from __future__ import annotations

import html
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "resume")

# --------------------------------------------------------------------------- #
# CONTENT — the only part you normally need to edit
# --------------------------------------------------------------------------- #
NAME = "Fortune Owivri"
TITLE = "IT Support &amp; Operations · Automation &amp; Cybersecurity"
LOCATION = "Ibadan, Oyo State, Nigeria"
PHONES = "+234 701 177 3190 · +234 904 465 9680"
EMAIL = "fortuneowivri@gmail.com"
LINKS = [
    ("LinkedIn", "https://www.linkedin.com/in/fortune-owivri-9a4504289",
     "linkedin.com/in/fortune-owivri-9a4504289"),
    ("Portfolio", "https://fortune5560.github.io/agentic-ai/",
     "fortune5560.github.io/agentic-ai"),
    ("X", "https://x.com/slatty5560", "x.com/slatty5560"),
]

SUMMARY = (
    "IT support and operations professional working across hardware and software "
    "troubleshooting, inventory systems and workflow automation. Digitized an inventory "
    "database that cut record retrieval time by <b>40%</b>, resolved <b>90%</b> of "
    "user-reported issues on first contact, and cut stock loss by <b>18%</b> with "
    "reconciliation procedures. Currently building agentic AI tooling — LLM planning, "
    "n8n orchestration, and guardrails with repeatable tests — and working toward "
    "Google Cybersecurity and CompTIA Security+ certification."
)

SKILLS = [
    ("IT support", "Windows troubleshooting · hardware &amp; software diagnostics · "
                   "system optimization · onsite and remote support · documentation"),
    ("Networking &amp; security", "TCP/IP and network configuration · monitoring · "
                                  "cybersecurity fundamentals · SIEM (studying) · "
                                  "secure data handling and confidentiality"),
    ("Data &amp; automation", "MySQL (basic) · GitHub · n8n workflow automation · "
                              "LLM-based agents with guardrails and tests · HTML/CSS/JS"),
    ("Operations", "Inventory and stock control · procurement support · logistics "
                   "coordination · stock audits · data entry accuracy · team leadership"),
    ("Tools", "Windows OS · Linux (basic) · MS Office · Google Workspace · "
              "live streaming systems"),
]

EXPERIENCE = [
    {
        "role": "Office Assistant / IT Support",
        "org": "RCCG Solution Assembly, Oyo Province",
        "place": "Ibadan, Nigeria",
        "dates": "June 2025 – Present",
        "bullets": [
            "Provide live technical support for streaming and video recording, keeping services uninterrupted through outages, equipment faults and last-minute changes.",
            "Maintain the digital and hardcopy document system, improving access and retrieval across the provincial office.",
            "Track office supplies inventory and tighten procurement cycles to avoid stockouts.",
            "Support leadership with administrative and IT tasks under strict confidentiality.",
        ],
    },
    {
        "role": "Store Clerk / Technical Operations Assistant",
        "org": "Rom Oil (PEOPL)",
        "place": "Ibadan, Nigeria",
        "dates": "July 2024 – March 2025",
        "bullets": [
            "Digitized the inventory database, <b>cutting record retrieval time by 40%</b>.",
            "Improved spare-parts availability by 30%, reducing operational downtime.",
            "Supported procurement processes, reducing urgent-order delays by 25%.",
            "Ran periodic stock audits, reducing discrepancies by 15%.",
            "Verified shipment documentation with 100% accuracy across all batches handled.",
        ],
    },
    {
        "role": "Warehouse Manager",
        "org": "PADVAP Publications Ltd.",
        "place": "Ibadan, Nigeria",
        "dates": "November 2023 – June 2024",
        "bullets": [
            "Cut <b>stock loss by 18%</b> by implementing stock reconciliation procedures.",
            "Improved warehouse efficiency by 35% through workflow optimization.",
            "Reduced order fulfillment time by 20% via storage and layout reorganization.",
            "Supervised 10+ staff, improving coordination and daily throughput.",
            "Enforced safety protocols, decreasing workplace incidents by 25%.",
        ],
    },
    {
        "role": "Junior Developer / IT Support Assistant",
        "org": "Pitason &amp; Smart Pro",
        "place": "Ibadan, Nigeria",
        "dates": "March 2022 – September 2022",
        "bullets": [
            "<b>Resolved 90% of user-reported technical issues on first contact</b>.",
            "Built lightweight web applications that automated recurring client operations.",
            "Improved system stability by 20% by collaborating on debugging and root-cause fixes.",
            "Tested and documented software bugs and their fixes for the support team.",
        ],
    },
    {
        "role": "Field Engineer (IT Support &amp; Systems Optimization)",
        "org": "Clearwox Systems",
        "place": "Ibadan, Nigeria",
        "dates": "April 2021 – September 2021",
        "bullets": [
            "Delivered onsite and remote IT support with a 95% resolution rate.",
            "Reduced downtime by 30% by supporting system upgrades and optimizations.",
            "Improved operational efficiency by 20% by implementing tailored IT solutions.",
            "Maintained hardware, networks and application reliability across client sites.",
        ],
    },
]

PROJECTS = [
    {
        "name": "Operations agent with guardrails",
        "meta": "Public demo · deterministic rules engine · 14-scenario test suite",
        "url": "https://fortune5560.github.io/agentic-ai/demo/",
        "bullets": [
            "Triage agent that classifies an incident, selects from approved playbooks only, "
            "and escalates anything irreversible, over-budget or low-confidence.",
            "Guardrail logic is covered by a repeatable test suite with an independently "
            "written answer key; the CLI exits non-zero if a decision diverges.",
        ],
    },
    {
        "name": "Research &amp; reporting agent",
        "meta": "Design write-up and blueprint",
        "url": "https://fortune5560.github.io/agentic-ai/blueprints/research-agent.html",
        "bullets": [
            "Source discovery, credibility filtering and verification before synthesis, with "
            "every claim carrying its citation and a human approving before publication.",
        ],
    },
    {
        "name": "Stock &amp; replenishment agent",
        "meta": "In progress — builds on the inventory work above",
        "url": "",
        "bullets": [
            "Turns demand signals into replenishment recommendations and flags the "
            "assumptions a human should check before ordering.",
        ],
    },
]

EDUCATION = [
    {
        "degree": "B.Sc. Computer Science",
        "org": "ESPAM Formation University, Porto-Novo, Benin Republic",
        "dates": "2020 – 2023",
        "detail": "Graduated Summa Cum Laude — 4.0 GPA",
    },
    {
        "degree": "Secondary &amp; primary education",
        "org": "Calvary International College; Calvary Heritage Group of Schools, Ibadan",
        "dates": "",
        "detail": "",
    },
]

CERTIFICATIONS = [
    ("Google Cybersecurity Professional Certificate", "In progress"),
    ("Google IT Support Professional Certificate", "In progress"),
    ("Cisco CCNA — Introduction to Networks", "Ongoing"),
    ("CompTIA Security+", "Planned"),
]

LANGUAGES = "English (fluent) · French (basic)"

# --------------------------------------------------------------------------- #
# Plain-text helpers (shared by both renderers)
# --------------------------------------------------------------------------- #
TAG_RE = re.compile(r"<[^>]+>")


def plain(text: str) -> str:
    """Strip inline markup and decode entities for the PDF/plain-text output."""
    return html.unescape(TAG_RE.sub("", text))


def check_no_agency_voice() -> list[str]:
    problems = []
    blob = " ".join(
        [plain(SUMMARY)]
        + [plain(b) for job in EXPERIENCE for b in job["bullets"]]
        + [plain(b) for proj in PROJECTS for b in proj["bullets"]]
    )
    for match in re.finditer(r"\b(we|We|our|Our|us)\b", blob):
        problems.append(f"agency voice in resume copy near: {blob[max(0, match.start() - 30):match.end() + 30]}")
    return problems


# --------------------------------------------------------------------------- #
# PDF (reportlab)
# --------------------------------------------------------------------------- #
def build_pdf(path: str, total_pages: int | None = None) -> None:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether,
                                    PageTemplate, Paragraph, Spacer, Table,
                                    TableStyle)
    from reportlab.platypus.flowables import HRFlowable
    from pypdf import PdfReader  # noqa: F401  (only used by the caller for verification)

    INK = colors.HexColor("#111827")
    MUTED = colors.HexColor("#4b5563")
    ACCENT = colors.HexColor("#0e7490")     # dark teal: prints, still on-brand
    RULE = colors.HexColor("#d1d5db")

    body = ParagraphStyle("body", fontName="Helvetica", fontSize=9.4, leading=12.9,
                          textColor=INK, alignment=TA_LEFT, spaceAfter=0)
    bullet = ParagraphStyle("bullet", parent=body, leftIndent=9, bulletIndent=1,
                            spaceAfter=1.1)
    section = ParagraphStyle("section", fontName="Helvetica-Bold", fontSize=9.2,
                             leading=11, textColor=ACCENT, spaceBefore=6,
                             spaceAfter=1.2, tracking=0.6)
    role = ParagraphStyle("role", fontName="Helvetica-Bold", fontSize=9.6, leading=12.2,
                          textColor=INK)
    orgline = ParagraphStyle("orgline", fontName="Helvetica", fontSize=8.9, leading=11.4,
                             textColor=MUTED)
    dateline = ParagraphStyle("dateline", fontName="Helvetica-Bold", fontSize=8.2,
                              leading=11, textColor=MUTED, alignment=2,
                              rightIndent=0, spaceBefore=1.5)

    def rule(color=RULE, thickness=0.8, space_before=2, space_after=3):
        return HRFlowable(width="100%", thickness=thickness, color=color,
                          spaceBefore=space_before, spaceAfter=space_after)

    story: list = []

    # ---- header
    name_style = ParagraphStyle("name", fontName="Helvetica-Bold", fontSize=20.5,
                                leading=23, textColor=INK)
    story.append(Paragraph(NAME, name_style))
    story.append(Spacer(1, 1.6))
    story.append(Paragraph(
        f'<font color="#0e7490" size="9.6"><b>{plain(TITLE)}</b></font>', body))
    story.append(Spacer(1, 3))
    story.append(Paragraph(
        f'{LOCATION}<br/>{PHONES} · {EMAIL}', ParagraphStyle(
            "contact", parent=body, fontSize=8.6, leading=11.4, textColor=MUTED)))
    story.append(Spacer(1, 2))
    link_stubs = " · ".join(
        f'<link href="{url}" color="#0e7490">{label}</link>' for label, url, _ in LINKS)
    story.append(Paragraph(link_stubs, ParagraphStyle(
        "links", parent=body, fontSize=8.6, leading=11.4, textColor=ACCENT)))
    story.append(Spacer(1, 5))
    story.append(rule(color=ACCENT))

    # ---- summary
    story.append(Paragraph("PROFESSIONAL SUMMARY", section))
    story.append(Paragraph(SUMMARY, body))

    # ---- skills
    story.append(Paragraph("CORE SKILLS", section))
    for label, detail in SKILLS:
        story.append(Paragraph(
            f"<b>{plain(label)}:</b> {plain(detail)}",
            ParagraphStyle("skill", parent=body, fontSize=8.9, leading=11.9, spaceAfter=1.4)))

    # ---- experience
    story.append(Paragraph("PROFESSIONAL EXPERIENCE", section))
    for job in EXPERIENCE:
        head = Table(
            [[Paragraph(f'{job["role"]} — <font color="#4b5563">{plain(job["org"])}</font>', role),
              Paragraph(job["dates"], dateline)],
             [Paragraph(job["place"], orgline), ""]],
            colWidths=[None, 128])
        head.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ("SPAN", (1, 1), (1, 1)),
        ]))
        block = [head]
        block += [Paragraph(b, bullet, bulletText="•") for b in job["bullets"]]
        story.append(KeepTogether(block))
        story.append(Spacer(1, 3.4))

    # ---- projects
    story.append(Paragraph("SELECTED PROJECTS", section))
    for proj in PROJECTS:
        name = plain(proj["name"])
        if proj.get("url"):
            name = f'<link href="{proj["url"]}" color="#0e7490">{name}</link>'
        block = [Paragraph(f"<b>{name}</b> <font color='#6b7280' size='8.2'>— {plain(proj['meta'])}</font>",
                           ParagraphStyle("proj", parent=body, fontSize=9.1, leading=12, spaceAfter=1.2))]
        block += [Paragraph(b, bullet, bulletText="•") for b in proj["bullets"]]
        story.append(KeepTogether(block))
        story.append(Spacer(1, 3.5))

    # ---- education
    story.append(Paragraph("EDUCATION", section))
    for ed in EDUCATION:
        line = f'<b>{plain(ed["degree"])}</b> — {plain(ed["org"])}'
        dates = f' <font color="#4b5563">· {ed["dates"]}</font>' if ed["dates"] else ""
        story.append(Paragraph(line + dates, ParagraphStyle(
            "edu", parent=body, fontSize=9.0, leading=12, spaceAfter=0.6)))
        if ed["detail"]:
            story.append(Paragraph(ed["detail"], ParagraphStyle(
                "edu2", parent=body, fontSize=8.7, leading=11.2, textColor=MUTED,
                spaceAfter=2.4)))

    # ---- certifications + languages
    story.append(Paragraph("CERTIFICATIONS", section))
    for name, status in CERTIFICATIONS:
        story.append(Paragraph(
            f"{plain(name)} <font color='#6b7280'>— {status}</font>",
            ParagraphStyle("cert", parent=body, fontSize=8.9, leading=11.8, spaceAfter=0.8)))

    story.append(Paragraph("LANGUAGES", section))
    story.append(Paragraph(LANGUAGES, body))

    # ---- render
    doc = BaseDocTemplate(
        path, pagesize=A4,
        leftMargin=16 * mm, rightMargin=16 * mm, topMargin=11 * mm, bottomMargin=12 * mm,
        title=f"{NAME} — Resume", author=NAME,
        subject="Resume: IT support, operations, automation and cybersecurity",
        creator="scripts/build-resume.py",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main",
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    def decorate(canvas, doc_):
        canvas.saveState()
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        y = doc.bottomMargin - 6
        canvas.line(doc.leftMargin, y + 9, doc.leftMargin + doc.width, y + 9)
        canvas.setFont("Helvetica", 7.4)
        canvas.setFillColor(MUTED)
        canvas.drawString(doc.leftMargin, y, f"{NAME} · {EMAIL}")
        canvas.drawRightString(doc.leftMargin + doc.width, y,
                               f"Page {doc_.page}" + (f" of {total_pages}" if total_pages else ""))
        canvas.restoreState()

    def on_first(canvas, doc_):
        decorate(canvas, doc_)

    doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=decorate)])
    doc.build(story)


# --------------------------------------------------------------------------- #
# HTML (print-ready web version, same content)
# --------------------------------------------------------------------------- #
def build_html(path: str) -> None:
    def bullets(items):
        return "\n".join(f"        <li>{item}</li>" for item in items)

    exp_html = []
    for job in EXPERIENCE:
        exp_html.append(f"""      <section class="job">
        <div class="job-head">
          <h3>{job["role"]} <span class="org">— {job["org"]}</span></h3>
          <p class="dates">{job["dates"]}</p>
        </div>
        <p class="place">{job["place"]}</p>
        <ul>
{bullets(job["bullets"])}
        </ul>
      </section>""")

    proj_html = []
    for proj in PROJECTS:
        name = proj["name"]
        if proj.get("url"):
            name = f'<a href="{proj["url"]}">{proj["name"]}</a>'
        proj_html.append(f"""      <section class="job">
        <h3>{name} <span class="meta">— {proj["meta"]}</span></h3>
        <ul>
{bullets(proj["bullets"])}
        </ul>
      </section>""")

    skills_html = "\n".join(
        f'        <p><strong>{label}:</strong> {detail}</p>' for label, detail in SKILLS)

    edu_html = "\n".join(
        f'        <p><strong>{ed["degree"]}</strong> — {ed["org"]}'
        + (f' <span class="muted">· {ed["dates"]}</span>' if ed["dates"] else "")
        + (f'<br><span class="muted">{ed["detail"]}</span>' if ed["detail"] else "")
        + "</p>"
        for ed in EDUCATION)

    certs_html = "\n".join(
        f'        <p>{name} <span class="muted">— {status}</span></p>' for name, status in CERTIFICATIONS)

    links_html = " · ".join(f'<a href="{url}">{label}</a>' for label, url, _ in LINKS)

    doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{NAME} — Resume</title>
  <meta name="description" content="Resume: IT support, operations, automation and cybersecurity — {NAME}, Ibadan, Nigeria." />
  <meta name="robots" content="index, follow" />
  <meta name="theme-color" content="#0e7490" />
  <link rel="icon" type="image/svg+xml" href="../favicon.svg" />
  <!--
    Generated by scripts/build-resume.py. Edit the CONTENT block in that script and
    re-run it rather than editing this file by hand, or the PDF will drift.
    The PDF is the canonical artefact; this page exists so the resume is linkable
    and printable straight from the browser.
  -->
  <style>
    /* Deliberately light and plain: a resume should print, scan and parse cleanly. */
    :root {{
      --ink: #111827;
      --muted: #4b5563;
      --accent: #0e7490;
      --rule: #d1d5db;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      padding: 2.2rem 1.2rem 4rem;
      background: #f3f4f6;
      color: var(--ink);
      font: 400 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }}
    .sheet {{
      max-width: 820px;
      margin: 0 auto;
      background: #fff;
      padding: 2.6rem 2.8rem 3rem;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
      border-radius: 4px;
    }}
    .toolbar {{ max-width: 820px; margin: 0 auto 1rem; display: flex; gap: .75rem; flex-wrap: wrap; align-items: center; }}
    .toolbar a {{
      display: inline-block; padding: .55rem 1rem; border-radius: 6px;
      background: var(--accent); color: #fff; text-decoration: none;
      font-size: .9rem; font-weight: 600;
    }}
    .toolbar a.secondary {{ background: #fff; color: var(--accent); border: 1px solid var(--accent); }}
    .toolbar p {{ margin: 0; color: var(--muted); font-size: .85rem; }}
    header {{ border-bottom: 2px solid var(--accent); padding-bottom: .9rem; margin-bottom: 1.4rem; }}
    h1 {{ margin: 0; font-size: 2rem; letter-spacing: -0.02em; line-height: 1.1; }}
    .title {{ margin: .35rem 0 .55rem; color: var(--accent); font-weight: 600; font-size: .95rem; }}
    .contact, .links {{ margin: .2rem 0 0; color: var(--muted); font-size: .87rem; }}
    .links a {{ color: var(--accent); text-decoration: none; }}
    h2 {{
      font-size: .78rem; text-transform: uppercase; letter-spacing: .1em;
      color: var(--accent); margin: 1.6rem 0 .6rem; padding-bottom: .25rem;
      border-bottom: 1px solid var(--rule);
    }}
    p {{ margin: .3rem 0; }}
    ul {{ margin: .35rem 0 .2rem; padding-left: 1.15rem; }}
    li {{ margin: .22rem 0; }}
    .job {{ margin-bottom: .95rem; }}
    .job-head {{ display: flex; justify-content: space-between; gap: 1rem; align-items: baseline; flex-wrap: wrap; }}
    .job h3 {{ margin: 0; font-size: 1rem; }}
    .job .org {{ font-weight: 400; color: var(--muted); }}
    .dates {{ margin: 0; font-size: .82rem; font-weight: 700; color: var(--muted); white-space: nowrap; }}
    .place {{ margin: .1rem 0 0; font-size: .84rem; color: var(--muted); }}
    .meta {{ font-weight: 400; font-size: .82rem; color: var(--muted); }}
    .muted {{ color: var(--muted); }}
    strong {{ font-weight: 700; }}
    #skills p {{ font-size: .9rem; }}
    footer {{ margin-top: 2rem; padding-top: .8rem; border-top: 1px solid var(--rule); font-size: .82rem; color: var(--muted); }}
    footer a {{ color: var(--accent); }}
    @media print {{
      @page {{ size: A4; margin: 12mm 14mm; }}
      body {{ background: #fff; padding: 0; font-size: 9.6pt; line-height: 1.42; }}
      .sheet {{ box-shadow: none; padding: 0; max-width: none; border-radius: 0; }}
      .toolbar {{ display: none; }}
      h1 {{ font-size: 19pt; }}
      h2 {{ font-size: 8.4pt; margin: 11pt 0 3pt; }}
      a {{ color: inherit; text-decoration: none; }}
      .job {{ break-inside: avoid; }}
    }}
  </style>
</head>
<body>
  <div class="toolbar">
    <a href="./Fortune-Owivri-Resume.pdf" download>Download PDF</a>
    <a class="secondary" href="../">Back to site</a>
    <p>Use your browser's Print → Save as PDF only if you need a fresh copy.</p>
  </div>

  <main class="sheet">
    <header>
      <h1>{NAME}</h1>
      <p class="title">{TITLE}</p>
      <p class="contact">{LOCATION}<br>{PHONES} · <a href="mailto:{EMAIL}">{EMAIL}</a></p>
      <p class="links">{links_html}</p>
    </header>

    <h2>Professional summary</h2>
    <p>{SUMMARY}</p>

    <h2>Core skills</h2>
    <div id="skills">
{skills_html}
    </div>

    <h2>Professional experience</h2>
{chr(10).join(exp_html)}

    <h2>Selected projects</h2>
{chr(10).join(proj_html)}

    <h2>Education</h2>
{edu_html}

    <h2>Certifications</h2>
{certs_html}

    <h2>Languages</h2>
    <p>{LANGUAGES}</p>

    <footer>
      <p>{NAME} · {LOCATION} · <a href="mailto:{EMAIL}">{EMAIL}</a></p>
    </footer>
  </main>
</body>
</html>
"""
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(doc)


def main() -> int:
    try:
        import reportlab  # noqa: F401
    except ImportError:
        print("reportlab is required:  pip install reportlab", file=sys.stderr)
        return 2

    problems = check_no_agency_voice()
    if problems:
        for p in problems:
            print(f"ERROR {p}", file=sys.stderr)
        return 1

    os.makedirs(OUT_DIR, exist_ok=True)
    pdf_path = os.path.join(OUT_DIR, "Fortune-Owivri-Resume.pdf")
    html_path = os.path.join(OUT_DIR, "index.html")

    # Two-pass build so the footer can say "Page 1 of 2".
    tmp_path = pdf_path + ".tmp"
    build_pdf(tmp_path)
    import pypdf
    total = len(pypdf.PdfReader(tmp_path).pages)
    build_pdf(pdf_path, total_pages=total)
    os.remove(tmp_path)
    build_html(html_path)

    print(f"wrote {os.path.relpath(pdf_path, ROOT)}")
    print(f"wrote {os.path.relpath(html_path, ROOT)}")

    # Optional verification: page count + text extraction round-trip.
    try:
        from pypdf import PdfReader
    except ImportError:
        print("(pypdf not installed — skipping page/text verification)")
        return 0

    reader = PdfReader(pdf_path)
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    pages = len(reader.pages)
    print(f"pages: {pages}")
    required = [NAME, "PROFESSIONAL SUMMARY", "CORE SKILLS", "PROFESSIONAL EXPERIENCE",
                "SELECTED PROJECTS", "EDUCATION", "CERTIFICATIONS", EMAIL,
                "Summa Cum Laude", "n8n"]
    missing = [r for r in required if plain(r) not in text]
    if missing:
        print("ERROR missing from PDF text: " + ", ".join(missing), file=sys.stderr)
        return 1
    if pages > 2:
        print(f"ERROR resume spills to {pages} pages (limit is 2)", file=sys.stderr)
        return 1
    print(f"text verification: all {len(required)} anchors present, {len(text)} chars extractable")
    return 0


if __name__ == "__main__":
    sys.exit(main())
