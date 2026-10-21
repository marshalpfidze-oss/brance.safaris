// Publish only the public website. Server files and private configuration stay out.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const destination = path.join(root, "public");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const assets = new Set(["index.html", "sytle.css", "app.js"]);
for (const match of html.matchAll(/\bsrc="([^"]+)"/g)) {
  const source = match[1];
  if (/^https?:\/\//.test(source)) continue;
  if (path.basename(source) !== source) throw new Error("Unexpected asset path");
  assets.add(source);
}

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
for (const asset of assets) {
  fs.copyFileSync(path.join(root, asset), path.join(destination, asset));
}
