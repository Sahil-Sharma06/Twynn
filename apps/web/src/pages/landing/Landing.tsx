import { ArrowRight } from 'lucide-react';
import { DEFAULT_CACHE_SETTINGS, VOCABULARY } from '@twynn/shared';
import { ButtonLink } from '../../components/Button';
import { HeroVisual } from './hero/Hero';
import { Journey } from './Journey';
import styles from './Landing.module.css';

const THRESHOLD = DEFAULT_CACHE_SETTINGS.twinThreshold;

/** Example pairs on the match score scale. Scores are illustrative. */
const PAIRS = [
  { a: "What's the capital of France?", b: "Which city is France's capital?", score: 0.97 },
  { a: 'Capital of Austria?', b: 'Capital of Australia?', score: 0.91 },
  { a: "What's the capital of France?", b: 'How tall is Mont Blanc?', score: 0.41 },
];

const SCALE_MIN = 0.3;
const at = (score: number) => `${((score - SCALE_MIN) / (1 - SCALE_MIN)) * 100}%`;

const FACTS = [
  [
    'Your provider and your key',
    'Any OpenAI-compatible endpoint. The key is encrypted at rest and never displayed again after you save it.',
  ],
  [
    'Answers stay in their workspace',
    'Every lookup is scoped to one workspace. A cached answer is never matched or shown to anyone else.',
  ],
  [
    'Streaming works both ways',
    'Streamed responses are stored once complete, and cached answers stream back to clients that ask for a stream.',
  ],
  [
    'You decide what counts as a twin',
    `The twin threshold starts at ${THRESHOLD}. Settings preview a new value against your own recent traffic before you save it.`,
  ],
  [
    'Fresh answers on request',
    'Send X-Twynn-Cache-Control: no-cache to skip the cache for one request, or clear entries by model or age.',
  ],
  [
    'Numbers you can check',
    'Every request is logged with the layer that answered it. Savings are estimated from the token counts your provider returned.',
  ],
] as const;

