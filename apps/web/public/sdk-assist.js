// Alias of sdk.js, kept for pages that already load it: Rook.configure, Rook.ask and Rook.recorder
// now live in sdk.js, which also holds <corvo-assistant>. This file only loads that one, from the
// same place, so both keep working. New pages should load sdk.js directly.
(() => {
  const here = document.currentScript;
  if (!here || (window.Rook?.ask && !window.Rook.ask.stub)) return;
  const url = new URL("sdk.js", here.src).href;
  // A plain <script> tag in the page: write the other one right here, so it runs before the next
  // script of the page does, as this one always did.
  if (document.readyState === "loading" && !here.async && !here.defer) {
    document.write(`<script src="${url}"></script>`);
    return;
  }
  // Added later: the calls wait for the file, and the recorder, which cannot wait, says so.
  window.Rook = window.Rook || {};
  const Rook = window.Rook;
  const loaded = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
  const queued = [];
  Rook.configure = (options) => queued.push(options);
  Rook.ask = (options) =>
    loaded.then(() => {
      for (const next of queued.splice(0)) Rook.configure(next);
      return Rook.ask(options);
    });
  Rook.ask.stub = true;
  Rook.recorder = () => {
    throw new Error("Rook is still loading: create the recorder after the page has loaded");
  };
  Rook.recorder.stub = true;
})();
