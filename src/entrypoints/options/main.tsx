import { render } from 'preact';
import { App } from '../../pages/options/App';
import '../../pages/shared/ui.css';
import '../../pages/options/options.css';

render(<App />, document.getElementById('app')!);
