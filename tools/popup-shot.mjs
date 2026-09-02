// Screenshots popup.html in both states so the layout can be eyeballed.
import { writeFileSync } from 'node:fs';

const HOST = 'http://127.0.0.1:9222';
const URL = 'http://127.0.0.1:8731/emdashless/popup.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`${HOST}/json/version`)).ok) break;
  } catch {}
  await sleep(250);
}

const target = await (await fetch(`${HOST}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) =>
  new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 284, height: 260, deviceScaleFactor: 2, mobile: false
});

async function shot(state, file) {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.chrome = { storage: { sync: {
      get: (d, cb) => cb(${JSON.stringify(state)}), set: () => {}
    } } };`
  });
  await send('Page.navigate', { url: URL });
  await sleep(900);
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log('wrote ' + file);
}

await shot({ enabled: true, purgeCode: true }, '/tmp/popup-on.png');
await shot({ enabled: false, purgeCode: true }, '/tmp/popup-off.png');
ws.close();
process.exit(0);
