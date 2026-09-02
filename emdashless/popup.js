'use strict';

var DEFAULTS = { enabled: true, purgeFields: true, purgeCode: true };

var toggle = document.getElementById('toggle');
var state = document.getElementById('state');
var stateNote = document.getElementById('state-note');

var editor = document.getElementById('editor');
var count = document.getElementById('count');
var copyButton = document.getElementById('copy');
var clearButton = document.getElementById('clear');

// Every setting below the master switch: input -> storage key.
var options = [
  { input: document.getElementById('fields'), row: document.getElementById('fields-row'), key: 'purgeFields' },
  { input: document.getElementById('code'), row: document.getElementById('code-row'), key: 'purgeCode' }
];

// ---- settings --------------------------------------------------------------
function render(settings) {
  var enabled = settings.enabled !== false;
  toggle.checked = enabled;
  state.textContent = enabled ? 'purging' : 'dormant';
  state.classList.toggle('off', !enabled);
  stateNote.textContent = enabled
    ? 'Every page you open, as you open it'
    : 'Pages are left exactly as written';

  options.forEach(function (option) {
    option.input.checked = settings[option.key] !== false;
    option.input.disabled = !enabled;
    option.row.classList.toggle('dim', !enabled);
  });
}

function current() {
  var settings = { enabled: toggle.checked };
  options.forEach(function (option) {
    settings[option.key] = option.input.checked;
  });
  return settings;
}

chrome.storage.sync.get(DEFAULTS, render);

toggle.addEventListener('change', function () {
  render(current());
  chrome.storage.sync.set({ enabled: toggle.checked });
});

options.forEach(function (option) {
  option.input.addEventListener('change', function () {
    render(current());
    var patch = {};
    patch[option.key] = option.input.checked;
    chrome.storage.sync.set(patch);
  });
});

// ---- the workbench ---------------------------------------------------------
// Independent of the master switch: this is something you asked for explicitly,
// not something happening to a page you are reading.
var purged = 0;

function status() {
  var empty = !editor.textContent.trim() && !editor.querySelector('img, table, hr');
  copyButton.disabled = empty;
  clearButton.disabled = empty;

  if (empty) {
    purged = 0;
    count.textContent = 'Nothing pasted yet';
    count.classList.remove('hit');
    return;
  }
  count.classList.toggle('hit', purged > 0);
  count.textContent = purged
    ? purged + (purged === 1 ? ' em dash purged' : ' em dashes purged')
    : 'Clean already, nothing to purge';
}

function purgeEditor() {
  var before = EmdashlessDom.countDashes(editor);
  if (before) {
    EmdashlessDom.sweep(editor, { purgeCode: options[1].input.checked });
    purged += before - EmdashlessDom.countDashes(editor);
  }
  status();
}

editor.addEventListener('input', purgeEditor);

// A fresh paste replaces the previous job, so the counter starts over.
editor.addEventListener('paste', function () {
  if (!editor.textContent.trim()) purged = 0;
});

editor.addEventListener('keydown', function (event) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !copyButton.disabled) {
    event.preventDefault();
    copyButton.click();
  }
});

clearButton.addEventListener('click', function () {
  editor.innerHTML = '';
  purged = 0;
  status();
  editor.focus();
});

copyButton.addEventListener('click', async function () {
  var html = editor.innerHTML;
  var text = editor.innerText;
  var label = copyButton.textContent;

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      })
    ]);
  } catch (e) {
    // Older clipboard stacks, and any case where the rich write is refused.
    var range = document.createRange();
    range.selectNodeContents(editor);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('copy');
    selection.removeAllRanges();
  }

  copyButton.textContent = 'Copied';
  setTimeout(function () {
    copyButton.textContent = label;
  }, 1200);
});

status();
