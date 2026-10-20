/*
 * Runs inside an HTML document (e.g. a Claude artifact) that StudySpace shows in a sandboxed frame.
 * The frame has no access to StudySpace and StudySpace none to it, so the two talk by postMessage:
 *
 *   StudySpace → page: highlights, scrollTo, zoom, clearSelection
 *   page → StudySpace: ready, selection, highlight (a highlight was clicked), pointerdown, scroll,
 *                      painted (which highlights couldn't be found), key
 *
 * Highlights are anchored like those in notes: quote + up to 32 characters of context on each side,
 * found again in the page's text each time (see web/src/lib/noteAnchors.ts; locateQuote is a copy).
 * They are painted with the CSS Custom Highlight API, which doesn't change the page's DOM, so the
 * page's own scripts (React and the like) never trip over them.
 *
 * Plain JavaScript, inserted as text: it must not contain a closing script tag.
 */
(function () {
  "use strict";
  var CONTEXT_CHARS = 32;
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, TEXTAREA: 1 };
  var supported = typeof CSS !== "undefined" && !!CSS.highlights && typeof Highlight === "function";
  var highlights = [];
  var ranges = []; // { id, range }, oldest first
  var userScrolled = false;
  var styleEl = null;

  function post(msg) {
    msg.ss = "frame";
    window.parent.postMessage(msg, "*");
  }

  // ---- The page's text ---------------------------------------------------------------
  function textUnits() {
    var out = [];
    if (!document.body) return out;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (n) {
        if (n.nodeType === 3) return NodeFilter.FILTER_ACCEPT;
        return SKIP[n.nodeName.toUpperCase()] ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP; // SVG names are lowercase
      },
    });
    var start = 0;
    for (var n = walker.nextNode(); n; n = walker.nextNode()) {
      out.push({ node: n, start: start });
      start += n.data.length;
    }
    return out;
  }

  function joined(units) {
    var parts = [];
    for (var i = 0; i < units.length; i++) parts.push(units[i].node.data);
    return parts.join("");
  }

  function offsetOf(units, node, offset) {
    if (node.nodeType === 3) {
      for (var i = 0; i < units.length; i++) if (units[i].node === node) return units[i].start + offset;
    }
    // A point between elements (or in skipped text): everything that ends before it counts.
    var point = document.createRange();
    point.setStart(node, offset);
    point.collapse(true);
    var acc = 0;
    for (var j = 0; j < units.length; j++) {
      var u = units[j];
      if (point.comparePoint(u.node, u.node.length) <= 0) acc = u.start + u.node.length;
      else break;
    }
    return acc;
  }

  // ---- Anchors (copy of noteAnchors.locateQuote) ---------------------------------------
  function normalise(text) {
    var norm = "";
    var map = [];
    var inSpace = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (/\s/.test(ch)) {
        if (!inSpace) {
          norm += " ";
          map.push(i);
        }
        inSpace = true;
      } else {
        norm += ch;
        map.push(i);
        inSpace = false;
      }
    }
    map.push(text.length);
    return { norm: norm, map: map };
  }

  function squash(s) {
    return String(s || "").replace(/\s+/g, " ");
  }

  function locateQuote(n, h) {
    var norm = n.norm;
    var map = n.map;
    var quote = squash(h.quote).trim();
    if (!quote) return null;
    var prefix = squash(h.prefix);
    var suffix = squash(h.suffix);
    var best = -1;
    var bestScore = -1;
    for (var at = norm.indexOf(quote); at !== -1; at = norm.indexOf(quote, at + 1)) {
      var score = 0;
      for (var k = 1; k <= prefix.length && at - k >= 0 && norm[at - k] === prefix[prefix.length - k]; k++) score++;
      var end = at + quote.length;
      for (var m = 0; m < suffix.length && end + m < norm.length && norm[end + m] === suffix[m]; m++) score++;
      if (score > bestScore) {
        best = at;
        bestScore = score;
      }
    }
    if (best === -1) return null;
    return [map[best], map[best + quote.length - 1] + 1];
  }

  function anchorOf(range) {
    var units = textUnits();
    var text = joined(units);
    var start = offsetOf(units, range.startContainer, range.startOffset);
    var end = offsetOf(units, range.endContainer, range.endOffset);
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end <= start) return null;
    return {
      quote: text.slice(start, end),
      prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
      suffix: text.slice(end, end + CONTEXT_CHARS),
    };
  }

  /** A DOM range for [start, end) of the page's text. */
  function rangeAt(units, start, end) {
    var r = document.createRange();
    var startSet = false;
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      var uEnd = u.start + u.node.data.length;
      if (!startSet && start < uEnd) {
        r.setStart(u.node, start - u.start);
        startSet = true;
      }
      if (startSet && end <= uEnd) {
        r.setEnd(u.node, end - u.start);
        return r;
      }
    }
    return null;
  }

  // ---- Painting ------------------------------------------------------------------------
  function paint() {
    if (!supported) {
      post({ type: "painted", missing: [], unsupported: highlights.length > 0 });
      return;
    }
    for (var i = 0; i < ranges.length; i++) CSS.highlights.delete("ss-hl-" + i);
    ranges = [];
    var units = textUnits();
    var n = normalise(joined(units));
    var missing = [];
    var css = "";
    for (var j = 0; j < highlights.length; j++) {
      var h = highlights[j];
      var at = locateQuote(n, h);
      var range = at && rangeAt(units, at[0], at[1]);
      if (!range) {
        missing.push(h.id);
        continue;
      }
      var name = "ss-hl-" + ranges.length;
      var hl = new Highlight(range);
      hl.priority = ranges.length; // later highlights on top where they overlap
      CSS.highlights.set(name, hl);
      var c = /^#[0-9a-f]{6}$/i.test(h.color) ? h.color + "66" : h.color;
      css += "::highlight(" + name + "){background-color:" + c + ";}\n";
      ranges.push({ id: h.id, range: range });
    }
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.setAttribute("data-studyspace", "");
      (document.head || document.documentElement).appendChild(styleEl);
    }
    styleEl.textContent = css;
    post({ type: "painted", missing: missing });
  }

  var paintTimer = 0;
  function paintSoon() {
    clearTimeout(paintTimer);
    paintTimer = setTimeout(paint, 250);
  }

  /** The newest highlight under a point, if any. */
  function highlightAt(x, y) {
    var node = null;
    var offset = 0;
    if (document.caretPositionFromPoint) {
      var p = document.caretPositionFromPoint(x, y);
      if (p) {
        node = p.offsetNode;
        offset = p.offset;
      }
    } else if (document.caretRangeFromPoint) {
      var r = document.caretRangeFromPoint(x, y);
      if (r) {
        node = r.startContainer;
        offset = r.startOffset;
      }
    }
    if (!node) return null;
    for (var i = ranges.length - 1; i >= 0; i--) {
      var rg = ranges[i].range;
      try {
        // isPointInRange is inclusive at the end; a click just after the text doesn't count.
        if (rg.isPointInRange(node, offset) && !(node === rg.endContainer && offset === rg.endOffset)) return ranges[i].id;
      } catch (e) {
        /* the point is in another document fragment */
      }
    }
    return null;
  }

  // ---- Selection and clicks --------------------------------------------------------------
  var lastPointer = "mouse";

  function rectOf(range) {
    var b = range.getBoundingClientRect();
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  }

  function reportSelection(point) {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    var range = sel.getRangeAt(0);
    var anchor = anchorOf(range);
    if (!anchor) return false;
    post({ type: "selection", anchor: anchor, rect: rectOf(range), point: point || null });
    return true;
  }

  window.addEventListener(
    "pointerdown",
    function (e) {
      lastPointer = e.pointerType;
      post({ type: "pointerdown" });
    },
    true,
  );

  window.addEventListener("mouseup", function (e) {
    var x = e.clientX;
    var y = e.clientY;
    setTimeout(function () {
      if (reportSelection({ x: x, y: y })) return;
      var id = highlightAt(x, y);
      if (id) post({ type: "highlight", id: id, point: { x: x, y: y } });
    }, 0);
  });

  // Phones select by long-press and send no mouseup: report once the selection stops changing.
  var selTimer = 0;
  document.addEventListener("selectionchange", function () {
    if (lastPointer !== "touch") return;
    clearTimeout(selTimer);
    selTimer = setTimeout(function () {
      reportSelection(null);
    }, 400);
  });

  // ---- Scrolling, keys ---------------------------------------------------------------------
  function scroller() {
    return document.scrollingElement || document.documentElement;
  }

  ["wheel", "touchmove", "keydown"].forEach(function (type) {
    window.addEventListener(
      type,
      function () {
        userScrolled = true;
      },
      { capture: true, passive: true },
    );
  });

  var scrollTimer = 0;
  window.addEventListener(
    "scroll",
    function () {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(function () {
        var el = scroller();
        var room = el.scrollHeight - el.clientHeight;
        post({ type: "scroll", top: room > 0 ? Math.min(1, Math.max(0, el.scrollTop / room)) : 0 });
      }, 200);
    },
    { passive: true },
  );

  function typing(t) {
    return !!(t && t.closest && t.closest("input, textarea, select, [contenteditable]"));
  }

  // StudySpace's one-key shortcuts ([, ], N, Esc…) still work while the page has the focus. Keys with
  // Ctrl/Alt/⌘, keys typed into the page's own fields, and keys the page handles itself stay here.
  window.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    setTimeout(function () {
      if (e.defaultPrevented) return;
      post({ type: "key", key: e.key, code: e.code, shiftKey: e.shiftKey });
    }, 0);
  });

  // ---- Messages from StudySpace -------------------------------------------------------
  window.addEventListener("message", function (e) {
    var m = e.data;
    if (e.source !== window.parent || !m || m.ss !== "parent") return;
    if (m.type === "highlights") {
      highlights = Array.isArray(m.items) ? m.items : [];
      paint();
    } else if (m.type === "scrollTo") {
      // Restoring where the reader was stops once they scroll; a jump they asked for (force) doesn't.
      if (userScrolled && !m.force) return;
      var el = scroller();
      el.scrollTop = (Number(m.top) || 0) * Math.max(0, el.scrollHeight - el.clientHeight);
    } else if (m.type === "zoom") {
      document.documentElement.style.zoom = String(m.value || 1);
    } else if (m.type === "clearSelection") {
      var sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    }
  });

  // Pages that build themselves with scripts change after loading: find the highlights again.
  function observe() {
    if (!document.body) return;
    new MutationObserver(function () {
      if (highlights.length) paintSoon();
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      observe();
      post({ type: "ready" });
    });
  } else {
    observe();
    post({ type: "ready" });
  }
  window.addEventListener("load", function () {
    post({ type: "ready" });
  });
})();
