/**
 * plusquam — lightweight i18n
 *
 * Element opts in via data-attributes:
 *   <h1 data-i18n="signin.heading">Anmelden</h1>
 *   <input data-i18n-placeholder="signin.email.placeholder">
 *   <button data-i18n-aria="some.aria.key">
 *
 * Language is detected from localStorage > browser > default ('de').
 * Toggle buttons opt in with data-lang-toggle="de" | "en".
 */

const PQ_TRANSLATIONS = {
  en: {
    'signin.heading':            'Sign in',
    'signin.workspace':          'Workspace: FZulG Project Evaluation',
    'signin.role.user':          'User',
    'signin.role.admin':         'Admin',
    'signin.email.label':        'Email',
    'signin.email.placeholder':  'Enter your email',
    'signin.password.label':     'Password',
    'signin.password.placeholder': '••••••••',
    'signin.password.forgot':    'Forgot password?',
    'signin.password.forgot_msg': 'No automatic reset — contact a plusquam admin or email research@plusquam.xyz',
    'signin.submit':             'Sign in →',
    'signin.eu_notice':          'All data stays in EU infrastructure',
    'signin.feature.roles':      'Assessor & Admin roles',
    'signin.feature.gdpr':       'GDPR compliant — EU data residency',
    'signin.feature.audit':      'Audit-ready PDF reports',
    'signin.page_title':         'plusquam — Sign in',

    'landing.page_title':        'plusquam — AI-powered FZulG assessment',
    'landing.nav.signin':        'Sign in',
    'landing.nav.cta':           'Request demo',
    'landing.eyebrow':           'FZulG assessment',
    'landing.h1':                'AI-powered FZulG assessment. Audit-ready reports.',
    'landing.sub':               'plusquam analyses your R&D projects against the FZulG, retrieves relevant literature, and produces a novelty score with full reasoning — in minutes, not weeks.',
    'landing.cta.primary':       'Sign in →',
    'landing.eu':                'All data stays in EU infrastructure',
    'landing.f1.title':          'Literature in seconds',
    'landing.f1.body':           'Research literature via OpenAlex. AI-assisted synthesis with citations.',
    'landing.f2.title':          'Novelty score on 5 dimensions',
    'landing.f2.body':           'Technical novelty, methodological novelty, scientific uncertainty, systematic approach, expected outcomes.',
    'landing.f3.title':          'Audit-ready PDF reports',
    'landing.f3.body':           'Claims table, research gaps, fit matrix — every claim grounded in a cited source.',
    'landing.footer.gdpr':       'GDPR-compliant — EU data residency'
  },
  de: {
    'signin.heading':            'Anmelden',
    'signin.workspace':          'Workspace: FZulG Projekt-Evaluierung',
    'signin.role.user':          'Nutzer',
    'signin.role.admin':         'Admin',
    'signin.email.label':        'E-Mail',
    'signin.email.placeholder':  'Geben Sie Ihre E-Mail ein',
    'signin.password.label':     'Passwort',
    'signin.password.placeholder': '••••••••',
    'signin.password.forgot':    'Passwort vergessen?',
    'signin.password.forgot_msg': 'Kein automatisches Zurücksetzen — wenden Sie sich an einen plusquam-Admin oder schreiben Sie an research@plusquam.xyz',
    'signin.submit':             'Anmelden →',
    'signin.eu_notice':          'Alle Daten verbleiben in der EU-Infrastruktur',
    'signin.feature.roles':      'Gutachter- & Administrator-Rollen',
    'signin.feature.gdpr':       'DSGVO-konform — EU-Datenresidenz',
    'signin.feature.audit':      'Prüfungssichere PDF-Berichte',
    'signin.page_title':         'plusquam — Anmelden',

    'landing.page_title':        'plusquam — KI-gestützte FZulG-Bewertung',
    'landing.nav.signin':        'Anmelden',
    'landing.nav.cta':           'Demo anfordern',
    'landing.eyebrow':           'FZulG-Bewertung',
    'landing.h1':                'KI-gestützte FZulG-Bewertung. Prüfungssichere Berichte.',
    'landing.sub':               'plusquam analysiert Ihre F&E-Projekte gegen das FZulG, sucht passende Literatur und liefert einen Neuheits-Score samt vollständiger Begründung — in Minuten, nicht Wochen.',
    'landing.cta.primary':       'Anmelden →',
    'landing.eu':                'Alle Daten verbleiben in der EU-Infrastruktur',
    'landing.f1.title':          'Literatur in Sekunden',
    'landing.f1.body':           'Fachliteratur über OpenAlex. KI-gestützte Synthese mit Quellenangaben.',
    'landing.f2.title':          'Neuheits-Score auf 5 Dimensionen',
    'landing.f2.body':           'Technische Neuheit, methodische Neuheit, wissenschaftliche Ungewissheit, Systematik, erwartete Ergebnisse.',
    'landing.f3.title':          'Prüfungssichere PDF-Berichte',
    'landing.f3.body':           'Anspruchstabelle, Forschungslücken, Passform-Matrix — jede Aussage mit Quellenangabe belegt.',
    'landing.footer.gdpr':       'DSGVO-konform — EU-Datenresidenz'
  }
};

const PQ_LANG_KEY = 'plusquam_lang';

function pqDetectLang() {
  const stored = localStorage.getItem(PQ_LANG_KEY);
  if (stored && PQ_TRANSLATIONS[stored]) return stored;
  const browser = (navigator.language || 'de').slice(0, 2).toLowerCase();
  return PQ_TRANSLATIONS[browser] ? browser : 'de';
}

function pqApplyTranslations(lang) {
  const dict = PQ_TRANSLATIONS[lang];
  if (!dict) return;

  document.documentElement.lang = lang;
  // Page-specific title: pages can set <html data-i18n-title="landing.page_title">.
  // Falls back to signin.page_title for back-compat with the existing signin.html.
  const titleKey = document.documentElement.dataset.i18nTitle || 'signin.page_title';
  if (dict[titleKey]) document.title = dict[titleKey];

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const v = dict[el.dataset.i18n];
    if (v !== undefined) el.textContent = v;
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const v = dict[el.dataset.i18nPlaceholder];
    if (v !== undefined) el.placeholder = v;
  });

  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    const v = dict[el.dataset.i18nAria];
    if (v !== undefined) el.setAttribute('aria-label', v);
  });

  document.querySelectorAll('[data-lang-toggle]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.langToggle === lang));
  });

  localStorage.setItem(PQ_LANG_KEY, lang);
}

function pqInitI18n() {
  pqApplyTranslations(pqDetectLang());
  document.querySelectorAll('[data-lang-toggle]').forEach(btn => {
    btn.addEventListener('click', () => pqApplyTranslations(btn.dataset.langToggle));
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', pqInitI18n);
} else {
  pqInitI18n();
}
