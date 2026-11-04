import RichText from '../components/RichText';
import { getTextPage } from '../../shared/textPages';
import { useLocale } from '../i18n/LocaleContext';
import '../styles/about.css';

export default function CustomerService() {
  const { locale } = useLocale();
  const page = getTextPage('service', locale);
  return (
    <main>
      <section className="about_section">
        <h1 className="about_heading">{page.title}</h1>
        {page.paragraphs.map((parts, index) => (
          <p key={index}>
            <RichText parts={parts} />
          </p>
        ))}
      </section>
    </main>
  );
}
