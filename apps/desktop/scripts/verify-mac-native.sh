#!/bin/bash
# Checks that a packaged macOS app carries native code for both Macs and that the copy for the
# machine running this script starts. Usage: verify-mac-native.sh <path to Corvo.app>
set -euo pipefail
app="$1"
native="$app/Contents/Resources/app.asar.unpacked/node_modules"
lipo "$native/@koromix/koffi-darwin-x64/darwin_x64/koffi.node" -verify_arch x86_64
lipo "$native/@koromix/koffi-darwin-arm64/darwin_arm64/koffi.node" -verify_arch arm64
lipo "$native/@oxc-parser/binding-darwin-x64/parser.darwin-x64.node" -verify_arch x86_64
lipo "$native/@oxc-parser/binding-darwin-arm64/parser.darwin-arm64.node" -verify_arch arm64
# The embedded Postgres programs are one universal build that serves both Macs.
lipo "$app/Contents/Resources/postgres/bin/postgres" -verify_arch x86_64 arm64
"$app/Contents/Resources/postgres/bin/postgres" --version
ELECTRON_RUN_AS_NODE=1 "$app/Contents/MacOS/Corvo" -e '
  const { createRequire } = require("node:module");
  const appRequire = createRequire(`${process.argv[1]}/Contents/Resources/app.asar/package.json`);
  const koffi = appRequire("koffi");
  if (koffi.load(null).func("int getpid()")() !== process.pid) {
    throw new Error("Packaged native bridge dependency failed");
  }
  const native = `${process.argv[1]}/Contents/Resources/app.asar.unpacked/node_modules`;
  const parser = appRequire(`${native}/@oxc-parser/binding-darwin-${process.arch}/parser.darwin-${process.arch}.node`);
  if (parser.parseSync("smoke.js", "const ready = true;").errors.length !== 0) {
    throw new Error("Packaged monitoring parser dependency failed");
  }
' "$PWD/$app"
