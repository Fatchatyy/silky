import { Fragment } from 'react';
import RichText from '../components/RichText';
import { getTextPage } from '../../shared/textPages';
import { useLocale } from '../i18n/LocaleContext';
import '../styles/about.css';

export default function DeliveryReturns() {
  const { locale } = useLocale();
  const page = getTextPage('delivery', locale);
  return (
    <main>
      <section className="about_section">
        <h1 className="about_page_title">{page.title}</h1>
        {page.sections.map((section) => (
          <Fragment key={section.id}>
            <h2 className="about_heading" id={section.id}>
              {section.heading}
            </h2>
            {section.paragraphs.map((parts, index) => (
              <p key={index}>
                <RichText parts={parts} />
              </p>
            ))}
          </Fragment>
        ))}
      </section>
    </main>
  );
}
