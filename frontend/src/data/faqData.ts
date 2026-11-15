import {getLocale} from '../i18n';
import content from './faqContent.json';

export const faqData = () => content[getLocale()];
