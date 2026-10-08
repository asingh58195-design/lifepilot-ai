import {
  PlannerError,
  type PlannerInput,
  type PlannerOutput,
  type PlannerProvider,
  type ProviderStatus,
} from './PlannerProvider';

/**
 * Placeholder for a hosted-LLM planner.
 *
 * It is intentionally NOT implemented: this build has no network model and no credentials.
 * The class documents the integration seam. A real implementation would:
 *   1. POST `PlannerInput` to a server route (e.g. `/api/plan`) that holds the API key,
 *   2. ask the model for JSON matching `PlannerOutput` (validate it before trusting it),
 *   3. return it unchanged - every screen already renders `PlannerOutput`.
 * Credentials must live on the server, never in the browser bundle.
 */
export class FutureAIProvider implements PlannerProvider {
  readonly id = 'future-ai';
  readonly name = 'Hosted AI planner';

  async status(): Promise<ProviderStatus> {
    return {
      id: this.id,
      name: this.name,
      description: 'Connects an LLM through a server-side route so credentials never reach the browser.',
      available: false,
      reason: 'Not implemented in this build. See "Future AI provider integration" in the README.',
      requiresCredentials: true,
    };
  }

  async plan(_input: PlannerInput): Promise<PlannerOutput> {
    void _input;
    throw new PlannerError(
      'PROVIDER_UNAVAILABLE',
      'The hosted AI provider is not configured in this build. Switch back to the local planner.',
    );
  }
}
