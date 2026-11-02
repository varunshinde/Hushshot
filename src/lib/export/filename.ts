/** Filenames from a template such as "{title}_{date}_{time}_{part}". */

export function slug(title: string, max = 80): string {
  const s = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|#%&{}$!'@`=+^~]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return (s || 'capture').slice(0, max).replace(/[-.]+$/, '');
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function buildFilename(
  template: string,
  v: { title: string; date: Date; part?: number; total?: number; ext: string },
): string {
  const d = v.date;
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}`;
  const multi = (v.total ?? 1) > 1 && v.part !== undefined;
  const w = Math.max(2, String(v.total ?? 1).length);
  const part = multi ? `part-${pad(v.part!, w)}-of-${pad(v.total!, w)}` : '';
  let name = template
    .replace(/\{title\}/g, slug(v.title))
    .replace(/\{date\}/g, date)
    .replace(/\{time\}/g, time)
    .replace(/\{part\}/g, part);
  name = name.replace(/[\\/:*?"<>|]/g, '-').replace(/[_-]{2,}/g, (m) => m[0]).replace(/^[_-]+|[_-]+$/g, '');
  if (multi && !template.includes('{part}')) name += `_${part}`;
  return `${name || 'capture'}.${v.ext}`;
}

export function withFolder(folder: string, name: string): string {
  const f = folder.replace(/^\/+|\/+$/g, '').replace(/\.\./g, '');
  return f ? `${f}/${name}` : name;
}
