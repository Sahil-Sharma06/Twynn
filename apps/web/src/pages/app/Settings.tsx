import { useEffect, useId, useState } from 'react';
import {
  CACHE_SETTINGS_LIMITS,
  cacheSettingsSchema,
  VOCABULARY,
  type CacheSettings,
  type CacheSettingsUpdate,
} from '@twynn/shared';
import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Field } from '../../components/Field';
import { Skeleton } from '../../components/Spinner';
import { PageHeader, Panel, Select } from '../../components/Ui';
import { formatDuration, formatScore } from '../../lib/format';
import { apiErrors, validate, type FieldErrors } from '../../lib/forms';
import { useCacheSettings, useProvider, useSaveSettings } from '../../lib/queries';
import { ProviderStep } from '../onboarding/ProviderStep';
import { describeThreshold, ThresholdImpact } from './ThresholdPreview';
import styles from './Settings.module.css';

const TTL_PRESETS = [3600, 6 * 3600, 86_400, 7 * 86_400, 30 * 86_400];
const { min: T_MIN, max: T_MAX } = CACHE_SETTINGS_LIMITS.twinThreshold;

/** The fields that differ between saved settings and the draft. */
export function settingsPatch(saved: CacheSettings, draft: CacheSettings): CacheSettingsUpdate {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as Array<keyof CacheSettings>) {
    if (draft[key] !== saved[key]) patch[key] = draft[key];
  }
  return patch as CacheSettingsUpdate;
}

function CacheSettingsForm({ saved }: { saved: CacheSettings }) {
  const save = useSaveSettings();
  const [draft, setDraft] = useState(saved);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [justSaved, setJustSaved] = useState(false);
  const toggleId = useId();
  const sliderId = useId();
  useEffect(() => setDraft(saved), [saved]);

  const patch = settingsPatch(saved, draft);
  const changes = Object.keys(patch).length;
  const set = <K extends keyof CacheSettings>(key: K, value: CacheSettings[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setJustSaved(false);
  };
  const reading = describeThreshold(draft.twinThreshold);

  const onSave = () => {
    const result = validate(cacheSettingsSchema, draft);
    if (result.errors) return setErrors(result.errors);
    setErrors({});
    save.mutate(patch, {
      onSuccess: () => setJustSaved(true),
      onError: (e) => setErrors(apiErrors(e)),
    });
  };

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <Panel
        title="Twin matching"
        description={`Answers requests that mean the same as an earlier one, even when worded differently. Twynn compares meanings with embeddings from your provider; the ${VOCABULARY.matchScore.label.toLowerCase()} is their ${VOCABULARY.matchScore.technical.toLowerCase()}.`}
      >
        <label className={styles.toggle} htmlFor={toggleId}>
          <input
            id={toggleId}
            type="checkbox"
            role="switch"
            checked={draft.semanticEnabled}
            onChange={(e) => set('semanticEnabled', e.target.checked)}
          />
          <span>
            <strong>Answer twins from the cache</strong>
            <span className={styles.toggleHint}>
              When off, only exact repeats are served from the cache and no embeddings are
              requested.
            </span>
          </span>
        </label>

        <fieldset className={styles.threshold} disabled={!draft.semanticEnabled}>
          <legend>
            {VOCABULARY.twinThreshold.label}
            <span className={styles.technical}>
              {' '}
              ({VOCABULARY.twinThreshold.technical.toLowerCase()})
            </span>
          </legend>
          <div className={styles.sliderRow}>
            <label htmlFor={sliderId} className="visually-hidden">
              {VOCABULARY.twinThreshold.label}
            </label>
            <input
              id={sliderId}
              type="range"
              min={T_MIN}
              max={T_MAX}
              step={0.005}
              value={draft.twinThreshold}
              onChange={(e) => set('twinThreshold', Number(e.target.value))}
              aria-valuetext={`${formatScore(draft.twinThreshold)}: ${reading.text}`}
              className={styles.slider}
            />
            <output htmlFor={sliderId} className={styles.value}>
              {formatScore(draft.twinThreshold)}
            </output>
          </div>
          <div className={styles.scale} aria-hidden="true">
            <span>More twins, more risk</span>
            <span>Fewer twins, safer</span>
          </div>
          <Callout tone={reading.tone}>{reading.text}</Callout>
          {errors.twinThreshold && <p className={styles.error}>{errors.twinThreshold}</p>}
          <div className={styles.preview}>
            <p className={styles.previewTitle}>
              Preview {draft.twinThreshold !== saved.twinThreshold && '(not saved yet)'}
            </p>
            <ThresholdImpact current={saved.twinThreshold} proposed={draft.twinThreshold} />
          </div>
        </fieldset>

        <Field
          label="Embedding model"
          value={draft.embeddingModel}
          onChange={(e) => set('embeddingModel', e.target.value)}
          disabled={!draft.semanticEnabled}
          spellCheck={false}
          error={errors.embeddingModel}
          hint="Must be available from your provider's /embeddings endpoint. Changing it starts twin matching afresh: entries stored with the old model only serve exact repeats."
        />
      </Panel>

      <Panel
        title="Expiry"
        description="How long a stored answer is reused before your provider is asked again. Changes apply to answers stored from now on."
      >
        <Select
          label="Keep answers for"
          value={String(draft.ttlSeconds)}
          onChange={(e) => set('ttlSeconds', Number(e.target.value))}
        >
          {[...new Set([...TTL_PRESETS, saved.ttlSeconds])]
            .sort((a, b) => a - b)
            .map((s) => (
              <option key={s} value={s}>
                {formatDuration(s)}
              </option>
            ))}
        </Select>
      </Panel>

      <div className={styles.saveBar} data-dirty={changes > 0 || undefined}>
        <p role="status">
          {errors.form ? (
            <span className={styles.error}>{errors.form}</span>
          ) : changes > 0 ? (
            `${changes} unsaved ${changes === 1 ? 'change' : 'changes'}`
          ) : justSaved ? (
            'Saved. New requests use these settings.'
          ) : (
            'All changes saved'
          )}
        </p>
        <div className={styles.saveActions}>
          <Button variant="ghost" disabled={changes === 0} onClick={() => setDraft(saved)}>
            Discard
          </Button>
          <Button type="submit" disabled={changes === 0} loading={save.isPending}>
            Save changes
          </Button>
        </div>
      </div>
    </form>
  );
}

export function Settings() {
  const settings = useCacheSettings();
  const provider = useProvider();
  const [providerSaved, setProviderSaved] = useState(false);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Settings"
        description="How Twynn caches for this workspace, and where it forwards misses."
      />
      {settings.isError ? (
        <Callout tone="error">Settings could not be loaded. Refresh to try again.</Callout>
      ) : settings.data ? (
        <CacheSettingsForm saved={settings.data} />
      ) : (
        <Skeleton height="24rem" />
      )}
      <Panel
        title="Provider"
        description={
          provider.data
            ? `Misses are forwarded to ${provider.data.baseUrl} using the saved key ${provider.data.apiKeyHint}.`
            : 'No provider is connected, so requests cannot be answered on a miss.'
        }
      >
        {providerSaved && (
          <p role="status" className={styles.saved}>
            Provider saved.
          </p>
        )}
        {provider.isPending ? (
          <Skeleton height="10rem" />
        ) : (
          <ProviderStep
            key={provider.data?.updatedAt ?? 'none'}
            existing={provider.data ?? null}
            onDone={() => setProviderSaved(true)}
          />
        )}
      </Panel>
    </div>
  );
}
