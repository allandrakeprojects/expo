import logger from '../../Logger';
import { Task } from '../../TasksRunner';
import { Parcel, TaskArgs } from '../types';

import { canPrebuildPackage, cleanFrameworksAsync } from '../../prebuilds/PreBuilder';

/**
 * Cleans up after building prebuilds and publishing them.
 */
export const cleanPrebuilds = new Task<TaskArgs>(
  {
    name: 'cleanPrebuilds',
  },
  async (parcels: Parcel[]) => {
    logger.log();

    const packagesToClean = parcels.map(({ pkg }) => pkg).filter(canPrebuildPackage);

    if (packagesToClean.length) {
      logger.info('🧹 Cleaning prebuilt resources %s');
      await cleanFrameworksAsync(packagesToClean);
    }
  }
);
