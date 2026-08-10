function u32(bytes, offset) {
  return (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24) >>> 0;
}

function hasPrefix(bytes, prefix, offset = 0) {
  return bytes.length >= offset + prefix.length && prefix.every((value, index) => bytes[offset + index] === value);
}

function isZip(bytes, offset = 0) {
  return [[80, 75, 3, 4], [80, 75, 5, 6], [80, 75, 7, 8]].some(signature => hasPrefix(bytes, signature, offset));
}

export function mobileLike() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') ||
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 1100);
}

export function bridgeAvailable() {
  return Boolean(document.documentElement?.dataset?.gxWorkshopBridge);
}

export function bridgeVersion() {
  return document.documentElement?.dataset?.gxWorkshopBridge || null;
}

export function extract(buffer) {
  const bytes = new Uint8Array(buffer);
  if (isZip(bytes)) return { bytes, container: 'ZIP', version: null, offset: 0 };
  if (!hasPrefix(bytes, [67, 114, 50, 52])) throw Error('Package is neither CRX nor ZIP');

  const version = u32(bytes, 4);
  let offset;
  if (version === 2) offset = 16 + u32(bytes, 8) + u32(bytes, 12);
  else if (version === 3) offset = 12 + u32(bytes, 8);
  else throw Error(`Unsupported CRX version ${version}`);

  if (!isZip(bytes, offset)) throw Error('CRX payload is not a ZIP archive');
  return { bytes: bytes.slice(offset), container: 'CRX', version, offset };
}

export async function inspect(file) {
  const buffer = await file.arrayBuffer();
  const pkg = extract(buffer);
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return {
    id: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''),
    name: file.name,
    size: file.size,
    container: pkg.container,
    version: pkg.version,
    offset: pkg.offset,
    zip: pkg.bytes
  };
}

export function safe(value) {
  return String(value || 'gx-mod')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 120) || 'gx-mod';
}

export function save(bytes, name, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function packageName(mod, extension) {
  const base = safe(String(mod?.name || 'gx-mod').replace(/\.(crx|zip)$/i, ''));
  return `${base}.${extension}`;
}

// GX's package CDN accepts the S3-style response-content-disposition override.
// This is crucial for cross-origin direct downloads: the server, rather than the
// HTML download= attribute, tells Android/Firefox/Chrome the real filename.
export function namedPackageUrl(mod, extension = 'crx') {
  const url = new URL(mod.packageUrl);
  url.searchParams.set('response-content-disposition', `attachment; filename="${packageName(mod, extension).replace(/"/g, '')}"`);
  return url.href;
}

function directDownload(mod) {
  const href = namedPackageUrl(mod, 'crx');
  if (mobileLike()) {
    window.location.href = href;
    return;
  }

  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = packageName(mod, 'crx');
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function bridgeDownload(mod, asZip) {
  return new Promise((resolve, reject) => {
    const id = `gxw-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = setTimeout(() => {
      cleanup();
      reject(Error('GX Workshop download bridge timed out'));
    }, 90000);

    function cleanup() {
      clearTimeout(timeout);
      document.removeEventListener('gx-workshop-bridge-result', onResult);
    }

    function onResult(event) {
      let result;
      try { result = JSON.parse(String(event.detail || '{}')); }
      catch { return; }
      if (result.id !== id) return;
      if (result.phase === 'working') return;
      cleanup();
      if (result.phase === 'done' && result.ok) resolve(result.kind || (asZip ? 'zip' : 'crx'));
      else reject(Error(result.message || 'GX Workshop bridge download failed'));
    }

    document.addEventListener('gx-workshop-bridge-result', onResult);
    document.dispatchEvent(new CustomEvent('gx-workshop-bridge-request', {
      detail: JSON.stringify({
        id,
        url: mod.packageUrl,
        name: safe(String(mod?.name || 'gx-mod').replace(/\.(crx|zip)$/i, '')),
        format: asZip ? 'zip' : 'crx'
      })
    }));
  });
}

async function fetchPackage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    return await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function download(mod, asZip = false) {
  if (!mod.packageUrl) throw Error('No resolved GX package URL is available yet');

  if (bridgeAvailable()) return bridgeDownload(mod, asZip);

  // A normal CRX does not require readable response bytes. On mobile, start the
  // direct server-named download synchronously so transient tap activation is
  // preserved and GX supplies the real filename through Content-Disposition.
  if (!asZip && mobileLike()) {
    directDownload(mod);
    return 'crx';
  }

  let response;
  try {
    response = await fetchPackage(mod.packageUrl);
  } catch (error) {
    if (asZip) throw Error('GX CDN blocked browser access to the package bytes');
    directDownload(mod);
    return 'crx';
  }

  if (!response.ok) {
    if (!asZip) {
      directDownload(mod);
      return 'crx';
    }
    throw Error(`GX CDN returned HTTP ${response.status}`);
  }

  const buffer = await response.arrayBuffer();

  if (asZip) {
    const pkg = extract(buffer);
    save(pkg.bytes, packageName(mod, 'zip'), 'application/zip');
    return 'zip';
  }

  save(
    new Uint8Array(buffer),
    packageName(mod, 'crx'),
    response.headers.get('content-type') || 'application/x-chrome-extension'
  );
  return 'crx';
}
