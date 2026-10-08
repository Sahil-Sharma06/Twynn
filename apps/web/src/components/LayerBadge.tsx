import { VOCABULARY, type CacheLayer, type CacheStatus } from '@twynn/shared';
import { Badge } from './Badge';

/** Labels a request by the layer that answered it, using the shared vocabulary. */
export function LayerBadge({
  layer,
  status,
}: {
  layer: CacheLayer | null;
  status: CacheStatus | null;
}) {
  if (status === 'HIT' && layer === 'exact') {
    return (
      <Badge tone="exact" title={VOCABULARY.exactHit.technical}>
        {VOCABULARY.exactHit.label}
      </Badge>
    );
  }
  if (status === 'HIT' && layer === 'twin') {
    return (
      <Badge tone="twin" title={VOCABULARY.twinHit.technical}>
        {VOCABULARY.twinHit.label}
      </Badge>
    );
  }
  if (status === 'BYPASS') return <Badge tone="bypass">Bypass</Badge>;
  if (status === 'MISS') return <Badge tone="miss">Miss</Badge>;
  return <Badge tone="danger">Not served</Badge>;
}
