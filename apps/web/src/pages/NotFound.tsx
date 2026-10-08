import { ButtonLink } from '../components/Button';
import styles from './NotFound.module.css';

/** Two bubbles drift toward each other and pass without meeting: this page has no twin. */
export function NotFound() {
  return (
    <div className={styles.page}>
      <div className={styles.scene} aria-hidden="true">
        <span className={`${styles.bubble} ${styles.a}`} />
        <span className={`${styles.bubble} ${styles.b}`} />
      </div>
      <div className={styles.copy}>
        <p className={styles.code}>404</p>
        <h1>This page has no twin</h1>
        <p>
          Nothing is stored at this address. The link may be mistyped, or the page may have moved.
        </p>
        <ButtonLink to="/">Back to the home page</ButtonLink>
      </div>
    </div>
  );
}
