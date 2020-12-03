import chalk from 'chalk';

import logger from '../../Logger';
import { Task } from '../../TasksRunner';
import { Parcel, TaskArgs } from '../types';

import { canPrebuildPackage, prebuildPackageAsync } from '../../prebuilds/PreBuilder';

/**
 * Updates version props in packages containing Android's native code.
 */
export const prebuildPackages = new Task<TaskArgs>(
  {
    name: 'prebuildPackages',
    required: true,
    backupable: false,
  },
  async (parcels: Parcel[]) => {
    logger.log();

    for (const { pkg } of parcels) {
      if (!canPrebuildPackage(pkg)) {
        continue;
      }
      logger.info('👷‍♀️ Prebuilding %s', chalk.green(pkg.packageName));
      await prebuildPackageAsync(pkg, { quiet: true });
    }
  }
);
