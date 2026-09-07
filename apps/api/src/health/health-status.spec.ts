import { getHealthStatus } from './health-status';

describe('getHealthStatus', () => {
  it('reports ok only when all dependencies are up', () => {
    expect(getHealthStatus('up', 'up')).toBe('ok');
  });

  it('reports degraded when a dependency is unavailable', () => {
    expect(getHealthStatus('up', 'down')).toBe('degraded');
    expect(getHealthStatus('down', 'up')).toBe('degraded');
  });
});