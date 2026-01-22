#!/usr/bin/env node

/**
 * Build script to generate CommonJS versions of ESM source files.
 * This allows the package to support both import and require().
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Files to convert
const files = ['errors.js', 'logger.js', 'config.js', 'sender.js'];

function convertToCommonJS(content, filename) {
  let result = content;
  const exportedNames = [];

  // Convert import statements to require
  // Handle: import x from 'y'
  result = result.replace(
    /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
    (match, name, source) => {
      // Fix .js extensions for local files in CJS
      const cjsSource = source.endsWith('.js') ? source.replace('.js', '.cjs') : source;
      return `const ${name} = require('${cjsSource}')`;
    }
  );

  // Handle: import { a, b } from 'y'
  result = result.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g,
    (match, names, source) => {
      const cjsSource = source.endsWith('.js') ? source.replace('.js', '.cjs') : source;
      return `const {${names}} = require('${cjsSource}')`;
    }
  );

  // Convert export statements and track exported names
  // Handle: export class X
  result = result.replace(/export\s+class\s+(\w+)/g, (match, name) => {
    exportedNames.push(name);
    return `class ${name}`;
  });

  // Handle: export function X
  result = result.replace(/export\s+function\s+(\w+)/g, (match, name) => {
    exportedNames.push(name);
    return `function ${name}`;
  });

  // Handle: export const X
  result = result.replace(/export\s+const\s+(\w+)/g, (match, name) => {
    exportedNames.push(name);
    return `const ${name}`;
  });

  // Handle: export { X, Y } - replace with nothing, we'll add module.exports at end
  result = result.replace(
    /export\s+\{([^}]+)\}\s*;?/g,
    (match, names) => {
      const items = names.split(',').map(n => n.trim()).filter(Boolean);
      items.forEach(name => {
        if (!exportedNames.includes(name)) {
          exportedNames.push(name);
        }
      });
      return ''; // Remove, we'll add module.exports at end
    }
  );

  // Clean up any leftover empty lines
  result = result.replace(/\n{3,}/g, '\n\n');

  // Handle: export default X
  result = result.replace(/export\s+default\s+(\{[^}]+\}|\w+)/g, (match, exported) => {
    return `module.exports = ${exported}`;
  });

  // Add module.exports at end if we collected exported names and don't already have module.exports
  if (exportedNames.length > 0 && !result.includes('module.exports')) {
    result = result.trimEnd() + `\n\nmodule.exports = { ${exportedNames.join(', ')} };\n`;
  }

  return result;
}

// Process each file
for (const file of files) {
  const srcPath = path.join(srcDir, file);
  const distPath = path.join(distDir, file.replace('.js', '.cjs'));

  if (!fs.existsSync(srcPath)) {
    console.warn(`Warning: ${srcPath} not found, skipping`);
    continue;
  }

  const content = fs.readFileSync(srcPath, 'utf8');
  const converted = convertToCommonJS(content, file);

  fs.writeFileSync(distPath, converted, 'utf8');
  console.log(`Converted: ${file} -> ${path.basename(distPath)}`);
}

// Create main index.cjs that re-exports from sender.cjs
const indexContent = `'use strict';

const sender = require('./sender.cjs');
module.exports = sender;
`;

fs.writeFileSync(path.join(distDir, 'index.cjs'), indexContent, 'utf8');
console.log('Created: index.cjs');

console.log('\\nCJS build complete!');
