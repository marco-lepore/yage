/** What an Xcode project built by {@link xcodeProject} sets. */
export interface XcodeProjectOptions {
  /** Build settings of the App target's Release configuration. */
  readonly release: Readonly<Record<string, string>>;
  /** Build settings of the App target's Debug configuration. Default: `release`. */
  readonly debug?: Readonly<Record<string, string>>;
  /** Build settings of the project's own Release configuration. */
  readonly projectRelease?: Readonly<Record<string, string>>;
  /** Files the App target's Resources build phase copies into the app. */
  readonly resources?: readonly string[];
  /** Extra object entries, such as another target or a file no target copies. */
  readonly objects?: string;
}

/** The id of the App target's Resources build phase. */
const RESOURCES_PHASE = "504EC3021FED79650016851F";

/**
 * The file reference and build file Xcode writes for each file a target
 * copies, and the Resources build phase that lists the build files.
 */
function resources(files: readonly string[]): string {
  const ids = files.map((file, index) => ({
    file,
    reference: `A1${String(index).padStart(22, "0")}`,
    build: `B1${String(index).padStart(22, "0")}`,
  }));
  const entries = ids
    .map(
      ({ file, reference, build }) =>
        `\t\t${build} /* ${file} in Resources */ = {isa = PBXBuildFile; fileRef = ${reference} /* ${file} */; };\n` +
        `\t\t${reference} /* ${file} */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = ${file}; sourceTree = "<group>"; };\n`,
    )
    .join("");
  const listed = ids
    .map(({ file, build }) => `\t\t\t\t${build} /* ${file} in Resources */,\n`)
    .join("");
  return `${entries}\t\t${RESOURCES_PHASE} /* Resources */ = {
\t\t\tisa = PBXResourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
${listed}\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t};
`;
}

function settings(values: Readonly<Record<string, string>>): string {
  return Object.entries(values)
    .map(([name, value]) => `\t\t\t\t${name} = ${value};\n`)
    .join("");
}

function configuration(
  id: string,
  name: string,
  values: Readonly<Record<string, string>>,
): string {
  return `\t\t${id} /* ${name} */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
${settings(values)}\t\t\t};
\t\t\tname = ${name};
\t\t};
`;
}

/**
 * A `project.pbxproj` shaped like the one `npx cap add ios` writes: a project
 * with Debug and Release configurations and an App target with its own and
 * with a Resources build phase. The Debug entries come first, as Xcode writes
 * them.
 */
export function xcodeProject(options: XcodeProjectOptions): string {
  return `// !$*UTF8*$!
{
\tarchiveVersion = 1;
\tclasses = {
\t};
\tobjectVersion = 60;
\tobjects = {

${options.objects ?? ""}${resources(options.resources ?? [])}\t\t504EC3031FED79650016851F /* App */ = {
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = 504EC3161FED79650016851F /* Build configuration list for PBXNativeTarget "App" */;
\t\t\tbuildPhases = (
\t\t\t\t${RESOURCES_PHASE} /* Resources */,
\t\t\t);
\t\t\tname = App;
\t\t\tproductName = App;
\t\t\tproductType = "com.apple.product-type.application";
\t\t};
\t\t504EC2FC1FED79650016851F /* Project object */ = {
\t\t\tisa = PBXProject;
\t\t\tbuildConfigurationList = 504EC2FF1FED79650016851F /* Build configuration list for PBXProject "App" */;
\t\t\ttargets = (
\t\t\t\t504EC3031FED79650016851F /* App */,
\t\t\t);
\t\t};
${configuration("504EC3141FED79650016851F", "Debug", { IPHONEOS_DEPLOYMENT_TARGET: "15.0" })}${configuration("504EC3151FED79650016851F", "Release", { IPHONEOS_DEPLOYMENT_TARGET: "15.0", ...options.projectRelease })}${configuration("504EC3171FED79650016851F", "Debug", options.debug ?? options.release)}${configuration("504EC3181FED79650016851F", "Release", options.release)}\t\t504EC2FF1FED79650016851F /* Build configuration list for PBXProject "App" */ = {
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\t504EC3141FED79650016851F /* Debug */,
\t\t\t\t504EC3151FED79650016851F /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t};
\t\t504EC3161FED79650016851F /* Build configuration list for PBXNativeTarget "App" */ = {
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\t504EC3171FED79650016851F /* Debug */,
\t\t\t\t504EC3181FED79650016851F /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t};
\t};
\trootObject = 504EC2FC1FED79650016851F /* Project object */;
}
`;
}
