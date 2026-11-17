import { test } from "node:test";
import assert from "node:assert/strict";
import { localDockerContext } from "./lib/foundation-native-isolation.mjs";

// The guard is pure: platform, environment, context inspection and the socket
// check are injected, so every case runs the same on Windows and Linux hosts.
const WINDOWS_HOST = "npipe:////./pipe/dockerDesktopLinuxEngine";
const LINUX_HOST = "unix:///var/run/docker.sock";
const GITHUB_HOSTED = { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted" };
const REMOTE_HOSTS = [
  "tcp://10.0.0.5:2375",
  "tcp://127.0.0.1:2375",
  "tcp://docker.example.com:2376",
  "ssh://builder@docker.example.com",
  "ssh://localhost",
  "unix:///home/runner/.docker/run/docker.sock",
  "npipe:////./pipe/docker_engine",
  "npipe:////remote-host/pipe/dockerDesktopLinuxEngine",
  "",
];

function guard({ platform, env = {}, endpoints = {}, socket = true }) {
  const inspected = [];
  const result = () =>
    localDockerContext({
      platform,
      env,
      inspect: (name) => {
        inspected.push(name);
        if (!Object.hasOwn(endpoints, name)) throw new Error("context not found");
        return endpoints[name];
      },
      isSocket: (file) => socket && file === "/var/run/docker.sock",
    });
  return { result, inspected };
}
const refused = (options) =>
  assert.throws(guard(options).result, /Non-local Docker endpoint prohibited/);

test("Windows accepts only Docker Desktop's local Linux engine pipe", () => {
  const { result, inspected } = guard({
    platform: "win32",
    endpoints: { "desktop-linux": WINDOWS_HOST },
  });
  assert.equal(result(), "desktop-linux");
  assert.deepEqual(inspected, ["desktop-linux"]);
});

test("Windows refuses a remote or redirected desktop-linux context", () => {
  for (const host of REMOTE_HOSTS)
    refused({ platform: "win32", endpoints: { "desktop-linux": host } });
  // A missing context fails closed (the inspection error propagates).
  assert.throws(guard({ platform: "win32" }).result);
});

test("GitHub-hosted Linux CI accepts only the default context on the local socket", () => {
  const { result, inspected } = guard({
    platform: "linux",
    env: GITHUB_HOSTED,
    endpoints: { default: LINUX_HOST },
  });
  assert.equal(result(), "default");
  assert.deepEqual(inspected, ["default"]);
  for (const env of [
    { ...GITHUB_HOSTED, DOCKER_HOST: LINUX_HOST },
    { ...GITHUB_HOSTED, DOCKER_CONTEXT: "default" },
  ])
    assert.equal(
      guard({ platform: "linux", env, endpoints: { default: LINUX_HOST } }).result(),
      "default"
    );
});

test("Linux CI refuses remote Docker endpoints, contexts and sockets", () => {
  const endpoints = { default: LINUX_HOST };
  for (const host of REMOTE_HOSTS) {
    refused({ platform: "linux", env: { ...GITHUB_HOSTED, DOCKER_HOST: host }, endpoints });
    refused({ platform: "linux", env: GITHUB_HOSTED, endpoints: { default: host } });
  }
  for (const context of ["remote", "desktop-linux", "rootless", ""])
    refused({
      platform: "linux",
      env: { ...GITHUB_HOSTED, DOCKER_CONTEXT: context },
      endpoints: { ...endpoints, [context]: LINUX_HOST },
    });
  refused({ platform: "linux", env: GITHUB_HOSTED, endpoints, socket: false });
});

test("Linux outside GitHub-hosted CI is refused before Docker is inspected", () => {
  const endpoints = { default: LINUX_HOST };
  for (const env of [
    {},
    { CI: "true" },
    { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted" },
    { ...GITHUB_HOSTED, CI: "1" },
    { ...GITHUB_HOSTED, GITHUB_ACTIONS: "false" },
    { ...GITHUB_HOSTED, RUNNER_ENVIRONMENT: "self-hosted" },
    { CI: "true", GITHUB_ACTIONS: "true" },
  ]) {
    const { result, inspected } = guard({ platform: "linux", env, endpoints });
    assert.throws(result, /Non-local Docker endpoint prohibited/);
    assert.deepEqual(inspected, []);
  }
});

test("other platforms are refused even with CI variables set", () => {
  for (const platform of ["darwin", "freebsd", "aix", "openbsd", "sunos", "android"]) {
    const { result, inspected } = guard({
      platform,
      env: GITHUB_HOSTED,
      endpoints: { default: LINUX_HOST, "desktop-linux": WINDOWS_HOST },
    });
    assert.throws(result, /Non-local Docker endpoint prohibited/);
    assert.deepEqual(inspected, []);
  }
});

test("the Windows guard ignores CI variables and still requires the local pipe", () => {
  refused({
    platform: "win32",
    env: { ...GITHUB_HOSTED, DOCKER_HOST: LINUX_HOST },
    endpoints: { "desktop-linux": "tcp://10.0.0.5:2375", default: LINUX_HOST },
  });
  refused({
    platform: "win32",
    env: GITHUB_HOSTED,
    endpoints: { "desktop-linux": "tcp://10.0.0.5:2375", default: LINUX_HOST },
  });
  assert.equal(
    guard({
      platform: "win32",
      env: GITHUB_HOSTED,
      endpoints: { "desktop-linux": WINDOWS_HOST },
    }).result(),
    "desktop-linux"
  );
});

test("Windows refuses DOCKER_HOST or DOCKER_CONTEXT pointing away from the local pipe", () => {
  const endpoints = { "desktop-linux": WINDOWS_HOST };
  for (const host of [...REMOTE_HOSTS, LINUX_HOST]) {
    const { result, inspected } = guard({
      platform: "win32",
      env: { DOCKER_HOST: host },
      endpoints,
    });
    assert.throws(result, /Non-local Docker endpoint prohibited/);
    assert.deepEqual(inspected, []);
  }
  for (const context of ["default", "remote", "rootless", ""]) {
    const { result, inspected } = guard({
      platform: "win32",
      env: { DOCKER_CONTEXT: context },
      endpoints: { ...endpoints, [context]: WINDOWS_HOST },
    });
    assert.throws(result, /Non-local Docker endpoint prohibited/);
    assert.deepEqual(inspected, []);
  }
  assert.equal(
    guard({
      platform: "win32",
      env: { DOCKER_HOST: WINDOWS_HOST, DOCKER_CONTEXT: "desktop-linux" },
      endpoints,
    }).result(),
    "desktop-linux"
  );
});
