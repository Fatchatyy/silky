import { Fragment } from 'react';
import { Outlet } from 'react-router-dom';
import { useLocale } from '../../i18n/LocaleContext';
import AnnouncementBar from './AnnouncementBar';
import Header from './Header';
import Footer from './Footer';
import ScrollToTop from './ScrollToTop';

export default function Layout() {
  const { locale } = useLocale();
  return (
    <>
      <ScrollToTop />
      <AnnouncementBar />
      <Header />
      {/* The French and /ar route trees share this layout, so React would keep the page (and any message it holds,
          already written in the old language) when the language is switched. The key starts the page afresh. */}
      <Fragment key={locale}>
        <Outlet />
      </Fragment>
      <Footer />
    </>
  );
}
