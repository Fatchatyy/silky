import { Fragment } from 'react';
import { Link } from '../i18n/router';

/** Renders a paragraph's parts (see shared/textPages.js): plain text, shop links and e-mail links. */
export default function RichText({ parts }) {
  return parts.map((part, index) => {
    if (typeof part === 'string') return <Fragment key={index}>{part}</Fragment>;
    if (part.mail) return <a key={index} href={`mailto:${part.mail}`}>{part.text}</a>;
    return (
      <Link key={index} to={part.to}>
        {part.text}
      </Link>
    );
  });
}
