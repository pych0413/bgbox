// ============================================================
// components/index.js — every shared component in one import, and the
// `components` bundle the shell hands to game UIs as api.components.
// ============================================================

import { dieFace } from '../dom.js?v=1';
import { Cover, closeAllCovers } from './Cover.js?v=1';
import { RoleCard, teamStyle } from './RoleCard.js?v=1';
import { DiceCup } from './DiceCup.js?v=1';
import { PlayerPicker } from './PlayerPicker.js?v=1';
import { VotePanel } from './VotePanel.js?v=1';
import { Timer } from './Timer.js?v=1';
import { Canvas } from './Canvas.js?v=1';
import { RulesSheet } from './RulesSheet.js?v=1';
import { NarratorBar } from './NarratorBar.js?v=1';
import { PassGate } from './PassGate.js?v=1';
import { SeatEditor } from './SeatEditor.js?v=1';
import { Scoreboard } from './Scoreboard.js?v=1';
import { ConfigForm } from './ConfigForm.js?v=1';
import { RecentFold } from './RecentFold.js?v=1';

export {
  Cover, closeAllCovers, RoleCard, teamStyle, DiceCup, PlayerPicker, VotePanel, Timer, Canvas,
  RulesSheet, NarratorBar, PassGate, SeatEditor, Scoreboard, ConfigForm, RecentFold, dieFace,
};

/** What game UIs receive as api.components (§15.8). */
export const components = Object.freeze({
  Cover, RoleCard, DiceCup, PlayerPicker, VotePanel, Timer, Canvas, RecentFold, dieFace,
});
