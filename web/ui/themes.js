// Color theme palettes. Each theme defines:
//   css — CSS custom properties applied to :root.  Drives every custom class
//         in styles.css (buttons, bars, source badges, AI button, …).
//   cy  — Cytoscape style tokens applied by graph.applyTheme().
//
// To add a palette, append an entry below. Keep `chrome` (slate bg / borders)
// consistent across palettes — only the accent, graph, and evidence colors
// change. This keeps the overall UI readable while giving the network a
// distinct visual identity per theme.

export const THEMES = [
  {
    id: 'aurora',
    name: 'Aurora',
    swatch: ['#0ea5e9', '#6366f1', '#10b981'],
    css: {
      '--accent-from':    '#0ea5e9',
      '--accent-to':      '#6366f1',
      '--ai-from':        '#8b5cf6',
      '--ai-to':          '#ec4899',
      '--evidence':       '#f59e0b',
      '--evidence-bg':    '#fffbeb',
      '--evidence-pill-bg':    '#fef3c7',
      '--evidence-pill-text':  '#92400e',
      '--bar-from':       '#0ea5e9',
      '--bar-to':         '#6366f1',
      '--bar-track':      '#f1f5f9',
      '--evidence-bar-from':   '#f59e0b',
      '--evidence-bar-to':     '#ea580c'
    },
    cy: {
      nodeFill:      '#ffffff',
      nodeText:      '#0f172a',
      nodeBorder:    '#cbd5e1',
      nodeSelected:  '#6366f1',
      evidenceFill:  '#fffbeb',
      evidenceBorder:'#f59e0b',
      edge:          '#94a3b8',
      selectedEdge:  '#6366f1',
      dropTarget:    '#10b981',
      dropTargetBg:  '#ecfdf5',
      handle:        '#6366f1',
      ghost:         '#6366f1'
    }
  },
  {
    id: 'sunset',
    name: 'Sunset',
    swatch: ['#f97316', '#e11d48', '#ec4899'],
    css: {
      '--accent-from':    '#f97316',
      '--accent-to':      '#e11d48',
      '--ai-from':        '#db2777',
      '--ai-to':          '#9f1239',
      '--evidence':       '#0ea5e9',
      '--evidence-bg':    '#f0f9ff',
      '--evidence-pill-bg':    '#dbeafe',
      '--evidence-pill-text':  '#1e3a8a',
      '--bar-from':       '#f97316',
      '--bar-to':         '#e11d48',
      '--bar-track':      '#ffe4e6',
      '--evidence-bar-from':   '#0ea5e9',
      '--evidence-bar-to':     '#1d4ed8'
    },
    cy: {
      nodeFill:      '#fffbf5',
      nodeText:      '#431407',
      nodeBorder:    '#fdba74',
      nodeSelected:  '#e11d48',
      evidenceFill:  '#e0f2fe',
      evidenceBorder:'#0ea5e9',
      edge:          '#fb923c',
      selectedEdge:  '#e11d48',
      dropTarget:    '#16a34a',
      dropTargetBg:  '#dcfce7',
      handle:        '#e11d48',
      ghost:         '#e11d48'
    }
  },
  {
    id: 'noir',
    name: 'Noir',
    swatch: ['#1f2937', '#6b7280', '#9ca3af'],
    css: {
      '--accent-from':    '#111827',
      '--accent-to':      '#4b5563',
      '--ai-from':        '#4b5563',
      '--ai-to':          '#111827',
      '--evidence':       '#a16207',
      '--evidence-bg':    '#fef3c7',
      '--evidence-pill-bg':    '#fde68a',
      '--evidence-pill-text':  '#713f12',
      '--bar-from':       '#374151',
      '--bar-to':         '#1f2937',
      '--bar-track':      '#e5e7eb',
      '--evidence-bar-from':   '#ca8a04',
      '--evidence-bar-to':     '#a16207'
    },
    cy: {
      nodeFill:      '#f9fafb',
      nodeText:      '#111827',
      nodeBorder:    '#9ca3af',
      nodeSelected:  '#111827',
      evidenceFill:  '#fef3c7',
      evidenceBorder:'#a16207',
      edge:          '#6b7280',
      selectedEdge:  '#111827',
      dropTarget:    '#14532d',
      dropTargetBg:  '#dcfce7',
      handle:        '#111827',
      ghost:         '#111827'
    }
  },
  {
    id: 'midnight',
    name: 'Midnight',
    dark: true,
    swatch: ['#818cf8', '#22d3ee', '#a855f7'],
    css: {
      '--accent-from':    '#6366f1',
      '--accent-to':      '#22d3ee',
      '--ai-from':        '#a855f7',
      '--ai-to':          '#ec4899',
      '--evidence':       '#fbbf24',
      '--evidence-bg':    '#422006',
      '--evidence-pill-bg':    '#78350f',
      '--evidence-pill-text':  '#fbbf24',
      '--bar-from':       '#818cf8',
      '--bar-to':         '#22d3ee',
      '--bar-track':      '#1e293b',
      '--evidence-bar-from':   '#fbbf24',
      '--evidence-bar-to':     '#d97706'
    },
    cy: {
      nodeFill:      '#1e293b',
      nodeText:      '#e2e8f0',
      nodeBorder:    '#475569',
      nodeSelected:  '#818cf8',
      evidenceFill:  '#422006',
      evidenceBorder:'#f59e0b',
      edge:          '#64748b',
      selectedEdge:  '#818cf8',
      dropTarget:    '#22d3ee',
      dropTargetBg:  '#164e63',
      handle:        '#818cf8',
      ghost:         '#818cf8'
    }
  }
];

const DEFAULT_ID = 'aurora';
let currentId = DEFAULT_ID;

export function getTheme(id) {
  return THEMES.find(t => t.id === id) ?? THEMES[0];
}

export function applyTheme(id) {
  const theme = getTheme(id);
  currentId = theme.id;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.css)) root.style.setProperty(k, v);
  root.dataset.theme = theme.id;
  return theme;
}

export function currentThemeId() { return currentId; }
