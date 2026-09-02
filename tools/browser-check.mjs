// Runs purge.js + content.js in a real Chrome against test/torture.html and
// reports whether any em dash survived. Headless Chrome refuses --load-extension,
// so the scripts are injected with a chrome.storage stub instead; every DOM path
// in content.js (TreeWalker, MutationObserver, shadow roots, block detection,
// editable fields, the toggle) is the same code the extension ships.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const HOST = 'http://127.0.0.1:9222';
const PAGE = process.argv[2] || 'http://127.0.0.1:8731/test/torture.html';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForChrome() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${HOST}/json/version`)).ok) return true;
    } catch {}
    await sleep(250);
  }
  return false;
}

if (!(await waitForChrome())) {
  console.error('chrome devtools endpoint never came up');
  process.exit(1);
}

const target = await (
  await fetch(`${HOST}/json/new?about:blank`, { method: 'PUT' })
).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description || ''));
  }
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
  return r.result?.result?.value;
};

const stub = `
  window.chrome = window.chrome || {};
  chrome.storage = {
    sync: { get: (d, cb) => cb(d), set: (v) => { window.__emdlStored = v; } },
    onChanged: { addListener: (fn) => { window.__emdlOnChanged = fn; } }
  };
`;

await send('Runtime.enable');
await send('Page.enable');
const read = (f) => readFileSync(join(root, 'emdashless', f), 'utf8');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: [stub, read('purge.js'), read('dom-purge.js'), read('content.js')].join('\n')
});
await send('Page.navigate', { url: PAGE });
await sleep(2500); // page load + the 700ms delayed mutation in the test page

const ATTRS = ['placeholder', 'title', 'alt', 'aria-label', 'aria-placeholder', 'label', 'value'];

const scan = `(() => {
  const dash = /[\\u2014\\u2015\\u2E3A\\u2E3B]/;
  const attrs = ${JSON.stringify(ATTRS)};
  const survivors = [];
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeType === 1) {
      if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE') continue;
      for (const a of attrs) {
        const v = n.getAttribute(a);
        if (v && dash.test(v)) survivors.push(n.tagName + '[' + a + ']: ' + JSON.stringify(v));
      }
      continue;
    }
    const tag = n.parentElement && n.parentElement.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') continue;
    if (dash.test(n.data)) survivors.push(tag + ': ' + JSON.stringify(n.data.trim()));
  }
  const shadow = document.getElementById('host').shadowRoot.textContent;
  if (dash.test(shadow)) survivors.push('SHADOW: ' + JSON.stringify(shadow));
  if (dash.test(document.title)) survivors.push('TITLE: ' + JSON.stringify(document.title));
  return {
    survivors,
    shadow: shadow.trim(),
    title: document.title,
    text: document.body.innerText,
    attributes: {
      placeholder: document.getElementById('field').placeholder,
      textarea: document.getElementById('area').placeholder,
      title: document.getElementById('tip').title,
      alt: document.getElementById('pic').alt,
      ariaLabel: document.getElementById('btn').getAttribute('aria-label'),
      buttonValue: document.getElementById('submit').value
    },
    code: document.querySelector('pre').textContent
  };
})()`;

const before = await evaluate(scan);
console.log('=== tab title ===');
console.log(before.title);
console.log('\n=== page text after the purge ===');
console.log(before.text);
console.log('\n=== shadow root ===');
console.log(before.shadow);
console.log('\n=== attributes ===');
for (const [k, v] of Object.entries(before.attributes)) console.log(`${k}: ${JSON.stringify(v)}`);
console.log('\n=== surviving em dashes ===');
console.log(before.survivors.length ? before.survivors.join('\n') : 'none. the page is clean.');

// The code-block setting: turning it off must put <pre> back, turning it on re-purges.
const codeOff = await evaluate(`(() => {
  window.__emdlOnChanged({ purgeCode: { newValue: false } }, 'sync');
  return document.querySelector('pre').textContent;
})()`);
const codeOn = await evaluate(`(() => {
  window.__emdlOnChanged({ purgeCode: { newValue: true } }, 'sync');
  return document.querySelector('pre').textContent;
})()`);
console.log('\n=== code blocks setting ===');
console.log('purged (on):  ' + JSON.stringify(before.code));
console.log('spared (off): ' + JSON.stringify(codeOff));
console.log('purged again: ' + JSON.stringify(codeOn));

// Typing simulation: an em dash typed mid-sentence, then the rest of the words.
const typed = await evaluate(`(async () => {
  const el = document.getElementById('field');
  el.focus();
  const type = (ch) => {
    el.value += ch;
    el.setSelectionRange(el.value.length, el.value.length);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
  };
  for (const ch of 'He knew\\u2014') type(ch);
  const afterDash = el.value;
  for (const ch of 'she lied.') type(ch);
  return { afterDash, final: el.value };
})()`);
console.log('\n=== typing into an input ===');
console.log('right after typing the dash: ' + JSON.stringify(typed.afterDash));
console.log('once the clause is finished:  ' + JSON.stringify(typed.final));

// Pasting a wall of LLM output into a textarea, the way it actually arrives.
const LLM =
  'Great question \u2014 let me break this down. The key insight is simple \u2014 caching. ' +
  'There are three things to consider \u2014 latency, cost, and correctness. ' +
  'It is not just faster \u2014 it is fundamentally cheaper. Hope that helps \u2014';

const pasted = await evaluate(`(() => {
  const el = document.getElementById('area');
  el.focus();
  el.value = ${JSON.stringify(LLM)};
  el.setSelectionRange(el.value.length, el.value.length);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
  return el.value;
})()`);
console.log('\n=== pasted LLM output ===');
console.log('before: ' + JSON.stringify(LLM));
console.log('after:  ' + JSON.stringify(pasted));

// With the field setting off, a paste must be left alone.
const pasteOff = await evaluate(`(() => {
  window.__emdlOnChanged({ purgeFields: { newValue: false } }, 'sync');
  const el = document.getElementById('area');
  el.value = ${JSON.stringify(LLM)};
  el.setSelectionRange(el.value.length, el.value.length);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
  const untouched = el.value;
  window.__emdlOnChanged({ purgeFields: { newValue: true } }, 'sync');
  return untouched;
})()`);
console.log('\n=== "what you write" setting off ===');
console.log('paste survives: ' + (pasteOff === LLM));

// The toggle must restore originals and then re-purge, with no reload, and it has
// to reach inside shadow roots both ways.
const probe = `({
  h1: document.querySelector('h1').textContent,
  shadow: document.getElementById('host').shadowRoot.textContent,
  placeholder: document.getElementById('field').placeholder
})`;

const off = await evaluate(`(() => {
  window.__emdlOnChanged({ enabled: { newValue: false } }, 'sync');
  return ${probe};
})()`);
const on = await evaluate(`(() => {
  window.__emdlOnChanged({ enabled: { newValue: true } }, 'sync');
  return ${probe};
})()`);

console.log('\n=== toggled off, then back on ===');
for (const key of ['h1', 'shadow', 'placeholder']) {
  console.log(`${key}\n  off: ${JSON.stringify(off[key])}\n  on:  ${JSON.stringify(on[key])}`);
}

const dash = /[\u2014\u2015\u2E3A\u2E3B]/;
const cycleOk =
  ['h1', 'shadow', 'placeholder'].every((k) => dash.test(off[k])) &&
  ['h1', 'shadow', 'placeholder'].every((k) => !dash.test(on[k]));
console.log(cycleOk ? 'cycle ok' : 'CYCLE BROKEN');

if (errors.length) {
  console.log('\n=== uncaught errors ===');
  console.log(errors.join('\n'));
}

const ok =
  before.survivors.length === 0 &&
  errors.length === 0 &&
  cycleOk &&
  codeOff.includes('\u2014') &&
  !codeOn.includes('\u2014') &&
  !dash.test(pasted) &&
  pasteOff === LLM;
console.log(`\n${ok ? 'PASS' : 'FAIL'}`);
ws.close();
process.exit(ok ? 0 : 1);
