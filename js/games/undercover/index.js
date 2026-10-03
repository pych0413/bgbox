// 誰是臥底 — the module the registry loads (DESIGN §15.1).
import * as g from './game.js?v=1';
import { mount } from './ui.js?v=1';

export default { ...g, ui: { mount } };
