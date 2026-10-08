import { FutureAIProvider } from './FutureAIProvider';
import { LocalPlannerProvider } from './LocalPlannerProvider';
import type { PlannerProvider } from './PlannerProvider';

export * from './PlannerProvider';
export { LocalPlannerProvider } from './LocalPlannerProvider';
export { FutureAIProvider } from './FutureAIProvider';

/** Registry of every provider the UI can offer. */
export function createProviders(): PlannerProvider[] {
  return [new LocalPlannerProvider(), new FutureAIProvider()];
}

export const DEFAULT_PROVIDER_ID = 'local';
