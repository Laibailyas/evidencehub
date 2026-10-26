/**
 * Mock assessment output — the shape the Lambda returns.
 *
 * getAssessment() fetches live data when VITE_API_BASE is set, and falls back
 * to MOCK_ASSESSMENT on error or in MOCK mode so the report always renders.
 */

import { API_ENABLED, api } from '../lib/api';

export type Verdict = 'qualifies' | 'borderline' | 'not_qualifies';
export type FitLevel = 'strong' | 'fulfilled' | 'weak' | 'not_fulfilled';
export type EvidenceStrength = 'strong' | 'moderate' | 'low';
export type DimensionKey =
  | 'technical' | 'methodological' | 'uncertainty' | 'systematic' | 'outcomes';

export type Paper = {
  id: number;
  title: string;
  authors: string;
  year: number;
  citations: number;
  keyTakeaway: string;
  relevance: number;        // 0–1
  type: 'systematic_review' | 'experimental' | 'review' | 'highly_cited';
  pdfUrl?: string;
};

export type Assessment = {
  projectId: string;
  fitScore: number;            // 0–100, overall FZulG fit
  einordnung: {
    verdict: Verdict;
    justification: string;
    paragraphs: string[];
  };
  passformMatrix: {
    name: string;
    level: FitLevel;
    evidence: string;
  }[];
  literaturUberblick: string; // 2–3 paragraph synthesis (citations rendered as [1], [2])
  anspruchstabelle: {
    claim: string;
    evidence: EvidenceStrength;
    paperRefs: number[];
    legalRefs?: string[];
    reasoning: string;
  }[];
  forschungsluecken: {
    question: string;
    paperRefs: number[];
    fzulgRelevance: string;
  }[];
  neuheitsgrad: {
    overall: number;          // 0–100, novelty
    dimensions: {
      key: DimensionKey;
      score: number;          // 0–20
      rationale: string;
      paperRefs?: number[];
    }[];
  };
  fazit: {
    recommendation: Verdict;
    strengths: string[];
    risks: string[];
    documentationChecklist: string[];
  };
  papers: Paper[];
  /**
   * Bilingual prose overlay. Maps a language to a flat { path: text } object,
   * where `path` is a dot-separated location into this assessment (numeric
   * segments = array indices). Absent → English inline content is used as-is.
   */
  content?: Partial<Record<'de' | 'en', Record<string, string>>>;
};

