// @ts-check
/* Test-only fake camera for the WebKit (mobile-safari) browser tests. Never
 * shipped: e2e/support/webkit-fake-camera.ts adds this file to every WebKit
 * browser context as an init script, and scripts/e2e-fake-camera-isolation.test.mjs
 * fails if anything under src/ (or a production build) refers to it.
 *
 * Why: Chromium has fake media device flags; WebKit has none. Headless WebKit
 * on Linux also does not reliably play a MediaStream from canvas.captureStream()
 * in a <video>: when the stream is attached a moment after it was created (the
 * verification page fetches a capture token in between), play() never settles
 * and the video stays at readyState 0 with no size, so a photo can never be
 * taken. Its own mock camera has the same problem.
 *
 * What it does, in this order:
 * 1. getUserMedia({ video }) returns a real MediaStream from a canvas test
 *    card: moving colour bars, a moving disc, "TEST CAMERA" text, a frame
 *    counter and fresh speckles on every frame, so frame-difference and
 *    brightness checks pass and no two photos are byte-identical (the website
 *    rejects reused photos). enumerateDevices lists one "Test camera".
 *    Requests with audio go to WebKit's own implementation.
 * 2. Any canvas-backed stream (this one, or a spec's own canvas camera) set as
 *    a <video>'s srcObject is not handed to WebKit's media player. The element
 *    reports itself playing at the canvas size (readyState, videoWidth,
 *    videoHeight, paused, currentTime, play(), pause() and the usual media
 *    events), shows the card as its poster, and drawImage / createImageBitmap
 *    read the canvas itself, so the page's own capture code takes the photo.
 *
 * Plain JavaScript passed by path, so no transpiler helper can end up in it. */
