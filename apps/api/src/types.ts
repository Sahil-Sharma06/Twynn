import type { SessionView } from '@twynn/shared';
import type { RequestIdVariables } from 'hono/request-id';

export interface AppEnv {
  Variables: RequestIdVariables & { session: SessionView };
}
