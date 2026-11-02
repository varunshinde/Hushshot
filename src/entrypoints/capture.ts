import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { install } from '../content';

// Injected on demand via chrome.scripting (activeTab); never declared in the manifest.
export default defineUnlistedScript(() => install());
