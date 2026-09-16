/**
 * Minimum number of comparable successful runs required before a workflow's compute cost
 * estimate is published. Below this the k-NN percentile band is too noisy to be meaningful,
 * so the estimator reports no estimate and the UI hides the estimated cost metric entirely.
 */
export const MIN_COMPARABLE_RUNS_FOR_COST_ESTIMATE = 3;
