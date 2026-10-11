/**
 * User-facing wording for the intent and question steps. Kept apart from
 * capabilities.js (pure logic) so copy can change without touching the model.
 */

export const INTENT_TEXT = {
  captions:   { title: 'Captions', desc: 'Speech to captions, translation, and where captions are delivered.' },
  video:      { title: 'Video relay and outputs', desc: 'Bring a live video feed in and send it to YouTube, other servers, HLS or a preview.' },
  production: { title: 'Production control', desc: 'Control cameras, video mixers and encoders from LCYT.' },
  graphics:   { title: 'Graphics and displays', desc: 'Lower thirds, logos and verses over the live video or on a separate screen.' },
  devices:    { title: 'Operator devices', desc: 'Dedicated tablets or panels that sign in with a PIN instead of a user account.' },
};

export const QUESTION_TEXT = {
  captionSource: {
    label: 'Where will the caption text come from?',
    options: {
      own: 'I will write or paste the captions myself',
      external: 'Another system already produces captions',
      transcribe: 'I want LCYT to transcribe speech',
    },
  },
  sttLocation: {
    label: 'Where should the speech be transcribed?',
    help: 'In the browser, speech goes to the browser vendor\'s service (usually Google or Microsoft). On the LCYT server, audio from your live stream is transcribed by the provider you choose next: a cloud service, your own local service, or the built-in one.',
    options: { browser: 'In the browser', server: 'On the LCYT server' },
  },
  broadcastCaptions: { label: 'Do you want to send captions out from the live transmission?', help: 'For example to YouTube, the viewer page or another HTTP endpoint.' },
  translate: { label: 'Do you want translated captions?' },
  viewerPage: { label: 'Do you want a public caption viewer page?' },
  saveCaptionFiles: { label: 'Do you want caption files saved for later download?' },
  videoInput: {
    label: 'How does the live video reach LCYT?',
    options: { rtmp: 'RTMP stream', hls: 'HLS stream', whep: 'WHEP stream', camera: 'Camera or encoder pushing to LCYT', unsure: 'I don\'t know yet' },
  },
  relay: { label: 'Do you need to send the video somewhere else?', help: 'LCYT forwards the stream to YouTube, another RTMP server or several destinations.' },
  hlsOutput: { label: 'Do you want an HLS video stream for viewers or embeds?' },
  radioOutput: { label: 'Do you want an audio-only (radio) stream?' },
  preview: { label: 'Do you want a live preview thumbnail?' },
  verticalCrop: { label: 'Do you want a vertical (portrait) crop of the video?' },
  controlCameras: { label: 'Do you want LCYT to control cameras?', help: 'PTZ presets and camera feeds. The protocol (VISCA-IP, AMX, …) comes later.' },
  controlMixers: { label: 'Do you want LCYT to control a video mixer?', help: 'Select the program source and recall presets.' },
  controlEncoders: { label: 'Do you want LCYT to control a hardware encoder?', help: 'Start and stop a Matrox Monarch-style encoder. A camera feed with no control is not an encoder.' },
  graphicsOnVideo: { label: 'Should graphics appear over the live video?', help: 'LCYT renders them and composites them onto the stream (DSK).' },
  graphicsSeparateDisplay: { label: 'Should graphics also appear on a separate display?', help: 'For example a projector in the church.' },
  operatorDevices: { label: 'Will anyone operate from a dedicated tablet or panel?', help: 'Device roles let a tablet sign in with a project device code and a PIN, with limited permissions. They are not the same as project roles (owner, editor, …).' },
};

/** Short concept explainers shown above an intent's questions. */
export const CONCEPT_TEXT = {
  video: 'Ingest is video coming into LCYT. Relay forwards it to destinations. HLS output lets viewers watch it in a browser. A named camera feed is an incoming source that may have no control channel at all.',
  graphics: 'Graphics are visual elements such as a lower third, logo, text, image or Bible verse. A viewport is a view onto a set of graphics: one viewport for the live transmission and another for a projector can place the same graphic differently.',
  devices: 'Device roles are PIN-based identities for dedicated production clients (camera, microphone, mixer or custom). They are separate from physical devices and from project roles.',
};

export const PREREQUISITE_TEXT = {
  'caption-target': 'Add at least one caption target (YouTube, viewer or HTTP).',
  'stt-provider': 'Choose a speech-to-text provider.',
  'incoming-stream': 'Your live video must be arriving at LCYT.',
  'relay-destination': 'Add at least one relay destination.',
  'server-audio-source': 'Server-side transcription needs audio from your live stream.',
  bridge: 'If the equipment is on a private network, install a bridge on site.',
  cameras: 'Add your cameras.',
  mixers: 'Add your mixer and map its inputs to LCYT feeds.',
  encoders: 'Add your encoder.',
  'device-roles': 'Create a device role and PIN for each dedicated device.',
  viewport: 'Create a viewport for each place graphics should appear.',
  'dsk-video-path': 'Graphics on the video need the live stream to pass through LCYT.',
};

export const PREREQUISITE_GROUPS = [
  { kind: 'configuration', title: 'Still to configure' },
  { kind: 'operational', title: 'Needs to be online' },
  { kind: 'optional', title: 'Optional' },
];
