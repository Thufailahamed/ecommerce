// Everything the recommendation block needs from the browser, in one module so it ships as one lazily loaded script.
export { renderRecommendations, recommendationMount } from "./recommend";
export type { RecProduct, RecHandle } from "./recommend";
export { resolveAdder } from "./addtocart";
