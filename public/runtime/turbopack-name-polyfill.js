if (typeof globalThis.__name !== "function") {
  globalThis.__name = function __namePolyfill(fn, name) {
    Object.defineProperty(fn, "name", {
      value: name,
      configurable: true,
    });
    return fn;
  };
}
