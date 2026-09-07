export type DependencyStatus = 'up' | 'down';

export function getHealthStatus(
  database: DependencyStatus,
  redis: DependencyStatus,
): 'ok' | 'degraded' {
  return database === 'up' && redis === 'up' ? 'ok' : 'degraded';
}