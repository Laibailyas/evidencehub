export type Domain =
  | 'AI/ML'
  | 'Biomedical'
  | 'Power Elec.'
  | 'Materials'
  | 'Photonics'
  | 'Electrochem.'
  | 'Aerospace'
  | 'Manufacturing';

export type ProjectStatus = 'complete' | 'processing' | 'error';

export type Project = {
  id: string;
  name: string;
  clientId: string;          // depersonalised
  domain: Domain;
  submittedAt: string;       // ISO date
  noveltyScore: number | null; // null while processing
  status: ProjectStatus;
};

// Mirrors the demo set in the screenshots and pads to 47 to make the table feel real.
export const mockProjects: Project[] = [
  { id: 'p41', name: 'AI-Powered Solar Panels R&D',          clientId: 'CLT-2024-0041', domain: 'AI/ML',         submittedAt: '2025-03-11', noveltyScore: 78,  status: 'complete' },
  { id: 'p39', name: 'BioSensor Microfluidics Platform',      clientId: 'CLT-2024-0039', domain: 'Biomedical',    submittedAt: '2025-03-09', noveltyScore: 83,  status: 'complete' },
  { id: 'p38', name: 'GaN Power Converter Design',            clientId: 'CLT-2024-0038', domain: 'Power Elec.',   submittedAt: '2025-03-06', noveltyScore: 54,  status: 'complete' },
  { id: 'p37', name: 'Quantum Error Correction Algorithm',    clientId: 'CLT-2024-0037', domain: 'AI/ML',         submittedAt: '2025-03-04', noveltyScore: null, status: 'processing' },
  { id: 'p36', name: 'Perovskite Tandem Solar Cell',          clientId: 'CLT-2024-0036', domain: 'Materials',     submittedAt: '2025-03-01', noveltyScore: 28,  status: 'complete' },
  { id: 'p35', name: 'Photonic Integrated Circuit for LiDAR', clientId: 'CLT-2024-0035', domain: 'Photonics',     submittedAt: '2025-02-26', noveltyScore: 71,  status: 'complete' },
  { id: 'p34', name: 'Solid-State Battery Electrolyte',       clientId: 'CLT-2024-0034', domain: 'Electrochem.',  submittedAt: '2025-02-22', noveltyScore: 66,  status: 'complete' },
  { id: 'p33', name: 'Adaptive Wing Morphing Control',        clientId: 'CLT-2024-0033', domain: 'Aerospace',     submittedAt: '2025-02-18', noveltyScore: 81,  status: 'complete' },
  { id: 'p32', name: 'Hybrid Additive Manufacturing Cell',    clientId: 'CLT-2024-0032', domain: 'Manufacturing', submittedAt: '2025-02-14', noveltyScore: 49,  status: 'complete' },
  { id: 'p31', name: 'Federated Medical Imaging Model',       clientId: 'CLT-2024-0031', domain: 'Biomedical',    submittedAt: '2025-02-10', noveltyScore: 74,  status: 'complete' },
  { id: 'p30', name: 'SiC MOSFET Gate Driver Architecture',   clientId: 'CLT-2024-0030', domain: 'Power Elec.',   submittedAt: '2025-02-06', noveltyScore: 62,  status: 'complete' },
  { id: 'p29', name: 'Self-Healing Polymer Coatings',         clientId: 'CLT-2024-0029', domain: 'Materials',     submittedAt: '2025-02-02', noveltyScore: 57,  status: 'complete' },
];

// The visible table truncates; "47 total" is shown in the header chip.
export const TOTAL_PROJECT_COUNT = 47;

export function computeStats(projects: Project[]) {
  const completed = projects.filter(p => p.status === 'complete' && p.noveltyScore !== null);
  const avg = completed.length
    ? Math.round(completed.reduce((s, p) => s + (p.noveltyScore ?? 0), 0) / completed.length)
    : 0;
  const high = completed.filter(p => (p.noveltyScore ?? 0) >= 61).length;
  const processing = projects.filter(p => p.status === 'processing').length;

  return {
    total: TOTAL_PROJECT_COUNT,
    addedThisMonth: 6, // matches screenshot copy
    avg,
    high,
    processing,
  };
}
