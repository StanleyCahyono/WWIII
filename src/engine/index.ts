/**
 * PUBLIC ENGINE API — World Command: World 120.
 * Pure TypeScript, deterministic, JSON state. Safe in Node and Web Workers. See docs/ENGINE.md.
 */
export * from './data-types';
export * from './state';
export type { Scenario, Catalog } from './scenario/types';
export { registerScenario, getScenarioById, getStatic, scenarioOf } from './scenario/registry';
export { createCampaign, type CreateOptions } from './scenario/create';
export { synthesizeProfile, defaultCityOutput } from './scenario/defaults';
export { buildWorld120Scenario, loadWorld120, listCampaignModes, WORLD120_ID } from './scenario/world120';

export { advance, stepOnce, advanceToNextEvent, isReviewMode } from './sim';
export { submitCommand, validateCommand, previewCommand, applyCommand, COMMAND_TYPES } from './commands/index';
export type { Command, CommandResult, Validation, CommandType, CommandOf, AirBase } from './commands/types';

export { getCountryView, getCountryViews, projectContact, type ViewOptions, type CountryView, type ContactView, type PublicCity, type StackView, type DiplomacyRow } from './view/country-view';
export {
  ledgerModel,
  forecastModel,
  scoreBreakdown,
  researchTree,
  cityList,
  provinceInspector,
  diplomacyRows,
  coalitionList,
  marketView,
  journal,
  newspaper,
  inbox,
  forceModel,
} from './view/queries';

export { serialize, deserialize, validateState, migrate, MIGRATIONS, stateHash, cloneState, markSaved, revisionConflict, SaveError, SAVE_FORMAT, addDrawing, renameDrawing, setDrawingHidden, deleteDrawing, setPref } from './save/index';
export { computeOpeningPower, rawDimensions, OpeningPowerConfigError, REFERENCE_COUNTRY } from './power';

export type { CountryController, PlannerContext, ControllerRegistry, SimHost, WantsInfo } from './ai-host/types';
export { IdleController, BasicController } from './ai-host/controllers';
export { setDefaultHost, getDefaultHost } from './ai-host/scheduler';

export { resolveMissileOutcome, flightMinutes, OUTCOME_ORDER } from './systems/missiles';
export { techStatus, researchRefund, researchSlots } from './systems/research';
export { resourceSummary, shortageBreakdown, allRates } from './systems/economy';
export { forceSummary } from './systems/readiness';
export { countryScores, scoreEntries, thresholdFor, computeDenominator, nodeVP } from './systems/score';
export { planRoute, type RoutePlan } from './systems/movement';
export { canSee, contactId, observedNodes, stackSensorRadii } from './systems/visibility';
export { pairKey } from './ids';
export { distKm } from './systems/mapindex';

export * as rules from './rules';
export { RULES } from './rules';
export * as fixed from './fixed';
export { formatGameTime, formatDuration, dayOf, FINAL_TICK, dayEndTick } from './time';
export { bumpEconomy, popManpower, popMoney, multEffect } from './systems/economy';
export { liftBreakdown, type LiftBreakdown } from './systems/readiness';
export { CONSUMED_MODIFIERS, UNUSED_MODIFIERS, cmod } from './systems/modifiers';
export { initialTrust, trustOf, threadFor } from './systems/diplomacy';
