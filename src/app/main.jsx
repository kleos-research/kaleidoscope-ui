import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.jsx';
import { captureToken } from './api.mjs';
import './styles.css';

/**
 * The whole browser half, mounted once.
 *
 * The token is taken before anything renders, so it is out of the address bar before a screenshot,
 * a bookmark or the Back button can carry it anywhere.
 */
captureToken();

createRoot(document.getElementById('root')).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
