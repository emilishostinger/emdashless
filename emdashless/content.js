'use strict';

/**
 * Purges the page on arrival and keeps purging as it changes. The actual DOM
 * work lives in dom-purge.js; this file owns the settings, the observer, and
 * the fields the user types into.
 */
(function () {
  var settings = { enabled: true, purgeCode: true, purgeFields: true };

  // Originals are kept so the toggles can undo the purge without a reload. Capped
  // because a long-lived single-page app would otherwise grow these forever.
  var MAX_TRACKED = 50000;
  var textOriginals = new Map();
  var attrOriginals = new Map();
  var roots = [document];

  var ctx = {
    purgeCode: true,
    record: function (node, src) {
      if (textOriginals.size < MAX_TRACKED && !textOriginals.has(node)) textOriginals.set(node, src);
    },
    recordAttr: function (el, name, src) {
      var saved = attrOriginals.get(el);
      if (!saved && attrOriginals.size < MAX_TRACKED) {
        saved = {};
        attrOriginals.set(el, saved);
      }
      if (saved && !(name in saved)) saved[name] = src;
    },
    onShadowRoot: observeRoot
  };

  function sweep(root) {
    ctx.purgeCode = settings.purgeCode;
    EmdashlessDom.sweep(root, ctx);
  }

  function sweepFrom(node) {
    ctx.purgeCode = settings.purgeCode;
    if (node.nodeType === 3) EmdashlessDom.purgeTextNode(node, ctx);
    else if (node.nodeType === 1) EmdashlessDom.sweep(node, ctx);
  }

  function initialSweep() {
    sweep(document.documentElement);
  }

  var pending = [];
  var scheduled = false;
  var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 16); };

  function flush() {
    scheduled = false;
    var batch = pending;
    pending = [];
    if (!settings.enabled) return;
    ctx.purgeCode = settings.purgeCode;
    for (var i = 0; i < batch.length; i++) {
      var item = batch[i];
      if (item.attr) EmdashlessDom.purgeAttrs(item.node, item.attr, ctx);
      else sweepFrom(item.node);
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    idle(flush);
  }

  var observer = new MutationObserver(function (records) {
    if (!settings.enabled) return;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'characterData') pending.push({ node: r.target });
      else if (r.type === 'attributes') pending.push({ node: r.target, attr: r.attributeName });
      else for (var j = 0; j < r.addedNodes.length; j++) pending.push({ node: r.addedNodes[j] });
    }
    if (pending.length) schedule();
  });

  var OBSERVE = {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: EmdashlessDom.ATTRS
  };

  /** Registration only. Sweeping is the caller's job, so re-sweeps are not skipped. */
  function observeRoot(root) {
    if (roots.indexOf(root) !== -1) return;
    roots.push(root);
    observer.observe(root, OBSERVE);
  }

  /** @param {(node: Node) => boolean} [filter] restore only what this matches */
  function restore(filter) {
    textOriginals.forEach(function (src, node) {
      if (filter && !filter(node)) return;
      if (node.isConnected) node.data = src;
      textOriginals.delete(node);
    });
    attrOriginals.forEach(function (saved, el) {
      if (filter && !filter(el)) return;
      if (el.isConnected) {
        for (var name in saved) el.setAttribute(name, saved[name]);
      }
      attrOriginals.delete(el);
    });
  }

  // ---- text the user types or pastes --------------------------------------
  // Covers pasted LLM output, which is where the corruption arrives in bulk.
  // A dash the user just typed by hand is left alone for one keystroke, so the
  // engine gets to see what follows it before choosing a replacement.
  var nativeValue = {
    INPUT: Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set,
    TEXTAREA: Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  };

  function onInput(event) {
    if (!settings.enabled || !settings.purgeFields) return;
    var el = event.target;
    if (!el || el.nodeType !== 1) return;
    if (!settings.purgeCode && EmdashlessDom.inCode(el)) return;

    var justTypedDash =
      event.inputType === 'insertText' && event.data && EmdashlessPurge.hasDash(event.data);

    var setter = nativeValue[el.tagName];
    if (setter && el.type !== 'password') {
      var value = el.value;
      if (!EmdashlessPurge.hasDash(value)) return;
      var caret = el.selectionStart;
      var out;
      var pos;

      if (justTypedDash) {
        // Purge only what precedes the fresh dash and leave the dash standing.
        var head = value.slice(0, Math.max(0, caret - 1));
        var kept = EmdashlessPurge.purge(head, { atBlockStart: false, atBlockEnd: false });
        out = kept + value.slice(Math.max(0, caret - 1));
        pos = kept.length + 1;
      } else {
        // A paste or an edit: the whole value is settled text, so both edges count.
        out = EmdashlessPurge.purge(value);
        pos = Math.min(
          out.length,
          EmdashlessPurge.purge(value.slice(0, caret), { atBlockStart: false, atBlockEnd: false }).length
        );
      }
      if (out === value) return;

      // Assign through the native setter so frameworks tracking the value notice.
      setter.call(el, out);
      try { el.setSelectionRange(pos, pos); } catch (e) { /* type has no selection */ }
      return;
    }

    if (el.isContentEditable && !justTypedDash) {
      var sel = window.getSelection();
      if (!sel || !sel.anchorNode || sel.anchorNode.nodeType !== 3) return;
      var node = sel.anchorNode;
      var before = node.data;
      if (!EmdashlessPurge.hasDash(before)) return;
      var offset = sel.anchorOffset;
      ctx.purgeCode = settings.purgeCode;
      EmdashlessDom.purgeTextNode(node, ctx);
      if (node.data !== before) {
        var next = Math.min(node.data.length, offset + (node.data.length - before.length));
        try { sel.collapse(node, Math.max(0, next)); } catch (e) { /* selection moved */ }
      }
    }
  }

  // ---- lifecycle ----------------------------------------------------------
  observer.observe(document, OBSERVE);
  document.addEventListener('input', onInput, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialSweep);
  } else {
    initialSweep();
  }
  window.addEventListener('load', initialSweep);

  chrome.storage.sync.get(settings, function (stored) {
    settings.enabled = stored.enabled !== false;
    settings.purgeCode = stored.purgeCode !== false;
    settings.purgeFields = stored.purgeFields !== false;
    if (!settings.enabled) restore();
    else if (!settings.purgeCode) restore(EmdashlessDom.inCode);
    else initialSweep();
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'sync') return;

    if (changes.purgeFields) settings.purgeFields = changes.purgeFields.newValue !== false;
    if (changes.purgeCode) {
      settings.purgeCode = changes.purgeCode.newValue !== false;
      if (!settings.purgeCode) restore(EmdashlessDom.inCode);
    }
    if (changes.enabled) {
      settings.enabled = changes.enabled.newValue !== false;
      if (!settings.enabled) restore();
    }
    if (settings.enabled) initialSweep();
  });
})();
