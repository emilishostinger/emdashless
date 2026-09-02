'use strict';

/**
 * Applies the engine to a DOM tree. Shared by the page walker and the popup
 * workbench so both purge identically.
 *
 * Callers pass a context:
 *   purgeCode   {boolean} false spares <pre>, <code> and friends
 *   record      {(node, original) => void} called before a text node changes
 *   recordAttr  {(el, name, original) => void} called before an attribute changes
 *   onShadowRoot{(root) => void} called for each open shadow root found
 */
var EmdashlessDom = (function () {
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, MATH: 1 };
  var CODE = { CODE: 1, PRE: 1, SAMP: 1, KBD: 1, VAR: 1, TT: 1 };
  var BLOCKISH = {
    P: 1, DIV: 1, LI: 1, TD: 1, TH: 1, TR: 1, TABLE: 1, CAPTION: 1, UL: 1, OL: 1,
    DL: 1, DD: 1, DT: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, BLOCKQUOTE: 1,
    PRE: 1, FIGURE: 1, FIGCAPTION: 1, SECTION: 1, ARTICLE: 1, MAIN: 1, ASIDE: 1,
    HEADER: 1, FOOTER: 1, NAV: 1, FORM: 1, ADDRESS: 1, DETAILS: 1, SUMMARY: 1,
    BUTTON: 1, LABEL: 1, OPTION: 1, TITLE: 1, BODY: 1, HTML: 1
  };

  // Attributes the user actually reads. `value` is only a visible label on buttons.
  var ATTRS = ['placeholder', 'title', 'alt', 'aria-label', 'aria-placeholder', 'label', 'value'];
  var BUTTONISH = { button: 1, submit: 1, reset: 1 };

  var LEADING_DASH = /^\s*[\u2014\u2015\u2E3A\u2E3B]/;
  var TRAILING_DASH = /[\u2014\u2015\u2E3A\u2E3B]\s*$/;

  function docOf(node) {
    return node.ownerDocument || document;
  }

  function blockAncestor(node) {
    var el = node.parentElement;
    while (el && !BLOCKISH[el.tagName]) el = el.parentElement;
    return el;
  }

  function inCode(node) {
    var el = node.nodeType === 3 ? node.parentElement : node;
    while (el) {
      if (CODE[el.tagName]) return true;
      el = el.parentElement;
    }
    return false;
  }

  /**
   * Does this text start its own line? Only asked when a node starts with a dash,
   * because that is the only time attribution ("— Oscar Wilde") is possible. A <br>
   * counts as a line boundary, otherwise attribution after one reads as an aside.
   */
  function atBlockStart(node) {
    var block = blockAncestor(node);
    if (!block) return true;
    var walker = docOf(node).createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    var n;
    var last = null;
    while ((n = walker.nextNode())) {
      if (n === node) return !last || last.tagName === 'BR';
      if (n.nodeType === 3 ? n.data.trim() : n.tagName === 'BR') last = n;
    }
    return true;
  }

  function atBlockEnd(node) {
    var block = blockAncestor(node);
    if (!block) return true;
    var walker = docOf(node).createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    var n;
    var seen = false;
    while ((n = walker.nextNode())) {
      if (n === node) { seen = true; continue; }
      if (!seen) continue;
      if (n.nodeType === 1) { if (n.tagName === 'BR') return true; continue; }
      if (n.data.trim()) return false;
    }
    return true;
  }

  function purgeTextNode(node, ctx) {
    ctx = ctx || {};
    var parent = node.parentNode;
    if (!parent || parent.nodeType !== 1 || SKIP[parent.tagName]) return false;
    var src = node.data;
    if (!src || !EmdashlessPurge.hasDash(src)) return false;
    if (ctx.purgeCode === false && inCode(node)) return false;

    var out = EmdashlessPurge.purge(src, {
      atBlockStart: LEADING_DASH.test(src) ? atBlockStart(node) : false,
      atBlockEnd: TRAILING_DASH.test(src) ? atBlockEnd(node) : false
    });
    if (out === src) return false;

    if (ctx.record) ctx.record(node, src);
    node.data = out;
    return true;
  }

  function purgeAttrs(el, only, ctx) {
    ctx = ctx || {};
    if (SKIP[el.tagName]) return;
    if (ctx.purgeCode === false && inCode(el)) return;
    var list = only ? [only] : ATTRS;

    for (var i = 0; i < list.length; i++) {
      var name = list[i];
      if (name === 'value' && !(el.tagName === 'INPUT' && BUTTONISH[el.type])) continue;
      if (!el.hasAttribute(name)) continue;

      var src = el.getAttribute(name);
      if (!src || !EmdashlessPurge.hasDash(src)) continue;
      // Attribute text stands on its own, so both edges are real boundaries.
      var out = EmdashlessPurge.purge(src);
      if (out === src) continue;

      if (ctx.recordAttr) ctx.recordAttr(el, name, src);
      el.setAttribute(name, out);
    }
  }

  function sweep(root, ctx) {
    if (!root) return;
    if (root.nodeType === 1) purgeAttrs(root, null, ctx);
    var walker = docOf(root).createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    var n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 3) {
        purgeTextNode(n, ctx);
      } else {
        purgeAttrs(n, null, ctx);
        if (n.shadowRoot) {
          if (ctx && ctx.onShadowRoot) ctx.onShadowRoot(n.shadowRoot);
          sweep(n.shadowRoot, ctx);
        }
      }
    }
  }

  /** How many dash characters live in a tree, text and attributes alike. */
  function countDashes(root) {
    var total = 0;
    var re = /[\u2014\u2015\u2E3A\u2E3B]/g;
    var walker = docOf(root).createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    var n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 3) {
        total += (n.data.match(re) || []).length;
        continue;
      }
      for (var i = 0; i < ATTRS.length; i++) {
        var v = n.getAttribute(ATTRS[i]);
        if (v) total += (v.match(re) || []).length;
      }
    }
    return total;
  }

  return {
    sweep: sweep,
    purgeTextNode: purgeTextNode,
    purgeAttrs: purgeAttrs,
    countDashes: countDashes,
    inCode: inCode,
    ATTRS: ATTRS
  };
})();
