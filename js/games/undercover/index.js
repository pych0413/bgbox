// 誰是臥底 — the module the registry loads (DESIGN §15.1).
import * as g from './game.js?v=20261003102525';
import { mount } from './ui.js?v=20261003102525';

export default { ...g, ui: { mount } };
