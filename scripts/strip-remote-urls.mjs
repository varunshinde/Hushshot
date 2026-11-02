// Post-build hardening: tesseract.js contains jsDelivr URLs as fallbacks for
// paths we always set. Rewrite them to an unroutable scheme so a fallback can
// never reach the network, then fail the build if any other remote URL that
// could be fetched remains in the bundle.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist/chrome-mv3';
const CDN = /https:\/\/cdn\.jsdelivr\.net\/npm\//g;
// Strings that look like URLs but are never fetched: XML namespaces and a source comment.
const ALLOWED = [/^http:\/\/www\.w3\.org\//, /^https:\/\/github\.com\/Hopding\/pdf-lib/];

const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|html|json|css)$/.test(f)) files.push(p);
  }
};
walk(dir);

let rewritten = 0;
const leftovers = [];
for (const f of files) {
  let s = readFileSync(f, 'utf8');
  const before = s;
  s = s.replace(CDN, () => (rewritten++, 'localcapture-blocked://cdn/'));
  if (s !== before) writeFileSync(f, s);
  // manifest.json only holds match patterns (E2E build), not fetchable URLs.
  if (f.endsWith('manifest.json')) continue;
  for (const m of s.matchAll(/https?:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+/g)) {
    if (!ALLOWED.some((r) => r.test(m[0]))) leftovers.push(`${f}: ${m[0]}`);
  }
}
console.log(`strip-remote-urls: neutralised ${rewritten} CDN fallback URL(s) in ${dir}`);
if (leftovers.length) {
  console.error('Remote URLs found in the bundle:\n' + leftovers.join('\n'));
  process.exit(1);
}
