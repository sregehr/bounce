// The Worker in front of the Bounce site. Everything is the built app, served as static files,
// except listening links: /s/<code> is passed through to the listening page on the Convex
// server, so a link reads bounce.stefanstudio.com/s/... and not the server's own address.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/s/')) return env.ASSETS.fetch(request);
    // Only the page and its note form are passed on; anything else under /s/ is not ours to forward.
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const upstream = new URL(url.pathname + url.search, env.LINKS_ORIGIN);
    const headers = new Headers();
    for (const name of ['content-type', 'accept', 'accept-language']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    // Redirects are handed back as they are: after a note is left the page sends the browser to /s/<code> here.
    return fetch(upstream, { method: request.method, headers, body: request.method === 'POST' ? request.body : undefined, redirect: 'manual' });
  },
};
