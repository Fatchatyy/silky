import { Fragment } from 'react';
import RichText from '../components/RichText';
import { getTextPage } from '../../shared/textPages';
import { useLocale } from '../i18n/LocaleContext';
import '../styles/legal.css';

// The questions and answers live in shared/textPages.js (also written into the HTML by the server).
export default function FAQ() {
  const { locale } = useLocale();
  const page = getTextPage('faq', locale);
  return (
    <main>
      <section className="legal_page">
        <h1>{page.title}</h1>

        {page.items.map((item) => (
          <Fragment key={item.question}>
            <h2>{item.question}</h2>
            {item.answer.map((parts, index) => (
              <p key={index}>
                <RichText parts={parts} />
              </p>
            ))}
          </Fragment>
        ))}

        {page.outro.map((parts, index) => (
          <p key={index}>
            <RichText parts={parts} />
          </p>
        ))}
      </section>
    </main>
  );
}
