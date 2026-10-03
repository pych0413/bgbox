// ============================================================
// components/index.js — every shared component in one import, and the
// `components` bundle the shell hands to game UIs as api.components.
// ============================================================

import { dieFace } from '../dom.js?v=20261003085536';
import { Cover, closeAllCovers } from './Cover.js?v=20261003085536';
import { RoleCard, teamStyle } from './RoleCard.js?v=20261003085536';
import { DiceCup } from './DiceCup.js?v=20261003085536';
import { PlayerPicker } from './PlayerPicker.js?v=20261003085536';
import { VotePanel } from './VotePanel.js?v=20261003085536';
import { Timer } from './Timer.js?v=20261003085536';
import { Canvas } from './Canvas.js?v=20261003085536';
import { RulesSheet } from './RulesSheet.js?v=20261003085536';
import { NarratorBar } from './NarratorBar.js?v=20261003085536';
import { PassGate } from './PassGate.js?v=20261003085536';
import { SeatEditor } from './SeatEditor.js?v=20261003085536';
import { Scoreboard } from './Scoreboard.js?v=20261003085536';
import { ConfigForm } from './ConfigForm.js?v=20261003085536';

export {
  Cover, closeAllCovers, RoleCard, teamStyle, DiceCup, PlayerPicker, VotePanel, Timer, Canvas,
  RulesSheet, NarratorBar, PassGate, SeatEditor, Scoreboard, ConfigForm, dieFace,
};

/** What game UIs receive as api.components (§15.8). */
export const components = Object.freeze({
  Cover, RoleCard, DiceCup, PlayerPicker, VotePanel, Timer, Canvas, dieFace,
});
