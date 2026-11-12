import { BING_OVERVIEW, GOOGLE_OVERVIEW } from "./ai-overview.mjs";

// Structural markers only: never classify blocks by translated heading text.
const TYPES = [
  { pref: "collapsePaa", label: "foldedPaa", selector: '[data-paa], .related-question-pair, .b_relatedQuestions, .b_ans.b_paa' },
  { pref: "collapseVideos", label: "foldedVideos", selector: '[data-video-carousel], .b_ans.b_vid, .b_ans.b_video, g-scrolling-carousel' },
  { pref: "collapseSnippets", label: "foldedSnippets", selector: '[data-featured-snippet], .ifM9O, [data-attrid="wa:/description"], .b_ans.b_snippet' },
];

export function resultBlocks(document) {
  const blocks = new Map();
  for (const type of TYPES) {
    for (const marker of document.querySelectorAll(type.selector)) {
      if (!marker.closest("#rso, #search, #b_results")) continue;
      if (marker.closest(`#rhs, #b_context, #tads, #tadsb, #bottomads, ${GOOGLE_OVERVIEW}, ${BING_OVERVIEW}`)) continue;
      if (marker.matches("g-scrolling-carousel") && !marker.querySelector('a[href*="youtube.com/watch"], a[href*="/videos/"], video')) continue;
      const block = marker.closest(".MjjYud, .g, .tF2Cxc, .b_ans") ?? marker;
      // A generic wrapper may also contain unrelated organic results. Fold the marker in that case.
      const target = block.querySelectorAll(".g, .tF2Cxc, li.b_algo").length ? marker : block;
      if (!blocks.has(target)) blocks.set(target, type);
    }
  }
  return blocks;
}

export function isSpecialResult(element, blocks) {
  for (const block of blocks.keys()) {
    if (element === block || block.contains(element) || element.contains(block)) return true;
  }
  return false;
}
