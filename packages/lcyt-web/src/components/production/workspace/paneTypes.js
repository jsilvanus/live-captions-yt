// Pane-type registry for the Production workspace.
// Order here drives the custom-view <select> and the empty-pane default.

export const TYPE_OPTIONS = [
  ['cameras',     'Cameras'],
  ['thumbnails',  'Camera Thumbnails'],
  ['mixer',       'Mixer'],
  ['mixerbtns',   'Mixer Buttons'],
  ['youtube',     'YouTube'],
  ['ytpreview',   'YouTube Preview'],
  ['ytmonitor',   'YT Live Monitor'],
  ['monitors',    'Monitors'],
  ['program',     'Program Out'],
  ['rundown',     'Rundown / Cues'],
  ['sent',        'Sent Captions'],
  ['chat',        'AI Assistant'],
  ['general',     'Controls'],
  ['lowerthirds', 'Lower Thirds / Graphics'],
  ['variables',   'Variables'],
  ['connectorPolls', 'Connector Polls'],
];

export const PANE_META = {
  cameras:     { title: 'Cameras',                 dot: '#3b6fb0' },
  thumbnails:  { title: 'Camera Thumbnails',       dot: '#2f9e8f' },
  mixer:       { title: 'Mixer',                   dot: '#8b6fd0' },
  mixerbtns:   { title: 'Mixer Buttons',           dot: '#8b6fd0' },
  youtube:     { title: 'YouTube',                 dot: '#e05252' },
  ytpreview:   { title: 'YouTube Preview',         dot: '#e05252' },
  ytmonitor:   { title: 'YouTube Live Monitor',    dot: '#e05252' },
  monitors:    { title: 'Monitors',                dot: '#5b7089' },
  program:     { title: 'Program Out',             dot: '#cc3344' },
  rundown:     { title: 'Rundown / Cues',          dot: '#c79a3a' },
  sent:        { title: 'Sent Captions',           dot: '#3a9e5a' },
  chat:        { title: 'AI Production Assistant', dot: '#a06fd0' },
  general:     { title: 'Controls',                dot: '#8a8a8a' },
  lowerthirds: { title: 'Lower Thirds / Graphics', dot: '#d08a4a' },
  variables:   { title: 'Variables',               dot: '#4ab0a0' },
  connectorPolls: { title: 'Connector Polls',      dot: '#1a7f4b' },
};

export function paneMeta(type) {
  return PANE_META[type] || { title: type, dot: '#888' };
}
