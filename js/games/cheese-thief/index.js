// Entry point the shell loads: the pure game module plus this game's phone UI (DESIGN §15.1).
import * as g from './game.js?v=20261003164441';
import { mount } from './ui.js?v=20261003164441';

export default { ...g, ui: { mount } };
