import { render } from 'preact';
import { App } from '../../pages/preview/App';
import '../../pages/shared/ui.css';
import '../../pages/preview/preview.css';

render(<App />, document.getElementById('app')!);

if (import.meta.env.MODE === 'e2e') {
  import('../../pages/preview/test-hooks').then((m) => Object.assign(globalThis, { __lcPreviewTest: m.previewTestHooks }));
}
