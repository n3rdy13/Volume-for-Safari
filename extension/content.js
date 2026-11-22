// Volume Boost - content script.
//
// Routes every <audio>/<video> element on the page through a Web Audio chain:
//   source -> [compressor] -> gain -> soft clipper -> speakers
// Nothing is touched until the user turns Boost on in the popup.
(() => {
  'use strict';
  if (window.__volumeBoostLoaded) return;
  window.__volumeBoostLoaded = true;

  const api = typeof browser !== 'undefined' ? browser : chrome;

  const DEFAULTS = { enabled: false, gain: 2, compress: true };
  const MIN_GAIN = 1;
  const MAX_GAIN = 6;
  // The soft clipper's curve covers input amplitudes of +/-CURVE_RANGE, so the
  // gain stage is scaled by 1/CURVE_RANGE. Must be >= MAX_GAIN.
  const CURVE_RANGE = 8;
  // Below this output level the clipper is perfectly linear; above it, it
  // rounds off smoothly toward 1.0 instead of hard-clipping.
  const KNEE = 0.6;

  let settings = Object.assign({}, DEFAULTS);
  let ctx = null;
  let bus = null;
  let comp = null;
  let gainNode = null;
  let shaper = null;
  let wiring = null;

  const hooked = new WeakSet();
  const failed = new WeakSet();
  const live = new Set();

  function clampGain(g) {
    const n = Number(g);
    if (!isFinite(n)) return DEFAULTS.gain;
    return Math.min(MAX_GAIN, Math.max(MIN_GAIN, n));
  }

  function mergeSettings(s) {
    const merged = Object.assign({}, DEFAULTS, s || {});
    merged.enabled = !!merged.enabled;
    merged.compress = !!merged.compress;
    merged.gain = clampGain(merged.gain);
    return merged;
  }

  function buildCurve() {
    const n = 8192;
    const curve = new Float32Array(n);
    const room = 1 - KNEE;
    for (let i = 0; i < n; i++) {
      const u = (i * 2) / (n - 1) - 1;
      const v = Math.abs(u) * CURVE_RANGE;
      const y = v <= KNEE ? v : KNEE + room * Math.tanh((v - KNEE) / room);
      curve[i] = Math.sign(u) * y;
    }
    return curve;
  }

  function kick() {
    if (!ctx || ctx.state === 'running') return;
    try {
      const p = ctx.resume();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* needs a user gesture; the next tap will retry */ }
  }

  function wire() {
    if (!ctx) return;
    [bus, comp, gainNode, shaper].forEach((node) => {
      try { node.disconnect(); } catch (e) { /* not connected */ }
    });
    wiring = settings.enabled + '|' + settings.compress;

    let head = bus;
    if (settings.enabled && settings.compress) {
      head.connect(comp);
      head = comp;
    }
    head.connect(gainNode);

    if (settings.enabled) {
      gainNode.connect(shaper);
      shaper.connect(ctx.destination);
      gainNode.gain.value = settings.gain / CURVE_RANGE;
    } else {
      // Off: pass audio through untouched, as if we weren't here.
      gainNode.connect(ctx.destination);
      gainNode.gain.value = 1;
    }
  }

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch (e) {
      ctx = null;
      return null;
    }
    bus = ctx.createGain();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -26;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    gainNode = ctx.createGain();
    shaper = ctx.createWaveShaper();
    shaper.curve = buildCurve();
    shaper.oversample = '4x';
    ctx.onstatechange = () => { if (ctx.state !== 'running') kick(); };
    wire();
    return ctx;
  }

  // 'ok'      - safe to route through Web Audio
  // 'pending' - no source yet, check again later
  // 'skip'    - cross-origin media without CORS: Web Audio would mute it
  function classify(el) {
    if (el.srcObject) return 'ok';
    const src = el.currentSrc || el.src;
    if (!src) return 'pending';
    let url;
    try { url = new URL(src, location.href); } catch (e) { return 'skip'; }
    if (url.protocol === 'blob:' || url.protocol === 'data:') return 'ok';
    if (url.origin === location.origin) return 'ok';
    return el.crossOrigin !== null ? 'ok' : 'skip';
  }

  function tryHook(el) {
    if (hooked.has(el) || failed.has(el)) return;
    if (!settings.enabled || !ctx || ctx.state !== 'running') return;
    if (classify(el) !== 'ok') return;
    try {
      const src = ctx.createMediaElementSource(el);
      src.connect(bus);
      hooked.add(el);
      live.add(el);
    } catch (e) {
      // Already owned by the page's own Web Audio graph, or similar.
      failed.add(el);
    }
  }

  function scan() {
    document.querySelectorAll('audio,video').forEach(tryHook);
  }

  function apply() {
    if (settings.enabled) ensureCtx();
    if (!ctx) return;
    const key = settings.enabled + '|' + settings.compress;
    if (key !== wiring) {
      wire();
    } else if (settings.enabled) {
      gainNode.gain.setTargetAtTime(settings.gain / CURVE_RANGE, ctx.currentTime, 0.03);
    }
    if (settings.enabled) {
      kick();
      scan();
    }
  }

  // iOS only lets an AudioContext start from a tap on the page itself.
  function onGesture() {
    if (!settings.enabled) return;
    if (!ensureCtx()) return;
    try {
      const p = ctx.resume();
      if (p && p.then) p.then(scan, () => {});
      else scan();
    } catch (e) { /* ignore */ }
  }

  function onMediaEvent(e) {
    const t = e.target;
    if (!t || (t.tagName !== 'AUDIO' && t.tagName !== 'VIDEO')) return;
    if (!settings.enabled) return;
    ensureCtx();
    kick();
    tryHook(t);
  }

  ['pointerdown', 'touchend', 'click', 'keydown'].forEach((type) => {
    window.addEventListener(type, onGesture, { capture: true, passive: true });
  });
  ['play', 'playing', 'loadedmetadata'].forEach((type) => {
    document.addEventListener(type, onMediaEvent, true);
  });
  document.addEventListener('visibilitychange', kick);

  // Keeps audio alive across screen lock / interruptions, and catches players
  // whose source shows up late.
  setInterval(() => {
    if (!ctx) return;
    let playing = false;
    live.forEach((el) => {
      if (!el.isConnected && el.paused) live.delete(el);
      else if (!el.paused && !el.ended) playing = true;
    });
    if (playing && ctx.state !== 'running') kick();
    if (settings.enabled && ctx.state === 'running') scan();
  }, 1500);

  // Lets the popup show what is happening on this page.
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'vb-status') return;
    const els = document.querySelectorAll('audio,video');
    if (!els.length) return; // another frame may answer instead
    let h = 0;
    let s = 0;
    let p = 0;
    els.forEach((el) => {
      if (hooked.has(el)) h++;
      else if (failed.has(el) || classify(el) === 'skip') s++;
      else p++;
    });
    sendResponse({ ctxState: ctx ? ctx.state : 'none', hooked: h, skipped: s, pending: p });
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    settings = mergeSettings(changes.settings.newValue);
    apply();
  });

  api.storage.local.get('settings').then((r) => {
    settings = mergeSettings(r && r.settings);
    if (settings.enabled) apply();
  }).catch(() => {});
})();
