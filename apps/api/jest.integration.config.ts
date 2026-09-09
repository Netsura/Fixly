import type { Config } from 'jest';

/**
 * Integration suites talk to a real Postgres and Redis, so they run serially
 * (shared database) and with a longer timeout than the unit suites.
 */
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.int-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  maxWorkers: 1,
  testTimeout: 60_000,
  forceExit: true,
};

export default config;
