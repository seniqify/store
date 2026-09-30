// One HTTP exchange under ONE deadline: connection, headers AND body.
//
// Clearing a timer when fetch() resolves bounds only the headers: a server
// that answers headers at once and then stalls the body would hold the caller
// past every deadline and budget. Here the deadline stays armed until the body
// has been read, and the body read itself races the deadline -- so the bound
// holds whatever fetch implementation is underneath, and on expiry the request
// is aborted (native fetch then closes the connection).
//
// Result: { ok, status, json, timedOut?, badBody? }
//   timedOut  the deadline passed at any stage; status is 0 -- nothing from a
//             half-received response is ever trusted
//   status 0  no response (network failure)
//   badBody   a response arrived in time but its body is not JSON (json null)
const TIMED_OUT = Symbol('timed_out');
const BAD_BODY = Symbol('bad_body');

export async function fetchJsonWithin(fetchImpl, url, init, limitMs) {
  const ctrl = new AbortController();
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => { ctrl.abort(); resolve(TIMED_OUT); }, Math.max(0, limitMs));
  });
  const timedOut = { ok: false, status: 0, timedOut: true, json: null };
  try {
    const r = await Promise.race([fetchImpl(url, { ...init, signal: ctrl.signal }), deadline]);
    if (r === TIMED_OUT || ctrl.signal.aborted) return timedOut;
    const body = await Promise.race([
      Promise.resolve().then(() => r.json()).then((json) => ({ json }), () => BAD_BODY),
      deadline,
    ]);
    if (body === TIMED_OUT || ctrl.signal.aborted) {
      try { r.body?.cancel?.()?.catch?.(() => {}); } catch { /* already errored by the abort */ }
      return timedOut;
    }
    if (body === BAD_BODY) return { ok: r.ok, status: r.status, json: null, badBody: true };
    return { ok: r.ok, status: r.status, json: body.json };
  } catch {
    return ctrl.signal.aborted ? timedOut : { ok: false, status: 0, json: null };
  } finally {
    clearTimeout(timer);
  }
}
