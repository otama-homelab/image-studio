import {beforeEach} from 'vitest';
import i18n from '../src/i18n';

// Existing UI fixtures assert Japanese labels independently of the app default.
beforeEach(async()=>{await i18n.changeLanguage('ja');});
