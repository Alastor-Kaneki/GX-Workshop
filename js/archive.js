function u32(bytes, offset) {
  return (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24) >>> 0;
}

function hasPrefix(bytes, prefix, offset = 0) {
  return bytes.length >= offset + prefix.length && prefix.every((value, index) => bytes[offset + index] === value);
}

function isZip(bytes, offset = 0) {
  return [[80, 75, 3, 4], [80, 75, 5, 6], [80, 75, 7, 8]].some(signature => hasPrefix(bytes, signature, offset));
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
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function packageName(mod, extension) {
  const base = safe(String(mod?.name || 'gx-mod').replace(/\.(crx|zip)$/i, ''));
  return `${base}.${extension}`;
}

function directDownload(mod) {
  const anchor = document.createElement('a');
  anchor.href = mod.packageUrl;
  // Best effort: some browsers/CDNs ignore download= for cross-origin URLs,
  // but keeping it here allows the real name whenever the browser honors it.
  anchor.download = packageName(mod, 'crx');
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export async function download(mod, asZip = false) {
  if (!mod.packageUrl) throw Error('No resolved GX package URL is available yet');

  let response;
  try {
    response = await fetch(mod.packageUrl, { mode: 'cors' });
  } catch (error) {
    // GX CDN CORS can vary. ZIP conversion requires readable bytes, but an
    // original CRX should never stop working just because fetch() is blocked.
    if (asZip) throw Error('GX CDN blocked browser access to the package bytes');
    directDownload(mod);
    return 'crx';
  }

  if (!response.ok) throw Error(`GX CDN returned HTTP ${response.status}`);
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