export function Landing() {
  return (
    <>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroCopy}>
          <h1 id="hero-title" className={styles.title}>
            Answer each question once.
          </h1>
          <p className={styles.lede}>
            Change one line in your OpenAI client and Twynn sits in front of your provider. A
            question it has answered before, word for word or in other words with the same meaning,
            gets the stored answer instead of a new provider call.
          </p>
          <div className={styles.actions}>
            <ButtonLink to="/signup" size="lg" icon={<ArrowRight size={18} aria-hidden="true" />}>
              Get started
            </ButtonLink>
            <a href="#how-it-works" className={styles.textLink}>
              See how a request is answered
            </a>
          </div>
        </div>
        <HeroVisual />
      </section>

      <section className={styles.change} aria-labelledby="change-title">
        <div className={styles.changeCopy}>
          <p className={styles.kicker}>Adoption</p>
          <h2 id="change-title">One line changes</h2>
          <p>
            Keep your SDK, your prompts and your provider. Point the base URL at Twynn and use a
            Twynn key. Responses keep the exact shape your code expects, plus headers that say which
            layer answered.
          </p>
        </div>
        <div className={styles.code} aria-label="Client configuration before and after">
          <pre>
            <code>
              <span className={styles.ln}>const client = new OpenAI({'{'}</span>
              <span className={`${styles.ln} ${styles.del}`}>
                {"  baseURL: 'https://api.openai.com/v1',"}
              </span>
              <span className={`${styles.ln} ${styles.add}`}>
                {"  baseURL: 'https://your-twynn-host/v1',"}
              </span>
              <span className={`${styles.ln} ${styles.del}`}>
                {'  apiKey: process.env.OPENAI_API_KEY,'}
              </span>
              <span className={`${styles.ln} ${styles.add}`}>
                {'  apiKey: process.env.TWYNN_API_KEY,'}
              </span>
              <span className={styles.ln}>{'});'}</span>
            </code>
          </pre>
          <div className={styles.headers}>
            <p className={styles.headersTitle}>Response headers</p>
            <dl>
              <div>
                <dt>X-Twynn-Cache</dt>
                <dd>HIT</dd>
              </div>
              <div>
                <dt>X-Twynn-Cache-Layer</dt>
                <dd>twin</dd>
              </div>
              <div>
                <dt>X-Twynn-Match-Score</dt>
                <dd>0.9700</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section id="how-it-works" className={styles.how} aria-labelledby="how-title">
        <div className={styles.howCopy}>
          <p className={styles.kicker}>How it works</p>
          <h2 id="how-title">Two checks before your provider</h2>
          <p>
            Each request is checked against what Twynn has already answered, cheapest check first.
            It stops at the first layer that can answer it.
          </p>
          <p>
            An {VOCABULARY.exactHit.label.toLowerCase()} costs a single Redis lookup. A{' '}
            {VOCABULARY.twinHit.label.toLowerCase()} costs one embeddings call, which Twynn
            subtracts from the savings it reports. Only a miss reaches your provider.
          </p>
        </div>
        <Journey />
      </section>

      <section className={styles.explain} aria-labelledby="explain-title">
        <div className={styles.explainCopy}>
          <p className={styles.kicker}>Matching by meaning</p>
          <h2 id="explain-title">What makes two questions twins</h2>
          <p>
            Twynn turns the final user message into an embedding, a list of numbers that captures
            its meaning, and compares it with prompts it has already answered. The comparison gives
            a <strong>{VOCABULARY.matchScore.label.toLowerCase()}</strong> from 0 to 1.
          </p>
          <p>
            If the closest stored prompt scores at or above your{' '}
            <strong>{VOCABULARY.twinThreshold.label.toLowerCase()}</strong>, its answer is reused.
            Twins must also share the model, the settings and the conversation so far, so an answer
            is never reused in a different context.
          </p>
        </div>
        <figure className={styles.scale}>
          <figcaption className={styles.scaleCaption}>
            {VOCABULARY.matchScore.label} for three example pairs, against a{' '}
            {VOCABULARY.twinThreshold.label.toLowerCase()} of {THRESHOLD}
          </figcaption>
          <ul className={styles.pairs}>
            {PAIRS.map((p) => {
              const twin = p.score >= THRESHOLD;
              return (
                <li key={p.b} className={styles.pairRow} data-twin={twin || undefined}>
                  <p className={styles.pairText}>
                    <q>{p.a}</q> <span className={styles.vs}>and</span> <q>{p.b}</q>
                  </p>
                  <div className={styles.track}>
                    <span className={styles.fill} style={{ width: at(p.score) }} />
                    <span className={styles.threshold} style={{ left: at(THRESHOLD) }} />
                  </div>
                  <p className={styles.verdict}>
                    <span className={styles.score}>{p.score.toFixed(2)}</span>
                    {twin
                      ? 'Twin: the stored answer is reused'
                      : p.score > 0.8
                        ? 'Close, but a different answer. Not reused.'
                        : 'Unrelated. Not reused.'}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className={styles.scaleNote}>
            Austria and Australia score high because the questions are built the same way. A
            threshold of {THRESHOLD} keeps them apart.
          </p>
        </figure>
      </section>

      <section className={styles.facts} aria-labelledby="facts-title">
        <h2 id="facts-title">Built to run in production</h2>
        <dl className={styles.factList}>
          {FACTS.map(([term, detail]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.cta} aria-labelledby="cta-title">
        <h2 id="cta-title">See your first twin hit</h2>
        <p>
          Connect a provider, create a key and send a request. The dashboard shows it the moment it
          is answered.
        </p>
        <ButtonLink to="/signup" size="lg" icon={<ArrowRight size={18} aria-hidden="true" />}>
          Get started
        </ButtonLink>
      </section>
    </>
  );
}
