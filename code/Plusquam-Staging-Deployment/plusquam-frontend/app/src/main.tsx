import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { I18nProvider } from './i18n/useTranslation';
import { clearToken, getToken } from './lib/session';
import { exchangeHandoff, SIGNIN_URL } from './lib/api';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

function renderApp() {
  root.render(
    <StrictMode>
      <BrowserRouter>
        <I18nProvider>
          <App />
        </I18nProvider>
      </BrowserRouter>
    </StrictMode>
  );
}

async function bootstrap() {
  const match = window.location.hash.match(/(?:^#|&)c=([^&]+)/);
  if (match) {
    // Remove the one-time code from history before making any network request.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    document.getElementById('root')!.textContent = 'Signing in…';
    try {
      const code = decodeURIComponent(match[1]);
      await exchangeHandoff(code);
      renderApp();
      return;
    } catch {
      clearToken();
      const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      if (!isLocal) {
        window.location.replace(`${SIGNIN_URL}?login=expired`);
        return;
      }
      document.getElementById('root')!.textContent = 'Sign-in expired. Return to the sign-in page and try again.';
      return;
    }
  }
  if (/(?:^#|&)t=/.test(window.location.hash)) {
    // Remove legacy JWT fragments from old bookmarks without persisting them.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  getToken(); // migrate older localStorage sessions and remove their persistent copy
  renderApp();
}

void bootstrap();
