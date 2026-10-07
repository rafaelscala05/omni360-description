import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import { metaInit } from './meta';
import { tiktokInit } from './tiktok';
import { instalarOrigemToque } from './modules/agent/origemToque';

metaInit();
tiktokInit();
instalarOrigemToque();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
