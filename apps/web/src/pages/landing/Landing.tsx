import { ArrowRight, Layers, Lock, Radio, ShieldCheck, SlidersHorizontal, Zap } from 'lucide-react';
import { DEFAULT_CACHE_SETTINGS, VOCABULARY } from '@twynn/shared';
import { ButtonLink } from '../../components/Button';
import { CodeBlock } from '../../components/CodeBlock';
import { Mark } from '../../components/Logo';
import { TwinIllustration } from './TwinIllustration';
import styles from './Landing.module.css';

const ONE_LINE_CHANGE = `const client = new OpenAI({
  baseURL: 'https://your-twynn-gateway/v1', // the only change
  apiKey: process.env.TWYNN_API_KEY,
});`;

const layers = [
  {
    tone: 'exact',
    title: VOCABULARY.exactHit.label,
    term: 'Layer 1',
    body: 'The same request, character for character, is answered straight from memory. No provider call, no tokens.',
  },
  {
    tone: 'twin',
    title: VOCABULARY.twinHit.label,
    term: 'Layer 2',
    body: 'A question worded differently but meaning the same thing is matched by meaning and answered from the cache.',
  },
  {
    tone: 'upstream',
    title: 'Upstream',
    term: 'Everything else',
    body: 'New questions go to your provider as usual. The answer is stored, so the next twin is free.',
  },
] as const;

const features = [
  {
    Icon: SlidersHorizontal,
    title: 'You set the bar for a twin',
    body: 'Choose how alike two questions must be before Twynn reuses an answer, and switch matching by meaning off entirely if you prefer.',
  },
  {
    Icon: Lock,
    title: 'Your provider, your keys',
    body: 'Bring any OpenAI-compatible provider. Its key is encrypted at rest and never shown again after you save it.',
  },
  {
    Icon: ShieldCheck,
    title: 'Strict isolation',
    body: 'Cached answers belong to one workspace. They are never matched, served or visible to anyone else.',
  },
  {
    Icon: Zap,
    title: 'Streaming included',
    body: 'Streamed responses are cached too, and cached answers stream back to clients that ask for a stream.',
  },
  {
    Icon: Radio,
    title: 'Live, honest numbers',
    body: 'Every request appears as it happens. Savings are estimated from the token counts your provider actually returned.',
  },
  {
    Icon: Layers,
    title: 'Fresh when it matters',
    body: 'Send one header to skip the cache for a request, or clear entries by model or age whenever answers change.',
  },
];

export function Landing() {
  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>
            <Mark size={18} animated /> OpenAI-compatible LLM gateway
          </p>
          <h1 className={styles.title}>Answer each question once.</h1>
          <p className={styles.lede}>
            Twynn sits between your app and your LLM provider. When a request has been answered
            before, word for word or in different words with the same meaning, Twynn returns the
            stored answer instead of paying for a new one.
          </p>
          <div className={styles.actions}>
            <ButtonLink to="/signup" size="lg" icon={<ArrowRight size={18} aria-hidden="true" />}>
              Create your gateway
            </ButtonLink>
            <ButtonLink to="/#how-it-works" variant="secondary" size="lg">
              How it works
            </ButtonLink>
          </div>
        </div>
        <TwinIllustration />
      </section>

      <section className={styles.section} aria-labelledby="one-line">
        <div className={styles.split}>
          <div className={styles.sectionCopy}>
            <h2 id="one-line">Change one line</h2>
            <p>
              Keep your OpenAI SDK, your prompts and your provider. Point the client&apos;s base URL
              at Twynn and use a Twynn key. Responses come back in exactly the shape your code
              already expects, with headers that say which layer answered.
            </p>
          </div>
          <CodeBlock code={ONE_LINE_CHANGE} label="Copy client example" />
        </div>
      </section>

      <section id="how-it-works" className={styles.section} aria-labelledby="how-heading">
        <h2 id="how-heading" className={styles.center}>
          Two layers before your provider
        </h2>
        <ol className={styles.layers}>
          {layers.map((layer) => (
            <li key={layer.title} className={`${styles.layer} ${styles[layer.tone]}`}>
              <span className={styles.term}>{layer.term}</span>
              <h3>{layer.title}</h3>
              <p>{layer.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section} aria-labelledby="threshold-heading">
        <div className={styles.explainer}>
          <h2 id="threshold-heading">What counts as a twin?</h2>
          <p>
            Twynn turns each question into a list of numbers that captures its meaning, then
            compares it with questions it has already answered. The comparison gives a{' '}
            <strong>{VOCABULARY.matchScore.label.toLowerCase()}</strong> between 0 and 1 (its
            technical name is {VOCABULARY.matchScore.technical.toLowerCase()}). Your{' '}
            <strong>{VOCABULARY.twinThreshold.label.toLowerCase()}</strong> decides how high that
            score must be. New workspaces start cautious, at {DEFAULT_CACHE_SETTINGS.twinThreshold},
            so only close rewordings are reused.
          </p>
          <p>
            Twins are only matched within the same model, the same settings and the same
            conversation so far, so an answer is never reused for a question asked in a different
            context.
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="features-heading">
        <h2 id="features-heading" className={styles.center}>
          Built to run in production
        </h2>
        <ul className={styles.features}>
          {features.map(({ Icon, title, body }) => (
            <li key={title} className={styles.feature}>
              <Icon size={20} aria-hidden="true" className={styles.featureIcon} />
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${styles.section} ${styles.cta}`} aria-labelledby="cta-heading">
        <Mark size={44} animated />
        <h2 id="cta-heading">See your first twin in minutes</h2>
        <p>
          Connect a provider, create a key, send a request. Your dashboard updates as it arrives.
        </p>
        <ButtonLink to="/signup" size="lg">
          Get started
        </ButtonLink>
      </section>
    </>
  );
}