export const MOCK_ASSESSMENT: Assessment = {
  projectId: 'p41',
  fitScore: 72,
  einordnung: {
    verdict: 'qualifies',
    justification:
      'The project demonstrates systematic R&D activity with genuine scientific uncertainty in the reward function design for adaptive MPPT control. Reinforcement learning generalisation across heterogeneous module geometries is an unresolved problem in the literature, which establishes the required novelty and uncertainty for FZulG eligibility.',
    paragraphs: ['§2 FZulG', '§2 Abs. 1', '§4 FZulG'],
  },
  passformMatrix: [
    { name: 'Neuartigkeit',          level: 'strong',     evidence: 'RL-based MPPT with adaptive reward shaping is not yet present in reviewed literature.' },
    { name: 'Technisches Risiko',    level: 'strong',     evidence: 'Generalisation of learned policies across bifacial geometries is flagged as future work in [4].' },
    { name: 'Systematik',            level: 'fulfilled',  evidence: 'Methodology specifies measurable outcomes, benchmark datasets, and ablation plan.' },
    { name: 'Planmäßigkeit',         level: 'fulfilled',  evidence: 'Project description includes phased milestones with explicit decision criteria.' },
    { name: 'Wissenschaftliche Ungewissheit', level: 'strong', evidence: 'Reward function design and policy transfer remain open problems across reviewed studies.' },
  ],
  literaturUberblick:
    'Recent literature on AI-driven photovoltaic control [1][2][3] converges on the conclusion that deep learning approaches outperform classical perturb-and-observe MPPT under variable irradiance, with reported gains of 8–22% in bifacial configurations and up to 41% in hybrid systems combining adaptive materials [1]. Systematic reviews [2][3] note, however, that reinforcement learning specifically remains underexplored and that most studies treat reward design as a fixed input rather than a research variable.\n\nThe transferability of learned control policies across module geometries is a recurring open question, flagged explicitly as future work in [4][9]. Field studies confirm bifacial gains with intelligent tracking, but no reviewed study resolves the generalisation problem directly. The combined evidence supports the position that genuine technical uncertainty exists in the proposed work, aligning with §2 Abs. 1 FZulG eligibility criteria.\n\nPolicy-side analyses [5] further distinguish between innovative R&D and incremental tuning; the proposed reward-shaping investigation falls clearly on the innovative side, since the contribution alters the learning objective rather than reapplying an existing one.',
  anspruchstabelle: [
    { claim: 'Novel AI-driven PV systems achieve significant efficiency gains', evidence: 'strong',  paperRefs: [1, 2, 7], reasoning: 'Multiple experimental studies show 10–40% yield improvement over conventional systems.' },
    { claim: 'Systematic R&D with technical uncertainty aligns with §2 FZulG', evidence: 'strong',  paperRefs: [3],       legalRefs: ['§2 FZulG', '§2 Abs. 1'], reasoning: 'Policy analyses confirm eligibility if genuine innovation/uncertainty is documented.' },
    { claim: 'Routine application of existing AI tools does not qualify',       evidence: 'moderate',paperRefs: [5],       legalRefs: ['§4 FZulG'], reasoning: 'Reviews distinguish between innovative R&D vs. incremental/routine development.' },
    { claim: 'Integration of smart materials enhances PV performance',          evidence: 'moderate',paperRefs: [1, 6],    reasoning: 'Studies show added value from hybrid nanocoatings / phase-change materials.' },
    { claim: 'RL reward functions generalise across heterogeneous module geometries', evidence: 'low', paperRefs: [4, 9], reasoning: 'Flagged as future work across reviewed literature — no study resolves this directly.' },
    { claim: 'Bifacial panels combined with AI MPPT outperform single-face arrays', evidence: 'moderate', paperRefs: [2, 8, 10], reasoning: 'Laboratory and field studies confirm 8–22% bifacial gain with intelligent tracking.' },
  ],
  forschungsluecken: [
    { question: 'How do learned RL policies for MPPT transfer across module geometries?', paperRefs: [4, 9],
      fzulgRelevance: 'A genuinely open question. Resolving it requires controlled experiments and constitutes systematic R&D under §2 Abs. 1.' },
    { question: 'What reward formulations balance short-term yield against panel degradation?', paperRefs: [1, 2],
      fzulgRelevance: 'No consensus in literature. The proposed reward-shaping investigation directly addresses this gap.' },
    { question: 'How robust is adaptive MPPT to sensor noise and partial shading?', paperRefs: [7, 10],
      fzulgRelevance: 'Field evidence is limited; further empirical work qualifies as scientific uncertainty.' },
  ],
  neuheitsgrad: {
    overall: 78,
    dimensions: [
      { key: 'technical',       score: 17, rationale: 'Adaptive reward shaping for MPPT is not present in reviewed literature.', paperRefs: [1, 2] },
      { key: 'methodological',  score: 15, rationale: 'Combines reinforcement learning with bifacial geometry — uncommon combination.', paperRefs: [3] },
      { key: 'uncertainty',     score: 18, rationale: 'Open questions in reward design and policy transfer are explicitly flagged in [4][9].' },
      { key: 'systematic',      score: 14, rationale: 'Methodology includes benchmark datasets, ablations, and measurable outcomes.' },
      { key: 'outcomes',        score: 14, rationale: 'Targets quantifiable efficiency gains; comparison vs. baselines specified.' },
    ],
  },
  fazit: {
    recommendation: 'qualifies',
    strengths: [
      'Genuine technical uncertainty documented in reward design and policy generalisation',
      'Strong fit with §2 Abs. 1 FZulG eligibility criteria',
      'Clear methodology with measurable outcomes and benchmark comparisons',
      'Identified research gaps directly addressed by the proposed work',
    ],
    risks: [
      'Documentation of experimental methodology must be rigorous to survive Finanzamt audit',
      'Distinguish "innovative R&D" from "incremental tuning" explicitly in final project record',
      'Capture intermediate negative results — they evidence the uncertainty claim',
    ],
    documentationChecklist: [
      'Technical hypothesis log with falsification criteria',
      'Bibliography of the 10 reviewed papers, with relevance annotations',
      'Records of reward-shaping experiments and ablations',
      'Time tracking per researcher per phase',
      'Comparison against perturb-and-observe baseline',
    ],
  },
  content: {
    de: {
      'einordnung.justification':
        'Das Projekt weist systematische FuE-Tätigkeit mit echter wissenschaftlicher Ungewissheit beim Entwurf der Belohnungsfunktion für die adaptive MPPT-Regelung auf. Die Generalisierung von Reinforcement-Learning-Strategien über heterogene Modulgeometrien hinweg ist ein in der Literatur ungelöstes Problem, was die für die FZulG-Förderfähigkeit erforderliche Neuheit und Ungewissheit begründet.',
      'passformMatrix.0.evidence': 'RL-basiertes MPPT mit adaptivem Reward-Shaping ist in der gesichteten Literatur noch nicht vertreten.',
      'passformMatrix.1.evidence': 'Die Generalisierung gelernter Strategien über bifaziale Geometrien hinweg wird in [4] ausdrücklich als künftige Arbeit benannt.',
      'passformMatrix.2.evidence': 'Die Methodik spezifiziert messbare Ergebnisse, Benchmark-Datensätze und einen Ablationsplan.',
      'passformMatrix.3.evidence': 'Die Projektbeschreibung enthält phasenweise Meilensteine mit expliziten Entscheidungskriterien.',
      'passformMatrix.4.evidence': 'Der Entwurf der Belohnungsfunktion und der Strategietransfer bleiben über die gesichteten Studien hinweg offene Probleme.',
      'literaturUberblick':
        'Die aktuelle Literatur zur KI-gestützten Photovoltaik-Regelung [1][2][3] kommt übereinstimmend zu dem Schluss, dass Deep-Learning-Ansätze das klassische Perturb-and-Observe-MPPT bei variabler Einstrahlung übertreffen, mit berichteten Zugewinnen von 8–22 % in bifazialen Konfigurationen und bis zu 41 % in Hybridsystemen mit adaptiven Materialien [1]. Systematische Übersichtsarbeiten [2][3] weisen jedoch darauf hin, dass insbesondere Reinforcement Learning bislang unzureichend erforscht ist und die meisten Studien den Entwurf der Belohnungsfunktion als feste Eingabe statt als Forschungsvariable behandeln.\n\nDie Übertragbarkeit gelernter Regelungsstrategien über Modulgeometrien hinweg ist eine wiederkehrende offene Frage, die in [4][9] ausdrücklich als künftige Arbeit benannt wird. Feldstudien bestätigen bifaziale Zugewinne mit intelligentem Tracking, doch keine der gesichteten Studien löst das Generalisierungsproblem unmittelbar. Die Gesamtevidenz stützt die Einschätzung, dass im geplanten Vorhaben echte technische Ungewissheit besteht, im Einklang mit den Förderkriterien des §2 Abs. 1 FZulG.\n\nFörderpolitische Analysen [5] unterscheiden ferner zwischen innovativer FuE und inkrementeller Optimierung; die geplante Untersuchung zum Reward-Shaping ist eindeutig der innovativen Seite zuzuordnen, da der Beitrag das Lernziel verändert, anstatt ein bestehendes erneut anzuwenden.',
      'anspruchstabelle.0.claim': 'Neuartige KI-gestützte PV-Systeme erzielen signifikante Effizienzgewinne',
      'anspruchstabelle.0.reasoning': 'Mehrere experimentelle Studien zeigen eine Ertragssteigerung von 10–40 % gegenüber konventionellen Systemen.',
      'anspruchstabelle.1.claim': 'Systematische FuE mit technischer Ungewissheit entspricht §2 FZulG',
      'anspruchstabelle.1.reasoning': 'Förderpolitische Analysen bestätigen die Förderfähigkeit, sofern echte Innovation bzw. Ungewissheit dokumentiert ist.',
      'anspruchstabelle.2.claim': 'Die routinemäßige Anwendung bestehender KI-Werkzeuge ist nicht förderfähig',
      'anspruchstabelle.2.reasoning': 'Übersichtsarbeiten unterscheiden zwischen innovativer FuE und inkrementeller bzw. routinemäßiger Entwicklung.',
      'anspruchstabelle.3.claim': 'Die Integration intelligenter Materialien verbessert die PV-Leistung',
      'anspruchstabelle.3.reasoning': 'Studien belegen einen Mehrwert durch hybride Nanobeschichtungen bzw. Phasenwechselmaterialien.',
      'anspruchstabelle.4.claim': 'RL-Belohnungsfunktionen generalisieren über heterogene Modulgeometrien hinweg',
      'anspruchstabelle.4.reasoning': 'Wird in der gesichteten Literatur als künftige Arbeit benannt — keine Studie löst dies unmittelbar.',
      'anspruchstabelle.5.claim': 'Bifaziale Module in Kombination mit KI-MPPT übertreffen einseitige Anlagen',
      'anspruchstabelle.5.reasoning': 'Labor- und Feldstudien bestätigen einen bifazialen Zugewinn von 8–22 % mit intelligentem Tracking.',
      'forschungsluecken.0.question': 'Wie lassen sich gelernte RL-Strategien für MPPT auf verschiedene Modulgeometrien übertragen?',
      'forschungsluecken.0.fzulgRelevance': 'Eine echte offene Frage. Ihre Klärung erfordert kontrollierte Experimente und stellt systematische FuE im Sinne des §2 Abs. 1 dar.',
      'forschungsluecken.1.question': 'Welche Belohnungsformulierungen wägen kurzfristigen Ertrag gegen Moduldegradation ab?',
      'forschungsluecken.1.fzulgRelevance': 'Kein Konsens in der Literatur. Die geplante Untersuchung zum Reward-Shaping adressiert diese Lücke unmittelbar.',
      'forschungsluecken.2.question': 'Wie robust ist adaptives MPPT gegenüber Sensorrauschen und Teilverschattung?',
      'forschungsluecken.2.fzulgRelevance': 'Die Feldevidenz ist begrenzt; weitere empirische Arbeiten gelten als wissenschaftliche Ungewissheit.',
      'neuheitsgrad.dimensions.0.rationale': 'Adaptives Reward-Shaping für MPPT ist in der gesichteten Literatur nicht vorhanden.',
      'neuheitsgrad.dimensions.1.rationale': 'Kombiniert Reinforcement Learning mit bifazialer Geometrie — eine seltene Kombination.',
      'neuheitsgrad.dimensions.2.rationale': 'Offene Fragen beim Entwurf der Belohnungsfunktion und beim Strategietransfer werden in [4][9] ausdrücklich benannt.',
      'neuheitsgrad.dimensions.3.rationale': 'Die Methodik umfasst Benchmark-Datensätze, Ablationen und messbare Ergebnisse.',
      'neuheitsgrad.dimensions.4.rationale': 'Zielt auf quantifizierbare Effizienzgewinne ab; ein Vergleich mit Baselines ist spezifiziert.',
      'fazit.strengths.0': 'Echte technische Ungewissheit beim Entwurf der Belohnungsfunktion und der Strategie-Generalisierung dokumentiert',
      'fazit.strengths.1': 'Hohe Passung mit den Förderkriterien des §2 Abs. 1 FZulG',
      'fazit.strengths.2': 'Klare Methodik mit messbaren Ergebnissen und Benchmark-Vergleichen',
      'fazit.strengths.3': 'Identifizierte Forschungslücken werden durch das geplante Vorhaben unmittelbar adressiert',
      'fazit.risks.0': 'Die Dokumentation der experimentellen Methodik muss einer Prüfung durch das Finanzamt standhalten',
      'fazit.risks.1': '„Innovative FuE“ ist im abschließenden Projektbericht ausdrücklich von „inkrementeller Optimierung“ abzugrenzen',
      'fazit.risks.2': 'Negative Zwischenergebnisse sind festzuhalten — sie belegen die geltend gemachte Ungewissheit',
      'fazit.documentationChecklist.0': 'Protokoll der technischen Hypothesen mit Falsifikationskriterien',
      'fazit.documentationChecklist.1': 'Literaturverzeichnis der 10 gesichteten Veröffentlichungen mit Relevanzannotationen',
      'fazit.documentationChecklist.2': 'Aufzeichnungen der Reward-Shaping-Experimente und Ablationen',
      'fazit.documentationChecklist.3': 'Zeiterfassung je Forscher und je Phase',
      'fazit.documentationChecklist.4': 'Vergleich mit der Perturb-and-Observe-Baseline',
    },
  },
  papers: [
    { id: 1,  title: 'Artificial intelligence based hybrid solar energy systems with smart materials and adaptive photovoltaics for sustainable power generation',
              authors: 'Mamodiya, U. et al.',         year: 2025, citations: 14,  type: 'highly_cited',     relevance: 0.96,
              keyTakeaway: 'AI-enhanced hybrid system with smart materials and adaptive photovoltaics significantly improves solar energy efficiency, achieving a 41.4% increase in annual energy yield and reducing panel temperature by 11.9 °C.' },
    { id: 2,  title: 'Artificial Intelligence Techniques for the Photovoltaic System: A Systematic Review and Analysis for Evaluation and Benchmarking',
              authors: 'Khan, M. & Lee, J.',          year: 2025, citations: 210, type: 'systematic_review', relevance: 0.91,
              keyTakeaway: 'AI techniques show potential as design tools in PV systems, enabling meteorological data forecasting, system sizing, modeling, simulation, and control.' },
    { id: 3,  title: 'Artificial intelligence techniques for photovoltaic applications: A review',
              authors: 'Rodríguez-Pajarón, P. et al.', year: 2025, citations: 210, type: 'review',            relevance: 0.88,
              keyTakeaway: 'AI techniques show potential as design tools in PV systems, enabling meteorological data forecasting, system sizing, modeling, simulation, and control.' },
    { id: 4,  title: 'Generalisation of reinforcement learning policies in renewable energy control',
              authors: 'Chen, X. & Müller, A.',       year: 2024, citations: 47,  type: 'experimental',      relevance: 0.84,
              keyTakeaway: 'Cross-geometry generalisation of RL controllers remains an unresolved problem; transfer accuracy degrades sharply outside the training distribution.' },
    { id: 5,  title: 'Tax incentives for R&D: distinguishing innovation from routine development',
              authors: 'Bundesfinanzministerium',      year: 2024, citations: 9,   type: 'review',            relevance: 0.79,
              keyTakeaway: 'Policy guidance clarifies that R&D tax credit eligibility requires demonstrable scientific uncertainty and a systematic approach.' },
    { id: 6,  title: 'Hybrid nanocoatings for photovoltaic module performance',
              authors: 'Ito, S. et al.',              year: 2024, citations: 33,  type: 'experimental',      relevance: 0.74,
              keyTakeaway: 'Hybrid nano-coatings and phase-change materials improve PV performance under high-irradiance conditions.' },
    { id: 7,  title: 'Robust MPPT under partial shading: a comparative evaluation',
              authors: 'Verma, R. et al.',            year: 2024, citations: 58,  type: 'experimental',      relevance: 0.72,
              keyTakeaway: 'Adaptive MPPT methods retain >90% of nominal output under partial shading, vs. ~70% for classical P&O.' },
    { id: 8,  title: 'Bifacial photovoltaic arrays with intelligent tracking',
              authors: 'Garcia, M. & Park, H.',       year: 2023, citations: 102, type: 'experimental',      relevance: 0.70,
              keyTakeaway: 'Bifacial arrays paired with intelligent tracking achieve 8–22% gain over single-face installations.' },
    { id: 9,  title: 'Transfer learning for energy system control: a survey',
              authors: 'Schmidt, P. et al.',          year: 2024, citations: 71,  type: 'review',            relevance: 0.66,
              keyTakeaway: 'Transfer learning for energy control is underexplored; promising but lacks standardised benchmarks.' },
    { id: 10, title: 'Field deployment of AI-MPPT controllers in commercial PV plants',
              authors: 'Hansen, T. et al.',           year: 2024, citations: 28,  type: 'experimental',      relevance: 0.64,
              keyTakeaway: 'Field deployment confirms simulation gains, but identifies sensor calibration and edge cases as practical barriers.' },
  ],
};

