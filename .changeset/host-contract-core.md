---
"@yagejs/core": minor
---

Name the application that runs the game through a `Host` service on every engine.

- `engine.host` and `HostKey` resolve a `Host`. Its `info` reports `runtime`, `os`, `appVersion`, `appBuild` and `runtimeVersion`; a page with no host adapter reports `runtime: "browser"` and `os: "unknown"`, since a page reads the system name only from the user agent.
- `Host.attach(provider)` is where a host adapter supplies that state. `HostProvider.info` is a `HostInfoInput`: `runtime` and `os` are required, and an adapter leaves out a version it has no authoritative value for. `attach` validates every field it is given, freezes a copy with all five fields present, and returns the function that detaches it. One engine takes one provider.
- A host adapter is a `Plugin` named `host`; the service id `host` belongs to the engine.
- `HostSupport` is the shared word for whether a host has an operation at all.
- `TestHostPlugin` attaches host state to a test engine.
- `Breaking:` the context `createMockScene` and `createMockEntity` return carries a `Logger`, an `AssetManager` and a `Host` beside the query cache, event bus and error boundary, so a component that resolves one of them works in a unit test with no extra setup. A test that registers `LoggerKey`, `AssetManagerKey` or `HostKey` on that context throws `Service "logger" is already registered.` (or the `"assetManager"` or `"host"` id). Remove the `register` call and resolve the service from the context, for example `vi.spyOn(context.resolve(LoggerKey), "warn")`.
