"""Render an assessment to a branded, formatted PDF (pure-Python, no binary deps).

Uses fpdf 1.7.2 (zero dependencies) so it builds for Lambda regardless of the
host `sam build` runs on. Layout is typographic (headings + paragraphs + labeled
blocks + bullet lists) rather than wrapping grids, which fpdf 1.x handles poorly.

Bilingual: reuses the `assessment.content` overlay written by the pipeline
(Step 6). Chrome labels are translated from the small L table below.
"""

from __future__ import annotations

import copy
from typing import Any

from fpdf import FPDF

# Brand + ink palette (RGB).
BRAND = (60, 69, 232)      # #3C45E8
INK = (28, 31, 38)
MUTED = (110, 116, 130)
RULE = (228, 230, 240)
OK = (22, 130, 70)
BAD = (190, 50, 50)

PAGE_W = 210.0
MARGIN = 18.0
BODY_W = PAGE_W - 2 * MARGIN

# ── Bilingual chrome labels ───────────────────────────────────
L = {
    "de": {
        "report_title": "FZulG-Gutachten",
        "project": "Projekt", "reference": "Referenz", "date": "Datum",
        "fit": "Gesamt-Fit", "novelty": "Neuheitsgrad", "recommendation": "Empfehlung",
        "sec_einordnung": "1 · Einordnung FZulG-Fit",
        "sec_passform": "2 · Passform-Matrix",
        "sec_literatur": "3 · Literaturüberblick",
        "sec_anspruch": "4 · Anspruchstabelle",
        "sec_luecken": "5 · Forschungslücken",
        "sec_neuheit": "6 · Neuheitsgrad",
        "sec_fazit": "7 · Fazit",
        "sec_referenzen": "Quellen / Referenzen",
        "paragraphs": "Anwendbare Paragraphen",
        "strengths": "Stärken", "risks": "Risiken", "checklist": "Dokumentations-Checkliste",
        "refs": "Quellen", "legal": "Rechtsgrundlagen", "relevance": "Relevanz", "citations": "Zitate", "source": "Quelle",
        "evidence": "Evidenz",
        "verdict": {"qualifies": "Förderfähig", "borderline": "Grenzfall", "not_qualifies": "Nicht förderfähig"},
        "level": {"strong": "stark", "fulfilled": "erfüllt", "weak": "schwach", "not_fulfilled": "nicht erfüllt"},
        "strength": {"strong": "stark", "moderate": "mittel", "low": "gering"},
        "dim": {"technical": "Technisch", "methodological": "Methodisch", "uncertainty": "Ungewissheit",
                "systematic": "Systematik", "outcomes": "Ergebnisse"},
        "ptype": {"systematic_review": "Systematisches Review", "review": "Review",
                  "highly_cited": "Häufig zitiert", "experimental": "Experimentell"},
    },
    "en": {
        "report_title": "FZulG Assessment",
        "project": "Project", "reference": "Reference", "date": "Date",
        "fit": "Overall fit", "novelty": "Novelty", "recommendation": "Recommendation",
        "sec_einordnung": "1 · FZulG Fit",
        "sec_passform": "2 · Fit matrix",
        "sec_literatur": "3 · State of research",
        "sec_anspruch": "4 · Claims table",
        "sec_luecken": "5 · Open questions",
        "sec_neuheit": "6 · Novelty",
        "sec_fazit": "7 · Conclusion",
        "sec_referenzen": "Sources / References",
        "paragraphs": "Applicable paragraphs",
        "strengths": "Strengths", "risks": "Risks", "checklist": "Documentation checklist",
        "refs": "Refs", "legal": "Legal basis", "relevance": "Relevance", "citations": "citations", "source": "Source",
        "evidence": "Evidence",
        "verdict": {"qualifies": "Qualifies", "borderline": "Borderline", "not_qualifies": "Does not qualify"},
        "level": {"strong": "strong", "fulfilled": "fulfilled", "weak": "weak", "not_fulfilled": "not fulfilled"},
        "strength": {"strong": "strong", "moderate": "moderate", "low": "low"},
        "dim": {"technical": "Technical", "methodological": "Methodological", "uncertainty": "Uncertainty",
                "systematic": "Systematic", "outcomes": "Outcomes"},
        "ptype": {"systematic_review": "Systematic review", "review": "Review",
                  "highly_cited": "Highly cited", "experimental": "Experimental"},
    },
}

_UNICODE_FALLBACKS = {
    "„": '"', "“": '"', "”": '"', "‚": "'", "‘": "'", "’": "'",
    "–": "-", "—": "-", "…": "...", "•": "-", "→": "->", "↳": "-",
    "≥": ">=", "≤": "<=", "×": "x", "™": "(TM)", "€": "EUR",
}


