import { render } from 'preact';
import { App } from '../../pages/popup/App';
import '../../pages/shared/ui.css';
import '../../pages/popup/popup.css';

render(<App />, document.getElementById('app')!);
