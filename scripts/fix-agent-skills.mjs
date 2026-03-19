import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const agentsDir = path.join(root, '.github', 'agents');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function parseInlineObjectKeys(raw) {
  const keys = [];
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^["']?([A-Za-z0-9_.-]+)["']?\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim().toLowerCase();
    if (['false', '0', 'null', 'no', 'off'].includes(val)) continue;
    keys.push(key);
  }
  return keys;
}

function convertToolsInYamlLines(lines) {
  const out = [];
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // tools: { bash: true, edit: true }
    let m = line.match(/^(\s*)tools:\s*\{(.*)\}\s*$/);
    if (m) {
      const indent = m[1];
      const keys = parseInlineObjectKeys(m[2]);
      if (keys.length > 0) {
        out.push(`${indent}tools:`);
        for (const key of keys) out.push(`${indent}  - ${key}`);
        changed = true;
        continue;
      }
    }

    // tools:
    m = line.match(/^(\s*)tools:\s*$/);
    if (!m) {
      out.push(line);
      continue;
    }

    const baseIndent = m[1].length;
    let j = i + 1;
    const block = [];

    while (j < lines.length) {
      const candidate = lines[j];
      if (candidate.trim() === '') {
        block.push(candidate);
        j++;
        continue;
      }

      const indent = candidate.match(/^(\s*)/)?.[1].length ?? 0;
      if (indent <= baseIndent) break;
      block.push(candidate);
      j++;
    }

    const nonEmpty = block.filter((l) => l.trim() !== '');
    if (nonEmpty.length === 0) {
      out.push(line);
      continue;
    }

    const firstIndent = nonEmpty[0].match(/^(\s*)/)?.[1].length ?? 0;
    const firstTrim = nonEmpty[0].trim();

    // Already array form (tools: \n  - bash)
    if (firstTrim.startsWith('- ')) {
      out.push(line, ...block);
      i = j - 1;
      continue;
    }

    const keys = [];
    let simpleMap = true;

    for (const b of nonEmpty) {
      const indent = b.match(/^(\s*)/)?.[1].length ?? 0;
      if (indent !== firstIndent) {
        simpleMap = false;
        break;
      }

      const mm = b.match(/^\s*["']?([A-Za-z0-9_.-]+)["']?\s*:\s*(.*?)\s*$/);
      if (!mm) {
        simpleMap = false;
        break;
      }

      const key = mm[1];
      const rawVal = (mm[2] ?? '').trim().toLowerCase();
      if (['false', '0', 'null', 'no', 'off'].includes(rawVal)) continue;
      keys.push(key);
    }

    if (!simpleMap || keys.length === 0) {
      out.push(line, ...block);
      i = j - 1;
      continue;
    }

    const childIndent = ' '.repeat(firstIndent);
    out.push(line);
    for (const key of keys) out.push(`${childIndent}- ${key}`);
    changed = true;
    i = j - 1;
  }

  return { changed, lines: out };
}

function convertTopFrontmatterOnly(content) {
  const hasBom = content.charCodeAt(0) === 0xfeff;
  const bom = hasBom ? '\ufeff' : '';
  const raw = hasBom ? content.slice(1) : content;
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);

  // Strict: only top frontmatter block.
  if (lines[0]?.trim() !== '---') return { changed: false, content };

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '---' || t === '...') {
      end = i;
      break;
    }
  }
  if (end === -1) return { changed: false, content };

  const frontmatter = lines.slice(1, end);
  const { changed, lines: newFrontmatter } = convertToolsInYamlLines(frontmatter);
  if (!changed) return { changed: false, content };

  const rebuilt = [
    lines[0],
    ...newFrontmatter,
    lines[end],
    ...lines.slice(end + 1),
  ].join(eol);

  return { changed: true, content: bom + rebuilt };
}

if (!fs.existsSync(agentsDir)) {
  console.error(`Missing directory: ${agentsDir}`);
  process.exit(1);
}

const files = walk(agentsDir).filter((f) => /\.(md|mdx)$/i.test(path.basename(f)));

let touched = 0;
for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  const { changed, content } = convertTopFrontmatterOnly(before);
  if (!changed || content === before) continue;
  fs.writeFileSync(file, content, 'utf8');
  touched++;
  console.log(`fixed: ${path.relative(root, file)}`);
}

console.log(`done. files updated: ${touched}`);