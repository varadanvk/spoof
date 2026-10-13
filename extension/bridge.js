// Runs in the isolated world: reads settings from chrome.storage and hands
// them to inject.js (main world), which can't access extension APIs.
const EVT_CONFIG = "__geospoof_config__";
const EVT_REQUEST = "__geospoof_request__";
const DEFAULTS = { enabled: true, latitude: 38.5370688, longitude: -121.751826, accuracy: 15 };

function send() {
  chrome.storage.local.get(DEFAULTS).then((cfg) => {
    window.dispatchEvent(new CustomEvent(EVT_CONFIG, { detail: JSON.stringify(cfg) }));
  });
}

// inject.js may run before or after us; cover both orderings.
window.addEventListener(EVT_REQUEST, send);
chrome.storage.onChanged.addListener(send);
send();
