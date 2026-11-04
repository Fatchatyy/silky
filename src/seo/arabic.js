// Arabic titles and descriptions of the storefront's fixed routes (keys are the route paths of routes.js) and the
// generic "not found" titles. Modern Standard Arabic, translated from the French ones; descriptions only restate
// what the page shows. To be reviewed by the owner before launch. Pure: no DOM, no React.

export const AR_ROUTE_TEXT = {
  '/': {
    fullTitle: 'Silky – متجر أزياء إلكتروني في تونس',
    description: 'Silky، متجر إلكتروني للأزياء والملابس الجاهزة مصمّم في تونس. توصيل إلى المنزل في 24 إلى 48 ساعة والدفع عند الاستلام.',
  },
  '/about': {
    title: 'من نحن',
    description: 'Silky، متجر إلكتروني للأزياء والملابس الجاهزة: قطع مصمّمة في تونس بمواد عالية الجودة وبأفضل سعر.',
  },
  '/contact': {
    title: 'اتصلوا بنا',
    description: 'أرسلوا رسالة إلى خدمة عملاء Silky عبر نموذج الاتصال.',
  },
  '/service-client': {
    title: 'خدمة العملاء',
    description: 'تواصلوا مع خدمة عملاء Silky على الرقم +216 25 274 800 أو عبر البريد الإلكتروني أو شبكات التواصل الاجتماعي.',
  },
  '/livraison-retours': {
    title: 'التوصيل والإرجاع',
    description: 'توصيل إلى المنزل في 24 إلى 48 ساعة، الدفع عند الاستلام، فحص الطرد أمام عامل التوصيل وتبديل المقاس أو اللون في غضون 48 ساعة.',
  },
  '/faq': {
    title: 'الأسئلة الشائعة',
    description: 'التوصيل، الدفع عند الاستلام، التبديل، الاسترجاع والتواصل: إجابات عن الأسئلة الشائعة حول Silky.',
  },
  '/search': { title: 'البحث' },
  '/cart': { title: 'السلة' },
  '/checkout': { title: 'إتمام الطلب' },
  '/order-confirmation': { title: 'تأكيد الطلب' },
  '/leave-review': { title: 'أضف رأيك' },
  '/login': { title: 'تسجيل الدخول' },
  '/signup': { title: 'إنشاء حساب' },
  '/register': { title: 'إنشاء حساب' },
  '/password-reset': { title: 'نسيت كلمة المرور' },
  '/password-reset/:token': { title: 'كلمة مرور جديدة' },
  '/favorites': { title: 'مفضلاتي' },
  '/account': { title: 'حسابي' },
};

export const AR_NOT_FOUND_TITLE = 'الصفحة غير موجودة';
export const AR_PRODUCT_NOT_FOUND_TITLE = 'المنتج غير موجود';
export const AR_COLLECTION_TITLE = 'المجموعة';
