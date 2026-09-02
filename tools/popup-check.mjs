// Loads the real popup, pastes formatted LLM output into the workbench, and
// checks that the corruption dies while the formatting lives.
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
const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) =>
  new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
  return r.result?.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 408, height: 620, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.chrome = { storage: { sync: { get: (d, cb) => cb(d), set: () => {} } } };`
});
await send('Page.navigate', { url: URL });
await sleep(900);

// Formatted content, the way it arrives from a chat window.
const HTML = `
<h3>Three things &mdash; and only three</h3>
<p>Great question &mdash; let me break it down. The key insight is simple &mdash; caching.</p>
<ul>
  <li>Latency &mdash; the obvious one</li>
  <li>Cost &mdash; it is not just faster &mdash; it is cheaper</li>
</ul>
<p><strong>Bold survives</strong> and <em>italics too</em> &mdash; obviously.</p>
<pre><code>const range = "1&mdash;5";</code></pre>
`.trim();

const result = await evaluate(`(() => {
  const editor = document.getElementById('editor');
  editor.focus();
  editor.innerHTML = ${JSON.stringify(HTML)};
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
  return {
    text: editor.innerText,
    html: editor.innerHTML,
    count: document.getElementById('count').textContent,
    copyDisabled: document.getElementById('copy').disabled,
    tags: [...editor.querySelectorAll('*')].map((el) => el.tagName).join(',')
  };
})()`);

console.log('=== workbench text after paste ===');
console.log(result.text);
console.log('\n=== counter ===');
console.log(result.count);
console.log('\n=== formatting preserved ===');
console.log(result.tags);
console.log('copy button enabled: ' + !result.copyDisabled);

const dash = /[\u2014\u2015\u2E3A\u2E3B]/;
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
writeFileSync('/tmp/popup-workbench.png', Buffer.from(shot.result.data, 'base64'));
console.log('\nscreenshot: /tmp/popup-workbench.png');

// Clearing must reset both the editor and the counter.
const cleared = await evaluate(`(() => {
  document.getElementById('clear').click();
  return {
    html: document.getElementById('editor').innerHTML,
    count: document.getElementById('count').textContent,
    copyDisabled: document.getElementById('copy').disabled
  };
})()`);
console.log('\n=== after clear ===');
console.log(JSON.stringify(cleared));

if (errors.length) {
  console.log('\n=== uncaught errors ===');
  console.log(errors.join('\n'));
}

const ok =
  !dash.test(result.text) &&
  /purged/.test(result.count) &&
  result.tags.includes('STRONG') &&
  result.tags.includes('LI') &&
  result.tags.includes('H3') &&
  !result.copyDisabled &&
  cleared.html === '' &&
  cleared.copyDisabled &&
  errors.length === 0;

console.log(`\n${ok ? 'PASS' : 'FAIL'}`);
ws.close();
process.exit(ok ? 0 : 1);
