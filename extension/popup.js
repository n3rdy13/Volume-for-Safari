(() => {
  'use strict';
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const DEFAULTS = { enabled: false, gain: 2, compress: true };

  const $ = (id) => document.getElementById(id);
  const enabledEl = $('enabled');
  const gainEl = $('gain');
  const compressEl = $('compress');
  const labelEl = $('gainLabel');
  const statusEl = $('status');
  const presetEls = Array.from(document.querySelectorAll('.presets button'));

  let settings = Object.assign({}, DEFAULTS);

  function save() {
    return api.storage.local.set({ settings }).catch(() => {});
  }

  function render() {
    enabledEl.checked = settings.enabled;
    compressEl.checked = settings.compress;
    gainEl.value = String(settings.gain);
    const db = 20 * Math.log10(settings.gain);
    labelEl.textContent = settings.gain.toFixed(1) + '× (+' + db.toFixed(1) + ' dB)';
    presetEls.forEach((b) => {
      b.classList.toggle('active', Math.abs(Number(b.dataset.g) - settings.gain) < 0.05);
    });
  }

  function setStatus(text, warn) {
    statusEl.textContent = text;
    statusEl.classList.toggle('warn', !!warn);
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve(null), ms))
    ]);
  }

  async function refreshStatus() {
    if (!settings.enabled) {
      setStatus('Boost is off.', false);
      return;
    }
    let reply = null;
    try {
      const tabs = await api.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs[0]) {
        reply = await withTimeout(api.tabs.sendMessage(tabs[0].id, { type: 'vb-status' }), 1200);
      }
    } catch (e) { reply = null; }

    if (!reply) {
      setStatus('No audio or video found on this page yet. If you are playing something, make sure Volume Boost is allowed on this website in Safari.', true);
    } else if (reply.hooked > 0 && reply.ctxState === 'running') {
      setStatus('Boosting ' + reply.hooked + (reply.hooked === 1 ? ' player.' : ' players.'), false);
    } else if (reply.skipped > 0 && reply.hooked === 0) {
      setStatus('This site plays audio from another domain, and Safari mutes it if boosted. Boost can\'t be applied here.', true);
    } else if (reply.ctxState !== 'running') {
      setStatus('Almost there: tap the page once (play or pause) to start boosting.', true);
    } else {
      setStatus('Waiting for the player to start.', false);
    }
  }

  enabledEl.addEventListener('change', () => {
    settings.enabled = enabledEl.checked;
    save().then(() => setTimeout(refreshStatus, 400));
    refreshStatus();
  });

  gainEl.addEventListener('input', () => {
    settings.gain = Number(gainEl.value);
    render();
    save();
  });

  compressEl.addEventListener('change', () => {
    settings.compress = compressEl.checked;
    save();
  });

  presetEls.forEach((b) => {
    b.addEventListener('click', () => {
      settings.gain = Number(b.dataset.g);
      render();
      save();
    });
  });

  api.storage.local.get('settings').then((r) => {
    settings = Object.assign({}, DEFAULTS, r && r.settings);
    settings.gain = Math.min(6, Math.max(1, Number(settings.gain) || DEFAULTS.gain));
    render();
    refreshStatus();
    setInterval(refreshStatus, 2000);
  }).catch(() => {
    render();
    refreshStatus();
  });
})();
