import { DB } from './db.js';
import { inspect, save, download, safe } from './archive.js';
import { PRESETS, apply, load, palette } from './themes.js';
import { catalog, norm, search, parseUrl, gxSearch, COMPONENTS } from './gx.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const q = $('#q');
const chips = $('#chips');
const sort = $('#sort');
const resolveInput = $('#resolveInput');
const resolveBtn = $('#resolve');
const openSearch = $('#openSearch');
const gxStore = $('#gxStore');
const random = $('#random');
const themeJump = $('#themeJump');
const chaos = $('#chaos');
const chaosN = $('#chaosN');
const fileInput = $('#fileInput');
const drop = $('#drop');
const accent = $('#accent');
const second = $('#second');
const bg = $('#bg');
const glow = $('#glow');
const radius = $('#radius');
const mutateBtn = $('#mutate');
const resetTheme = $('#resetTheme');
const themeImage = $('#themeImage');
const preferZip = $('#preferZip');
const recordHistory = $('#recordHistory');
const effects = $('#effects');
const reduce = $('#reduce');
const reloadCatalog = $('#reloadCatalog');
const exportAll = $('#exportAll');
const exportLib = $('#exportLib');
const restore = $('#restore');
const clearBtn = $('#clear');
const install = $('#install');

const PAGE_SIZE = 96;
const S = {
  mods: [],
  meta: {},
  query: '',
  filter: 'All',
  sort: 'relevance',
  visible: PAGE_SIZE,
  fav: new Set(),
  settings: { recordHistory: true, effects: true, reduce: false },
  theme: load()
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
}[char]));
const fmt = number => number > 999999 ? `${(number / 1e6).toFixed(1)}M` : number > 999 ? `${(number / 1e3).toFixed(1)}K` : String(number || 0);
const bytes = number => {
  if (!number) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let value = number;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(i ? 1 : 0)} ${units[i]}`;
};

function toast(text, error = false) {
  const node = document.createElement('div');
  node.className = `toast${error ? ' err' : ''}`;
  node.textContent = text;
  $('#toasts')?.append(node);
  setTimeout(() => node.remove(), 4300);
}

function nav(id) {
  $$('.view').forEach(view => view.classList.toggle('active', view.id === id));
  $$('[data-nav]').forEach(button => button.classList.toggle('active', button.dataset.nav === id));
  history.replaceState(null, '', `#${id}`);
  if (id === 'library') renderLibrary();
  if (id === 'themes') renderThemes();
  if (id === 'settings') diag();
}

function card(mod) {
  const node = document.createElement('article');
  node.className = 'card';
  const badges = [...(mod.platforms || []), ...mod.components, ...mod.tags].filter(Boolean).slice(0, 4);
  node.innerHTML = `
    <div class="art">${mod.image ? `<img loading="lazy" src="${esc(mod.image)}" alt="${esc(mod.name)} icon">` : ''}</div>
    <div class="cardBody">
      <div class="cardTitle"><h3 title="${esc(mod.name)}">${esc(mod.name)}</h3><button class="fav ${S.fav.has(mod.id) ? 'on' : ''}">${S.fav.has(mod.id) ? '♥' : '♡'}</button></div>
      <div class="author">${esc(mod.author)}</div>
      <div class="tags">${badges.map(item => `<span class="tag">${esc(item)}</span>`).join('')}</div>
      <div class="meta"><span>${mod.installs ? `${fmt(mod.installs)} installs` : 'GX Store'}</span><span>${esc(mod.size || mod.version || '')}</span></div>
      <div class="actions"><button class="details">Details</button><button class="primary dl">${mod.packageUrl ? 'Download' : 'Open GX'}</button></div>
    </div>`;
  node.querySelector('.fav').onclick = () => favorite(mod);
  node.querySelector('.details').onclick = () => openMod(mod);
  node.querySelector('.art').onclick = () => openMod(mod);
  node.querySelector('.dl').onclick = () => getMod(mod, false);
  return node;
}

function resetVisible() {
  S.visible = PAGE_SIZE;
}

function render() {
  const matches = search(S.mods, S.query, S.filter, S.sort);
  const shown = matches.slice(0, S.visible);
  const grid = $('#grid');
  grid.innerHTML = '';
  for (const mod of shown) grid.append(card(mod));
  if (shown.length < matches.length) {
    const more = document.createElement('button');
    more.className = 'loadMore';
    more.textContent = `Load more • ${matches.length - shown.length} remaining`;
    more.onclick = () => { S.visible += PAGE_SIZE; render(); };
    grid.append(more);
  }
  $('#count').textContent = `${matches.length} mods`;
  $('#title').textContent = S.query ? `Results for “${S.query}”` : S.filter === 'All' ? 'GX Mods' : S.filter;
  $('#label').textContent = S.query ? 'SEARCH' : 'DISCOVER';
  $('#empty').hidden = Boolean(matches.length);
}

