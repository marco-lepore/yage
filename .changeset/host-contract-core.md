---
"@yagejs/core": patch
---

Name the application that runs the game through a `Host` service on every engine.

- `engine.host` and `HostKey` resolve a `Host`. Its `info` reports `runtime`, `os`, `appVersion`, `appBuild` and `runtimeVersion`; a page with no host adapter reports `runtime: "browser"` and `os: "unknown"`, since a page reads the system name only from the user agent.
- `Host.attach(provider)` is where a host adapter supplies that state. It validates the five fields, freezes a copy of them, and returns the function that detaches it. One engine takes one provider.
- A host adapter is a `Plugin` named `host`; the service id `host` belongs to the engine.
- `HostSupport` and `HostPermission` are the shared words for whether a host has an operation and whether the player or the operating system allows it.
- `TestHostPlugin` attaches host state to a test engine.
