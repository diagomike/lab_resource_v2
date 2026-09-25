// Re-labels a recorded case (e.g. a test artifact) without re-running it: tsx e2e/annotate.ts <id> <RESULT> <note>
import fs from "node:fs";
const [id, result, ...note] = process.argv.slice(2);
const all = JSON.parse(fs.readFileSync("e2e/results.json", "utf8"));
const row = all.find((r: any) => r.id === id);
if (!row) throw new Error(`no case ${id}`);
row.result = result;
row.evidence = { ...(typeof row.evidence === "object" ? row.evidence : { value: row.evidence }), annotation: note.join(" ") };
fs.writeFileSync("e2e/results.json", JSON.stringify(all, null, 2));
console.log(id, "→", result);
