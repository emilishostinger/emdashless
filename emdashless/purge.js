'use strict';

/**
 * The replacement engine. Pure string in, pure string out, no DOM.
 * Every em dash is resolved into the punctuation a human would have used.
 */
var EmdashlessPurge = (function () {
  // Em dash and its visual accomplices. En dash (U+2013) is legitimate and survives.
  var D = '[\\u2014\\u2015\\u2E3A\\u2E3B]';
  var H = '[ \\t\\u00A0\\u2009\\u202F]'; // horizontal space only, never newlines

  var HAS_DASH = new RegExp(D);
  var RUN = new RegExp(D + '+', 'g');
  var TRAIL_H = new RegExp(H + '+$');
  var LEAD_H = new RegExp('^' + H + '+');

  var RANGE_NUM = new RegExp('(\\d)' + H + '*' + D + '+' + H + '*(?=\\d)', 'g');
  var RANGE_WORD = new RegExp('\\b([A-Za-z]{3,9})' + H + '*' + D + '+' + H + '*(?=([A-Za-z]{3,9})\\b)', 'g');
  var TERM_DOT = new RegExp(H + '*' + D + '+' + H + '*\\.(?=\\s|$)', 'g');
  var TERM_QUOTE = new RegExp(H + '*' + D + '+' + H + '*(?=["\\u201D\\u2019\\u00BB])', 'g');

  var RANGEABLE = /^(mon|tue|tues|wed|wednesday|thu|thur|thurs|fri|sat|sun|monday|tuesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)$/i;

  var COORD = /^(and|but|or|so|yet|nor|then|plus|also)\b/i;
  var SUBORD = /^(which|who|whom|whose|because|although|though|while|whereas|since|unless|until|if|when|whenever|after|before|as|despite|besides|except|including)\b/i;
  var CLAUSE_START = /^(i|you|he|she|it|we|they|there|here)\b/i;
  // Only verb forms that are not also everyday nouns. "cost", "need", "work" and
  // friends are left out, because a list like "latency, cost, and correctness"
  // must not be mistaken for a clause.
  var FINITE = /\b(is|isn't|are|aren't|was|wasn't|were|weren't|am|be|been|being|has|hasn't|have|haven't|had|hadn't|does|doesn't|did|didn't|don't|will|won't|would|wouldn't|shall|should|shouldn't|can|can't|cannot|could|couldn't|may|might|must|mustn't|said|says|knew|knows|thought|thinks|went|goes|came|comes|saw|sees|felt|seems|seemed|became|becomes|brought|gave|told|asked|tried|meant|kept|held|wrote|makes|made|takes|took|gets|got)\b/i;
  var NP_CUE = /^(the|a|an|all|every|each|one|two|three|no|none|nothing|everything|something|anything|just|only|more|less|most|my|our|your|his|her|its|their|pure|total|sheer|exactly|precisely|namely|simply)\b/i;

  /** Split on sentence terminators and newlines, keeping every character. */
  function splitSentences(s) {
    var out = [];
    var start = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '\n') {
        out.push(s.slice(start, i + 1));
        start = i + 1;
        continue;
      }
      if (c === '.' || c === '!' || c === '?' || c === '\u2026') {
        var j = i + 1;
        while (j < s.length && '.!?\u2026"\'\u201D\u2019)]'.indexOf(s[j]) !== -1) j++;
        if (j >= s.length || /\s/.test(s[j])) {
          while (j < s.length && s[j] !== '\n' && /\s/.test(s[j])) j++;
          out.push(s.slice(start, j));
          start = j;
        }
        i = j - 1;
      }
    }
    if (start < s.length) out.push(s.slice(start));
    return out;
  }

  function findRuns(s) {
    var out = [];
    var m;
    RUN.lastIndex = 0;
    while ((m = RUN.exec(s))) out.push({ start: m.index, end: m.index + m[0].length });
    return out;
  }

  /** Which mark replaces a lone em dash, given what follows it. */
  function decide(right, sentence) {
    var body = right.replace(/^[("'\u201C\u2018]+/, '');
    var words = body
      .replace(/[.!?\u2026]+["'\u201D\u2019\u00BB]?\s*$/, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    var head = words.slice(0, 5).join(' ');
    var pick;

    if (COORD.test(body) || SUBORD.test(body)) pick = ',';
    else if (CLAUSE_START.test(body) || FINITE.test(head)) pick = ';';
    else if (/,\s/.test(right)) pick = ':';
    // An enumeration joined by "and"/"or" rather than commas is still a list,
    // unless it opens on an adverb, which makes it an aside instead.
    else if (/\s(and|or)\s/i.test(body) && !/ly$/i.test(words[0] || '')) pick = ':';
    else if (NP_CUE.test(body)) pick = ':';
    else if (words.length && words.length <= 3 && !/ly$/i.test(words[0])) pick = ':';
    else pick = ',';

    // One colon and one semicolon per sentence, otherwise it reads like a ransom note.
    if (pick === ':' && sentence.indexOf(':') !== -1) pick = ',';
    if (pick === ';' && sentence.indexOf(';') !== -1) pick = ',';
    return pick;
  }

  /** A matched pair wrapping an aside: commas normally, parentheses when commas would collide. */
  function tryPair(s, a, b) {
    var left = s.slice(0, a.start).replace(TRAIL_H, '');
    var aside = s.slice(a.end, b.start).trim();
    var right = s.slice(b.end).replace(LEAD_H, '');
    if (!left || !aside || !right) return null;

    var useParens =
      aside.indexOf(',') !== -1 || left.indexOf(',') !== -1 || right.indexOf(',') !== -1;
    left = left.replace(/[,;:]$/, '');
    var glued = /^[,.;:!?]/.test(right);

    if (useParens) return left + ' (' + aside + ')' + (glued ? '' : ' ') + right;
    return left + ', ' + aside + (glued ? '' : ', ') + right;
  }

  function replaceSingle(s, run, state) {
    var rawRight = s.slice(run.end);
    var left = s.slice(0, run.start).replace(TRAIL_H, '');
    var right = rawRight.replace(LEAD_H, '');

    if (!left) {
      // Attribution or a dash used as a bullet: "— Oscar Wilde".
      if (state.lineStart) return '- ' + right;
      if (state.isFirst) return ', ' + right;
      return right;
    }

    if (!right) {
      // Genuinely the end of the text: interrupted speech. Otherwise an inline
      // element follows ("text — <a>link</a>") and a comma is what belongs there.
      if (state.isLast && state.atBlockEnd) return left.replace(/[,;:]$/, '') + '...';
      return left.replace(/[,;:]$/, '') + ',' + (rawRight ? ' ' : '');
    }

    var punct = decide(right, s);
    left = left.replace(/[,;:]$/, '');
    if (/^[,.;:!?]/.test(right)) return left + right;
    return left + punct + ' ' + right;
  }

  function fixSentence(s, state) {
    var runs = findRuns(s);
    if (!runs.length) return s;

    if (runs.length >= 2) {
      var paired = tryPair(s, runs[0], runs[1]);
      if (paired !== null) return fixSentence(paired, state);
    }
    return fixSentence(replaceSingle(s, runs[0], state), state);
  }

  /**
   * @param {string} input raw text
   * @param {{atBlockStart?: boolean, atBlockEnd?: boolean}} [opts]
   *   Whether this text begins/ends its block. Without it we cannot tell
   *   "— Oscar Wilde" from a dash that merely follows an inline tag.
   */
  function purge(input, opts) {
    if (typeof input !== 'string' || !HAS_DASH.test(input)) return input;
    var atBlockStart = !opts || opts.atBlockStart !== false;
    var atBlockEnd = !opts || opts.atBlockEnd !== false;

    var s = input.replace(RANGE_NUM, '$1-');
    s = s.replace(RANGE_WORD, function (whole, a, b) {
      return RANGEABLE.test(a) && RANGEABLE.test(b) ? a + '-' : whole;
    });
    if (!HAS_DASH.test(s)) return s;

    s = s.replace(TERM_DOT, '...').replace(TERM_QUOTE, '...');
    if (!HAS_DASH.test(s)) return s;

    var sentences = splitSentences(s);
    var lineStart = atBlockStart;
    for (var i = 0; i < sentences.length; i++) {
      var sentence = sentences[i];
      if (HAS_DASH.test(sentence)) {
        sentences[i] = fixSentence(sentence, {
          lineStart: lineStart,
          isFirst: i === 0,
          isLast: i === sentences.length - 1,
          atBlockEnd: atBlockEnd
        });
      }
      lineStart = /\n$/.test(sentence);
    }
    return sentences.join('');
  }

  return { purge: purge, hasDash: function (s) { return HAS_DASH.test(s); } };
})();
