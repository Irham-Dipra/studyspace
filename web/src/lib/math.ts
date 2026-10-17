/**
 * Normalises LaTeX math delimiters so notes written with `\( … \)` / `\[ … \]` (the style used by
 * LaTeX, ChatGPT and most textbooks) render like `$ … $` / `$$ … $$`, which is what remark-math reads.
 * Without this, Markdown treats `\(` as an escaped bracket and prints the formula as plain text.
 *
 * Display math (`$$ … $$` or `\[ … \]`) always becomes a block on its own lines, even when it was
 * written on one line or in the middle of a sentence. remark-math only treats `$$` as display math
 * when the fences sit on their own lines; otherwise it renders a small inline formula with cramped
 * fractions. List and blockquote indentation is kept, so a formula stays inside its list item.
 *
 * Also makes math work inside GFM tables: table cells are split on `|` before math is parsed, so any
 * `|` inside a formula (e.g. `$|x|$`) would cut the cell. Those become `\vert` / `\Vert`.
 * Escaped dollars (`\(\$5\)`) become `\char36` inside inline math: remark-math, like code spans, ignores
 * backslash escapes, so a literal `$` would end the formula early and leave stray `\5$` text behind.
 *
 * Code spans and fenced code blocks are left untouched.
 */
export function normalizeMath(src: string): string {
  // Odd indexes are code (fenced blocks or inline code spans) and are kept verbatim.
  const parts = src.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g);
  return parts.map((part, i) => (i % 2 === 1 ? part : convertText(part))).join("");
}

const isTableRow = (line: string) => /^\s*\|/.test(line);

/** Wraps formula text in single-dollar inline math, making any `\$` safe inside it. */
const inlineMath = (m: string) => `$${m.trim().replace(/\\\$/g, "\\char36 ")}$`;

/**
 * Escapes dollar signs used as money ("$100 from A … deducting $100") so remark-math doesn't pair
 * them into one formula and print the prose between them as run-together italics.
 * Follows Pandoc's rule: a closing `$` must touch the formula (no space before it) and not be
 * followed by a digit. Only openers followed by a digit are checked, so `$ x $` stays math.
 * Display math and `\( … \)` / `\[ … \]` are skipped.
 */
export function escapeCurrency(text: string): string {
  const skip = /\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\\\$/g;
  const parts = text.split(new RegExp(`(${skip.source})`, "g"));
  return parts.map((part, i) => (i % 2 === 1 ? part : escapeCurrencyIn(part))).join("");
}

function escapeCurrencyIn(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf("$", i);
    if (at === -1) break;
    out += text.slice(i, at);
    if (!/\d/.test(text[at + 1] ?? "")) {
      // Not money: keep a well-formed `$…$` pair as it is.
      const close = findClose(text, at);
      const end = close === -1 ? at + 1 : close + 1;
      out += text.slice(at, end);
      i = end;
      continue;
    }
    const close = findClose(text, at);
    const ok = close !== -1 && !/\s/.test(text[close - 1]) && !/\d/.test(text[close + 1] ?? "");
    if (ok) {
      out += text.slice(at, close + 1);
      i = close + 1;
    } else {
      out += "\\$";
      i = at + 1;
    }
  }
  return out + text.slice(i);
}

/** Next unescaped `$` in the same paragraph, or -1. */
function findClose(text: string, open: number): number {
  for (let j = open + 1; j < text.length; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === "$") return j;
    else if (text[j] === "\n" && /^\n[ \t]*\n/.test(text.slice(j))) return -1;
  }
  return -1;
}

function convertText(text: string): string {
  text = escapeCurrency(text);
  const lines = text.split("\n");
  // Inside table rows everything must stay on one line: use inline math (display style for \[ \] and $$ $$).
  const tableFixed = lines.map((line) =>
    isTableRow(line)
      ? escapeTablePipes(
          line
            .replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => inlineMath(`\\displaystyle ${m}`))
            .replace(/(?<!\\)\$\$([^\n]+?)(?<!\\)\$\$/g, (_, m: string) => inlineMath(`\\displaystyle ${m}`))
            .replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => inlineMath(m)),
        )
      : line,
  );
  const text2 = tableFixed
    .join("\n")
    // \[ … \] → $$ … $$, laid out as a block below.
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => `$$${m}$$`)
    // \( … \) → inline $ … $.
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => inlineMath(m));
  return displayBlocks(text2);
}

/**
 * Rewrites every `$$ … $$` as a fenced display block:
 *
 *     $$
 *     formula
 *     $$
 *
 * Any text before or after it on the same line becomes its own paragraph, and the lines get the
 * indentation (or `>` prefix) of the list item / quote they belong to.
 */
