export const DRAFT_KEY = 'lcyt.wizard.draft';

/**
 * Draft format version. Drafts without a version (written before intents and
 * answers existed) are still valid: they simply have no intents/answers.
 */
export const DRAFT_VERSION = 2;

export const MAX_RELAY_SLOTS = 8;

export const ALL_FEATURE_CODES = [
  'captions', 'viewer-target', 'translations', 'ingest', 'cea-captions',
  'embed', 'stt-server', 'radio', 'hls-stream', 'preview', 'graphics-client',
  'graphics-server', 'restream', 'file-saving', 'mic-lock', 'stats',
  'collaboration', 'device-control', 'planning',
  'crop', 'files-local', 'files-managed-bucket', 'files-custom-bucket',
  'files-webdav', 'files-browser-local',
];

/**
 * Codes the wizard knows about that the backend does not (yet): shown by the
 * feature picker as "coming soon". Kept explicit so test/featureInventoryParity
 * fails on any other drift between this list and the backend's
 * KNOWN_FEATURE_CODES.
 */
export const WEB_ONLY_FEATURE_CODES = ['planning'];

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
  'restream':  'Restream fanout',
  'file-saving':      'Caption file saving',
  'mic-lock':         'Mic lock',
  'stats':            'Stats',
  'collaboration':    'Collaboration',
  'device-control':   'Device control',
  'planning':         'Planning',
  'crop':             'Vertical crop',
  'files-local':          'Files: server storage',
  'files-managed-bucket': 'Files: managed bucket',
  'files-custom-bucket':  'Files: own bucket',
  'files-webdav':         'Files: WebDAV',
  'files-browser-local':  'Files: this computer',
};

export const DEPS = {
  'graphics-server': ['graphics-client', 'ingest'],
  'stt-server':      ['ingest'],
  'radio':           ['ingest'],
  'hls-stream':      ['ingest'],
  'preview':         ['ingest'],
  'crop':            ['ingest'],
  'files-local':          ['file-saving'],
  'files-managed-bucket': ['file-saving'],
  'files-custom-bucket':  ['file-saving'],
  'files-webdav':         ['file-saving'],
  'files-browser-local':  [],
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
