// The small fixed pages the edge middleware and api/render.js answer with when
// they will not render a store. Plain strings; no store data in any of them.
import { PL_ORIGIN } from './_hosts.js';

// A host that serves no store: not PocketLink's, not connected, or not known.
export const NOT_CONNECTED_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex"/><title>Not a PocketLink shop</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:15vh auto;padding:0 24px;color:#111;text-align:center">
<h1 style="font-size:20px">This address is not connected to a PocketLink shop.</h1>
<p><a href="${PL_ORIGIN}/">Go to PocketLink</a></p></body></html>`;

// Something needed to decide or render the page was unavailable. Answer here
// instead of redirecting to the same URL, which could loop while it lasts.
export const UNAVAILABLE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex"/><title>Please try again</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:15vh auto;padding:0 24px;color:#111;text-align:center">
<h1 style="font-size:20px">This page could not load just now.</h1>
<p><a href="">Try again</a></p></body></html>`;

// A path a merchant's domain does not serve. Links only to that domain's own home.
export const NOT_FOUND_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex"/><title>Page not found</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:15vh auto;padding:0 24px;color:#111;text-align:center">
<h1 style="font-size:20px">This page does not exist.</h1>
<p><a href="/">Go to the shop</a></p></body></html>`;

const HTML = 'text/html; charset=utf-8';

/** Web Response versions, for the edge middleware. Never cached, never indexed. */
export const responses = {
  notConnected: () => new Response(NOT_CONNECTED_HTML, { status: 404, headers: { 'Content-Type': HTML, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } }),
  unavailable: () => new Response(UNAVAILABLE_HTML, { status: 503, headers: { 'Content-Type': HTML, 'Cache-Control': 'no-store', 'Retry-After': '5', 'X-Robots-Tag': 'noindex' } }),
  notFound: () => new Response(NOT_FOUND_HTML, { status: 404, headers: { 'Content-Type': HTML, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } }),
  // Temporary: which store a merchant domain belongs to, and which of its names
  // is primary, can change -- a browser must never remember the answer.
  redirect: (location) => new Response(null, { status: 307, headers: { Location: location, 'Cache-Control': 'no-store' } }),
};

/** Node (req, res) versions, for api/render.js and api/sitemap.js. */
export function sendNotConnected(res) {
  res.setHeader('Content-Type', HTML);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.status(404).send(NOT_CONNECTED_HTML);
}

export function sendUnavailable(res) {
  res.setHeader('Content-Type', HTML);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Retry-After', '5');
  res.status(503).send(UNAVAILABLE_HTML);
}

export function sendNotFound(res) {
  res.setHeader('Content-Type', HTML);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.status(404).send(NOT_FOUND_HTML);
}

export function sendRedirect(res, location) {
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.status(307).send('');
}
