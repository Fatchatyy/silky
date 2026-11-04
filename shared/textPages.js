// Text of the storefront's text pages, by language. The React pages render it, and the server writes the same text
// into the HTML of the page (server/seo/renderBody.js) so crawlers that do not run JavaScript can read it.
// Pure: no DOM, no React. Only what the shop confirmed; when a fact changes, change it here once.
//
// A paragraph is a list of parts: a string, { to, text } (link inside the shop) or { mail, text } (e-mail link).
import { CONTACT } from './contact.js';
import { DELIVERY_FEE_TND } from './delivery.js';

// A phone number inside Arabic text: the isolate keeps its digit groups in reading order (+216 25 274 800).
const ltr = (text) => `\u2066${text}\u2069`;

const feeSentence = `Les frais de livraison sont de ${DELIVERY_FEE_TND} TND.`;
const exchangeFees =
  "Pour un échange, les frais de livraison sont à la charge du client. En cas d'erreur de Silky dans votre commande, ils sont pris en charge par Silky. Silky peut également les prendre en charge dans d'autres situations.";
const refundRule =
  'Vous pouvez demander un remboursement dans un délai de 2 jours à compter de la livraison de votre colis par le livreur.';
const support247 = 'Notre service client est disponible 24h/24 et 7j/7.';
const feeSentenceAr = `تبلغ تكلفة التوصيل ${DELIVERY_FEE_TND} د.ت.`;
const exchangeFeesAr =
  'في حالة التبديل، تكون تكاليف التوصيل على عاتق العميل. وفي حال وقوع خطأ من Silky في طلبك، تتحمّلها Silky. ويمكن لـ Silky أيضًا أن تتحمّلها في حالات أخرى.';
const refundRuleAr = 'يمكنك طلب استرجاع المبلغ في غضون يومين من تاريخ تسليم طردك من طرف عامل التوصيل.';
const support247Ar = 'خدمة العملاء متوفرة 24 ساعة على 24 و7 أيام على 7.';

