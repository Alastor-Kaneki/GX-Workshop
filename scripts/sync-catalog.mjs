import fs from 'node:fs/promises';

const ORIGIN = 'https://store.gx.me';
const MAX_PAGES = Number(process.env.MAX_PAGES || 500);
const DETAIL_LIMIT = Number(process.env.DETAIL_LIMIT || 20000);
const REFRESH_LIMIT = Number(process.env.REFRESH_LIMIT || 1200);
const RECENT_PAGES = Number(process.env.RECENT_PAGES || 12);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 8));
const DETAIL_DELAY_MS = Math.max(0, Number(process.env.DETAIL_DELAY_MS || 35));
const UA = 'Mozilla/5.0 (compatible; GX-Workshop-Catalog/2.0; +https://github.com/Alastor-Kaneki/GX-Workshop)';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function get(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, {
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml'
      }
    });
    if (response.ok) return response.text();
    if (response.status === 429 || response.status >= 500) {
      await sleep(900 * (attempt + 1));
      continue;
    }
    throw new Error(`${response.status} ${url}`);
  }
  throw new Error(`failed ${url}`);
}

function decode(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function strip(html) {
  return decode(String(html || ''))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function attrs(tag) {
  const out = {};
  for (const match of String(tag || '').matchAll(/([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
    out[match[1].toLowerCase()] = decode(match[3]);
  }
  return out;
}

function metaContent(html, names) {
  const wanted = new Set(names.map(x => x.toLowerCase()));
  for (const match of String(html || '').matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(match[0]);
    const key = String(a.property || a.name || '').toLowerCase();
    if (wanted.has(key) && a.content) return a.content.trim();
  }
  return '';
}

function pickHtml(html, regex) {
  const match = String(html || '').match(regex);
  return match ? strip(match[1]) : '';
}

function absolute(value, base = ORIGIN) {
  if (!value) return '';
  try { return new URL(value, base).href; }
  catch { return value; }
}

function discoverLinks(html) {
  const found = new Map();
  const decoded = String(html || '').replace(/\\u0026/gi, '&').replace(/\\\//g, '/');
  const patterns = [
    /(?:https:\/\/store\.gx\.me)?(?:\/[a-z]{2})?\/mods\/([a-z0-9]+)\/([^\s"'<>/?#\\]+)\/?/gi,
    /href\s*=\s*["'](?:https:\/\/store\.gx\.me)?(?:\/[a-z]{2})?\/mods\/([a-z0-9]+)\/([^"'/?#]+)\/?["']/gi
  ];
  for (const regex of patterns) {
    for (const match of decoded.matchAll(regex)) {
      const id = match[1];
      const slug = match[2].replace(/\\.*$/, '').replace(/[),.;}\]]+$/, '');
      if (!id || !slug) continue;
      found.set(id, { id, slug, url: `${ORIGIN}/mods/${id}/${slug}/` });
    }
  }
  return [...found.values()];
}

const COMPONENTS = [
  'Mod kit', 'App icon', 'Background Music', 'Browser Sounds', 'Cursors', 'Fonts',
  'Game Strip', 'Icons', 'Keyboard sounds', 'Mobile Icons', 'SD effects', 'Shader',
  'Splash screen', 'Stickers', 'Theme', 'Wallpaper', 'Web Modding'
];

function tagTexts(html) {
  const result = new Set();
  for (const match of String(html || '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const a = attrs(`<a ${match[1]}>`);
    if (!a.href || !/[?&](?:tagAlias|tag)=/i.test(a.href)) continue;
    const text = strip(match[2]);
    if (text && text.length <= 80) result.add(text);
  }
  return [...result];
}

function studioName(html, text) {
  for (const match of String(html || '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const a = attrs(`<a ${match[1]}>`);
    if (!a.href || !(/(?:^|\/)studios\/[^/?#]+\/?(?:$|[?#])/i.test(a.href) || /[?&]studioId=/i.test(a.href))) continue;
    const name = strip(match[2]);
    if (name) return name;
  }
  if (/\bOpera GX Official\b/i.test(text)) return 'Opera GX Official';
  return 'Unknown studio';
}

function iconImage(html, title, pageUrl) {
  const meta = metaContent(html, ['og:image', 'twitter:image']);
  if (meta) return absolute(meta, pageUrl);
  for (const match of String(html || '').matchAll(/<img\b[^>]*>/gi)) {
    const a = attrs(match[0]);
    const alt = String(a.alt || '');
    if (!/\bicon\b/i.test(alt) && !(title && alt.toLowerCase().includes(title.toLowerCase()))) continue;
    const src = a.src || a['data-src'] || a['data-original'];
    if (src) return absolute(src, pageUrl);
  }
  return '';
}

function packageUrl(html) {
  const decoded = String(html || '')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&');
  for (const match of decoded.matchAll(/https:\/\/(?:mods\.store\.gx\.me|play\.gxc\.gg)\/mods\/[^\s"'<>\\]+/gi)) {
    try {
      const url = new URL(match[0].replace(/[),.;}\]]+$/g, ''));
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.at(-1) === 'mod.crx' && parts.length >= 5) {
        url.search = '';
        url.hash = '';
        return url.href;
      }
      const marker = parts.findIndex(x => x === 'contents' || x === 'icons');
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

function dateField(text, label) {
  const match = text.match(new RegExp(`${label}\\s+(\\d{2}\\/\\d{2}\\/\\d{4})`, 'i'));
  return match?.[1] || '';
}

function versionField(text) {
  return text.match(/\bVersion\s+([^\s#]+)\b/i)?.[1] || '';
}

function installsField(text) {
  return Number((text.match(/\bInstalls\s+([\d,]+)/i)?.[1] || '0').replace(/,/g, '')) || 0;
}

function sizeField(text) {
  return text.match(/\bSize\s+([\d.]+\s*(?:B|kB|KB|MB|GB|TB))/i)?.[1].replace(/\s+/g, '') || '';
}

async function detail(base) {
  try {
    const html = await get(base.url);
    const text = strip(html);
    const title = pickHtml(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
      || metaContent(html, ['og:title'])
      || pickHtml(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i).replace(/\s*[-|–].*GX Store.*$/i, '')
      || base.slug.replace(/-/g, ' ');
    const allTags = tagTexts(html);
    const components = COMPONENTS.filter(component => text.includes(component) || allTags.includes(component));
    const featureSegment = text.split('Install Mod')[1]?.split('Date created')[0] || '';
    const platforms = ['Desktop', 'Mobile'].filter(platform =>
      featureSegment.includes(platform) || allTags.includes(platform) || base.platforms?.includes(platform)
    );
    const tags = allTags.filter(tag => !COMPONENTS.includes(tag) && !['Desktop', 'Mobile'].includes(tag));
    return {
      ...base,
      name: title,
      author: studioName(html, text),
      description: metaContent(html, ['description', 'og:description']),
      image: iconImage(html, title, base.url),
      components,
      platforms: [...new Set([...(base.platforms || []), ...platforms])],
      tags,
      createdAt: dateField(text, 'Date created'),
      updatedAt: dateField(text, 'Last update'),
      version: versionField(text),
      installs: installsField(text),
      size: sizeField(text),
      packageUrl: packageUrl(html),
      detailFetchedAt: new Date().toISOString()
    };
  } catch (error) {
    console.warn('detail failed', base.url, error.message);
    return {
      ...base,
      name: base.name || base.slug.replace(/-/g, ' '),
      author: base.author || 'Unknown studio',
      description: base.description || '',
      image: base.image || '',
      components: base.components || [],
      platforms: base.platforms || [],
      tags: base.tags || [],
      createdAt: base.createdAt || '',
      updatedAt: base.updatedAt || '',
      version: base.version || '',
      installs: base.installs || 0,
      size: base.size || '',
      packageUrl: base.packageUrl || null,
      detailFetchedAt: base.detailFetchedAt || ''
    };
  }
}

async function readPrevious() {
  try {
    const parsed = JSON.parse(await fs.readFile('data/catalog.json', 'utf8'));
    return Array.isArray(parsed) ? parsed : parsed.mods || [];
  } catch {
    return [];
  }
}

const previous = await readPrevious();
const previousById = new Map(previous.map(mod => [mod.id, mod]));
const found = new Map();
const recentIds = new Set();

function addFound(mod, platform) {
  const old = found.get(mod.id) || previousById.get(mod.id) || {};
  const platforms = new Set([...(old.platforms || []), ...(mod.platforms || []), ...(platform ? [platform] : [])]);
  found.set(mod.id, { ...old, ...mod, platforms: [...platforms] });
}

async function scanCatalog(platform) {
  let emptyOrDuplicatePages = 0;
  const platformSeen = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${ORIGIN}/mods/?page=${page}&sort=total-downloads-desc&tagAlias=${encodeURIComponent(platform.toLowerCase())}`;
    let html;
    try {
      html = await get(url);
    } catch (error) {
      if (String(error.message).startsWith('404 ')) {
        console.log(`scan ${platform} page ${page}: reached end of catalog`);
        break;
      }
      throw error;
    }
    const items = discoverLinks(html);
    let pageAdded = 0;
    for (const item of items) {
      if (!platformSeen.has(item.id)) pageAdded++;
      platformSeen.add(item.id);
      addFound(item, platform);
    }
    if (page === 1 || page % 25 === 0) console.log(`scan ${platform} page ${page}: ${items.length} links, ${platformSeen.size} ${platform} IDs, ${found.size} union`);
    if (!items.length || !pageAdded) emptyOrDuplicatePages++;
    else emptyOrDuplicatePages = 0;
    if (emptyOrDuplicatePages >= 2) break;
    await sleep(70);
  }
}

async function scanRecent(platform) {
  for (let page = 1; page <= RECENT_PAGES; page++) {
    const url = `${ORIGIN}/mods/?page=${page}&sort=last-modified-desc&tagAlias=${encodeURIComponent(platform.toLowerCase())}`;
    try {
      for (const item of discoverLinks(await get(url))) {
        addFound(item, platform);
        recentIds.add(item.id);
      }
    } catch (error) {
      console.warn('recent scan failed', url, error.message);
      break;
    }
    await sleep(70);
  }
}

for (const platform of ['Desktop', 'Mobile']) await scanCatalog(platform);
for (const platform of ['Desktop', 'Mobile']) await scanRecent(platform);

if (!found.size) throw new Error('GX Store returned no discoverable mod links; refusing to overwrite the existing catalog');

const all = [...found.values()];
const incomplete = mod => !mod.packageUrl || !mod.name || !mod.image || !mod.detailFetchedAt;
const refreshIds = new Set();
for (const mod of all) if (incomplete(mod)) refreshIds.add(mod.id);
for (const id of recentIds) refreshIds.add(id);

const oldest = all
  .filter(mod => !refreshIds.has(mod.id))
  .sort((a, b) => String(a.detailFetchedAt || '').localeCompare(String(b.detailFetchedAt || '')))
  .slice(0, REFRESH_LIMIT);
for (const mod of oldest) refreshIds.add(mod.id);

const selected = all.filter(mod => refreshIds.has(mod.id)).slice(0, DETAIL_LIMIT);
console.log(`discovered ${all.length} mods; refreshing ${selected.length} detail pages with concurrency ${CONCURRENCY}`);

const refreshed = new Map();
let cursor = 0;
let completed = 0;
async function worker() {
  while (cursor < selected.length) {
    const item = selected[cursor++];
    refreshed.set(item.id, await detail(item));
    completed++;
    if (completed % 250 === 0) console.log(`details ${completed}/${selected.length}`);
    if (DETAIL_DELAY_MS) await sleep(DETAIL_DELAY_MS);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const mods = all.map(base => refreshed.get(base.id) || {
  ...(previousById.get(base.id) || {}),
  ...base,
  platforms: [...new Set([...(previousById.get(base.id)?.platforms || []), ...(base.platforms || [])])]
});
mods.sort((a, b) => (b.installs || 0) - (a.installs || 0) || String(a.name || '').localeCompare(String(b.name || '')));

const out = {
  meta: {
    generatedAt: new Date().toISOString(),
    sources: ['GX Store official Desktop + Mobile catalogs'],
    maxPagesPerPlatform: MAX_PAGES,
    entries: mods.length,
    enrichedThisRun: refreshed.size,
    resolvedPackageUrls: mods.filter(mod => mod.packageUrl).length,
    images: mods.filter(mod => mod.image).length,
    knownAuthors: mods.filter(mod => mod.author && mod.author !== 'Unknown studio').length
  },
  mods
};

await fs.mkdir('data', { recursive: true });
await fs.writeFile('data/catalog.json', `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${mods.length} mods; ${out.meta.resolvedPackageUrls} packages; ${out.meta.images} images; ${out.meta.knownAuthors} known authors`);
