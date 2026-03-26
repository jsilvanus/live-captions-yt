export const DRAFT_KEY = 'lcyt.wizard.draft';

export const MAX_RELAY_SLOTS = 8;

export const ALL_FEATURE_CODES = [
  'captions', 'viewer-target', 'translations', 'ingest', 'cea-captions',
  'embed', 'stt-server', 'radio', 'hls-stream', 'preview', 'graphics-client',
  'graphics-server', 'restream-fanout', 'file-saving', 'mic-lock', 'stats',
  'collaboration', 'device-control', 'planning',
];

export const FEATURE_LABELS = {
  'captions':         'Captions',
  'viewer-target':    'Viewer target',
  'translations':     'Translations',
  'ingest':           'RTMP ingest/relay',
  'cea-captions':     'CEA-608/708',
  'embed':            'Embed widgets',
  'stt-server':       'Server-side STT',
  'radio':            'Radio/audio HLS',
  'hls-stream':       'HLS video stream',
  'preview':          'Preview thumbnail',
  'graphics-client':  'Graphics viewer',
  'graphics-server':  'Graphics server',
  'restream-fanout':  'Restream fanout',
  'file-saving':      'Caption file saving',
  'mic-lock':         'Mic lock',
  'stats':            'Stats',
  'collaboration':    'Collaboration',
  'device-control':   'Device control',
  'planning':         'Planning',
};

export const DEPS = {
  'graphics-server': ['graphics-client', 'ingest'],
  'stt-server':      ['ingest'],
  'radio':           ['ingest'],
  'hls-stream':      ['ingest'],
  'preview':         ['ingest'],
};

/**
 * StepDescriptor for config steps (excluding 'features' and 'review' which
 * are always present). computeSteps() selects from this list based on the
 * active feature set.
 */
export const CONFIG_STEP_TEMPLATES = [
  { id: 'targets',      title: 'Caption Targets',  featureCode: 'captions' },
  { id: 'translation',  title: 'Translation',      featureCode: 'translations' },
  { id: 'relay',        title: 'RTMP Relay Slots', featureCode: 'ingest' },
  { id: 'cea-captions', title: 'CEA Captions',     featureCode: 'cea-captions' },
  { id: 'embed',        title: 'Embed Widgets',    featureCode: 'embed' },
  { id: 'stt-server',   title: 'Server STT',       featureCode: 'stt-server' },
];
