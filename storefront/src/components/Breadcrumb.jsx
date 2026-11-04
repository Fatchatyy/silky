// Small visible breadcrumb line above the product name (Accueil › Collection › Produit). Real links, same markup in
// the server HTML and for the admin editor. The separator flips in Arabic (see the .product_breadcrumb rules in shop.css).
export default function Breadcrumb({ items, label = 'Breadcrumb' }) {
  if (!items?.length) return null;
  return (
    <nav className="product_breadcrumb" aria-label={label}>
      <ol>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.name}-${index}`} aria-current={last ? 'page' : undefined}>
              {last || !item.href ? <span>{item.name}</span> : <a href={item.href}>{item.name}</a>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
