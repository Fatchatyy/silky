import { Link } from '../i18n/router';
import '../styles/about.css';
import { useT } from '../i18n/useT';

export default function NotFound() {
  const { t } = useT();
  return (
    <main>
      <section className="about_section">
        <h1 className="about_heading">{t('notfound.title')}</h1>
        <p>{t('notfound.text')}</p>
        <p>
          <Link to="/">{t('notfound.home')}</Link>
        </p>
      </section>
    </main>
  );
}
