// Synthetic engine structures, not a snapshot of a particular live rollout.
export function resultMarkup(engine, index) {
  const tag = engine === "bing" ? "li" : "div";
  const heading = engine === "bing" ? "h2" : "h3";
  return `<${tag} class="${engine === "bing" ? "b_algo" : "g"}" data-result="${index}">
    <${heading}><a href="https://example.com/result/${index}">Result ${index}: Chrome extension layout</a></${heading}>
    <p class="${engine === "bing" ? "b_caption" : "VwiC3b"}">A useful summary with ${index % 2 ? "a longer description. ".repeat(12) : "short text."}</p>
  </${tag}>`;
}

export function aiMarkup(engine = "google") {
  const marker = engine === "bing" ? 'id="b_copilot_search_container"' : 'id="ai-overview" data-attrid="SGE"';
  return `<section ${marker}><h2>AI Overview</h2>
    <div class="ai-inner" style="display:flex;gap:13px">
      <div class="g"><a href="https://example.com/citation"><h3>AI citation</h3></a></div>
      <p>Generated summary</p>
    </div></section>`;
}

export function searchPage({ engine = "google", count = 3, ai = false, placement = "shell", wideOverview } = {}) {
  const results = Array.from({ length: count }, (_, i) => resultMarkup(engine, i)).join("");
  const columnMarker = wideOverview === "wrapped" ? 'data-container-id="main-col"' : "data-rl";
  const wideMarkup = `<div class="wide-overview"${wideOverview === "wrapped" ? ' id="Odp5De"' : ""}>
    <div class="overview-column"><h2>AI Overview</h2>
      <div id="m-x-content"><div><div ${columnMarker} class="overview-body">
        <p>Generated summary</p><div class="g"><a href="https://example.com/citation"><h3>AI citation</h3></a></div>
      </div></div></div>
      <details><summary>Show more</summary><p>More of the answer</p></details>
    </div>
  </div>`;
  const overview = wideOverview ? wideMarkup : ai ? aiMarkup(engine) : "";
  const content = engine === "google"
    ? `<div id="rcnt">${placement === "shell" ? overview : ""}
        <div id="center_col"><div id="search"><div id="rso" class="${placement === "inner" && ai ? "ai-grid" : ""}">
          ${placement === "inner" ? overview : ""}${results}
        </div></div></div>
        <aside id="rhs"><h3>Knowledge panel</h3><p>Sidebar stays outside cards.</p></aside>
      </div>`
    : `<div id="b_mcw">${overview}<ol id="b_results">${results}<li class="b_pag"><a href="#">Next</a></li></ol>
        <aside id="b_context">Knowledge panel</aside></div>`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      body { margin:0; font:16px Arial,sans-serif; }
      #rcnt { display:grid; grid-template-columns:652px 360px; }
      #center_col { width:652px; }
      #rhs { width:360px; }
      #b_mcw { display:flex; }
      #b_results { display:inline-block; width:648px; padding:0; margin:0; }
      #b_context { width:360px; }
      #ai-overview, #b_copilot_search_container { width:700px; min-height:180px; }
      .wide-overview { width:100%; min-width:0; }
      .overview-column, .overview-body { width:652px; }
      .overview-column summary { cursor:pointer; }
      .ai-grid { display:grid; grid-template-columns:300px 352px; width:652px; }
      .g,.b_algo { margin-bottom:28px; }
      #searchform, #b_header { min-height:48px; }
      #sb_form { display:inline-block; }
      #sb_form .b_logoArea { display:inline-block; width:40px; height:40px; }
      #sb_form .b_searchboxForm { display:inline-flex; margin-left:110px; width:550px; height:40px; }
      #sb_form .b_searchbox { width:770px; }
      #id_h { float:right; width:115px; height:40px; }
      nav { height:32px; }
    </style></head><body>
    ${engine === "bing"
      ? '<header id="b_header"><form id="sb_form"><a class="b_logoArea" href="/">Bing</a><div class="b_searchboxForm"><button>Search</button><input class="b_searchbox" name="q" value="test"><button>Voice</button></div></form><div id="id_h">Account</div></header>'
      : '<header id="searchform"><form><input name="q" value="test"></form></header>'}
    <nav id="unrelated-nav"><a href="#">Navigation</a></nav>
    ${content}<footer id="footer">Pagination</footer>
    </body></html>`;
}