async function favorite(mod) {
  if (S.fav.has(mod.id)) {
    S.fav.delete(mod.id);
    await DB.del('favorites', mod.id);
  } else {
    S.fav.add(mod.id);
    await DB.put('favorites', { id: mod.id, mod, at: new Date().toISOString() });
    await DB.put('library', { id: mod.id, mod, at: new Date().toISOString() });
  }
  render();
  toast(S.fav.has(mod.id) ? 'Added to favorites' : 'Removed from favorites');
  renderLibrary();
}

async function renderLibrary() {
  const library = await DB.all('library');
  const imports = await DB.all('imports');
  const historyItems = await DB.all('history');
  const grid = $('#libGrid');
  grid.innerHTML = '';
  const mods = [
    ...library.map(item => norm(item.mod || item)),
    ...imports.map(item => norm({
      id: item.id,
      name: item.name,
      author: 'Local import',
      description: `${item.container}${item.version ? ` v${item.version}` : ''} • SHA-256 ${item.id.slice(0, 16)}…`,
      tags: ['Imported', 'Local'],
      size: bytes(item.size)
    }))
  ];
  mods.forEach(mod => grid.append(card(mod)));
  $('#sSaved').textContent = library.length;
  $('#sFav').textContent = S.fav.size;
  $('#sImp').textContent = imports.length;
  $('#sHist').textContent = historyItems.length;
  $('#libCount').textContent = library.length + imports.length;
}

function openMod(mod) {
  const body = $('#modalBody');
  const badges = [...(mod.platforms || []), ...mod.components, ...mod.tags].filter(Boolean);
  body.innerHTML = `
    <div class="detailArt">${mod.image ? `<img src="${esc(mod.image)}" alt="${esc(mod.name)} icon">` : ''}</div>
    <div class="detail">
      <small class="eyebrow">${esc((mod.components[0] || 'GX MOD').toUpperCase())}</small>
      <h2>${esc(mod.name)}</h2>
      <div class="author">${esc(mod.author)} ${mod.version ? `• v${esc(mod.version)}` : ''} ${mod.size ? `• ${esc(mod.size)}` : ''}</div>
      <p>${esc(mod.description || 'GX Store mod.')}</p>
      <div class="tags">${badges.map(item => `<span class="tag">${esc(item)}</span>`).join('')}</div>
      <div class="detailBtns">
        <button class="primary" id="mainDl">${mod.packageUrl ? 'Download original CRX' : 'Open GX Store'}</button>
        ${mod.packageUrl ? '<button id="rawZip">Download raw ZIP</button><button id="copyUrl">Copy package URL</button>' : ''}
        ${mod.url ? `<a href="${esc(mod.url)}" target="_blank" rel="noopener">Official page ↗</a>` : ''}
      </div>
    </div>`;
  $('#modal').showModal();
  $('#mainDl').onclick = () => getMod(mod, false);
  if (mod.packageUrl) {
    $('#rawZip').onclick = () => getMod(mod, true);
    $('#copyUrl').onclick = async () => {
      try { await navigator.clipboard.writeText(mod.packageUrl); toast('Direct package URL copied'); }
      catch { window.prompt('Copy the GX package URL:', mod.packageUrl); }
    };
  }
}

async function getMod(mod, asZip = false) {
  if (!mod.packageUrl) {
    window.open(mod.url || gxSearch(mod.name), '_blank', 'noopener');
    return;
  }
  try {
    if (asZip) toast(`Preparing ${mod.name}.zip…`);
    const kind = await download(mod, asZip);
    toast(`${kind.toUpperCase()} download started`);
    await remember(mod, kind);
  } catch (error) {
    if (asZip) {
      toast(`Raw ZIP failed: ${error.message}. Falling back to original CRX.`, true);
      try {
        await download(mod, false);
        await remember(mod, 'crx');
      } catch (fallbackError) {
        toast(fallbackError.message, true);
      }
    } else {
      toast(error.message, true);
    }
  }
}

async function remember(mod, kind) {
  await DB.put('library', { id: mod.id, mod, at: new Date().toISOString() });
  if (S.settings.recordHistory) {
    await DB.put('history', { id: `${Date.now()}-${mod.id}`, modId: mod.id, name: mod.name, kind, at: new Date().toISOString() });
  }
  renderLibrary();
}

function renderThemes() {
  const grid = $('#themesGrid');
  grid.innerHTML = '';
  for (const theme of PRESETS) {
    const button = document.createElement('button');
    button.className = 'themeCard';
    button.style.setProperty('--pbg', theme.bg);
    button.style.setProperty('--pa', theme.accent);
    button.innerHTML = `<b>${esc(theme.name)}</b><small>${esc(theme.id)}</small>`;
    button.onclick = () => { S.theme = { ...theme }; apply(S.theme); syncTheme(); };
    grid.append(button);
  }
}