export const TEXT_PAGES = {
  fr: {
    faq: {
      title: 'Questions fréquentes',
      items: [
        { question: 'Quels sont les délais de livraison ?', answer: [['Nous livrons à domicile en 24 à 48 heures.']] },
        { question: 'Combien coûte la livraison ?', answer: [[feeSentence]] },
        { question: 'Livrez-vous dans toute la Tunisie ?', answer: [['Oui, nous livrons dans les 24 gouvernorats de Tunisie.']] },
        {
          question: 'Comment puis-je payer ma commande ?',
          answer: [['Le paiement se fait à la livraison, en espèces, directement auprès du livreur lors de la réception de votre colis.']],
        },
        {
          question: 'Puis-je vérifier mon colis avant de payer ?',
          answer: [["Oui, vous pouvez ouvrir et inspecter votre colis devant le livreur avant de l'accepter."]],
        },
        {
          question: 'Puis-je échanger un article ?',
          answer: [['Oui, un échange de taille ou de couleur est possible dans un délai de 48 heures.']],
        },
        { question: "Qui paie la livraison d'un échange ?", answer: [[exchangeFees]] },
        { question: 'Puis-je être remboursé ?', answer: [[refundRule]] },
        {
          question: 'Comment contacter le service client ?',
          answer: [
            [
              `Appelez le ${CONTACT.telephone}, écrivez à `,
              { mail: CONTACT.email, text: CONTACT.email },
              ` ou contactez-nous sur nos réseaux sociaux. ${support247} Vous pouvez aussi utiliser le `,
              { to: '/contact', text: 'formulaire de contact' },
              '.',
            ],
          ],
        },
      ],
      outro: [['Retrouvez le détail sur la page ', { to: '/livraison-retours', text: 'Livraison et retours' }, '.']],
    },

    delivery: {
      title: 'Livraison et retours',
      sections: [
        {
          id: 'livraison',
          heading: 'Informations de livraison',
          paragraphs: [
            ['Livraison à domicile rapide en 24 à 48 heures. Paiement à la livraison, en espèces, directement auprès du livreur lors de la réception de votre colis.'],
            [feeSentence],
          ],
        },
        {
          id: 'retours',
          heading: 'Politique de retours',
          paragraphs: [
            ["Vous pouvez ouvrir et inspecter votre colis devant le livreur avant de l'accepter. Un échange est également possible (taille et couleur) dans un délai de 48 heures."],
            [exchangeFees],
            [refundRule],
          ],
        },
      ],
    },

    service: {
      title: 'Service client',
      paragraphs: [
        [
          `Appelez ${CONTACT.telephone}, envoyez un e-mail à `,
          { mail: CONTACT.email, text: CONTACT.email },
          ' ou contactez nous sur nos réseaux sociaux',
        ],
        [support247],
      ],
    },

    about: {
      title: 'À propos',
      paragraphs: [
        ["Silky vous accueille dans sa boutique en ligne spécialisée dans la mode et le prêt-à-porter. Vous y trouverez des styles variés pour répondre aux goûts et à l'individualité de chacun."],
        ["Nous croyons qu'une qualité haut de gamme ne doit pas être un luxe inaccessible. Pensées en Tunisie dans des tissus et des matières de haute qualité, nos pièces vous garantissent un style élégant, une excellente durabilité et le meilleur prix."],
        ['Qualité, style et prix: Tout est garanti! Votre confiance est notre plus grand capital.'],
      ],
    },

    contact: {
      title: 'Contactez-nous',
      intro: [
        ["Chez Silky, nous sommes toujours à votre écoute pour vous offrir une expérience shopping sur mesure."],
        [`Pour toute question, suggestion ou besoin d'aide, notre équipe reste à votre entière disposition. N'hésitez pas à nous contacter ! ${support247}`],
      ],
    },
  },
  // Modern Standard Arabic, translated from the French text above (same facts, nothing added). To be reviewed by the
  // owner before launch.
  ar: {
    faq: {
      title: 'الأسئلة الشائعة',
      items: [
        { question: 'ما هي آجال التوصيل؟', answer: [['نوصّل إلى المنزل في غضون 24 إلى 48 ساعة.']] },
        { question: 'كم تبلغ تكلفة التوصيل؟', answer: [[feeSentenceAr]] },
        { question: 'هل تقومون بالتوصيل إلى كامل تراب تونس؟', answer: [['نعم، نوصّل إلى الولايات الأربع والعشرين في تونس.']] },
        {
          question: 'كيف يمكنني دفع ثمن طلبي؟',
          answer: [['يتم الدفع عند الاستلام، نقدًا، مباشرة لدى عامل التوصيل عند استلام طردك.']],
        },
        {
          question: 'هل يمكنني فحص الطرد قبل الدفع؟',
          answer: [['نعم، يمكنك فتح طردك وفحصه أمام عامل التوصيل قبل قبوله.']],
        },
        { question: 'هل يمكنني تبديل منتج؟', answer: [['نعم، يمكن تبديل المقاس أو اللون في غضون 48 ساعة.']] },
        { question: 'من يتحمّل تكلفة توصيل التبديل؟', answer: [[exchangeFeesAr]] },
        { question: 'هل يمكنني استرجاع المبلغ؟', answer: [[refundRuleAr]] },
        {
          question: 'كيف أتواصل مع خدمة العملاء؟',
          answer: [
            [
              `اتصل على الرقم ${ltr(CONTACT.telephone)}، أو راسلنا على `,
              { mail: CONTACT.email, text: CONTACT.email },
              `، أو تواصل معنا عبر شبكات التواصل الاجتماعي. ${support247Ar} يمكنك أيضًا استعمال `,
              { to: '/contact', text: 'نموذج الاتصال' },
              '.',
            ],
          ],
        },
      ],
      outro: [['تجدون التفاصيل في صفحة ', { to: '/livraison-retours', text: 'التوصيل والإرجاع' }, '.']],
    },

    delivery: {
      title: 'التوصيل والإرجاع',
      sections: [
        {
          id: 'livraison',
          heading: 'معلومات التوصيل',
          paragraphs: [
            ['توصيل سريع إلى المنزل في غضون 24 إلى 48 ساعة. الدفع عند الاستلام، نقدًا، مباشرة لدى عامل التوصيل عند استلام طردك.'],
            [feeSentenceAr],
          ],
        },
        {
          id: 'retours',
          heading: 'سياسة الإرجاع',
          paragraphs: [
            ['يمكنك فتح طردك وفحصه أمام عامل التوصيل قبل قبوله. كما يمكن تبديل المقاس أو اللون في غضون 48 ساعة.'],
            [exchangeFeesAr],
            [refundRuleAr],
          ],
        },
      ],
    },

    service: {
      title: 'خدمة العملاء',
      paragraphs: [
        [
          `اتصل على الرقم ${ltr(CONTACT.telephone)}، أو أرسل بريدًا إلكترونيًا إلى `,
          { mail: CONTACT.email, text: CONTACT.email },
          ' أو تواصل معنا عبر شبكات التواصل الاجتماعي',
        ],
        [support247Ar],
      ],
    },

    about: {
      title: 'من نحن',
      paragraphs: [
        ['ترحّب بكم Silky في متجرها الإلكتروني المتخصص في الأزياء والملابس الجاهزة. ستجدون فيه أنماطًا متنوعة تلبّي أذواق كل شخص وخصوصيته.'],
        ['نؤمن بأن الجودة العالية لا ينبغي أن تكون ترفًا بعيد المنال. قطعنا مصمّمة في تونس بأقمشة ومواد عالية الجودة، وتضمن لكم أناقة في الأسلوب ومتانة ممتازة وأفضل سعر.'],
        ['الجودة والأناقة والسعر: كل شيء مضمون! ثقتكم هي أكبر رأسمال لدينا.'],
      ],
    },

    contact: {
      title: 'اتصلوا بنا',
      intro: [
        ['في Silky، نحن دائمًا في خدمتكم لنقدّم لكم تجربة تسوّق على مقاسكم.'],
        [`لأي سؤال أو اقتراح أو طلب مساعدة، فريقنا رهن إشارتكم. لا تترددوا في الاتصال بنا! ${support247Ar}`],
      ],
    },
  },
};

/** Which text page a route shows (routes of src/seo/routes.js). */
export const TEXT_PAGE_BY_PATH = {
  '/faq': 'faq',
  '/livraison-retours': 'delivery',
  '/service-client': 'service',
  '/about': 'about',
  '/contact': 'contact',
};

export const getTextPage = (id, locale = 'fr') => TEXT_PAGES[locale]?.[id] ?? TEXT_PAGES.fr[id];

// A paragraph's parts as plain text (links become their text, the phone-number isolates are dropped).
const ISOLATES = [String.fromCharCode(0x2066), String.fromCharCode(0x2069)];
export const partsToText = (parts) =>
  [...parts.map((part) => (typeof part === 'string' ? part : part.text)).join('')].filter((ch) => !ISOLATES.includes(ch)).join('');

/** The FAQ as [{ question, answer }] in plain text (for the FAQPage structured data). */
export const faqEntries = (locale = 'fr') =>
  getTextPage('faq', locale).items.map((item) => ({ question: item.question, answer: item.answer.map(partsToText).join(' ') }));
