import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dirname, ".."),
  ams = process.env.WORKFORCE_AMS_DIR ?? resolve(root, "../ams");
const rows = [],
  sources = [];
for (const file of (await readdir(resolve(root, "docs/specs")))
  .filter((f) => f.endsWith(".md"))
  .sort()) {
  const body = await readFile(resolve(root, "docs/specs", file), "utf8");
  sources.push({
    file,
    sha256: createHash("sha256").update(body).digest("hex"),
  });
  for (const [i, line] of body.split("\n").entries()) {
    const match = line.match(/^\|\s*(AC-[a-zA-Z0-9-]+)\s*\|/);
    if (!match) continue;
    rows.push({
      id: match[1],
      source: `docs/specs/${file}`,
      line: i + 1,
      criterion: line
        .split("|")
        .slice(2, -1)
        .map((x) => x.trim())
        .join(" | "),
      test_references: [],
      verification: "not_yet_individually_accepted",
    });
  }
}
if (new Set(rows.map((r) => r.id)).size !== rows.length)
  throw Error("Duplicate acceptance IDs");
async function walk(dir) {
  let paths = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(
    () => [],
  )) {
    const name = resolve(dir, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(name)));
    else if (/\.(test|spec)\.js$/.test(name)) paths.push(name);
  }
  return paths;
}
for (const path of [
  ...(await walk(resolve(root, "test"))),
  ...(await walk(resolve(ams, "test"))),
  ...(await walk(resolve(ams, "e2e"))),
]) {
  const body = await readFile(path, "utf8"),
    ids = new Set();
  for (const match of body.matchAll(/(AC-[a-zA-Z0-9-]+)((?:\/\d\d)*)/g)) {
    ids.add(match[1]);
    const base = match[1].split("-").slice(0, -1).join("-");
    for (const suffix of match[2].split("/").filter(Boolean))
      ids.add(`${base}-${suffix}`);
  }
  for (const row of rows)
    if (ids.has(row.id)) row.test_references.push(relative(root, path));
}
const referenced = rows.filter((r) => r.test_references.length).length;
await writeFile(
  resolve(root, "docs/acceptance-inventory.json"),
  JSON.stringify(
    {
      note: "Test-name references only. This is not a pass report or proof that an entire AC has been verified.",
      sources,
      baseline_count: rows.length,
      with_test_references: referenced,
      without_test_references: rows.length - referenced,
      criteria: rows,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    baseline: rows.length,
    with_test_references: referenced,
    without_test_references: rows.length - referenced,
    individually_accepted: 0,
    report: "docs/acceptance-inventory.json",
  }),
);
