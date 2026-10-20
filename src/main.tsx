import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { BrowserRouter } from 'react-router-dom';
import { AccountProvider } from './account/AccountProvider';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter><AccountProvider><App /></AccountProvider></BrowserRouter>
  </React.StrictMode>,
);
