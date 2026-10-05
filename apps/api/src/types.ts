import type { SessionView } from '@twynn/shared';
import type { RequestIdVariables } from 'hono/request-id';
import type { MeterDraft } from './metering/recorder';

export interface AppEnv {
  Variables: RequestIdVariables & { session: SessionView; meter: MeterDraft };
}
