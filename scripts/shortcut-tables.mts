// Prints the keyboard-shortcut tables for docs/USER_GUIDE.md §12 from web/src/lib/shortcuts.ts.
// Run: npx tsx scripts/shortcut-tables.mts, then paste the output over the tables in §12.
import { GROUP_ORDER, SHORTCUTS, formatCombo, type Shortcut } from "../web/src/lib/shortcuts.ts";

const all = Object.values(SHORTCUTS) as Shortcut[];
const out: string[] = [];
for (const g of GROUP_ORDER) {
  out.push(`**${g}**`, "", "| Keys | Action |", "| --- | --- |");
  for (const s of all.filter((x) => x.group === g)) out.push(`| ${s.keys.map((k) => "`" + formatCombo(k) + "`").join(" / ")} | ${s.label} |`);
  out.push("");
}
console.log(out.join("\n"));
