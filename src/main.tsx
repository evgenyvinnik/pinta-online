import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { i18nReady } from './i18n';
import './styles.css';

void i18nReady
  .catch((error) => console.error('The selected translation catalog could not be loaded.', error))
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
