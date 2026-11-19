import { describe, expect, it } from "vitest";
import { buildFlow, movePhrase, nextPhrase, phrasePieces, phraseText, startPhrase, type Flow, type Phrase, type Piece } from "./phrase";

/** Text height and the width of one char in the made-up pages below (points). */
const H = 10;
const W = 5;

/** A piece of text at (x, y), as wide as its chars. */
const piece = (text: string, x: number, y: number, eol = false): Piece => ({ text, x0: x, y0: y, x1: x + text.length * W, y1: y + H, eol });
/** One line of text at (x, y), as one piece followed by a line break. */
const line = (text: string, x: number, y: number) => piece(text, x, y, true);

const at = (flow: Flow, word: string, nth = 0) => {
  let i = -1;
  for (let k = 0; k <= nth; k++) i = flow.text.indexOf(word, i + 1);
  if (i < 0) throw new Error(`"${word}" not in the page`);
  return i;
};
const click = (flow: Flow, word: string, nth = 0) => startPhrase(flow, at(flow, word, nth))!;
const text = (flow: Flow, p: Phrase) => phraseText(flow, p);

describe("phrase highlights", () => {
  it("runs to the next punctuation mark, over a line break and a hyphen-split word", () => {
    const flow = buildFlow([line("NMI 17 in, rising edge; ignores IF and has no ac-", 0, 0), line("knowledge; type 2", 0, 13)]);
    expect(text(flow, click(flow, "rising"))).toBe("rising edge;");
    expect(text(flow, click(flow, "has"))).toBe("has no acknowledge;");
  });

  it("stops at the end of a table cell, not in the next row", () => {
    const flow = buildFlow([
      piece("M/IO", 0, 0),
      piece("28", 50, 0),
      piece("out", 80, 0),
      line("1 = memory address, 0 = I/O port address on the bus", 120, 0),
      piece("WR", 0, 15),
      piece("29", 50, 15),
      line("out,", 80, 15),
      line("low", 80, 28),
      line("write strobe (memory or I/O, per M/IO)", 120, 15),
    ]);
    // "1 = …, 0 = …" is a list of settings: its comma is no stop.
    expect(text(flow, click(flow, "1 ="))).toBe("1 = memory address, 0 = I/O port address on the bus");
    expect(text(flow, click(flow, "write"))).toBe("write strobe (memory or I/O, per M/IO)");
  });

  it("follows a cell's wrapped lines and stops where the next row starts", () => {
    const flow = buildFlow([
      piece("HLDA", 0, 0),
      line("out,", 80, 0),
      line("high", 80, 13),
      line("hold acknowledge: the 8086 has floated its buses; the DMA may", 120, 0),
      line("use them", 120, 13),
      piece("BHE/S7", 0, 30),
      line("bus high enable", 120, 30),
    ]);
    const p = click(flow, "the 8086");
    expect(text(flow, p)).toBe("the 8086 has floated its buses;");
    const longer = movePhrase(flow, p, "endNextStop");
    expect(text(flow, longer)).toBe("the 8086 has floated its buses; the DMA may use them");
    // Past a cell's end, → goes on into the next row, a cell at a time.
    expect(text(flow, movePhrase(flow, longer, "endNextStop"))).toBe("the 8086 has floated its buses; the DMA may use them BHE/S7");
  });

  it("skips a bullet and ends a block at the next bullet", () => {
    const flow = buildFlow([
      line("• READY: memory is external and may be slower than the CPU. If the data", 0, 0),
      line("are not ready by T3 and the CPU moved on, the data would be lost", 12, 13),
      line("• TEST: the WAIT instruction waits", 0, 26),
    ]);
    expect(text(flow, click(flow, "•"))).toBe("READY:");
    expect(text(flow, click(flow, "memory"))).toBe("memory is external and may be slower than the CPU.");
    expect(text(flow, click(flow, "the data", 1))).toBe("the data would be lost");
  });

  it("doesn't stop at commas inside brackets the phrase opened, but at their end when stepping", () => {
    const flow = buildFlow([line("The offset (IP, SP, BX, SI, DI …) is 16 bits: so", 0, 0), line("ALE (address latch enable, pin 25) is high during T1 only: then", 0, 13)]);
    expect(text(flow, click(flow, "The"))).toBe("The offset (IP, SP, BX, SI, DI …) is 16 bits:");
    const ale = click(flow, "ALE");
    expect(text(flow, ale)).toBe("ALE (address latch enable, pin 25) is high during T1 only:");
    expect(text(flow, movePhrase(flow, ale, "endPrevStop"))).toBe("ALE (address latch enable, pin 25)");
    // Starting inside the brackets, the comma is a stop as usual, and stepping stops at their end.
    const inside = click(flow, "latch");
    expect(text(flow, inside)).toBe("latch enable,");
    expect(text(flow, movePhrase(flow, inside, "endNextStop"))).toBe("latch enable, pin 25)");
  });

  it("knows abbreviations and decimal points", () => {
    const flow = buildFlow([line("See Fig. 3.8 and e.g. section 3.3 for more. Next one.", 0, 0)]);
    expect(text(flow, click(flow, "See"))).toBe("See Fig. 3.8 and e.g. section 3.3 for more.");
  });

  it("stops at a column's end instead of running into the next column", () => {
    const flow = buildFlow([
      line("The left column starts here and", 0, 0),
      line("it ends on this line without a mark", 0, 13),
      line("The right column is up here.", 300, 0),
    ]);
    expect(text(flow, click(flow, "it"))).toBe("it ends on this line without a mark");
  });

  it("moves the end and the start by stops and by words; Tab goes on to the next phrase", () => {
    const flow = buildFlow([line("Advantages: 1 MB stays for memory; simple decoding; I/O instructions are easy to spot.", 0, 0)]);
    const p = click(flow, "1 MB");
    expect(text(flow, p)).toBe("1 MB stays for memory;");
    expect(text(flow, movePhrase(flow, p, "endNextStop"))).toBe("1 MB stays for memory; simple decoding;");
    expect(text(flow, movePhrase(flow, p, "endPrevWord"))).toBe("1 MB stays for");
    expect(text(flow, movePhrase(flow, p, "endNextWord"))).toBe("1 MB stays for memory; simple");
    expect(text(flow, movePhrase(flow, p, "startNextWord"))).toBe("MB stays for memory;");
    expect(text(flow, movePhrase(flow, p, "startPrevWord"))).toBe("Advantages: 1 MB stays for memory;");
    // ↑ takes the start back to the stop before; ↓ drops a label.
    const second = click(flow, "simple");
    expect(text(flow, movePhrase(flow, second, "startPrevStop"))).toBe("1 MB stays for memory; simple decoding;");
    const label = click(flow, "Advantages");
    expect(text(flow, movePhrase(flow, movePhrase(flow, label, "endNextStop"), "startNextStop"))).toBe("1 MB stays for memory;");
    // Tab: the next phrase.
    const n1 = nextPhrase(flow, p)!;
    expect(text(flow, n1)).toBe("simple decoding;");
    expect(text(flow, nextPhrase(flow, n1)!)).toBe("I/O instructions are easy to spot.");
    expect(nextPhrase(flow, nextPhrase(flow, n1)!)).toBeNull();
    // The end never goes back past the first word.
    expect(text(flow, movePhrase(flow, movePhrase(flow, p, "endPrevStop"), "endPrevStop"))).toBe("1");
  });

  it("steps back to just before 'and', 'which' or '(' too", () => {
    const flow = buildFlow([line("two ground paths halve the current per pin and the noise (Book: p. 3).", 0, 0)]);
    const p = click(flow, "two");
    expect(text(flow, p)).toBe("two ground paths halve the current per pin and the noise (Book: p. 3).");
    const back = movePhrase(flow, p, "endPrevStop");
    expect(text(flow, back)).toBe("two ground paths halve the current per pin and the noise");
    expect(text(flow, movePhrase(flow, back, "endPrevStop"))).toBe("two ground paths halve the current per pin");
  });

  it("keeps lists of short settings together, but not longer clauses", () => {
    const flow = buildFlow([line("SF = 1, OF = 1", 0, 0), line("AF = 1 (F + 1 carries out of bit 3), PF = 0 (80H has one 1), done", 0, 20)]);
    expect(text(flow, click(flow, "SF"))).toBe("SF = 1, OF = 1");
    expect(text(flow, click(flow, "AF"))).toBe("AF = 1 (F + 1 carries out of bit 3),");
  });

  it("adds a space only where the page shows a gap", () => {
    const flow = buildFlow([piece("R = 1.88", 0, 0), piece("k", 40, 0), piece("Ω,", 45, 0), piece("C", 60, 0, true)]);
    expect(flow.text).toBe("R = 1.88kΩ, C");
  });

  it("skips a number marker only at the start of a line", () => {
    const flow = buildFlow([line("1. First item here.", 0, 0), line("It equals 1. Then more.", 0, 26)]);
    expect(text(flow, click(flow, "1."))).toBe("First item here.");
    expect(text(flow, click(flow, "1.", 1))).toBe("1.");
  });

  it("maps a phrase back to its pieces, leaving out added spaces and line breaks", () => {
    const pieces = [piece("hold", 0, 0), piece("on", 25, 0, true), line("tight now.", 0, 13)];
    const flow = buildFlow(pieces);
    const p = click(flow, "hold");
    expect(text(flow, p)).toBe("hold on tight now.");
    expect(phrasePieces(flow, p)).toEqual([
      { piece: 0, from: 0, to: 4 },
      { piece: 1, from: 0, to: 2 },
      { piece: 2, from: 0, to: 10 },
    ]);
  });
});
