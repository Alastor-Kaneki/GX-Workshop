import fs from 'node:fs/promises';

const ORIGIN = 'https://store.gx.me';
const CONCURRENCY = Math.max(1, Number(process.env.ENRICH_CONCURRENCY || 10));
const DELAY_MS = Math.max(0, Number(process.env.ENRICH_DELAY_MS || 45));
const MAX = Math.max(0, Number(process.env.ENRICH_LIMIT || 20000));
const UA = 'Mozilla/5.0 (compatible; GX-Workshop-Enricher/1.1; +https://github.com/Alastor-Kaneki/GX-Workshop)';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function decode(value = '') {
  return String(value)
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function strip(html = '') {
  return decode(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function attrs(tag = '') {
  const out = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) out[match[1].toLowerCase()] = decode(match[3]);
  return out;
}

function metaContent(html, names) {
  const wanted = new Set(names.map(name => name.toLowerCase()));
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(match[0]);
    if (wanted.has(String(a.property || a.name || '').toLowerCase()) && a.content) return a.content.trim();
  }
  return '';
}

function first(html, regex) {
  const match = html.match(regex);
  return match ? strip(match[1]) : '';
}

function absolute(value, base) {
  if (!value) return '';
  try { return new URL(value, base).href; }
  catch { return value; }
}

async function get(url) {
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en-US,en;q=0.9'
        }
      });
      if (response.ok) return response.text();
      last = new Error(`${response.status} ${url}`);
      if (response.status !== 429 && response.status < 500) throw last;
    } catch (error) {
      last = error;
    }
    await sleep(650 * (attempt + 1));
  }
  throw last || new Error(`failed ${url}`);
}

function studioName(html) {
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const a = attrs(`<a ${match[1]}>`);
    if (!a.href || !(/(?:^|\/)studios\/[^/?#]+\/?(?:$|[?#])/i.test(a.href) || /[?&]studioId=/i.test(a.href))) continue;
    const name = strip(match[2]);
    if (name && name.length <= 120) return name;
  }

  const decoded = decode(html);
  const jsonStudio = decoded.match(/["']studio["']\s*:\s*\{[\s\S]{0,1200}?["']name["']\s*:\s*["']([^"']+)["']/i);
  if (jsonStudio) return decode(jsonStudio[1]);

  const escapedStudio = html.match(/\\"studio\\"\s*:\s*\{[\s\S]{0,1200}?\\"name\\"\s*:\s*\\"([^"\\]+)\\"/i);
  if (escapedStudio) return decode(escapedStudio[1]);
  if (/\bOpera GX Official\b/i.test(strip(html))) return 'Opera GX Official';
  return '';
}

function packageUrl(html) {
  const decoded = decode(html);
  for (const match of decoded.matchAll(/https:\/\/(?:mods\.store\.gx\.me|play\.gxc\.gg)\/mods\/[^\s"'<>\\]+/gi)) {
    try {
      const url = new URL(match[0].replace(/[),.;}\]]+$/g, ''));
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.at(-1) === 'mod.crx' && parts.length >= 5) {
        url.search = '';
        url.hash = '';
        return url.href;
      }
      const marker = parts.findIndex(part => part === 'contents' || part === 'icons');
      if (marker >= 4) {
        url.pathname = `/${parts.slice(0, marker).concat('mod.crx').join('/')}`;
        url.search = '';
        url.hash = '';
        return url.href;
      }
    } catch {}
  }
  return null;
}

function value(text, label, pattern) {
  const index = text.indexOf(label);
  if (index < 0) return '';
  const chunk = text.slice(index + label.length, index + label.length + 180);
  return chunk.match(pattern)?.[0] || '';
}

// A missing description can be legitimate. Re-request records only when a
// field that materially affects cards/downloads is still absent.
function needs(mod) {
  return !mod.name || !mod.packageUrl || !mod.image || !mod.version || !mod.size || !mod.author || mod.author === 'Unknown studio';
}

async function enrich(mod) {
  const pageUrl = mod.url || `${ORIGIN}/mods/${mod.id}/${mod.slug}/`;
  try {
    const html = await get(pageUrl);
    const text = strip(html);
    const title = first(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
      || metaContent(html, ['og:title']).replace(/\s*[-|–].*mod your browser.*$/i, '')
      || mod.name;
    const description = metaContent(html, ['description', 'og:description']) || mod.description || '';
    const image = absolute(metaContent(html, ['og:image', 'twitter:image']), pageUrl) || mod.image || '';
    const author = studioName(html) || mod.author || 'Unknown studio';
    const version = value(text, 'Version', /[\w.-]+/) || mod.version || '';
    const size = value(text, 'Size', /\d+(?:\.\d+)?\s*(?:B|kB|KB|MB|GB|TB)/i).replace(/\s+/g, '') || mod.size || '';
    const installsText = value(text, 'Installs', /[\d,]+/);
    const installs = installsText ? Number(installsText.replace(/,/g, '')) : Number(mod.installs || 0);
    const createdAt = value(text, 'Date created', /\d{1,2}\/\d{1,2}\/\d{4}/) || mod.createdAt || '';
    const updatedAt = value(text, 'Last update', /\d{1,2}\/\d{1,2}\/\d{4}/) || mod.updatedAt || '';
    return {
      ...mod,
      name: title || mod.name,
      author,
      description,
      image,
      version,
      size,
      installs,
      createdAt,
      updatedAt,
      packageUrl: packageUrl(html) || mod.packageUrl || null,
      enrichedAt: new Date().toISOString()
    };
  } catch (error) {
    console.warn('enrich failed', pageUrl, error.message);
    return mod;
  }
}

const parsed = JSON.parse(await fs.readFile('data/catalog.json', 'utf8'));
const mods = Array.isArray(parsed) ? parsed : parsed.mods || [];
const targets = mods.filter(needs).slice(0, MAX || undefined);
console.log(`catalog ${mods.length}; enriching ${targets.length} incomplete records`);

const targetIds = new Set(targets.map(mod => mod.id));
const replacements = new Map();
let cursor = 0;
let done = 0;
async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= targets.length) return;
    const item = targets[index];
    replacements.set(item.id, await enrich(item));
    done++;
    if (done % 250 === 0 || done === targets.length) console.log(`enriched ${done}/${targets.length}`);
    if (DELAY_MS) await sleep(DELAY_MS);
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, targets.length)) }, worker));

const outMods = mods.map(mod => targetIds.has(mod.id) ? replacements.get(mod.id) || mod : mod);
const meta = Array.isArray(parsed) ? {} : parsed.meta || {};
const out = {
  meta: {
    ...meta,
    enrichedAt: new Date().toISOString(),
    entries: outMods.length,
    resolvedPackageUrls: outMods.filter(mod => mod.packageUrl).length,
    images: outMods.filter(mod => mod.image).length,
    descriptions: outMods.filter(mod => mod.description).length,
    knownAuthors: outMods.filter(mod => mod.author && mod.author !== 'Unknown studio').length
  },
  mods: outMods
};

await fs.writeFile('data/catalog.json', `${JSON.stringify(out, null, 2)}\n`);
console.log(`done: ${out.meta.entries} entries; ${out.meta.resolvedPackageUrls} packages; ${out.meta.images} images; ${out.meta.knownAuthors} known authors`);
