// Paste into DevTools on a search results page after enabling a card layout.
// Run at 1920/2560/390/320px, with/without AI, before/after loading more results.
(() => {
  const box = document.getElementById("bsp-results");
  if (!box) return console.info("SearchLayout: no active card container");
  const bounds = box.getBoundingClientRect();
  const style = getComputedStyle(box);
  const columns = style.display === "grid" ? style.gridTemplateColumns.split(" ").length : 1;
  const gap = Number.parseFloat(style.columnGap) || 0;
  const expected = (bounds.width - gap * (columns - 1)) / columns;
  const rows = [...box.children].map((card, index) => {
    const r = card.getBoundingClientRect();
    return { index, width:r.width, height:r.height, left:r.left, top:r.top,
      expectedWidth:expected, widthOK:Math.abs(r.width - expected) < 2 };
  });
  console.table(rows);
  console.assert(rows.every(row => row.widthOK), "Card width differs from its grid track");
  console.assert(bounds.left >= 0 && bounds.right <= document.documentElement.clientWidth + 1,
    "Result container exceeds the viewport", bounds);
  console.assert(!box.querySelector('#rhs, #b_context, #Odp5De, [data-attrid="SGE"], [data-attrid="AIOverview"], [data-ai-overview]'),
    "AI/side panel was collected as an organic card");
  return { mode:box.dataset.mode, columns, containerWidth:bounds.width, cards:rows.length };
})();
