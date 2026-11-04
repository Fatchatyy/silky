// Loaded first, so the shop's own styles keep overriding these base rules (see the comment in the file).
import './styles/reboot.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './context/ThemeContext';
import { ProductsProvider } from './context/ProductsContext';
import { CartProvider } from './context/CartContext';
import { AuthProvider } from './context/AuthContext';
import { FavoritesProvider } from './context/FavoritesContext';
import SeoManager from './components/SeoManager';
import { LocaleProvider } from './i18n/LocaleContext';
import './styles/base.css';
import './styles/price.css';
import './styles/rtl.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <LocaleProvider>
      <ThemeProvider>
        <AuthProvider>
          <ProductsProvider>
            <CartProvider>
              <FavoritesProvider>
                <SeoManager />
                <App />
              </FavoritesProvider>
            </CartProvider>
          </ProductsProvider>
        </AuthProvider>
      </ThemeProvider>
      </LocaleProvider>
    </BrowserRouter>
  </StrictMode>,
);
