/**
 * Labels open in a new tab, in the browser's own PDF viewer, where printing is
 * one tap (founder, 2026-11-15).
 *
 * Browsers only allow a new tab for a few seconds after the tap. Shadowfax takes
 * longer than that to make a label, so a tab opened at the end was blocked and the
 * PDF downloaded instead. So the tab opens AT THE TAP (openPendingTab, showing
 * "Preparing the label…"), and the label is put into that same tab when it is ready.
 */
export function base64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Open the tab now, while the tap still counts. null if the browser refused it. */
export function openPendingTab() {
  const tab = window.open('', '_blank');
  if (!tab) return null;
  try {
    tab.opener = null;   // the courier's page must not reach back into PocketLink
    tab.document.title = 'Label';
    tab.document.body.innerHTML = '<p style="font:16px system-ui,sans-serif;padding:24px;color:#374151">Preparing the label…</p>';
  } catch { /* still usable */ }
  return tab;
}

function download(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Put a PDF (base64) into the waiting tab; with no tab, download it so it is never lost. */
export function showPdfIn(tab, b64, filename = 'label.pdf') {
  const url = URL.createObjectURL(new Blob([base64ToBytes(b64)], { type: 'application/pdf' }));
  if (tab && !tab.closed) tab.location.href = url;
  else download(url, filename);
  // The tab has loaded it by then; free the memory.
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
}

/** Send the waiting tab to a link (Delhivery's label); with no tab, open one now. */
export function showLinkIn(tab, url) {
  if (tab && !tab.closed) tab.location.href = url;
  else window.open(url, '_blank', 'noopener');
}

/** Close the waiting tab when there is nothing to show (an error). */
export function closeTab(tab) {
  try { if (tab && !tab.closed) tab.close(); } catch { /* ignore */ }
}
