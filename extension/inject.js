// Runs in the page's main world at document_start, before page scripts.
(() => {
  const EVT_CONFIG = "__geospoof_config__";
  const EVT_REQUEST = "__geospoof_request__";
  const geo = navigator.geolocation;
  if (!geo) return;

  const native = {
    getCurrentPosition: geo.getCurrentPosition.bind(geo),
    watchPosition: geo.watchPosition.bind(geo),
    clearWatch: geo.clearWatch.bind(geo),
  };

  let config = null;
  let markReady;
  const ready = new Promise((r) => (markReady = r));
  setTimeout(() => markReady(), 1000); // fall back to native if the bridge never answers

  window.addEventListener(EVT_CONFIG, (e) => {
    try { config = JSON.parse(e.detail); } catch {}
    markReady();
  });
  window.dispatchEvent(new CustomEvent(EVT_REQUEST));

  const spoofing = () => config && config.enabled;

  // Build objects that pass `instanceof GeolocationPosition` checks. Own
  // properties shadow the prototype getters, which would throw on a fake.
  function makePosition() {
    const c = {
      latitude: Number(config.latitude),
      longitude: Number(config.longitude),
      accuracy: Number(config.accuracy) || 20,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    };
    const coords = Object.create(GeolocationCoordinates.prototype);
    for (const [k, v] of Object.entries(c)) {
      Object.defineProperty(coords, k, { value: v, enumerable: true });
    }
    Object.defineProperty(coords, "toJSON", { value: () => ({ ...c }) });

    const timestamp = Date.now();
    const pos = Object.create(GeolocationPosition.prototype);
    Object.defineProperty(pos, "coords", { value: coords, enumerable: true });
    Object.defineProperty(pos, "timestamp", { value: timestamp, enumerable: true });
    Object.defineProperty(pos, "toJSON", { value: () => ({ coords: { ...c }, timestamp }) });
    return pos;
  }

  // IDs for spoofed watches start high so they never collide with native ones.
  let nextWatchId = 1_000_000;
  const spoofWatches = new Set();

  function getCurrentPosition(success, error, options) {
    ready.then(() => {
      if (!spoofing()) return native.getCurrentPosition(success, error, options);
      setTimeout(() => success(makePosition()), 50 + Math.random() * 150);
    });
  }

  function watchPosition(success, error, options) {
    if (spoofing()) {
      const id = nextWatchId++;
      spoofWatches.add(id);
      setTimeout(() => spoofWatches.has(id) && success(makePosition()), 50);
      return id;
    }
    // Config may not have arrived yet; native watch is the only synchronous option.
    return native.watchPosition(success, error, options);
  }

  function clearWatch(id) {
    if (spoofWatches.delete(id)) return;
    native.clearWatch(id);
  }

  const proto = Geolocation.prototype;
  Object.defineProperty(proto, "getCurrentPosition", { value: getCurrentPosition, writable: true, configurable: true });
  Object.defineProperty(proto, "watchPosition", { value: watchPosition, writable: true, configurable: true });
  Object.defineProperty(proto, "clearWatch", { value: clearWatch, writable: true, configurable: true });

  // Report geolocation permission as granted while spoofing, so sites that
  // check permissions first don't show an "enable location" prompt.
  if (navigator.permissions && window.PermissionStatus) {
    const nativeQuery = Permissions.prototype.query;
    Object.defineProperty(Permissions.prototype, "query", {
      configurable: true,
      writable: true,
      value: function query(desc) {
        if (desc && desc.name === "geolocation") {
          return ready.then(() => {
            if (!spoofing()) return nativeQuery.call(this, desc);
            const status = new EventTarget(); // real EventTarget so addEventListener works
            Object.setPrototypeOf(status, PermissionStatus.prototype);
            Object.defineProperties(status, {
              state: { value: "granted", enumerable: true },
              name: { value: "geolocation", enumerable: true },
              onchange: { value: null, writable: true, enumerable: true },
            });
            return status;
          });
        }
        return nativeQuery.call(this, desc);
      },
    });
  }
})();
