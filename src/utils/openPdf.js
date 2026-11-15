/**
 * Open a PDF (sent as base64) in a new tab, in the browser's own PDF viewer,
 * where the print button is one tap away. Founder, 2026-11-15: Shadowfax's label
 * link downloaded instead of opening like Delhivery's, so the server fetches the
 * PDF and the app opens it here.
 *
 * If the browser blocks the new tab, the PDF downloads instead, so it is never lost.
 * Returns true when it opened in a tab.
 */
export function base64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function openPdfTab(b64, filename = 'label.pdf') {
  const url = URL.createObjectURL(new Blob([base64ToBytes(b64)], { type: 'application/pdf' }));
  const tab = window.open(url, '_blank');
  if (!tab) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // The tab has loaded it by then; free the memory.
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  return Boolean(tab);
}
