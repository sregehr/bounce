// Serves the built web app (dist/) for testing.
//   node scripts/serve.mjs            http://localhost:8090, this computer only
//   node scripts/serve.mjs --phone    https on your local network, for a phone on the same Wi-Fi
// Phones only allow the microphone on secure pages, hence HTTPS; the certificate is made
// here and self-signed, so the phone's browser shows a warning once.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('dist');
const phone = process.argv.includes('--phone');
const port = Number(process.env.PORT ?? (phone ? 8443 : 8090));
if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('No build found. Run: npm run build:web');
  process.exit(1);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.map': 'application/json' };

function handle(req, res) {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(root, url);
  // Stay inside dist, and send the app itself for any route it handles in the browser.
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600' });
  fs.createReadStream(file).pipe(res);
}

const addresses = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);

if (!phone) {
  http.createServer(handle).listen(port, '127.0.0.1', () => console.log(`Bounce is at http://localhost:${port}`));
} else {
  const dir = path.resolve('.certs');
  const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem'), made = path.join(dir, 'addresses');
  const names = ['DNS:localhost', 'IP:127.0.0.1', ...addresses.map((a) => `IP:${a}`)].join(',');
  // A certificate only covers the addresses it was made for, so make a new one when they change.
  if (!fs.existsSync(cert) || fs.readFileSync(made, 'utf8') !== names) {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365', '-keyout', key, '-out', cert, '-subj', '/CN=Bounce local test', '-addext', `subjectAltName=${names}`], { stdio: 'ignore' });
    fs.writeFileSync(made, names);
  }
  https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, handle).listen(port, '0.0.0.0', () => {
    console.log('Bounce is being served to your local network. On the phone (same Wi-Fi), open:');
    for (const a of addresses) console.log(`  https://${a}:${port}`);
    console.log('Accept the certificate warning once. Stop this with Ctrl-C when you are done.');
  });
}
