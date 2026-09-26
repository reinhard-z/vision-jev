// World units are metres along the road. Screen layout is in CSS pixels.
// Longitudinal scale is a toy scale, chosen so ~70 m ahead fits on screen.

export const PX_PER_M = 8;

export const DEFAULT_TARGET_KMH = 50;
export const MIN_TARGET_KMH = 10;
export const MAX_TARGET_KMH = 120;

export const ACCEL = 2.5; // m/s², gentle acceleration
export const COMFORT_DECEL = 7; // m/s², used to plan stops
export const MAX_DECEL = 9; // m/s², hardest the car can brake

export const STOP_GAP_M = 2; // car stops this far before an object
export const CAR_LENGTH_M = 9; // toy scale: matches the drawn car

export const SLOW_DOWN_FACTOR = 0.5;
export const STOP_SIGN_WAIT_S = 2;

export const MIN_DROP_AHEAD_M = 6; // objects dropped closer than this are pushed out

// Layout (CSS px), left to right: grass | sidewalk | oncoming lane | own lane
// | sidewalk | grass. Traffic drives on the right; the car is in the right lane.
export const CANVAS_WIDTH = 420;
export const GRASS_W = 30;
export const SIDEWALK_W = 80;
export const ROAD_W = CANVAS_WIDTH - 2 * (GRASS_W + SIDEWALK_W);
export const ROAD_LEFT = GRASS_W + SIDEWALK_W;
export const ROAD_RIGHT = ROAD_LEFT + ROAD_W;
export const ROAD_MID = ROAD_LEFT + ROAD_W / 2; // centre line
export const CAR_FRONT_FROM_BOTTOM_PX = 150;
export const OBJECT_SIZE_PX = 52;
// The × button on an object's top-right corner.
export const REMOVE_BUTTON_R = 9;
// Physical size matches the drawn tile, so "reached" means touching it.
export const OBJECT_HALF_LENGTH_M = OBJECT_SIZE_PX / 2 / PX_PER_M;
