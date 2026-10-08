import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Chip';
import { CodeBlock } from '../../components/CodeBlock';
import { Field } from '../../components/Field';
import { LayerBadge } from '../../components/LayerBadge';
import { Logo, Mark } from '../../components/Logo';
import { ScoreMeter } from '../../components/ScoreMeter';
import { Skeleton, Spinner } from '../../components/Spinner';
import { ThemeToggle } from '../../components/ThemeToggle';
import { useToast } from '../../components/Toast';
import { ConfirmButton, Segmented, Select } from '../../components/Ui';
import styles from './DevComponents.module.css';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      <div className={styles.row}>{children}</div>
    </section>
  );
}

/** Development-only catalogue of base components. Not registered in production builds. */
export function DevComponents() {
  const toast = useToast();
  const [chip, setChip] = useState('all');
  const [seg, setSeg] = useState<'a' | 'b'>('a');
  const [score, setScore] = useState(0.97);
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Components</h1>
        <ThemeToggle />
      </header>

      <Section title="Logo">
        <Logo />
        <Logo size={20} />
        <Mark size={48} animated />
      </Section>

      <Section title="Buttons">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button loading>Saving</Button>
        <Button disabled>Disabled</Button>
        <Button size="sm">Small</Button>
        <Button size="lg">Large</Button>
      </Section>

      <Section title="Badges">
        <LayerBadge layer="exact" status="HIT" />
        <LayerBadge layer="twin" status="HIT" />
        <LayerBadge layer="upstream" status="MISS" />
        <LayerBadge layer="upstream" status="BYPASS" />
        <LayerBadge layer={null} status={null} />
        <Badge tone="neutral">Neutral</Badge>
      </Section>

      <Section title="Chips and segmented control">
        {['all', 'exact', 'twin', 'miss'].map((value) => (
          <Chip key={value} pressed={chip === value} onClick={() => setChip(value)}>
            {value}
          </Chip>
        ))}
        <Segmented
          label="Example"
          value={seg}
          onChange={setSeg}
          options={[
            { value: 'a', label: 'Requests by layer' },
            { value: 'b', label: 'Latency' },
          ]}
        />
      </Section>

      <Section title="Inputs">
        <Field label="Base URL" defaultValue="https://api.openai.com/v1" hint="Ends in /v1." />
        <Field label="Key name" defaultValue="" error="This field is required." />
        <Select label="Model">
          <option>gpt-4o-mini</option>
        </Select>
      </Section>

      <Section title="Cards and callouts">
        <Card>A card: hairline border, soft shadow.</Card>
        <Card raised>A raised card.</Card>
        <Callout title="Info">Neutral information.</Callout>
        <Callout tone="warning" title="Warning">
          Something needs attention.
        </Callout>
        <Callout tone="error" title="Error">
          Something failed.
        </Callout>
      </Section>

      <Section title="Match score meter">
        <div className={styles.meter}>
          <ScoreMeter score={score} threshold={0.95} />
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.01}
            value={score}
            aria-label="Example score"
            onChange={(e) => setScore(Number(e.target.value))}
          />
        </div>
      </Section>

      <Section title="Feedback">
        <Button variant="secondary" onClick={() => toast('Key revoked', 'success')}>
          Show toast
        </Button>
        <Button variant="secondary" onClick={() => toast('Could not save', 'danger')}>
          Show error toast
        </Button>
        <ConfirmButton
          label="Delete"
          confirmLabel="Delete"
          prompt="Delete this entry?"
          icon={<Trash2 size={15} aria-hidden="true" />}
          onConfirm={() => toast('Deleted')}
        />
        <Spinner label="Loading" />
        <Skeleton width="12rem" height="2rem" />
      </Section>

      <Section title="Code">
        <CodeBlock code={'curl https://your-twynn-host/v1/chat/completions'} label="Copy" />
      </Section>
    </div>
  );
}
