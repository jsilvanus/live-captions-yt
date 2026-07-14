// Fixed dark palette for the Production operator console.
//
// The Production page is an immersive live-operator surface and the Claude
// Design mockup commits to a single dark look (matching hardware mixer/switcher
// UIs), so — unlike the rest of lcyt-web — these panes use fixed hex values
// straight from the mockup rather than the app's light/dark `--color-*` tokens.
// Keeping them in one place makes the whole surface easy to retheme later.

export const C = {
  pageBg:      '#0f0f10',
  panelBg:     '#161616',
  panelBorder: '#2a2a2a',
  headerBg:    '#1c1c1c',
  headerBorder:'#262626',
  chipBg:      '#1e1e1e',
  tileBg:      '#1a1a1a',
  tileBorder:  '#242424',
  inputBg:     '#131313',
  inputBorder: '#262626',
  btnBg:       '#202020',
  btnBorder:   '#2c2c2c',
  text:        '#e8e8e8',
  textDim:     '#9a9a9a',
  textMuted:   '#777',
  textFaint:   '#555',
  mono:        "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  // Signal colours
  live:        '#cc3344',
  liveBright:  '#e04a5a',
  preview:     '#2f9e8f',
  previewLine: '#3a9e5a',
  gold:        '#c79a3a',
  yt:          '#e05252',
  ok:          '#3a9e5a',
  okBright:    '#8fd8a8',
};

/** Diagonal "no-signal" hatch used for empty monitor / preview tiles. */
export const HATCH = 'repeating-linear-gradient(45deg,#141414,#141414 9px,#181818 9px,#181818 18px)';
export const HATCH_LIVE = 'repeating-linear-gradient(45deg,#182018,#182018 8px,#1d251d 8px,#1d251d 16px)';
