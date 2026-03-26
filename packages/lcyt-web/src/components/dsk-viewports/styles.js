// Shared inline style tokens for DSK Viewports components.

export const dark = {
  bg:        '#121212',
  panel:     '#1a1a1a',
  card:      '#222',
  cardHover: '#2a2a2a',
  border:    '#333',
  text:      '#ddd',
  muted:     '#888',
  accent:    '#44ff88',
  accentDim: '#2d8a52',
  danger:    '#ff6666',
};

const btnBase = {
  background: dark.card,
  border: `1px solid ${dark.border}`,
  color: dark.text,
  borderRadius: 6,
  padding: '7px 14px',
  fontSize: 13,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export const btnPrimary = { ...btnBase, background: '#1a4a2e', border: `1px solid ${dark.accentDim}`, color: '#cfffdc' };
export const btnDanger  = { ...btnBase, background: '#3a0000', border: '1px solid #882222', color: '#ffaaaa' };
export const btnSmall   = { ...btnBase, padding: '4px 10px', fontSize: 12 };

export const inputStyle = {
  background: '#1a1a1a',
  border: `1px solid ${dark.border}`,
  color: '#eee',
  borderRadius: 4,
  padding: '6px 10px',
  fontSize: 13,
  boxSizing: 'border-box',
};

export const labelStyle = { display: 'block', marginBottom: 4, color: dark.muted, fontSize: 12 };
