import path from 'path';
import fs from 'fs-extra';
import semver from 'semver';

import { mapAsync, spawnAsync } from '../Utils';
import { EXPOTOOLS_DIR, IOS_DIR } from '../Constants';
import { Podspec } from '../Packages';

const PODS_DIR = path.join(IOS_DIR, 'Pods');
const PODS_PUBLIC_HEADERS_DIR = path.join(PODS_DIR, 'Headers', 'Public');
const PLATFORMS_MAPPING: Record<string, Platform> = {
  ios: 'iOS',
  osx: 'macOS',
  macos: 'macOS',
  tvos: 'tvOS',
  watchos: 'watchOS',
};

export const INFO_PLIST_FILENAME = 'Info-generated.plist';

// More detailed spec schema available here:
// https://github.com/yonaskolb/XcodeGen/blob/master/Docs/ProjectSpec.md
export type ProjectSpec = {
  name: string;
  projectReferences?: {
    [key: string]: {
      path: string;
    };
  };
  targets?: {
    [targetName: string]: {
      type: string;
      platform: Platform[];
      sources?: ProjectSpecSource[];
      dependencies?: ProjectSpecDependency[];
      settings?: ProjectSpecSettings;
      info?: {
        path: string;
        properties: Record<string, string>;
      };
    };
  };
  options?: ProjectSpecOptions;
  settings?: ProjectSpecSettings;
};

type Platform = 'iOS' | 'macOS' | 'tvOS' | 'watchOS';

export type ProjectSpecSource = {
  path: string;
  name?: string;
  createIntermediateGroups?: boolean;
  includes?: string[];
  excludes?: string[];
  compilerFlags?: string;
};

export type ProjectSpecDependency = {
  // framework type
  framework?: string;
  implicit?: boolean;

  // target/project type
  target?: string;

  // SDK framework
  sdk?: string;

  // shared options
  embed?: boolean;
  link?: boolean;
  codeSign?: boolean;
  removeHeaders?: boolean;
  weak?: boolean;
};

export type ProjectSpecOptions = {
  minimumXcodeGenVersion: string;
  deploymentTarget: Record<Platform, string>;
};

export type ProjectSpecSettings = {
  base: XcodeConfig;
};

type XcodeConfig = Record<string, string>;

/**
 * Generates `.xcodeproj` from given project spec and saves it at given dir.
 */
export async function generateXcodeProjectAsync(dir: string, spec: ProjectSpec): Promise<string> {
  const specPath = path.join(dir, `${spec.name}.spec.json`);

  // Save the spec to the file so `xcodegen` can use it.
  await fs.outputJSON(specPath, spec, {
    spaces: 2,
  });

  // Generate `.xcodeproj` from given spec. The binary is provided by `@expo/xcodegen` package.
  await spawnAsync('yarn', ['--silent', 'run', 'xcodegen', '--quiet', '--spec', specPath], {
    cwd: EXPOTOOLS_DIR,
    stdio: 'inherit',
  });

  // Remove temporary spec file.
  await fs.remove(specPath);

  return path.join(dir, `${spec.name}.xcodeproj`);
}

/**
 * Creates `xcodegen` spec from the podspec. It's very naive, but covers all our cases so far.
 */
