import chalk from 'chalk';
import { performance } from 'perf_hooks';
import { Command } from '@expo/commander';

import logger from '../Logger';
import { Package, getPackageByName } from '../Packages';
import XcodeProject from '../prebuilds/XcodeProject';
import {
  buildFrameworksForProjectAsync,
  cleanTemporaryFilesAsync,
  cleanFrameworksAsync,
  generateXcodeProjectSpecAsync,
  PACKAGES_TO_PREBUILD,
} from '../prebuilds/PreBuilder';

type ActionOptions = {
  removeArtifacts: boolean;
  cleanCache: boolean;
  generateSpecs: boolean;
  verbose: boolean;
};

async function main(packageNames: string[], options: ActionOptions) {
  const filteredPackageNames =
    packageNames.length > 0
      ? packageNames.filter((name) => PACKAGES_TO_PREBUILD.includes(name))
      : PACKAGES_TO_PREBUILD;

  if (options.cleanCache) {
    logger.info('🧹 Cleaning shared derived data directory');
    await XcodeProject.cleanBuildFolderAsync();
    return;
  }

  const packages = filteredPackageNames.map(getPackageByName).filter(Boolean) as Package[];

  if (options.removeArtifacts) {
    logger.info('🧹 Removing existing artifacts');
    await cleanFrameworksAsync(packages);
    return;
  }

  for (const pkg of packages) {
    logger.info(`📦 Prebuilding ${chalk.green(pkg.packageName)}`);

    const startTime = performance.now();
    const xcodeProject = await generateXcodeProjectSpecAsync(pkg);

    if (!options.generateSpecs) {
      await buildFrameworksForProjectAsync(xcodeProject, {
        quiet: !options.verbose,
      });
      await cleanTemporaryFilesAsync(xcodeProject);
    }

    const endTime = performance.now();
    const timeDiff = (endTime - startTime) / 1000;
    logger.success('   Finished in: %s\n', chalk.magenta(timeDiff.toFixed(2) + 's'));
  }
}

export default (program: Command) => {
  program
    .command('prebuild-packages [packageNames...]')
    .alias('prebuild')
    .option('-r, --remove-artifacts', 'Removes `.xcframework` artifacts for given packages.', false)
    .option('-c, --clean-cache', 'Cleans the shared derived data folder.', false)
    .option('-g, --generate-specs', 'Only generates project specs', false)
    .option('-v, --verbose', 'Outputs `xcodebuild` logs', false)
    .asyncAction(main);
};
