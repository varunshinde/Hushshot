// Prepares the GitHub Pages site in docs/: copies the icons and builds changelog.html
// from CHANGELOG.md. The site is plain HTML and CSS with nothing loaded from elsewhere.
// Run: pnpm docs:site
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const docs = resolve(root, 'docs');

for (const size of [32, 128]) copyFileSync(resolve(root, `public/icons/icon-${size}.png`), resolve(docs, `images/icon-${size}.png`));
// Serve files as they are (no Jekyll processing).
writeFileSync(resolve(docs, '.nojekyll'), '');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Inline Markdown used in CHANGELOG.md: code, bold, italic and links. */
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

function markdown(md) {
  const out = [];
  let list = false;
  for (const line of md.split('\n')) {
    const item = line.match(/^- (.*)/);
    if (!item && list) {
      out.push('</ul>');
      list = false;
    }
    if (item) {
      if (!list) out.push('<ul>');
      list = true;
      out.push(`<li>${inline(item[1])}</li>`);
    } else if (line.startsWith('### ')) out.push(`<h3>${inline(line.slice(4))}</h3>`);
    else if (line.startsWith('## ')) out.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (line.startsWith('# ')) continue;
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('\n');
}

const page = (body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Changelog · LocalFullPageCapture</title>
<meta name="description" content="What's new in each version of LocalFullPageCapture.">
<meta name="referrer" content="no-referrer">
<link rel="icon" href="images/icon-32.png" sizes="32x32">
<link rel="stylesheet" href="site.css">
</head>
<body>
<header class="nav">
  <div class="wrap">
    <a class="brand" href="./"><img src="images/icon-32.png" width="26" height="26" alt="">LocalFullPageCapture</a>
    <nav class="nav-links" aria-label="Site">
      <a href="./#install">Install</a>
      <a href="help.html">Help</a>
      <a href="privacy.html">Privacy</a>
      <a href="https://github.com/varunshinde/LocalFullPageCapture">GitHub</a>
    </nav>
  </div>
</header>
<main class="doc">
  <div class="wrap">
    <h1>Changelog</h1>
    <p class="muted">Downloads for each version are on the <a href="https://github.com/varunshinde/LocalFullPageCapture/releases">Releases page</a>.</p>
${body}
  </div>
</main>
<footer class="site">
  <div class="wrap">
    <a class="brand" href="./"><img src="images/icon-32.png" width="22" height="22" alt="">LocalFullPageCapture</a>
    <span class="grow"></span>
    <a href="help.html">Help</a>
    <a href="privacy.html">Privacy policy</a>
    <a href="changelog.html">Changelog</a>
    <a href="https://github.com/varunshinde/LocalFullPageCapture">GitHub</a>
  </div>
</footer>
</body>
</html>
`;

writeFileSync(resolve(docs, 'changelog.html'), page(markdown(readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8'))));
console.log('site ready in docs/');