(() => {
  const MARKER = "__verifymzansiWebKitFakeCamera";
  const scope = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window));
  if (scope[MARKER]) return;
  scope[MARKER] = true;

  const runToken = Math.random().toString(36).slice(2, 8).toUpperCase();
  /** @type {WeakMap<MediaStreamTrack, HTMLCanvasElement>} */
  const trackCanvas = new WeakMap();

  /** @param {unknown} value @returns {number | undefined} */
  const numberFrom = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value && typeof value === "object") {
      const range = /** @type {Record<string, unknown>} */ (value);
      for (const key of ["exact", "ideal", "max", "min"])
        if (typeof range[key] === "number" && Number.isFinite(range[key])) return range[key];
    }
    return undefined;
  };

  /** The card's size: the requested size within 320..1920 wide, 16:9 by default. */
  const cardSize = (/** @type {MediaStreamConstraints["video"]} */ video) => {
    const wanted = video && typeof video === "object" ? video : {};
    const clamp = (/** @type {number} */ n, /** @type {number} */ lo, /** @type {number} */ hi) =>
      Math.round(Math.min(hi, Math.max(lo, n)));
    const width = clamp(numberFrom(wanted.width) ?? 1280, 320, 1920);
    const height = clamp(numberFrom(wanted.height) ?? (width * 9) / 16, 180, 1080);
    return { width, height };
  };

  /** Draws one frame of the test card. Colours stay below near-white (no glare hint). */
  const paintCard = (
    /** @type {CanvasRenderingContext2D} */ ctx,
    /** @type {number} */ width,
    /** @type {number} */ height,
    /** @type {number} */ frame
  ) => {
    const bars = ["#b4b4b4", "#b4b410", "#10b4b4", "#10b410", "#b410b4", "#b41010", "#1010b4"];
    const barWidth = width / bars.length;
    const shift = (frame * 6) % width;
    for (let i = 0; i < bars.length + 1; i += 1) {
      ctx.fillStyle = bars[i % bars.length];
      ctx.fillRect(
        ((i * barWidth + shift) % (width + barWidth)) - barWidth,
        0,
        barWidth + 1,
        height
      );
    }
    ctx.fillStyle = "rgba(20, 24, 32, 0.55)";
    ctx.fillRect(0, height * 0.3, width, height * 0.4);
    const radius = Math.min(width, height) * 0.08;
    const x = radius + ((frame * 9) % Math.max(1, width - 2 * radius));
    ctx.fillStyle = "#e0c040";
    ctx.beginPath();
    ctx.arc(x, height * 0.82, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e6e6e6";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${Math.round(height * 0.12)}px sans-serif`;
    ctx.fillText("TEST CAMERA", width / 2, height * 0.45);
    ctx.font = `${Math.round(height * 0.05)}px monospace`;
    ctx.fillText(`${runToken}  frame ${frame}`, width / 2, height * 0.6);
    const speckle = Math.max(2, Math.round(width / 320));
    for (let i = 0; i < 300; i += 1) {
      const grey = 40 + Math.floor(Math.random() * 180);
      ctx.fillStyle = `rgb(${grey},${grey},${grey})`;
      ctx.fillRect(Math.random() * width, Math.random() * height, speckle, speckle);
    }
  };

  /** A MediaStream from a test-card canvas, painted 15 times a second until its track stops. */
  const openTestCard = (/** @type {MediaStreamConstraints["video"]} */ video) => {
    const { width, height } = cardSize(video);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new DOMException("The test camera could not draw.", "NotReadableError");
    let frame = 0;
    paintCard(ctx, width, height, frame);
    const stream = canvas.captureStream(15);
    const [track] = stream.getVideoTracks();
    const timer = setInterval(() => {
      if (track.readyState === "ended") return clearInterval(timer);
      frame += 1;
      paintCard(ctx, width, height, frame);
    }, 66);
    const stop = track.stop.bind(track);
    track.stop = () => {
      clearInterval(timer);
      stop();
    };
    Object.defineProperty(track, "label", { value: "Test camera", configurable: true });
    return stream;
  };

  // 1. getUserMedia and enumerateDevices.
  if (typeof MediaDevices !== "undefined") {
    const proto = MediaDevices.prototype;
    const nativeGetUserMedia = proto.getUserMedia;
    const nativeEnumerate = proto.enumerateDevices;
    proto.getUserMedia = async function getUserMedia(constraints) {
      if (!constraints || constraints.audio || !constraints.video)
        return nativeGetUserMedia.call(this, constraints);
      return openTestCard(constraints.video);
    };
    proto.enumerateDevices = async function enumerateDevices() {
      let others = /** @type {MediaDeviceInfo[]} */ ([]);
      try {
        others = (await nativeEnumerate.call(this)).filter((d) => d.kind !== "videoinput");
      } catch {
        others = [];
      }
      const camera = {
        deviceId: "verifymzansi-test-camera",
        groupId: "verifymzansi-test-camera",
        kind: /** @type {MediaDeviceKind} */ ("videoinput"),
        label: "Test camera",
        toJSON() {
          return {
            deviceId: this.deviceId,
            groupId: this.groupId,
            kind: this.kind,
            label: this.label,
          };
        },
      };
      return [/** @type {MediaDeviceInfo} */ (/** @type {unknown} */ (camera)), ...others];
    };
  }

  // Every canvas capture stream, including a spec's own, is known by its canvas.
  if (typeof HTMLCanvasElement !== "undefined" && HTMLCanvasElement.prototype.captureStream) {
    const nativeCapture = HTMLCanvasElement.prototype.captureStream;
    HTMLCanvasElement.prototype.captureStream = function captureStream(...args) {
      const stream = nativeCapture.apply(this, args);
      for (const track of stream.getVideoTracks()) trackCanvas.set(track, this);
      return stream;
    };
  }

  /** The canvas behind a stream's live video track, if it is a canvas capture. */
  const canvasOf = (/** @type {unknown} */ value) => {
    if (typeof MediaStream === "undefined" || !(value instanceof MediaStream)) return null;
    for (const track of value.getVideoTracks()) {
      const canvas =
        trackCanvas.get(track) ??
        /** @type {{ canvas?: unknown }} */ (/** @type {unknown} */ (track)).canvas;
      if (canvas instanceof HTMLCanvasElement) return { canvas, track };
    }
    return null;
  };

  // 2. Canvas-backed streams in <video>.
  /** @typedef {{ stream: MediaStream, canvas: HTMLCanvasElement, track: MediaStreamTrack, paused: boolean, startedAt: number, playedFor: number, poster: number, hadPoster: string | null }} Emulated */
  /** @type {WeakMap<HTMLMediaElement, Emulated>} */
  const emulated = new WeakMap();
  const srcObject = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "srcObject");
  if (!srcObject?.get || !srcObject.set) return;
  const nativeGetSrcObject = srcObject.get;
  const nativeSetSrcObject = srcObject.set;
  const nativePlay = HTMLMediaElement.prototype.play;
  const nativePause = HTMLMediaElement.prototype.pause;
  const posterCanvas = document.createElement("canvas");

  const fire = (/** @type {HTMLMediaElement} */ el, /** @type {string[]} */ names) =>
    setTimeout(() => {
      if (!emulated.has(el)) return;
      for (const name of names) el.dispatchEvent(new Event(name));
    }, 0);

  const refreshPoster = (/** @type {HTMLMediaElement} */ el, /** @type {Emulated} */ state) => {
    if (!(el instanceof HTMLVideoElement) || state.track.readyState === "ended") return;
    const scale = Math.min(1, 480 / Math.max(state.canvas.width, 1));
    posterCanvas.width = Math.max(1, Math.round(state.canvas.width * scale));
    posterCanvas.height = Math.max(1, Math.round(state.canvas.height * scale));
    posterCanvas
      .getContext("2d")
      ?.drawImage(state.canvas, 0, 0, posterCanvas.width, posterCanvas.height);
    el.poster = posterCanvas.toDataURL("image/jpeg", 0.6);
  };

  const release = (/** @type {HTMLMediaElement} */ el) => {
    const state = emulated.get(el);
    if (!state) return;
    clearInterval(state.poster);
    emulated.delete(el);
    if (el instanceof HTMLVideoElement) {
      if (state.hadPoster === null) el.removeAttribute("poster");
      else el.setAttribute("poster", state.hadPoster);
    }
  };

  const start = (/** @type {HTMLMediaElement} */ el, /** @type {Emulated} */ state) => {
    if (!state.paused) return;
    state.paused = false;
    state.startedAt = performance.now();
    fire(el, ["play", "playing"]);
  };

  /** @param {HTMLMediaElement} el */
  const stateOf = (el) => emulated.get(el);
  const shadow = (
    /** @type {string} */ name,
    /** @type {(el: HTMLMediaElement, state: Emulated) => unknown} */ read
  ) => {
    const proto =
      name === "videoWidth" || name === "videoHeight"
        ? HTMLVideoElement.prototype
        : HTMLMediaElement.prototype;
    const native = Object.getOwnPropertyDescriptor(proto, name);
    if (!native?.get) return;
    const nativeGet = native.get;
    Object.defineProperty(proto, name, {
      ...native,
      get() {
        const state = stateOf(this);
        return state ? read(this, state) : nativeGet.call(this);
      },
    });
  };

  shadow("readyState", () => 4);
  shadow("networkState", () => 1);
  shadow("videoWidth", (_el, s) => s.canvas.width);
  shadow("videoHeight", (_el, s) => s.canvas.height);
  shadow("paused", (_el, s) => s.paused);
  shadow("ended", (_el, s) => s.track.readyState === "ended");
  shadow(
    "currentTime",
    (_el, s) => (s.playedFor + (s.paused ? 0 : performance.now() - s.startedAt)) / 1000
  );

  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
    ...srcObject,
    get() {
      return stateOf(this)?.stream ?? nativeGetSrcObject.call(this);
    },
    set(value) {
      release(this);
      const source = canvasOf(value);
      if (!source) return nativeSetSrcObject.call(this, value);
      nativeSetSrcObject.call(this, null);
      /** @type {Emulated} */
      const state = {
        stream: /** @type {MediaStream} */ (value),
        canvas: source.canvas,
        track: source.track,
        paused: true,
        startedAt: 0,
        playedFor: 0,
        poster: 0,
        hadPoster: this.getAttribute("poster"),
      };
      emulated.set(this, state);
      refreshPoster(this, state);
      state.poster = window.setInterval(() => refreshPoster(this, state), 500);
      fire(this, [
        "loadstart",
        "loadedmetadata",
        "resize",
        "loadeddata",
        "canplay",
        "canplaythrough",
      ]);
      if (this.autoplay) start(this, state);
    },
  });

  HTMLMediaElement.prototype.play = function play() {
    const state = stateOf(this);
    if (!state) return nativePlay.call(this);
    start(this, state);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function pause() {
    const state = stateOf(this);
    if (!state) return nativePause.call(this);
    if (state.paused) return;
    state.playedFor += performance.now() - state.startedAt;
    state.paused = true;
    fire(this, ["pause"]);
  };

  /** drawImage / createImageBitmap read the canvas behind an emulated video. */
  const sourceOf = (/** @type {unknown} */ image) =>
    image instanceof HTMLMediaElement ? (stateOf(image)?.canvas ?? image) : image;
  const nativeDrawImage = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = /** @type {typeof nativeDrawImage} */ (
    function drawImage(/** @type {any[]} */ ...args) {
      args[0] = sourceOf(args[0]);
      return /** @type {Function} */ (nativeDrawImage).apply(this, args);
    }
  );
  if (typeof window.createImageBitmap === "function") {
    const nativeBitmap = window.createImageBitmap;
    window.createImageBitmap = /** @type {typeof nativeBitmap} */ (
      function createImageBitmap(/** @type {any[]} */ ...args) {
        args[0] = sourceOf(args[0]);
        return /** @type {Function} */ (nativeBitmap).apply(window, args);
      }
    );
  }
})();
