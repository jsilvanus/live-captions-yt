// Planner metacode serialization/deserialization extracted from plannerUtils.js
export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const MULTI_META_RE_SRC = '<!--\\s*([a-z][a-z0-9-]*)\\s*:\\s*([\\s\\S]*?)\\s*-->';

function isMetadataLine(raw) {
  return raw.replace(new RegExp(MULTI_META_RE_SRC, 'gi'), '').trim() === '';
}

export function serializePlan(blocks) {
  return blocks.map(b => {
    switch (b.type) {
      case 'caption':     return b.text ?? '';
      case 'heading':     return `# ${b.text ?? ''}`;
      case 'audio-start': return '<!-- audio: start -->';
      case 'audio-stop':  return '<!-- audio: stop -->';
      case 'graphics':    return `<!-- graphics: ${b.value ?? ''} -->`;
      case 'codes': {
        const parts = Object.entries(b.codes ?? {})
          .filter(([, v]) => v !== '')
          .map(([k, v]) => `<!-- ${k}: ${v} -->`);
        return parts.join('');
      }
      case 'stanza':
        return `<!-- stanza\n${(b.lines ?? []).join('\n')}\n-->`;
      case 'empty-send':
        return b.label ? `_ ${b.label}` : '_';
      default: return '';
    }
  }).filter(s => s !== '').join('\n');
}

export function deserializePlan(rawText) {
  const rawLines = (rawText ?? '').split('\n');
  const blocks = [];

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i].trim();
    if (!raw) continue;

    if (raw.startsWith('#')) {
      blocks.push({ id: uid(), type: 'heading', text: raw.replace(/^#+\s*/, '') });
      continue;
    }

    if (/^<!--\s*stanza\s*$/i.test(raw)) {
      const lines = [];
      i++;
      while (i < rawLines.length) {
        const l = rawLines[i].trim();
        if (l === '-->') break;
        if (l) lines.push(l);
        i++;
      }
      blocks.push({ id: uid(), type: 'stanza', lines: lines.length ? lines : [''] });
      continue;
    }

    if (/^<!--\s*audio\s*:\s*start\s*-->$/i.test(raw)) {
      blocks.push({ id: uid(), type: 'audio-start' });
      continue;
    }
    if (/^<!--\s*audio\s*:\s*stop\s*-->$/i.test(raw)) {
      blocks.push({ id: uid(), type: 'audio-stop' });
      continue;
    }

    const gfxMatch = raw.match(/^<!--\s*graphics\s*:\s*(.*?)\s*-->$/i);
    if (gfxMatch) {
      blocks.push({ id: uid(), type: 'graphics', value: gfxMatch[1].trim() });
      continue;
    }

    const esMatch = raw.match(/^_(?:\s+(.+))?$/);
    if (esMatch) {
      blocks.push({ id: uid(), type: 'empty-send', label: esMatch[1]?.trim() ?? '' });
      continue;
    }

    if (isMetadataLine(raw)) {
      const codes = {};
      for (const m of raw.matchAll(new RegExp(MULTI_META_RE_SRC, 'gi'))) {
        codes[m[1].toLowerCase()] = m[2].trim();
      }
      if (Object.keys(codes).length > 0) {
        blocks.push({ id: uid(), type: 'codes', codes });
      }
      continue;
    }

    blocks.push({ id: uid(), type: 'caption', text: raw });
  }

  return blocks;
}
