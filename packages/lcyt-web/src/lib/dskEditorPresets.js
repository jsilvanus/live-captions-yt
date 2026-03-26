export const PRESETS = {
  'Lower Third': {
    background: 'transparent',
    width: 1920,
    height: 1080,
    groups: [{ id: 'lt', name: 'Lower Third' }],
    layers: [
      { id: 'bg',    type: 'rect', x: 0,  y: 790, width: 1920, height: 290, groupId: 'lt',
        style: { background: '#1a1a2e', opacity: '0.92', 'border-radius': '0' } },
      { id: 'name',  type: 'text', x: 80, y: 840, width: 1760, groupId: 'lt',
        text: 'Speaker Name',
        style: { 'font-size': '56px', 'font-family': 'Arial, sans-serif', color: '#ffffff', 'font-weight': 'bold', 'white-space': 'nowrap' } },
      { id: 'title', type: 'text', x: 80, y: 930, width: 1760, groupId: 'lt',
        text: 'Title / Organisation',
        style: { 'font-size': '38px', 'font-family': 'Arial, sans-serif', color: '#cccccc', 'white-space': 'nowrap' } },
    ],
  },
  'Corner Bug': {
    background: 'transparent',
    width: 1920,
    height: 1080,
    groups: [{ id: 'bug', name: 'Corner Bug' }],
    layers: [
      { id: 'bug-bg',   type: 'rect', x: 40, y: 40, width: 320, height: 100, groupId: 'bug',
        style: { background: '#000000', opacity: '0.75', 'border-radius': '8px' } },
      { id: 'bug-text', type: 'text', x: 60, y: 62, groupId: 'bug',
        text: 'LIVE',
        style: { 'font-size': '48px', 'font-family': 'Arial, sans-serif', color: '#ff3300', 'font-weight': 'bold', 'letter-spacing': '4px' } },
    ],
  },
  'Full-screen Title': {
    background: '#000000',
    width: 1920,
    height: 1080,
    layers: [
      { id: 'title',    type: 'text', x: 0, y: 420, width: 1920,
        text: 'Event Title',
        style: { 'font-size': '96px', 'font-family': 'Arial, sans-serif', color: '#ffffff', 'font-weight': 'bold', 'text-align': 'center' } },
      { id: 'subtitle', type: 'text', x: 0, y: 560, width: 1920,
        text: 'Subtitle or Date',
        style: { 'font-size': '52px', 'font-family': 'Arial, sans-serif', color: '#aaaaaa', 'text-align': 'center' } },
    ],
  },
};
