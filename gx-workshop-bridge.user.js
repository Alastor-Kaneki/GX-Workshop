// ==UserScript==
// @name         GX Workshop Download Bridge
// @namespace    https://alastor-kaneki.github.io/GX-Workshop/
// @version      1.0.0
// @description  Gives GX Workshop the same cross-origin CRX/ZIP download powers as the GX Mod Archive Downloader userscript.
// @author       Alastor Kaneki
// @match        https://alastor-kaneki.github.io/GX-Workshop/*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @connect      mods.store.gx.me
// @connect      play.gxc.gg
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '1.0.0';
  const REQUEST_EVENT = 'gx-workshop-bridge-request';
  const RESULT_EVENT = 'gx-workshop-bridge-result';
  const READY_EVENT = 'gx-workshop-bridge-ready';
  const HOSTS = new Set(['mods.store.gx.me', 'play.gxc.gg']);

  function emit(payload) {
    document.dispatchEvent(new CustomEvent(RESULT_EVENT, { detail: JSON.stringify(payload) }));
  }

  function announce() {
    document.documentElement.dataset.gxWorkshopBridge = VERSION;
    document.dispatchEvent(new CustomEvent(READY_EVENT, { detail: VERSION }));
  }

  function safe(value) {
    return String(value || 'gx-mod')
      .normalize('NFKC')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .trim()
      .slice(0, 120) || 'gx-mod';
  }

  function validatePackageUrl(value) {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)) throw new Error('GX package host is not allowed.');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'mods' || parts.at(-1) !== 'mod.crx' || parts.length < 5) throw new Error('URL is not a GX mod.crx package.');
    url.search = '';
    url.hash = '';
    return url.href;
  }

  function readUInt32LE(bytes, offset) {
    if (offset + 4 > bytes.length) throw new Error('Truncated CRX header.');
    return (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24) >>> 0;
  }

  function hasPrefix(bytes, prefix, offset = 0) {
    return bytes.length >= offset + prefix.length && prefix.every((value, index) => bytes[offset + index] === value);
  }

  function isZip(bytes, offset = 0) {
    return [
      [0x50, 0x4b, 0x03, 0x04],
      [0x50, 0x4b, 0x05, 0x06],
      [0x50, 0x4b, 0x07, 0x08]
    ].some(signature => hasPrefix(bytes, signature, offset));
  }

  function extractZip(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    if (isZip(bytes)) return bytes;
    if (!hasPrefix(bytes, [0x43, 0x72, 0x32, 0x34])) throw new Error('Package is neither CRX nor ZIP.');

    const version = readUInt32LE(bytes, 4);
    let offset;
    if (version === 2) offset = 16 + readUInt32LE(bytes, 8) + readUInt32LE(bytes, 12);
    else if (version === 3) offset = 12 + readUInt32LE(bytes, 8);
    else throw new Error(`Unsupported CRX version: ${version}.`);

    if (!isZip(bytes, offset)) throw new Error('CRX payload is not a valid ZIP archive.');
    return bytes.slice(offset);
  }

  function anchorDownload(url, filename, revoke = false) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.style.display = 'none';
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    if (revoke) setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  function gmRequest(details) {
    if (typeof GM_xmlhttpRequest === 'function') return GM_xmlhttpRequest(details);
    if (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function') return GM.xmlHttpRequest(details);
    throw new Error('Userscript manager does not provide cross-origin requests.');
  }

  function gmDownloader() {
    if (typeof GM_download === 'function') return GM_download;
    if (typeof GM !== 'undefined' && typeof GM.download === 'function') return GM.download.bind(GM);
    return null;
  }

  function requestBytes(id, packageUrl, onBytes) {
    gmRequest({
      method: 'GET',
      url: packageUrl,
      responseType: 'arraybuffer',
      anonymous: true,
      timeout: 60000,
      onload(response) {
        if (response.status < 200 || response.status >= 300) {
          emit({ id, phase: 'error', ok: false, message: `GX CDN returned HTTP ${response.status}.` });
          return;
        }
        try {
          onBytes(response.response);
        } catch (error) {
          emit({ id, phase: 'error', ok: false, message: error instanceof Error ? error.message : String(error) });
        }
      },
      onerror() { emit({ id, phase: 'error', ok: false, message: 'GX CDN request failed.' }); },
      ontimeout() { emit({ id, phase: 'error', ok: false, message: 'GX CDN request timed out.' }); }
    });
  }

  function downloadZip(id, packageUrl, baseName) {
    emit({ id, phase: 'working', ok: true, kind: 'zip', message: 'Downloading GX package through userscript bridge…' });
    requestBytes(id, packageUrl, buffer => {
      const zip = extractZip(buffer);
      const filename = `${baseName}.zip`;
      const blobUrl = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
      anchorDownload(blobUrl, filename, true);
      emit({ id, phase: 'done', ok: true, kind: 'zip', filename, message: `Saved ${filename}` });
    });
  }

  function downloadCrxViaBytes(id, packageUrl, baseName) {
    requestBytes(id, packageUrl, buffer => {
      const filename = `${baseName}.crx`;
      const blobUrl = URL.createObjectURL(new Blob([buffer], { type: 'application/x-chrome-extension' }));
      anchorDownload(blobUrl, filename, true);
      emit({ id, phase: 'done', ok: true, kind: 'crx', filename, message: `Saved ${filename}` });
    });
  }

  function downloadCrx(id, packageUrl, baseName) {
    const filename = `${baseName}.crx`;
    const downloader = gmDownloader();
    emit({ id, phase: 'working', ok: true, kind: 'crx', message: 'Starting original CRX through userscript bridge…' });

    if (!downloader) {
      downloadCrxViaBytes(id, packageUrl, baseName);
      return;
    }

    try {
      downloader({
        url: packageUrl,
        name: filename,
        saveAs: false,
        onload() { emit({ id, phase: 'done', ok: true, kind: 'crx', filename, message: `Saved ${filename}` }); },
        onerror() { downloadCrxViaBytes(id, packageUrl, baseName); }
      });
    } catch (_) {
      downloadCrxViaBytes(id, packageUrl, baseName);
    }
  }

  document.addEventListener(REQUEST_EVENT, event => {
    let request;
    try {
      request = JSON.parse(String(event.detail || '{}'));
      const id = String(request.id || '');
      if (!id) throw new Error('Missing bridge request id.');
      const packageUrl = validatePackageUrl(request.url);
      const baseName = safe(String(request.name || 'gx-mod').replace(/\.(crx|zip)$/i, ''));
      const format = request.format === 'zip' ? 'zip' : 'crx';
      if (format === 'zip') downloadZip(id, packageUrl, baseName);
      else downloadCrx(id, packageUrl, baseName);
    } catch (error) {
      emit({ id: String(request?.id || ''), phase: 'error', ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  });

  if (document.documentElement) announce();
  else document.addEventListener('DOMContentLoaded', announce, { once: true });
})();
