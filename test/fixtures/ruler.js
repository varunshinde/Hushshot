// Draws a "ruler" down the left edge of an element: CSS row y is coloured
// rgb(y & 255, (y >> 8) & 255, 200). Rendered with nearest-neighbour scaling,
// so every output row can be traced back to exactly one CSS row — duplicated
// or missing rows in a stitched capture are detected exactly.
window.drawRuler = function drawRuler(host, height, width = 12) {
  const CHUNK = 4000;
  for (let top = 0; top < height; top += CHUNK) {
    const h = Math.min(CHUNK, height - top);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = h;
    c.className = 'ruler';
    c.style.cssText = `position:absolute;left:0;top:${top}px;width:${width}px;height:${h}px;image-rendering:pixelated;`;
    const ctx = c.getContext('2d');
    for (let y = 0; y < h; y++) {
      const v = top + y;
      ctx.fillStyle = `rgb(${v & 255},${(v >> 8) & 255},200)`;
      ctx.fillRect(0, y, width, 1);
    }
    host.appendChild(c);
  }
};

// Deterministic prose.
window.prose = function prose(seed) {
  const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim minim veniam quis nostrud exercitation ullamco laboris nisi aliquip commodo consequat duis aute irure reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat proident sunt culpa officia deserunt mollit anim laborum'.split(' ');
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return (n) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(words[Math.floor(rnd() * words.length)]);
    out[0] = out[0][0].toUpperCase() + out[0].slice(1);
    return out.join(' ') + '.';
  };
};
