import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gradleSetting, xcodeCopiesResource } from "./native.js";
import { makeTree, removeTrees } from "./test/tree.js";
import { xcodeProject } from "./test/xcode.js";

afterEach(() => {
  removeTrees();
});

/** Write a Gradle file and return its path. */
function gradle(body: string): string {
  return path.join(makeTree({ "build.gradle": body }), "build.gradle");
}

/** Write a project.pbxproj and return its path. */
function pbxproj(body: string): string {
  return path.join(makeTree({ "project.pbxproj": body }), "project.pbxproj");
}

describe("gradleSetting", () => {
  it("reads a double-quoted value", () => {
    const file = gradle(
      'defaultConfig {\n    applicationId "com.example.mygame"\n}\n',
    );
    expect(gradleSetting(file, "applicationId")).toBe("com.example.mygame");
  });

  it("reads a single-quoted value", () => {
    const file = gradle(
      "defaultConfig {\n    applicationId 'com.example.mygame'\n    versionName '1.2.3'\n}\n",
    );
    expect(gradleSetting(file, "applicationId")).toBe("com.example.mygame");
    expect(gradleSetting(file, "versionName")).toBe("1.2.3");
  });

  it("reads a bare value without the comment after it", () => {
    const file = gradle(
      "defaultConfig {\n    versionCode 12 // raise for every store upload\n}\n",
    );
    expect(gradleSetting(file, "versionCode")).toBe("12");
  });

  it("skips a commented-out line before the setting", () => {
    const file = gradle(`defaultConfig {
    // applicationId "com.example.old"
    /* applicationId "com.example.older"
       versionCode 1 */
    applicationId "com.example.mygame"
    versionCode 2
}
`);
    expect(gradleSetting(file, "applicationId")).toBe("com.example.mygame");
    expect(gradleSetting(file, "versionCode")).toBe("2");
  });

  it("keeps comment markers inside a string", () => {
    const file = gradle(`defaultConfig {
    ignoreAssetsPattern '!.svn:!*.scc:/*'
    testInstrumentationRunner "https://example.com//runner"
    versionCode 3
}
`);
    expect(gradleSetting(file, "versionCode")).toBe("3");
  });

  it("reads the form with an equals sign", () => {
    const file = gradle(`defaultConfig {
    applicationId = 'com.example.mygame'
    versionName = "1.2.3"
    versionCode = 4 /* raise for every store upload */
}
`);
    expect(gradleSetting(file, "applicationId")).toBe("com.example.mygame");
    expect(gradleSetting(file, "versionName")).toBe("1.2.3");
    expect(gradleSetting(file, "versionCode")).toBe("4");
  });

  it("returns undefined for a setting the file does not set", () => {
    const file = gradle(
      'defaultConfig {\n    applicationIdSuffix ".debug"\n    // versionCode 1\n}\n',
    );
    expect(gradleSetting(file, "applicationId")).toBeUndefined();
    expect(gradleSetting(file, "versionCode")).toBeUndefined();
  });
});

describe("xcodeCopiesResource", () => {
  const MANIFEST = "PrivacyInfo.xcprivacy";
  const REFERENCE = `\t\t3C4D /* ${MANIFEST} */ = {isa = PBXFileReference; path = ${MANIFEST}; sourceTree = "<group>"; };\n`;
  const BUILD_FILE = `\t\t1A2B /* ${MANIFEST} in Resources */ = {isa = PBXBuildFile; fileRef = 3C4D /* ${MANIFEST} */; };\n`;

  it("finds a file in the App target's Resources build phase", () => {
    const file = pbxproj(xcodeProject({ release: {}, resources: [MANIFEST] }));
    expect(xcodeCopiesResource(file, MANIFEST)).toBe(true);
    expect(xcodeCopiesResource(file, "Other.plist")).toBe(false);
  });

  it("does not count a file that only another target copies", () => {
    const widget = `\t\t5E6F /* Widget */ = {
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildPhases = (
\t\t\t\t7A8B /* Resources */,
\t\t\t);
\t\t\tname = Widget;
\t\t};
\t\t7A8B /* Resources */ = {
\t\t\tisa = PBXResourcesBuildPhase;
\t\t\tfiles = (
\t\t\t\t1A2B /* ${MANIFEST} in Resources */,
\t\t\t);
\t\t};
`;
    const file = pbxproj(
      xcodeProject({
        release: {},
        objects: `${BUILD_FILE}${REFERENCE}${widget}`,
      }),
    );
    expect(xcodeCopiesResource(file, MANIFEST)).toBe(false);
  });

  it("does not count a build file that no build phase lists", () => {
    const file = pbxproj(
      xcodeProject({ release: {}, objects: `${BUILD_FILE}${REFERENCE}` }),
    );
    expect(xcodeCopiesResource(file, MANIFEST)).toBe(false);
  });

  it("finds nothing in a project file that is missing or cannot be parsed", () => {
    const root = makeTree({ "project.pbxproj": "{ objects = {" });
    expect(
      xcodeCopiesResource(path.join(root, "project.pbxproj"), MANIFEST),
    ).toBe(false);
    expect(xcodeCopiesResource(path.join(root, "missing"), MANIFEST)).toBe(
      false,
    );
  });
});
