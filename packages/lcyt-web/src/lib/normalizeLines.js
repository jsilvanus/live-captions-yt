// Utility: normalize lines by wrapping paragraphs while preserving special lines
const DEFAULT_MAX_LEN = 42;

/** Matches a complete single-line <!-- ... --> comment. */
const COMMENT_LINE_RE = /^<!--(?!-?$)[\s\S]*?-->\s*$/;

/** Matches start of a multi-line stanza block: <!-- stanza */
const STANZA_OPEN_RE = /^<!--\s*stanza\s*$/i;

/** Matches an empty-send marker line: _ or _ "label" */
const EMPTY_SEND_RE = /^_(?:\s|$)/;

function wrapWords(words, maxLen) {
  const result = [];
  let current = '';
  for (const word of words) {
    if (current === '') {
      current = word;
    } else if ((current + ' ' + word).length <= maxLen) {
      current += ' ' + word;
    } else {
      result.push(current);
      current = word;
    }
  }
  if (current) result.push(current);
  return result;
}

export function normalizeLines(rawLines, maxLen = DEFAULT_MAX_LEN) {
  const result = [];
  let textBuffer = [];
  let inStanza = false;

  function flushBuffer() {
    if (textBuffer.length === 0) return;
    const words = textBuffer.join(' ').split(/\s+/).filter(w => w.length > 0);
    result.push(...wrapWords(words, maxLen));
    textBuffer = [];
  }

  for (const line of rawLines) {
    // Heading lines (start with #) — preserve as their own lines
    if (line.trim().startsWith('#')) {
      flushBuffer();
      result.push(line);
      continue;
    }

    // Inside a multi-line stanza block — preserve verbatim until closing -->
    if (inStanza) {
      result.push(line);
      if (line.trim() === '-->') inStanza = false;
      continue;
    }

    // Opening of a multi-line stanza block
    if (STANZA_OPEN_RE.test(line)) {
      flushBuffer();
      result.push(line);
      inStanza = true;
      continue;
    }

    // Single-line metadata comment — preserve verbatim
    if (COMMENT_LINE_RE.test(line)) {
      flushBuffer();
      result.push(line);
      continue;
    }

    // Empty-send marker — preserve verbatim
    if (EMPTY_SEND_RE.test(line)) {
      flushBuffer();
      result.push(line);
      continue;
    }

    // Blank line — flush current paragraph and preserve blank line as separator
    if (line.trim() === '') {
      flushBuffer();
      result.push('');
      continue;
    }

    // Regular text line — accumulate for word-wrapping
    textBuffer.push(line);
  }
  flushBuffer();
  return result;
}

export default normalizeLines;
