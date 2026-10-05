import { ButtonLink } from '../components/Button';
import { Mark } from '../components/Logo';
import styles from './NotFound.module.css';

export function NotFound() {
  return (
    <div className={styles.page}>
      <Mark size={48} />
      <h1>This page has no twin</h1>
      <p>
        We could not find what you were looking for. It may have moved, or the link may be mistyped.
      </p>
      <ButtonLink to="/">Back to the home page</ButtonLink>
    </div>
  );
}