function displayBlocks(text: string): string {
  return text.replace(/(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$/g, (match, inner: string, offset: number) => {
    if (!inner.trim()) return match;
    const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
    const lineEnd = text.indexOf("\n", offset + match.length);
    const head = text.slice(lineStart, offset);
    const tail = text.slice(offset + match.length, lineEnd === -1 ? undefined : lineEnd);
    // Container prefix of this line: indentation, quote markers and a list marker (as spaces).
    const m = /^([ \t]*(?:>[ \t]?)*)(?:([*+-]|\d{1,9}[.)])([ \t]+))?/.exec(head)!;
    const cont = m[1] + (m[2] ? " ".repeat(m[2].length + m[3].length) : "");
    const blank = cont.includes(">") ? cont.trimEnd() : "";
    const quoted = cont.includes(">");
    const body = splitChain(inner.trim())
      .split("\n")
      .map((l) => cont + (quoted ? l.replace(/^[ \t]*(?:>[ \t]?)*/, "") : l.replace(/^[ \t]+/, "")))
      .join("\n");
    const textBefore = head.slice(m[0].length).trim() !== "";
    const textAfter = tail.trim() !== "";
    return (
      (textBefore ? `\n${blank}\n${cont}` : "") +
      `$$\n${body}\n${cont}$$` +
      (textAfter ? `\n${blank}\n${cont}` : "")
    );
  });
}

/** Line break between the steps of a chain, with extra room so fractions don't touch the line above. */
const ROW_GAP = "\\\\[0.45em]";

/** Relation signs a chain of equalities is broken at. */
const RELATION = /^(=|\\approx(?![a-zA-Z])|\\equiv(?![a-zA-Z])|\\Rightarrow(?![a-zA-Z])|\\implies(?![a-zA-Z]))/;

/**
 * A chain like `a = b = c` (two or more top-level relations) is laid out one step per line, aligned on
 * the relation sign, so long derivations stay readable in a narrow panel. Formulas that already
 * arrange their own lines (`\\`, `&`, environments) or put several equations side by side are left alone.
 */
export function splitChain(tex: string): string {
  if (/\\\\|&|\\begin\{/.test(tex)) return tex;
  // Several separate equations side by side ("a = b, \quad c = d") are not one chain.
  if (/\\q?quad(?![a-zA-Z])|;|\\text\{\s*(and|or|where|if|for)\b/.test(tex)) return tex;
  const cuts: number[] = [];
  // Nesting of {…}, (…), […] and \{…\}; only relations outside all of them split the chain.
  // (\left / \right always come with one of these delimiters, so they need no extra handling.)
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    const ch = tex[i];
    if (ch === "\\") {
      const next = tex[i + 1];
      if (next === "{" || next === "(" || next === "[") depth++;
      else if (next === "}" || next === ")" || next === "]") depth--;
      if (next === "{" || next === "}" || next === "(" || next === ")" || next === "[" || next === "]" || next === "\\") {
        i++;
        continue;
      }
      if (depth === 0 && RELATION.test(tex.slice(i))) cuts.push(i);
      // Skip the rest of the command name.
      while (i + 1 < tex.length && /[a-zA-Z]/.test(tex[i + 1])) i++;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === "=" && depth === 0) cuts.push(i);
  }
  if (cuts.length < 2 || depth !== 0) return tex;
  const parts: string[] = [];
  let from = 0;
  for (const at of cuts) {
    parts.push(tex.slice(from, at).trim());
    from = at;
  }
  parts.push(tex.slice(from).trim());
  const [first, ...steps] = parts;
  // A long left-hand side gets a line of its own, with every step indented below it; otherwise the
  // steps line up on their relation signs to the right of it.
  if (visibleLength(first) > 12) {
    return `\\begin{aligned}\n&${first} ${ROW_GAP}\n${steps.map((st) => `&\\quad ${st}`).join(` ${ROW_GAP}\n`)}\n\\end{aligned}`;
  }
  return `\\begin{aligned}\n${first} &${steps.join(` ${ROW_GAP}\n&`)}\n\\end{aligned}`;
}

/** Rough number of characters a TeX snippet shows (command names, braces and spaces removed). */
function visibleLength(tex: string): number {
  return tex.replace(/\\(text|mathrm|operatorname|mathbf|mathit)\b/g, "").replace(/\\[a-zA-Z]+/g, "x").replace(/[{}\s^_]/g, "").length;
}

/** Replaces `|` inside `$…$` on a table row so the table parser doesn't split the formula. */
function escapeTablePipes(line: string): string {
  return line.replace(/(?<!\\)\$([^$\n]+?)(?<!\\)\$/g, (_, m: string) =>
    `$${m.replace(/\\\|/g, "\\Vert ").replace(/\|/g, "\\vert ")}$`,
  );
}