function syncTheme() {
  accent.value = S.theme.accent;
  second.value = S.theme.second;
  bg.value = S.theme.bg;
  glow.value = S.theme.glow ?? 55;
  radius.value = S.theme.radius ?? 18;
}

function mutate() {
  const randomColor = () => `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;
  S.theme = {
    ...S.theme,
    id: 'mutant',
    name: 'Mutant',
    accent: randomColor(),
    second: randomColor(),
    glow: 35 + Math.floor(Math.random() * 61),
    radius: 7 + Math.floor(Math.random() * 25)
  };
  apply(S.theme);
  syncTheme();
}

async function files(list) {
  for (const file of list) {
    try {
      const inspected = await inspect(file);
      await DB.put('imports', {
        id: inspected.id,
        name: inspected.name,
        size: inspected.size,
        container: inspected.container,
        version: inspected.version,
        offset: inspected.offset,
        at: new Date().toISOString()
      });
      const cardNode = document.createElement('article');
      cardNode.className = 'inspectCard';
      cardNode.innerHTML = `<h3>${esc(inspected.name)}</h3><div class="facts"><div><small>Container</small><b>${inspected.container}${inspected.version ? ` v${inspected.version}` : ''}</b></div><div><small>File size</small><b>${bytes(inspected.size)}</b></div><div><small>ZIP offset</small><b>${inspected.offset} bytes</b></div><div><small>SHA-256</small><b title="${inspected.id}">${inspected.id.slice(0, 16)}…</b></div></div><div class="actions"><button class="primary extract">Save raw ZIP</button></div>`;
      cardNode.querySelector('.extract').onclick = () => save(inspected.zip, `${safe(inspected.name.replace(/\.(crx|zip)$/i, ''))}.zip`, 'application/zip');
      $('#inspect').prepend(cardNode);
      toast(`Inspected ${inspected.name}`);
    } catch (error) {
      toast(`${file.name}: ${error.message}`, true);
    }
  }
  renderLibrary();
}

function diag() {
  const meta = S.meta || {};
  $('#diag').textContent = [
    `Catalog entries: ${S.mods.length}`,
    `Generated: ${meta.generatedAt || 'bundled seed'}`,
    `Sources: ${(meta.sources || ['GX Store']).join(', ')}`,
    `Resolved package URLs: ${meta.resolvedPackageUrls ?? S.mods.filter(mod => mod.packageUrl).length}`,
    `Artwork records: ${meta.images ?? S.mods.filter(mod => mod.image).length}`,
    `Known authors: ${meta.knownAuthors ?? S.mods.filter(mod => mod.author !== 'Unknown studio').length}`,
    `Service worker: ${'serviceWorker' in navigator ? 'supported' : 'unsupported'}`,
    `IndexedDB: ${'indexedDB' in window ? 'supported' : 'unsupported'}`,
    `File API: ${'FileReader' in window ? 'supported' : 'unsupported'}`
  ].join('\n');
}

function syncSettings() {
  recordHistory.checked = S.settings.recordHistory;
  effects.checked = S.settings.effects;
  reduce.checked = S.settings.reduce;
  document.body.classList.toggle('reduced', S.settings.reduce);
  $('.ambient').hidden = !S.settings.effects;
  if (preferZip) {
    preferZip.checked = false;
    preferZip.disabled = true;
    const label = preferZip.closest('label');
    const title = label?.querySelector('b');
    const note = label?.querySelector('small');
    if (title) title.textContent = 'Original CRX is the default';
    if (note) note.textContent = 'Use “Download raw ZIP” explicitly, matching the userscript.';
  }
}

async function setSetting(id, value) {
  S.settings[id] = value;
  await DB.put('settings', { id, value });
  syncSettings();
}

async function jsonDownload(object, name) {
  save(new TextEncoder().encode(JSON.stringify(object, null, 2)), name, 'application/json');
}

async function init() {
  for (const item of await DB.all('favorites')) S.fav.add(item.id);
  for (const item of await DB.all('settings')) if (item.id in S.settings) S.settings[item.id] = item.value;
  apply(S.theme);
  syncTheme();
  syncSettings();
  try {
    const result = await catalog();
    S.mods = result.mods;
    S.meta = result.meta;
    $('#dot').style.background = '#5dff8b';
    $('#health').textContent = `${S.mods.length} synced mods`;
    render();
  } catch (error) {
    $('#dot').style.background = '#ff4668';
    $('#health').textContent = 'catalog unavailable';
    toast(error.message, true);
  }
  renderLibrary();
  diag();
}

$$('[data-nav]').forEach(button => button.onclick = () => nav(button.dataset.nav));
$('#close').onclick = () => $('#modal').close();
$('#modal').onclick = event => { if (event.target === $('#modal')) $('#modal').close(); };

let searchFrame = 0;
q.oninput = event => {
  S.query = event.target.value;
  resetVisible();
  cancelAnimationFrame(searchFrame);
  searchFrame = requestAnimationFrame(render);
};
q.onkeydown = event => {
  if (event.key === 'Enter' && parseUrl(q.value)) {
    resolveInput.value = q.value;
    resolveBtn.click();
  }
};

document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    q.focus();
    q.select();
  }
  if (event.key === 'Escape' && $('#modal').open) $('#modal').close();
});

for (const component of ['All', ...COMPONENTS.slice(0, 10)]) {
  const button = document.createElement('button');
  button.className = `chip${component === 'All' ? ' active' : ''}`;
  button.textContent = component;
  button.onclick = () => {
    S.filter = component;
    resetVisible();
    $$('.chip').forEach(item => item.classList.toggle('active', item === button));
    render();
  };
  chips.append(button);
}

sort.onchange = event => { S.sort = event.target.value; resetVisible(); render(); };
resolveBtn.onclick = () => {
  const parsed = parseUrl(resolveInput.value);
  if (!parsed) return toast('That is not a GX Store mod URL.', true);
  const mod = S.mods.find(item => item.id === parsed.id || item.slug === parsed.slug);
  if (mod) openMod(mod);
  else {
    toast('Not in the synced catalog yet — opening official GX page');
    window.open(parsed.url, '_blank', 'noopener');
  }
};
openSearch.onclick = () => window.open(gxSearch(S.query), '_blank', 'noopener');
gxStore.onclick = () => window.open('https://store.gx.me/mods/', '_blank', 'noopener');
random.onclick = () => S.mods.length && openMod(S.mods[Math.floor(Math.random() * S.mods.length)]);
themeJump.onclick = () => nav('themes');
chaos.onclick = () => {
  const level = (Number(chaosN.textContent) + 25) % 125;
  chaosN.textContent = level;
  if (level === 0) { S.theme = { ...PRESETS[0] }; apply(S.theme); syncTheme(); }
  else mutate();
  toast(level ? `Chaos raised to ${level}` : 'Chaos contained');
};

fileInput.onchange = event => files(event.target.files);
for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('drag'); });
for (const type of ['dragleave', 'drop']) drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('drag'); });
drop.addEventListener('drop', event => files(event.dataTransfer.files));

for (const element of [accent, second, bg, glow, radius]) {
  element.oninput = () => {
    S.theme = { ...S.theme, id: 'custom', accent: accent.value, second: second.value, bg: bg.value, glow: Number(glow.value), radius: Number(radius.value) };
    apply(S.theme);
  };
}
mutateBtn.onclick = mutate;
resetTheme.onclick = () => { S.theme = { ...PRESETS[0] }; apply(S.theme); syncTheme(); };
themeImage.onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const colors = await palette(file);
    S.theme = { ...S.theme, id: 'asset-derived', name: `From ${file.name}`, ...colors };
    apply(S.theme);
    syncTheme();
    const url = URL.createObjectURL(file);
    document.body.style.backgroundImage = `linear-gradient(#0008,#000c),url(${url})`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundAttachment = 'fixed';
    toast('GX asset palette applied across the interface');
  } catch (error) {
    toast(error.message, true);
  }
};

