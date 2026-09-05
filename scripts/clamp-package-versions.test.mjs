import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "yage-release-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const json = (path, value) =>
    write(path, `${JSON.stringify(value, null, 2)}\n`);
  const read = (path) => readFileSync(join(root, path), "utf8");
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  for (const dir of ["scripts", "packages/addons", "packages/tools"])
    mkdirSync(join(root, dir), { recursive: true });
  copyFileSync(
    new URL("./clamp-package-versions.mjs", import.meta.url),
    join(root, "scripts/clamp-package-versions.mjs"),
  );
  json(".changeset/config.json", {
    fixed: [["@yagejs/core", "@yagejs/effects", "create-yage"]],
  });
  const manifest = (dir, name, version, extra = {}) =>
    json(`${dir}/package.json`, { name, version, ...extra });
  const engine = (version) => {
    manifest("packages/core", "@yagejs/core", version);
    manifest("packages/effects", "@yagejs/effects", version, {
      peerDependencies: {
        "@yagejs/core": `>=${version} <${version.startsWith("0.") ? "0.11.0" : "2.0.0"}`,
        "pixi.js": "^8.5.0",
      },
    });
    manifest("packages/create-yage", "create-yage", version);
  };
  engine("0.10.4");
  manifest("packages/addons/demo", "@yagejs-addons/demo", "0.3.0");
  manifest("packages/tools/demo", "@yagejs-tools/demo", "0.1.1");
  git("init", "-q");
  git("add", ".");
  git(
    "-c",
    "user.name=Release test",
    "-c",
    "user.email=release@example.test",
    "commit",
    "-qm",
    "Base versions",
  );
  const run = (base = "HEAD") =>
    execFileSync(process.execPath, ["scripts/clamp-package-versions.mjs"], {
      cwd: root,
      env: { ...process.env, CLAMP_BASE_REF: base },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  return {
    root,
    write,
    json,
    read,
    git,
    manifest,
    engine,
    run,
    pkg: (dir) => JSON.parse(read(`${dir}/package.json`)),
  };
}

test("clamps the engine group and independent packages, with consistent ranges and changelogs", (t) => {
  const f = fixture(t);
  f.engine("1.0.0");
  for (const [dir, name] of [
    ["packages/addons/demo", "@yagejs-addons/demo"],
    ["packages/tools/demo", "@yagejs-tools/demo"],
  ]) {
    f.manifest(dir, name, "1.0.0", {
      peerDependencies: { "@yagejs/core": ">=1.0.0" },
      devDependencies: { "@yagejs/core": ">=1.0.0" },
    });
  }
  f.manifest("examples", "examples", "0.0.1", {
    dependencies: {
      "@yagejs/core": "^1.0.0",
      "@yagejs-addons/demo": "~1.0.0",
      "create-yage": "1.0.0",
      unrelated: "^1.0.0",
    },
  });
  f.manifest("docs", "docs", "0.0.0", {
    devDependencies: { "@yagejs/core": "workspace:*" },
  });
  const dirs = [
    "packages/core",
    "packages/effects",
    "packages/create-yage",
    "packages/addons/demo",
    "packages/tools/demo",
    "examples",
  ];
  for (const dir of dirs)
    f.write(
      `${dir}/CHANGELOG.md`,
      "# Changelog\n\n## 1.0.0\n\n- @yagejs/core@1.0.0\n- @yagejs-addons/demo@1.0.0\n- @yagejs-tools/demo@1.0.0\n\n## 0.1.0\n\nOlder release.\n",
    );
  f.run();
  for (const dir of dirs.slice(0, 3)) {
    assert.equal(f.pkg(dir).version, "0.11.0");
    assert.match(f.read(`${dir}/CHANGELOG.md`), /## 0\.11\.0\n/);
  }
  assert.equal(f.pkg("packages/addons/demo").version, "0.4.0");
  assert.equal(f.pkg("packages/tools/demo").version, "0.2.0");
  for (const dir of [
    "packages/effects",
    "packages/addons/demo",
    "packages/tools/demo",
  ]) {
    assert.equal(
      f.pkg(dir).peerDependencies["@yagejs/core"],
      ">=0.11.0 <0.12.0",
    );
  }
  assert.equal(f.pkg("packages/effects").peerDependencies["pixi.js"], "^8.5.0");
  for (const dir of ["packages/addons/demo", "packages/tools/demo"])
    assert.equal(f.pkg(dir).devDependencies["@yagejs/core"], ">=0.11.0");
  assert.deepEqual(f.pkg("examples").dependencies, {
    "@yagejs/core": "^0.11.0",
    "@yagejs-addons/demo": "~0.4.0",
    "create-yage": "^0.11.0",
    unrelated: "^1.0.0",
  });
  assert.equal(f.pkg("docs").devDependencies["@yagejs/core"], "workspace:*");
  for (const dir of dirs) {
    const changelog = f.read(`${dir}/CHANGELOG.md`);
    assert.match(changelog, /@yagejs\/core@0\.11\.0/);
    assert.match(changelog, /@yagejs-addons\/demo@0\.4\.0/);
    assert.match(changelog, /@yagejs-tools\/demo@0\.2\.0/);
    assert.match(changelog, /## 0\.1\.0\n\nOlder release\./);
  }
  const diff = f.git("diff");
  f.run();
  assert.equal(f.git("diff"), diff, "a second run must not change the release");
});

test("keeps patch releases and no-op runs below the current peer cap", (t) => {
  const f = fixture(t);
  f.run();
  assert.equal(f.git("diff"), "");
  f.engine("0.10.5");
  f.run();
  assert.equal(f.pkg("packages/core").version, "0.10.5");
  assert.equal(
    f.pkg("packages/effects").peerDependencies["@yagejs/core"],
    ">=0.10.5 <0.11.0",
  );
});

test("uses the highest previous minor for a fixed group and includes new members", (t) => {
  const f = fixture(t);
  f.manifest("packages/effects", "@yagejs/effects", "0.2.0");
  f.git("add", ".");
  f.git(
    "-c",
    "user.name=Release test",
    "-c",
    "user.email=release@example.test",
    "commit",
    "-qm",
    "Different member version",
  );
  f.json(".changeset/config.json", {
    fixed: [["@yagejs/core", "@yagejs/effects", "create-yage", "@yagejs/new"]],
  });
  f.engine("1.0.0");
  f.manifest("packages/new", "@yagejs/new", "1.0.0");
  f.run();
  for (const dir of [
    "packages/core",
    "packages/effects",
    "packages/create-yage",
    "packages/new",
  ])
    assert.equal(f.pkg(dir).version, "0.11.0");
});

test("leaves established 1.x packages on normal major releases", (t) => {
  const f = fixture(t);
  f.engine("1.2.0");
  f.manifest("packages/addons/demo", "@yagejs-addons/demo", "1.2.0");
  f.git("add", ".");
  f.git(
    "-c",
    "user.name=Release test",
    "-c",
    "user.email=release@example.test",
    "commit",
    "-qm",
    "Stable versions",
  );
  f.engine("2.0.0");
  f.manifest("packages/addons/demo", "@yagejs-addons/demo", "2.0.0");
  f.run();
  assert.equal(f.pkg("packages/core").version, "2.0.0");
  assert.equal(f.pkg("packages/addons/demo").version, "2.0.0");
  assert.equal(
    f.pkg("packages/effects").peerDependencies["@yagejs/core"],
    ">=2.0.0 <3.0.0",
  );
});

test("rejects an invalid base ref before changing files", (t) => {
  const f = fixture(t);
  f.engine("1.0.0");
  const diff = f.git("diff");
  assert.throws(
    () => f.run("missing-release-base"),
    /Base ref.*does not resolve/,
  );
  assert.equal(f.git("diff"), diff);
});