/**
 * Fetch a live assessment when the API is configured. Only local MOCK mode may
 * use canned demo content; live API errors must never masquerade as results.
 */
export async function getAssessment(projectId: string): Promise<Assessment> {
  if (API_ENABLED) return await api.getAssessment(projectId);
  return { ...MOCK_ASSESSMENT, projectId };
}

/**
 * Overlay the language-specific prose in `assessment.content[lang]` onto a copy
 * of the assessment. Paths are dot-separated (numeric segments = array indices).
 * Unknown/missing paths are skipped; absent overlay returns the input unchanged
 * (English inline content). Only pre-existing leaves are overwritten.
 */
export function localizeAssessment(a: Assessment, lang: 'de' | 'en'): Assessment {
  const overlay = a.content?.[lang];
  if (!overlay) return a;
  const clone: Assessment = JSON.parse(JSON.stringify(a));
  for (const [path, value] of Object.entries(overlay)) {
    if (typeof value !== 'string' || !value) continue;
    const segs = path.split('.');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cur: any = clone;
    let ok = true;
    for (let i = 0; i < segs.length - 1; i++) {
      const key: string | number = /^\d+$/.test(segs[i]) ? Number(segs[i]) : segs[i];
      if (cur == null || cur[key] == null) { ok = false; break; }
      cur = cur[key];
    }
    if (!ok) continue;
    const lastRaw = segs[segs.length - 1];
    const last: string | number = /^\d+$/.test(lastRaw) ? Number(lastRaw) : lastRaw;
    if (cur != null && cur[last] !== undefined) cur[last] = value;
  }
  return clone;
}