recordHistory.onchange = event => setSetting('recordHistory', event.target.checked);
effects.onchange = event => setSetting('effects', event.target.checked);
reduce.onchange = event => setSetting('reduce', event.target.checked);
reloadCatalog.onclick = () => location.reload();
exportAll.onclick = async () => jsonDownload(await DB.export(), `gx-workshop-backup-${Date.now()}.json`);
exportLib.onclick = async () => jsonDownload({ library: await DB.all('library'), favorites: await DB.all('favorites'), imports: await DB.all('imports') }, `gx-workshop-library-${Date.now()}.json`);
restore.onchange = async event => {
  try {
    await DB.restore(JSON.parse(await event.target.files[0].text()));
    toast('Backup restored');
    setTimeout(() => location.reload(), 450);
  } catch (error) {
    toast(error.message, true);
  }
};
clearBtn.onclick = async () => {
  if (!confirm('Clear GX Workshop local data?')) return;
  for (const store of ['library', 'favorites', 'history', 'imports', 'themes', 'settings']) await DB.clear(store);
  localStorage.removeItem('gx-theme');
  location.reload();
};

let installPrompt;
addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; install.hidden = false; });
install.onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  install.hidden = true;
};

if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
nav(location.hash.slice(1) || 'browse');
renderThemes();
init();
