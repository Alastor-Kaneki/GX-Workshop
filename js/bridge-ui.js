const status = document.querySelector('#bridgeStatus');
const card = document.querySelector('#bridgeCard');

function refresh() {
  const version = document.documentElement?.dataset?.gxWorkshopBridge;
  const ready = Boolean(version);
  if (status) status.textContent = ready
    ? `Connected • userscript bridge v${version}`
    : 'Not installed • browser-only fallback active';
  if (card) card.classList.toggle('bridgeReady', ready);
}

document.addEventListener('gx-workshop-bridge-ready', refresh);
document.addEventListener('gx-workshop-bridge-result', event => {
  let result;
  try { result = JSON.parse(String(event.detail || '{}')); }
  catch { return; }
  if (result.phase !== 'error') return;
  const toasts = document.querySelector('#toasts');
  if (!toasts) return;
  const node = document.createElement('div');
  node.className = 'toast err';
  node.textContent = `Download bridge: ${result.message || 'failed'}`;
  toasts.append(node);
  setTimeout(() => node.remove(), 5200);
});

refresh();
setTimeout(refresh, 300);
setTimeout(refresh, 1200);
