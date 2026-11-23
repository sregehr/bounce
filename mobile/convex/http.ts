import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

// Sign-in can only come back to a web address, and the phone app has none. So a phone
// sign-in comes back here, and this hands it on to the app through its own link scheme.
// What is passed on is a one-time code that only works together with a secret the app that
// started the sign-in is holding, so it is no use to anything else that catches the link.
http.route({
  path: "/auth/return",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    return new Response(null, { status: 302, headers: { Location: `bounce://auth${new URL(request.url).search}` } });
  }),
});

// ---------- Listening links ----------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
      // The page runs only its own inline script and plays only this server's audio.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; media-src *; form-action 'self'; base-uri 'none'",
    },
  });
const STYLE = `body{margin:0;background:#121212;color:#f2f0ea;font:16px/1.5 -apple-system,system-ui,sans-serif}main{max-width:560px;margin:0 auto;padding:32px 20px 64px}h1{font-size:32px;line-height:1.1;margin:0 0 4px}p{color:#a8a59c;margin:0}.wave{display:flex;align-items:center;gap:2px;height:96px;margin:28px 0 8px;cursor:pointer;touch-action:manipulation}.wave i{flex:1;background:#4a4a4a;border-radius:2px;min-height:3px}.wave i.on{background:#ffb020}.row{display:flex;justify-content:space-between;color:#a8a59c;font-size:13px}button{font:600 16px -apple-system,system-ui,sans-serif;border:0;border-radius:14px;min-height:48px;padding:0 22px;background:#ffb020;color:#121212;cursor:pointer}.play{margin:20px 0 28px;width:100%}input,textarea{font:16px -apple-system,system-ui,sans-serif;width:100%;box-sizing:border-box;background:#1c1c1c;color:#f2f0ea;border:1px solid #333;border-radius:12px;padding:12px;margin:0 0 10px}h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#a8a59c;margin:32px 0 10px}li{list-style:none;padding:10px 0;border-top:1px solid #2a2a2a}ul{padding:0;margin:0}li b{color:#ffb020;cursor:pointer;margin-right:8px}small{color:#a8a59c}`;

http.route({
  pathPrefix: "/s/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const token = new URL(request.url).pathname.split("/")[2] ?? "";
    const song = /^[a-z0-9]{12,60}$/.test(token) ? await ctx.runQuery(internal.shares.page, { token }) : null;
    if (!song || !song.audioUrl) return html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bounce</title><style>${STYLE}</style><main><h1>This link is no longer here</h1><p>The song was taken down, or the link is not complete.</p></main>`, 404);
    const bars = song.peaks.map((p) => `<i style="height:${Math.max(4, Math.round(Math.sqrt(p) * 100))}%"></i>`).join("");
    const notes = song.notes.map((n) => `<li><b data-at="${n.atSec}">${clock(n.atSec)}</b>${esc(n.text)} <small>${esc(n.name)}</small></li>`).join("");
    return html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(song.title)} · Bounce</title><style>${STYLE}</style>
<main>
<h1>${esc(song.title)}</h1><p>${esc(song.artist)}</p>
<div class="wave" id="wave" role="slider" aria-label="Position in song" aria-valuemin="0" aria-valuemax="${Math.round(song.durationSec)}" aria-valuenow="0" tabindex="0">${bars}</div>
<div class="row"><span id="now">0:00</span><span>${clock(song.durationSec)}</span></div>
<audio id="audio" preload="metadata" src="${esc(song.audioUrl)}"></audio>
<button class="play" id="play" type="button">Play</button>
<h2>Leave a note</h2>
<form method="post" action="/s/${token}/note">
<input type="hidden" name="at" id="at" value="0">
<input name="name" maxlength="40" placeholder="Your name" autocomplete="name">
<textarea name="text" maxlength="280" rows="3" required placeholder="What do you think? Your note is pinned to where the song is now."></textarea>
<button type="submit">Leave note at <span id="pin">0:00</span></button>
</form>
<h2>Notes</h2>
<ul>${notes || "<li><small>No notes yet. Be the first.</small></li>"}</ul>
</main>
<script>
var a=document.getElementById('audio'),w=document.getElementById('wave'),bars=w.children,d=${song.durationSec};
function t(s){return Math.floor(s/60)+':'+('0'+Math.floor(s%60)).slice(-2)}
function draw(){var p=a.currentTime/d;for(var i=0;i<bars.length;i++)bars[i].className=i/bars.length<p?'on':'';document.getElementById('now').textContent=t(a.currentTime);document.getElementById('pin').textContent=t(a.currentTime);document.getElementById('at').value=a.currentTime.toFixed(1);w.setAttribute('aria-valuenow',Math.round(a.currentTime))}
a.addEventListener('timeupdate',draw);a.addEventListener('seeked',draw);
document.getElementById('play').onclick=function(){if(a.paused){a.play();this.textContent='Pause'}else{a.pause();this.textContent='Play'}};
a.addEventListener('ended',function(){document.getElementById('play').textContent='Play'});
w.onclick=function(e){var r=w.getBoundingClientRect();a.currentTime=Math.max(0,Math.min(d,(e.clientX-r.left)/r.width*d))};
w.onkeydown=function(e){if(e.key==='ArrowRight')a.currentTime=Math.min(d,a.currentTime+5);if(e.key==='ArrowLeft')a.currentTime=Math.max(0,a.currentTime-5)};
[].forEach.call(document.querySelectorAll('b[data-at]'),function(b){b.onclick=function(){a.currentTime=Number(b.dataset.at);a.play();document.getElementById('play').textContent='Pause'}});
</script></html>`);
  }),
});

http.route({
  pathPrefix: "/s/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const [, , token, action] = new URL(request.url).pathname.split("/");
    if (action !== "note" || !/^[a-z0-9]{12,60}$/.test(token ?? "")) return html("Not found", 404);
    // The page's form posts as plain url-encoded fields; anything larger than a note is not read.
    const body = await request.text().catch(() => "");
    const form = new URLSearchParams(body.slice(0, 4000));
    const text = form.get("text") ?? "";
    if (text.trim()) await ctx.runMutation(internal.shares.addNote, { token, atSec: Number(form.get("at") ?? 0), name: form.get("name") ?? "", text });
    // Back to the page, so a reload does not post the note twice.
    return new Response(null, { status: 303, headers: { Location: `/s/${token}` } });
  }),
});

export default http;
