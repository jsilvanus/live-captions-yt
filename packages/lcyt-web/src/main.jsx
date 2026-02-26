import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/reset.css';
import './styles/layout.css';
import './styles/components.css';
import { App } from './App';

createRoot(document.getElementById('app')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
