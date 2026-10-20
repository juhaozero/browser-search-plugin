import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { test } from "node:test";
import puppeteer from "puppeteer-core";
import * as esbuild from "esbuild";
import { googleHeaderPage } from "./fixtures/google-header.mjs";

test("Google 顶栏：搜索框与结果共用中线，Logo/自定义/账号不移动不重叠", async () => {
  const executablePath = process.env.CHROME_PATH ?? [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find(existsSync);
  const browser = await puppeteer.launch({executablePath, headless:true, timeout:15000,
    args:process.env.BROWSER_NO_SANDBOX === "1" ? ["--no-sandbox","--disable-gpu"] : []});
  try {
    const page = await browser.newPage();
    const css = await readFile("extension/content.css","utf8");
    const bundle = await esbuild.build({stdin:{contents:'export { bootSearchPage } from "./src/content-boot.mjs";',resolveDir:process.cwd()},
      bundle:true,write:false,format:"iife",globalName:"SearchLayoutTest"});
    const readHeader = () => page.evaluate(() => {
      const ids=["searchform","sfcnt","sf","tsf","google-logo","gb","customize","account","search-actions"];
      const state = Object.fromEntries(ids.map(id=>{
        const el=document.getElementById(id), r=el.getBoundingClientRect();
        return [id,{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,
          style:el.style.cssText || null,position:getComputedStyle(el).position}];
      }));
      const rect = el => {const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
      state.field = rect(document.querySelector('.A8SBwf') ?? document.getElementById('tsf'));
      state.fieldStyle = (document.querySelector('.A8SBwf') ?? document.getElementById('tsf')).style.cssText || null;
      state.results = document.getElementById('bsp-results') ? rect(document.getElementById('bsp-results')) : null;
      state.query = document.querySelector('[name="q"]').value;
      return state;
    });
    function check(header, baseline, label, centered = true) {
      if (!centered) {
        const {results:unused,...actual}=header;
        const {results:unusedBaseline,...native}=baseline;
        assert.deepEqual(actual,native,`Native header not restored: ${label}`);
      } else {
        for (const id of ["google-logo","gb","customize","account"]) assert.deepEqual(header[id],baseline[id],`${id} moved: ${label}`);
        for (const id of ["searchform","sfcnt","sf"]) assert.equal(header[id].style,baseline[id].style,`${id} rewritten: ${label}`);
        const fieldCenter=(header.field.left+header.field.right)/2;
        const resultCenter=(header.results.left+header.results.right)/2;
        assert.ok(Math.abs(fieldCenter-resultCenter)<1,`Off-center: ${label}: field=${fieldCenter}, results=${resultCenter}`);
        assert.equal(header.field.height,baseline.field.height,`Field height changed: ${label}`);
        assert.equal(header.query,baseline.query);
      }
      for (const id of ["google-logo","customize","account"]) {
        const a=header[id],b=header.field;
        assert.ok(a.right<=b.left || a.left>=b.right || a.bottom<=b.top || a.top>=b.bottom,
          `${id} overlaps search input: ${label}`);
      }
    }
    let scenarios=0;
    for (const width of [1859,1920,2546,1366,1024,390]) for (const ai of [false,true]) for(const inner of [false,true]) for(const sidebar of [false,true]) {
      await page.setViewport({width,height:1080});
      await page.setContent(googleHeaderPage({ai,inner,sidebar}));
      const baseline=await readHeader();
      const nativeForm=await page.$eval('#tsf',el=>el.outerHTML);
      // Capture native responsive geometry independently of extension resize handlers.
      await page.setViewport({width:800,height:1080});
      const resizedBaseline=await readHeader();
      await page.setViewport({width,height:1080});
      await page.addStyleTag({content:css});
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      await page.evaluate(async()=>{window.boot=await SearchLayoutTest.bootSearchPage(document,"https://www.google.com/search?q=test",{},
        {prefs:{columnMode:"double",autoPage:false},attachScroll:false});});
      for(const mode of ["double","single-center","single","original","double"]) {
        await page.evaluate(mode=>boot.applyPrefs({columnMode:mode,autoPage:false}),mode);
        check(await readHeader(),baseline,`${width}px AI=${ai} inner=${inner} sidebar=${sidebar} ${mode}`,mode === "double" || mode === "single-center");
        scenarios++;
      }
      // A late account/customize cluster must also stay out of layout refresh.
      await page.evaluate(()=>{const gb=document.getElementById("gb");gb.replaceWith(gb.cloneNode(true));});
      await new Promise(resolve=>setTimeout(resolve,180));
      check(await readHeader(),baseline,`late controls ${width}`);
      // Google can replace the search form without changing the result shell.
      await page.$eval('#tsf',(el,html)=>{el.outerHTML=html;},nativeForm);
      await new Promise(resolve=>setTimeout(resolve,180));
      check(await readHeader(),baseline,`replacement field ${width}`);
      await page.setViewport({width:800,height:1080});
      await new Promise(resolve=>setTimeout(resolve,180));
      check(await readHeader(),resizedBaseline,`resize ${width}->800`);
      await page.setViewport({width,height:1080});
      await new Promise(resolve=>setTimeout(resolve,180));
      await page.evaluate(()=>document.documentElement.dataset.bspReady="1");
      if(width===1859 && !ai) {
        await mkdir(".scratch",{recursive:true});
        await page.screenshot({path:".scratch/google-header-fixed.png",clip:{x:0,y:0,width,height:300}});
      }
      if(width===2546 && !ai && inner && !sidebar) {
        await mkdir(".scratch",{recursive:true});
        await page.screenshot({path:".scratch/google-header-centered.png",clip:{x:0,y:0,width,height:300}});
        await writeFile(".scratch/google-header-centered.json",JSON.stringify(await readHeader(),null,2));
      }
      await page.evaluate(()=>boot.dispose());
      check(await readHeader(),baseline,`dispose ${width}`,false);
    }
    console.log(`Passed ${scenarios} centered-header mode cases, late controls and resize checks.`);
  } finally { await browser.close(); }
});
