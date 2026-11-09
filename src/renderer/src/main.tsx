import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// A file dropped anywhere outside a terminal would make the page try to open
// it; the window never navigates, so just ignore the drop.
for (const type of ['dragover', 'drop'] as const) document.addEventListener(type, (e) => e.preventDefault());

createRoot(document.getElementById('root')!).render(<App />);
