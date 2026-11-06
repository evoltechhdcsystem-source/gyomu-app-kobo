const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const functionsDirectory = path.join(__dirname, "..", "netlify", "functions");

for (const file of fs.readdirSync(functionsDirectory).filter((name) => name.endsWith(".js"))) {
  test(`Netlify can load ${file} with its installed dependencies`, () => {
    const { handler } = require(path.join(functionsDirectory, file));
    assert.equal(typeof handler, "function");
  });
}
