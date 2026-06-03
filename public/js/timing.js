// Official NC EOG/BOG administration timing. The countdown runs from `suggested`
// minutes; after that the runner enters gentle "overtime" up to `max` (3 hours
// for EOG/BOG) before auto-submitting — mirroring NC's estimated-time + max rule.
export function officialTiming(testType) {
  if (testType === "eog") return { suggested: 120, max: 180 }; // ~2 hr, up to 3 hr
  if (testType === "moy") return { suggested: 90, max: 135 };  // mid-year benchmark
  return { suggested: 90, max: 180 };                          // boy/bog: 90 + 90
}