def _safe(s: Any) -> str:
    """fpdf core fonts are latin-1; map common Unicode punctuation, then drop
    anything still outside latin-1 so output never crashes."""
    s = "" if s is None else str(s)
    for k, v in _UNICODE_FALLBACKS.items():
        s = s.replace(k, v)
    return s.encode("latin-1", "replace").decode("latin-1")


def _num(v: Any, default: int = 0) -> int:
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return default


def _localize(a: dict, lang: str) -> dict:
    """Apply the language overlay (path -> text) onto a copy of the assessment."""
    overlay = (a.get("content") or {}).get(lang)
    if not overlay:
        return a
    c = copy.deepcopy(a)
    for path, val in overlay.items():
        if not isinstance(val, str) or not val:
            continue
        segs = path.split(".")
        cur: Any = c
        ok = True
        for s in segs[:-1]:
            key: Any = int(s) if s.isdigit() else s
            try:
                cur = cur[key]
            except (KeyError, IndexError, TypeError):
                ok = False
                break
        if not ok:
            continue
        last = segs[-1]
        lk: Any = int(last) if last.isdigit() else last
        try:
            cur[lk] = val  # set; if missing leaf, fpdf still fine, but guard:
        except (KeyError, IndexError, TypeError):
            pass
    return c


class _PDF(FPDF):
    def footer(self) -> None:
        self.set_y(-14)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 8, _safe(f"plusquam · FZulG · {self.page_no()}"), align="C")


# ── small typographic helpers ─────────────────────────────────

def _break_long_words(pdf: _PDF, text: str, max_w: float) -> str:
    """fpdf's multi_cell raises if a single token is wider than the line.
    Real data (long titles, DOIs, URLs) has such tokens — hard-split them so
    they wrap instead of crashing. Requires the font to be set by the caller."""
    out: list[str] = []
    for word in text.split(" "):
        if not word or pdf.get_string_width(word) <= max_w:
            out.append(word)
            continue
        chunk = ""
        for ch in word:
            if chunk and pdf.get_string_width(chunk + ch) > max_w:
                out.append(chunk)
                chunk = ch
            else:
                chunk += ch
        if chunk:
            out.append(chunk)
    return " ".join(out)


def _mc(pdf: _PDF, h: float, text: str, w: float = BODY_W) -> None:
    pdf.multi_cell(w, h, _break_long_words(pdf, _safe(text), w - 1.0))


def _h2(pdf: _PDF, text: str) -> None:
    pdf.ln(3)
    pdf.set_text_color(*BRAND)
    pdf.set_font("Helvetica", "B", 13)
    _mc(pdf, 7, text)
    pdf.set_draw_color(*RULE)
    y = pdf.get_y() + 0.5
    pdf.line(MARGIN, y, MARGIN + BODY_W, y)
    pdf.ln(2.5)


def _para(pdf: _PDF, text: str, size: float = 10, style: str = "", color=INK, h: float = 5.2) -> None:
    pdf.set_text_color(*color)
    pdf.set_font("Helvetica", style, size)
    _mc(pdf, h, text)


def _label(pdf: _PDF, text: str) -> None:
    pdf.set_text_color(*MUTED)
    pdf.set_font("Helvetica", "B", 8)
    _mc(pdf, 4.5, text.upper())


def _bullets(pdf: _PDF, items: list, color=INK) -> None:
    pdf.set_text_color(*color)
    pdf.set_font("Helvetica", "", 10)
    for it in items or []:
        _mc(pdf, 5.0, "- " + str(it))
        pdf.ln(0.4)


def _refs_line(pdf: _PDF, t: dict, paper_refs, legal_refs=None) -> None:
    bits = []
    if paper_refs:
        bits.append(f"{t['refs']}: " + ", ".join(str(r) for r in paper_refs))
    if legal_refs:
        bits.append(f"{t['legal']}: " + ", ".join(str(r) for r in legal_refs))
    if not bits:
        return
    pdf.set_text_color(*MUTED)
    pdf.set_font("Helvetica", "", 8.5)
    _mc(pdf, 4.4, "   " + "   ·   ".join(bits))


# ── main entry ────────────────────────────────────────────────

def render_assessment_pdf(project: dict, assessment: dict, lang: str = "de") -> bytes:
    """Public entry — never raises. On any rendering error it returns a minimal
    one-page PDF, so the client always receives a real PDF download instead of
    the server 500ing into an ugly browser-print fallback."""
    try:
        return _render_impl(project, assessment, lang)
    except Exception as e:  # pragma: no cover — last-resort safety net
        print(f"pdf render failed type={type(e).__name__}; returning fallback PDF")
        return _fallback_pdf(project, lang)