export async function createSpecFromPodspecAsync(
  podspec: Podspec,
  dependencyResolver: (dependencyName: string) => Promise<ProjectSpecDependency | null>
): Promise<ProjectSpec> {
  const platforms = Object.keys(podspec.platforms);
  const deploymentTarget = platforms.reduce((acc, platform) => {
    acc[PLATFORMS_MAPPING[platform]] = podspec.platforms[platform];
    return acc;
  }, {} as Record<Platform, string>);

  const dependenciesNames = podspec.dependencies ? Object.keys(podspec.dependencies) : [];

  const dependencies = (
    await mapAsync(dependenciesNames, (dependencyName) => dependencyResolver(dependencyName))
  ).filter(Boolean) as ProjectSpecDependency[];

  const bundleId = podNameToBundleId(podspec.name);

  return {
    name: podspec.name,
    targets: {
      [podspec.name]: {
        type: 'framework',
        platform: platforms.map((platform) => PLATFORMS_MAPPING[platform]),
        sources: [
          {
            path: '',
            name: podspec.name,
            createIntermediateGroups: true,
            includes: arrayize(podspec.source_files),
            excludes: [
              INFO_PLIST_FILENAME,
              `${podspec.name}.spec.json`,
              '*.xcodeproj',
              '*.xcframework',
              '*.podspec',
              ...arrayize(podspec.exclude_files),
            ],
            compilerFlags: podspec.compiler_flags,
          },
        ],
        dependencies: [
          ...arrayize(podspec.frameworks).map((framework) => ({
            sdk: `${framework}.framework`,
          })),
          ...dependencies,
        ],
        settings: {
          base: mergeXcodeConfigs(podspec.pod_target_xcconfig ?? {}, {
            MACH_O_TYPE: 'staticlib',
          }),
        },
        info: {
          path: INFO_PLIST_FILENAME,
          properties: mergeXcodeConfigs(
            {
              CFBundleIdentifier: bundleId,
              CFBundleName: podspec.name,
              CFBundleShortVersionString: podspec.version,
              CFBundleVersion: semver.major(podspec.version),
            },
            podspec.info_plist ?? {}
          ),
        },
      },
    },
    options: {
      minimumXcodeGenVersion: '2.18.0',
      deploymentTarget,
    },
    settings: {
      base: {
        PRODUCT_BUNDLE_IDENTIFIER: bundleId,
        IPHONEOS_DEPLOYMENT_TARGET: podspec.platforms.ios,
        FRAMEWORK_SEARCH_PATHS: constructFrameworkSearchPaths(dependencies),
        HEADER_SEARCH_PATHS: constructHeaderSearchPaths(dependenciesNames),

        // Suppresses deprecation warnings coming from frameworks like OpenGLES.
        VALIDATE_WORKSPACE_SKIPPED_SDK_FRAMEWORKS: arrayize(podspec.frameworks).join(' '),
      },
    },
  };
}

function constructFrameworkSearchPaths(dependencies: ProjectSpecDependency[]): string {
  const frameworks = dependencies.filter((dependency) => !!dependency.framework) as {
    framework: string;
  }[];

  return (
    '$(inherited) ' + frameworks.map((dependency) => path.dirname(dependency.framework)).join(' ')
  ).trim();
}

function constructHeaderSearchPaths(dependencies: string[]): string {
  // A set of pod names to include in header search paths.
  // For simplicity, we add some more (usually transitive) than direct dependencies.
  const podsToSearchForHeaders = new Set([
    // Some pods' have headers at its root level (ZXingObjC and all our modules).
    // Without this we would have to use `#import <ZXingObjC*.h>` instead of `#import <ZXingObjC/ZXingObjC*.h>`
    '',

    ...dependencies,

    'DoubleConversion',
    'React-callinvoker',
    'React-Core',
    'React-cxxreact',
    'React-jsi',
    'React-jsiexecutor',
    'React-jsinspector',
    'Yoga',
    'glog',
  ]);

  // Should we add private headers too?
  return (
    '$(inherited) ' +
    [...podsToSearchForHeaders]
      .map((podName) => '"' + path.join(PODS_PUBLIC_HEADERS_DIR, podName) + '"')
      .join(' ')
  ).trim();
}

/**
 * Merges Xcode config from left to right.
 * Values containing `$(inherited)` are properly taken into account.
 */
function mergeXcodeConfigs(...configs: XcodeConfig[]): XcodeConfig {
  const result: XcodeConfig = {};

  for (const config of configs) {
    for (const key in config) {
      const value = config[key];
      result[key] = mergeXcodeConfigValue(result[key], value);
    }
  }
  return result;
}

function mergeXcodeConfigValue(prevValue: string | undefined, nextValue: string): string {
  if (prevValue && typeof prevValue === 'string' && prevValue.includes('$(inherited)')) {
    return '$(inherited) ' + (prevValue + ' ' + nextValue).replace(/\\s*$\(inherited\)\s*/g, ' ');
  }
  return nextValue;
}

/**
 * Simple conversion from pod name to framework's bundle identifier.
 */
function podNameToBundleId(podName: string): string {
  return podName
    .replace(/^UM/, 'unimodules')
    .replace(/^EX/, 'expo')
    .replace(/(\_|[^\w\d\.])+/g, '.')
    .replace(/\.*([A-Z]+)/g, (_, p1) => `.${p1.toLowerCase()}`);
}

/**
 * Ensures the value is an array.
 */
function arrayize<T>(value: T | T[]): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value != null ? [value] : [];
}
