import { searchPage } from "./search-page.mjs";

// Native logo/account controls stay at their original positions. Exercise both
// a form-sized input and Google's nested visible-field structure with flex parents.
export function googleHeaderPage({ ai = false, inner = false, sidebar = true } = {}) {
  let html = searchPage({ ai, count:10 }).replace(
    '<header id="searchform"><form><input name="q" value="test"></form></header>',
    `<style>
      body { background:#1b1b1b; color:#ddd; }
      #searchform { position:static; height:88px; }
      #google-logo { position:absolute; left:32px; top:24px; color:#77aaff; font-size:25px; }
      #tsf { display:flex; align-items:center; gap:14px; box-sizing:border-box;
        margin:12px 0 0 180px; width:min(1100px, calc(100vw - 440px)); height:52px;
        border:1px solid #555; border-radius:28px; padding:0 20px; }
      #tsf input { flex:1; min-width:0; background:transparent; color:inherit; border:0; }
      #search-actions { display:flex; gap:14px; flex:none; }
      #gb { position:absolute; right:32px; top:20px; display:flex; align-items:center; gap:16px; }
      #customize { background:#142b80; color:white; border:1px solid #7582d8; padding:8px; }
      #account { width:32px; height:32px; border-radius:50%; background:#258b65; }
      @media(max-width:767px) {
        #searchform { height:124px; }
        #tsf { margin:68px 16px 0; width:calc(100vw - 32px); }
        #gb { right:16px; top:16px; }
        #google-logo { left:16px; }
      }
      ${inner ? `
        #tsf { border:0; padding:0; width:auto; margin-left:0; display:block; flex:1; }
        .A8SBwf { display:flex; align-items:center; gap:14px; box-sizing:border-box;
          margin-left:180px; width:min(1100px,calc(100vw - 440px)); height:52px;
          border:1px solid #555; border-radius:28px; padding:0 20px; }
        #sf { display:flex; justify-content:center; }
        @media(max-width:767px) { .A8SBwf { margin-left:16px; width:calc(100vw - 32px); } }
      ` : ""}
    </style>
    <header id="searchform"><a id="google-logo">Google</a>
      <div id="sfcnt"><div id="sf"><form id="tsf" role="search" ${!inner ? 'style="max-width:1120px !important;margin-right:4px"' : ""}>
        ${inner ? '<div class="A8SBwf" style="max-width:1120px !important;margin-right:4px">' : ""}
        <input name="q" value="deepseek harness 安装部署">
        <div id="search-actions"><button type="button">语音</button><button type="button">图片</button></div>
        ${inner ? '</div>' : ""}
      </form></div></div>
      <div id="gb"><button id="customize" type="button">自定义</button><button type="button">应用</button><div id="account"></div></div>
    </header>`,
  );
  if (!sidebar) html = html.replace(/<aside id="rhs">[\s\S]*?<\/aside>/, "");
  return html;
}
