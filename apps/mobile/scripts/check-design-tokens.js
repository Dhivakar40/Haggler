#!/usr/bin/env node
/**
 * Phase UI gate: screen files (src/features/**, src/app/**) must use only design-system tokens
 * and components — no hardcoded hex colors, no raw fontSize/fontWeight (use Text's `variant`), no
 * raw padding/margin/gap pixel values (use `spacing`). The design-system files themselves
 * (src/theme/**, src/components/**) are exempt — they're where the tokens are defined.
 *
 * Usage: node scripts/check-design-tokens.js
 * Exits 1 and prints every violation if any are found.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'src');
const SCAN_DIRS = ['features', 'app'];
const EXEMPT_FILE_SUFFIXES = ['.spec.ts', '.spec.tsx', '.d.ts'];

const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g;
const RGBA_COLOR = /rgba?\([^)]*\)/g;
// Flags a raw literal (number or string) right-hand side, but not a reference into the design
// tokens themselves (e.g. `fontSize: typography.label.fontSize`) — screens should prefer a Text
// `variant` over this entirely, but the one legitimate exception (React Navigation's
// tabBarLabelStyle, which needs a plain style object, not a Text element) must still read the
// token's own value, not a parallel raw number that could drift from it.
const FONT_SIZE_OR_WEIGHT = /\b(fontSize|fontWeight)\s*:\s*['"\d]/g;
const SPACING_PROP = /\b(padding|margin|gap)(Horizontal|Vertical|Top|Bottom|Left|Right)?\s*:\s*(\d+)\b/g;

// A handful of narrow, deliberate exceptions, each with a reason — not a general escape hatch.
const LINE_EXEMPT_IF_CONTAINS = [
  'eslint-disable', // never silently exempt; a real disable comment must still name itself
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(entry.name) && !EXEMPT_FILE_SUFFIXES.some((s) => entry.name.endsWith(s)))
      out.push(full);
  }
  return out;
}

function checkFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const violations = [];
  lines.forEach((line, i) => {
    if (LINE_EXEMPT_IF_CONTAINS.some((s) => line.includes(s))) return;
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

    for (const m of line.matchAll(HEX_COLOR)) violations.push({ line: i + 1, kind: 'hex color', text: m[0] });
    for (const m of line.matchAll(RGBA_COLOR)) violations.push({ line: i + 1, kind: 'raw rgba()', text: m[0] });
    for (const m of line.matchAll(FONT_SIZE_OR_WEIGHT))
      violations.push({ line: i + 1, kind: 'raw font style', text: m[0] });
    for (const m of line.matchAll(SPACING_PROP))
      violations.push({ line: i + 1, kind: 'raw spacing pixel value', text: m[0] });
  });
  return violations;
}

let files = [];
for (const d of SCAN_DIRS) {
  const full = path.join(ROOT, d);
  if (fs.existsSync(full)) files = files.concat(walk(full));
}

let total = 0;
for (const file of files) {
  const violations = checkFile(file);
  if (violations.length === 0) continue;
  total += violations.length;
  console.log(`\n${path.relative(process.cwd(), file)}`);
  for (const v of violations) console.log(`  line ${v.line}: ${v.kind} — "${v.text}"`);
}

if (total > 0) {
  console.log(`\n${total} violation(s) in ${files.length} screen files.`);
  process.exit(1);
} else {
  console.log(`0 violations in ${files.length} screen files.`);
}
