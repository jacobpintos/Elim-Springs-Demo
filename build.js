#!/usr/bin/env node
/**
 * Build step: compile src/app.jsx and inject it into index.html.
 *
 * The app used to ship its JSX as a giant escaped string and compile it in the
 * browser with Babel on every sign-in. That meant a slow startup, a CDN
 * dependency, and a Content-Security-Policy that had to allow 'unsafe-eval'.
 * Now the JSX is compiled here, once, and the plain JS is written straight into
 * index.html between the APP-CODE markers.
 *
 * Usage:  npm run build      (after editing src/app.jsx)
 *
 * index.html is the deployed artifact and is committed, so GitHub Pages needs
 * no build step of its own — but re-run this whenever src/app.jsx changes.
 */

const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");

const ROOT = __dirname;
const SRC = path.join(ROOT, "src", "app.jsx");
const HTML = path.join(ROOT, "index.html");
const START = "<!-- APP-CODE:START -->";
const END = "<!-- APP-CODE:END -->";

function fail(msg) {
  console.error("build failed: " + msg);
  process.exit(1);
}

const jsx = fs.readFileSync(SRC, "utf8");

const out = babel.transformSync(jsx, {
  presets: [["@babel/preset-react", { runtime: "classic" }]],
  compact: false,
  comments: false,
  babelrc: false,
  configFile: false,
  filename: "app.jsx",
});
if (!out || !out.code) fail("Babel produced no output.");

// The app is written against bare hook names (useState, useEffect, …) that the
// old runtime path injected before eval. Declare them here instead.
const PRELUDE =
  "var useState=React.useState,useEffect=React.useEffect,useRef=React.useRef," +
  "useCallback=React.useCallback,useMemo=React.useMemo,useContext=React.useContext," +
  "useReducer=React.useReducer,useLayoutEffect=React.useLayoutEffect;\n";

const bundle = "(function(){\n" + PRELUDE + out.code + "\n})();";

let html = fs.readFileSync(HTML, "utf8");
const s = html.indexOf(START);
const e = html.indexOf(END);
if (s === -1 || e === -1 || e < s) fail("APP-CODE markers not found in index.html.");

html = html.slice(0, s + START.length) + "\n<script>\n" + bundle + "\n</script>\n" + html.slice(e);
fs.writeFileSync(HTML, html);

const kb = (n) => Math.round(n / 1024) + "KB";
console.log(
  "built  src/app.jsx (" + kb(jsx.length) + ")  ->  index.html (" + kb(bundle.length) + " compiled)"
);