def _fallback_pdf(project: dict, lang: str) -> bytes:
    t = L.get(lang, L["de"])
    pdf = _PDF(format="A4", unit="mm")
    pdf.set_auto_page_break(True, margin=18)
    pdf.set_margins(MARGIN, MARGIN, MARGIN)
    pdf.add_page()
    pdf.set_fill_color(*BRAND)
    pdf.rect(0, 0, PAGE_W, 30, "F")
    pdf.set_xy(MARGIN, 11)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 20)
    pdf.cell(0, 8, _safe("plusquam"), ln=1)
    pdf.set_y(42)
    pdf.set_text_color(*INK)
    pdf.set_font("Helvetica", "B", 15)
    _mc(pdf, 7, project.get("title", "—"))
    pdf.ln(4)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(*MUTED)
    _mc(pdf, 5.5, t["report_title"] + ".")
    out = pdf.output(dest="S")
    return out.encode("latin-1") if isinstance(out, str) else bytes(out)


def _render_impl(project: dict, assessment: dict, lang: str = "de") -> bytes:
    lang = lang if lang in L else "de"
    t = L[lang]
    a = _localize(assessment, lang)

    pdf = _PDF(format="A4", unit="mm")
    pdf.set_auto_page_break(True, margin=18)
    pdf.set_margins(MARGIN, MARGIN, MARGIN)
    pdf.add_page()

    # ── Hero band ──
    pdf.set_fill_color(*BRAND)
    pdf.rect(0, 0, PAGE_W, 30, "F")
    pdf.set_xy(MARGIN, 9)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 20)
    pdf.cell(0, 8, _safe("plusquam"), ln=1)
    pdf.set_x(MARGIN)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, _safe(t["report_title"]), ln=1)
    pdf.set_y(38)

    # ── Title + meta ──
    pdf.set_text_color(*INK)
    pdf.set_font("Helvetica", "B", 16)
    _mc(pdf, 7.5, project.get("title", "—"))
    meta = []
    if project.get("reference"):
        meta.append(f"{t['reference']}: {project['reference']}")
    created = (project.get("createdAt") or "")[:10]
    if created:
        meta.append(f"{t['date']}: {created}")
    if project.get("domains"):
        meta.append(", ".join(str(d) for d in project["domains"]))
    if meta:
        pdf.set_text_color(*MUTED)
        pdf.set_font("Helvetica", "", 9)
        _mc(pdf, 5, "   ·   ".join(meta))
    pdf.ln(2)

    # ── Summary chips row ──
    fit = _num(assessment.get("fitScore"))
    nov = _num((assessment.get("neuheitsgrad") or {}).get("overall"))
    rec = (a.get("fazit") or {}).get("recommendation") or (a.get("einordnung") or {}).get("verdict") or ""
    _summary_row(pdf, t, fit, nov, t["verdict"].get(rec, rec))

    # 1 — Einordnung
    ein = a.get("einordnung") or {}
    _h2(pdf, t["sec_einordnung"])
    _para(pdf, f"{t['recommendation']}: {t['verdict'].get(ein.get('verdict',''), ein.get('verdict',''))}"
               f"      {t['fit']}: {fit}/100", style="B", color=BRAND, size=11)
    pdf.ln(1)
    _para(pdf, ein.get("justification", ""))
    if ein.get("paragraphs"):
        pdf.ln(1)
        _label(pdf, t["paragraphs"])
        _para(pdf, ", ".join(str(x) for x in ein["paragraphs"]))

    # 2 — Passform matrix
    _h2(pdf, t["sec_passform"])
    for row in a.get("passformMatrix") or []:
        lvl = t["level"].get(row.get("level", ""), row.get("level", ""))
        _para(pdf, f"{row.get('name','')}  —  {lvl}", style="B", size=10.5)
        _para(pdf, row.get("evidence", ""), color=MUTED, size=9.5)
        pdf.ln(1)

    # 3 — Literaturüberblick
    _h2(pdf, t["sec_literatur"])
    for block in str(a.get("literaturUberblick", "")).split("\n\n"):
        if block.strip():
            _para(pdf, block.strip())
            pdf.ln(1.2)

    # 4 — Anspruchstabelle
    _h2(pdf, t["sec_anspruch"])
    for row in a.get("anspruchstabelle") or []:
        strength = t["strength"].get(row.get("evidence", ""), row.get("evidence", ""))
        _para(pdf, f"{row.get('claim','')}", style="B", size=10.5)
        _para(pdf, f"{t['evidence']}: {strength}. {row.get('reasoning','')}", color=MUTED, size=9.5)
        _refs_line(pdf, t, row.get("paperRefs"), row.get("legalRefs"))
        pdf.ln(1.2)

    # 5 — Forschungslücken
    _h2(pdf, t["sec_luecken"])
    for row in a.get("forschungsluecken") or []:
        _para(pdf, row.get("question", ""), style="B", size=10.5)
        _para(pdf, row.get("fzulgRelevance", ""), color=MUTED, size=9.5)
        _refs_line(pdf, t, row.get("paperRefs"))
        pdf.ln(1.2)

    # 6 — Neuheitsgrad
    _h2(pdf, t["sec_neuheit"])
    _para(pdf, f"{t['novelty']}: {nov}/100", style="B", color=BRAND, size=11)
    pdf.ln(1)
    for d in (a.get("neuheitsgrad") or {}).get("dimensions") or []:
        name = t["dim"].get(d.get("key", ""), d.get("key", ""))
        _para(pdf, f"{name}  —  {_num(d.get('score'))}/20", style="B", size=10.5)
        _para(pdf, d.get("rationale", ""), color=MUTED, size=9.5)
        _refs_line(pdf, t, d.get("paperRefs"))
        pdf.ln(1)

    # 7 — Fazit
    faz = a.get("fazit") or {}
    _h2(pdf, t["sec_fazit"])
    _para(pdf, f"{t['recommendation']}: {t['verdict'].get(faz.get('recommendation',''), faz.get('recommendation',''))}",
          style="B", color=BRAND, size=11)
    pdf.ln(1)
    if faz.get("strengths"):
        _label(pdf, t["strengths"]); _bullets(pdf, faz["strengths"], color=OK); pdf.ln(1)
    if faz.get("risks"):
        _label(pdf, t["risks"]); _bullets(pdf, faz["risks"], color=BAD); pdf.ln(1)
    if faz.get("documentationChecklist"):
        _label(pdf, t["checklist"]); _bullets(pdf, faz["documentationChecklist"]); pdf.ln(1)

    # References
    _h2(pdf, t["sec_referenzen"])
    for p in a.get("papers") or []:
        ptype = t["ptype"].get(p.get("type", ""), p.get("type", ""))
        _para(pdf, f"[{p.get('id')}] {p.get('title','')}", style="B", size=10)
        meta_bits = [str(x) for x in [
            p.get("year"),
            f"{_num(p.get('citations'))} {t['citations']}",
            p.get("authors", ""),
            ptype,
        ] if x]
        _para(pdf, "   " + "  ·  ".join(meta_bits), color=MUTED, size=8.5)
        if p.get("keyTakeaway"):
            _para(pdf, p["keyTakeaway"], color=INK, size=9)
        src = p.get("sourceUrl") or p.get("pdfUrl") or p.get("openalexId")
        if src:
            src = str(src)
            disp = src if len(src) <= 92 else src[:90] + "..."
            pdf.set_font("Helvetica", "", 8.5)
            pdf.set_text_color(*MUTED)
            pdf.write(4.6, _safe(f"   {t['source']}: "))
            pdf.set_text_color(*BRAND)
            pdf.write(4.6, _safe(disp), link=src)
            pdf.ln(5)
        pdf.ln(1.4)

    out = pdf.output(dest="S")
    return out.encode("latin-1") if isinstance(out, str) else bytes(out)


def _summary_row(pdf: _PDF, t: dict, fit: int, nov: int, rec_label: str) -> None:
    """Three side-by-side stat chips."""
    gap = 4.0
    w = (BODY_W - 2 * gap) / 3
    x0 = MARGIN
    y0 = pdf.get_y()
    chips = [(t["fit"], f"{fit}/100"), (t["novelty"], f"{nov}/100"), (t["recommendation"], rec_label)]
    for i, (label, value) in enumerate(chips):
        x = x0 + i * (w + gap)
        pdf.set_fill_color(244, 245, 252)
        pdf.rect(x, y0, w, 16, "F")
        pdf.set_xy(x + 3, y0 + 2.5)
        pdf.set_text_color(*MUTED)
        pdf.set_font("Helvetica", "B", 7.5)
        pdf.cell(w - 6, 4, _safe(label.upper()))
        pdf.set_xy(x + 3, y0 + 7.5)
        pdf.set_text_color(*BRAND)
        pdf.set_font("Helvetica", "B", 13)
        pdf.cell(w - 6, 6, _safe(value))
    pdf.set_y(y0 + 16 + 2)
