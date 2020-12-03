import os from 'os';
import path from 'path';
import fs from 'fs-extra';

import { spawnAsync } from '../Utils';
import { generateXcodeProjectAsync, ProjectSpec } from './XcodeGen';
import { XcodebuildOptions, Flavor, Framework } from './XcodeProject.types';

/**
 * Path to the shared derived data directory.
 */
const SHARED_DERIVED_DATA_DIR = path.join(os.tmpdir(), 'Expo/DerivedData');

/**
 * Path to the products in derived data directory. We pick `.framework` files from there.
 */
const PRODUCTS_DIR = path.join(SHARED_DERIVED_DATA_DIR, 'Build/Products');

/**
 * A class representing single Xcode project and operating on its `.xcodeproj` file.
 */
export default class XcodeProject {
  /**
   * Creates `XcodeProject` instance from given path to `.xcodeproj` file.
   */
  static async fromXcodeprojPathAsync(xcodeprojPath: string): Promise<XcodeProject> {
    if (!(await fs.pathExists(xcodeprojPath))) {
      throw new Error(`Xcodeproj not found at path: ${xcodeprojPath}`);
    }
    return new XcodeProject(xcodeprojPath);
  }

  /**
   * Generates `.xcodeproj` file based on given spec and returns it.
   */
  static async generateProjectFromSpec(dir: string, spec: ProjectSpec): Promise<XcodeProject> {
    const xcodeprojPath = await generateXcodeProjectAsync(dir, spec);
    return new XcodeProject(xcodeprojPath);
  }

  /**
   * Name of the project. It should stay in sync with its filename.
   */
  name: string;

  /**
   * Root directory of the project and at which the `.xcodeproj` file is placed.
   */
  rootDir: string;

  constructor(xcodeprojPath: string) {
    this.name = path.basename(xcodeprojPath, '.xcodeproj');
    this.rootDir = path.dirname(xcodeprojPath);
  }

  /**
   * Returns output path to where the `.xcframework` file will be stored after running `buildXcframeworkAsync`.
   */
  getXcframeworkPath(): string {
    return path.join(this.rootDir, `${this.name}.xcframework`);
  }

  /**
   * Builds `.framework` for given target name and flavor specifying,
   * configuration, the SDK and a list of architectures to compile against.
   */
  async buildFrameworkAsync(
    target: string,
    flavor: Flavor,
    options?: XcodebuildOptions
  ): Promise<Framework> {
    await this.xcodebuildAsync(
      [
        'build',
        '-project',
        `${this.name}.xcodeproj`,
        '-scheme',
        `${target}_iOS`,
        '-configuration',
        flavor.configuration,
        '-sdk',
        flavor.sdk,
        ...spreadArgs('-arch', flavor.archs),
        '-derivedDataPath',
        SHARED_DERIVED_DATA_DIR,
      ],
      options
    );

    const frameworkPath = flavorToFrameworkPath(target, flavor);
    const stat = await fs.lstat(path.join(frameworkPath, target));

    // Remove `Headers` as each our module contains headers as part of the provided source code
    // and CocoaPods exposes them through HEADER_SEARCH_PATHS either way.
    await fs.remove(path.join(frameworkPath, 'Headers'));

    // `_CodeSignature` is apparently generated only for simulator, afaik we don't need it.
    await fs.remove(path.join(frameworkPath, '_CodeSignature'));

    return {
      target,
      flavor,
      frameworkPath,
      binarySize: stat.size,
    };
  }

  /**
   * Builds universal `.xcframework` from given frameworks.
   */
  async buildXcframeworkAsync(
    frameworks: Framework[],
    options?: XcodebuildOptions
  ): Promise<string> {
    const frameworkPaths = frameworks.map((framework) => framework.frameworkPath);
    const outputPath = this.getXcframeworkPath();

    await fs.remove(outputPath);

    await this.xcodebuildAsync(
      ['-create-xcframework', ...spreadArgs('-framework', frameworkPaths), '-output', outputPath],
      {
        // `-create-xcframework` doesn't support any other options.
        stdOutput: options?.quiet ? 'ignore' : 'inherit',
      }
    );
    return outputPath;
  }

  /**
   * Removes `.xcframework` artifact.
   */
  async cleanXcframeworkAsync(): Promise<void> {
    await fs.remove(this.getXcframeworkPath());
  }

  /**
   * Generic function spawning `xcodebuild` process.
   */
  async xcodebuildAsync(args: string[], options?: XcodebuildOptions) {
    const finalArgs = [...args];

    if (options?.quiet) {
      finalArgs.unshift('-quiet');
    }
    if (options?.settings) {
      finalArgs.unshift(
        ...Object.entries(options.settings).map(([key, value]) => {
          return `${key}=${parseXcodeSettingsValue(value)}`;
        })
      );
    }

    try {
      await spawnAsync('xcodebuild', finalArgs, {
        cwd: this.rootDir,

        // If `stdOutput` is not specified then pipe stdout to stderr,
        // because stdout usually contains more details about the error.
        // Using `pipe` instead would result in no colors in the output.
        stdio: ['ignore', options?.stdOutput ?? 2, 2],
      });
    } catch (e) {
      // xcodebuild writes some more details about the error to stdout, so let's print it too.
      process.stdout.write(e.stdout);
      throw e;
    }
  }

  static async cleanBuildFolderAsync(): Promise<void> {
    await fs.remove(SHARED_DERIVED_DATA_DIR);
  }
}

/**
 * Returns a path to the prebuilt framework for given flavor.
 */
function flavorToFrameworkPath(target: string, flavor: Flavor): string {
  return path.join(PRODUCTS_DIR, `${flavor.configuration}-${flavor.sdk}`, `${target}.framework`);
}

/**
 * Spreads given args under specific flag.
 * Example: `spreadArgs('-arch', ['arm64', 'x86_64'])` returns `['-arch', 'arm64', '-arch', 'x86_64']`
 */
function spreadArgs(argName: string, args: string[]): string[] {
  return ([] as string[]).concat(...args.map((arg) => [argName, arg]));
}

/**
 * Converts boolean values to its Xcode build settings format. Value of other type just passes through.
 */
function parseXcodeSettingsValue(value: string | boolean): string {
  if (typeof value === 'boolean') {
    return value ? 'YES' : 'NO';
  }
  return value;
}
