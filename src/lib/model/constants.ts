/**
 * Single source of truth for lot dimensions, storey limits, viewport cut plane bounds,
 * flood safety thresholds, and structural parameter limits (locked 5x17 m 2-storey).
 */

export const SITE_WIDTH_M = 5.0;
export const SITE_DEPTH_M = 17.0;
export const LEVEL_COUNT = 2;

export const CUT_PLANE_OFF = 100;
export const CUT_PLANE_MIN_M = -1.5;
export const CUT_PLANE_MAX_M = 12.0;

export const SAFE_OUTLET_HEIGHT_M = 1.1;
export const SAFE_MCB_HEIGHT_M = 1.6;
export const OUTLET_HEIGHT_MIN_M = 0.25;
export const OUTLET_HEIGHT_MAX_M = 1.6;
export const MCB_HEIGHT_MIN_M = 1.0;
export const MCB_HEIGHT_MAX_M = 2.2;

export const FC_MIN_MPA = 15;
export const FC_MAX_MPA = 45;
export const FY_MIN_MPA = 240;
export const FY_MAX_MPA = 550;
export const REBAR_DIAM_MIN_MM = 8;
export const REBAR_DIAM_MAX_MM = 19;
export const SEISMIC_R_MIN = 3;
export const SEISMIC_R_MAX = 8;

export const PEIL_STREET_MIN_M = -0.3;
export const PEIL_STREET_MAX_M = 0.5;
export const PEIL_CARPORT_MIN_M = 0.05;
export const PEIL_CARPORT_MAX_M = 1.2;
export const PEIL_TERRACE_MIN_M = 0.05;
export const PEIL_TERRACE_MAX_M = 1.4;
export const PEIL_FLOOR1_MIN_M = 0.1;
export const PEIL_FLOOR1_MAX_M = 1.5;

export const RAIN_MIN_MM_H = 0;
export const RAIN_MAX_MM_H = 150;
export const WIND_SPEED_MIN_MS = 0;
export const WIND_SPEED_MAX_MS = 20;
export const AMBIENT_TEMP_MIN_C = 18;
export const AMBIENT_TEMP_MAX_C = 42;
