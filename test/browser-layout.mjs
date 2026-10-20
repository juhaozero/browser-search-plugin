import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";
import * as esbuild from "esbuild";
import { aiMarkup, resultMarkup, searchPage } from "./fixtures/search-page.mjs";

const executablePath = process.env.CHROME_PATH ?? [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find(existsSync);
if (!executablePath) throw new Error("Set CHROME_PATH to a Chrome/Chromium executable");

test("真实 Chromium：AI、数量、视口、动态插入、还原与观察器释放", async () => {
  const browser = await puppeteer.launch({ executablePath, headless:true, timeout:15000,
    args: process.env.BROWSER_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-gpu"] : [] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const bundle = await esbuild.build({ stdin:{ contents:'export { bootSearchPage } from "./src/content-boot.mjs";',
      resolveDir:process.cwd() }, bundle:true, write:false, format:"iife", globalName:"SearchLayoutTest" });
    const css = await readFile("extension/content.css", "utf8");
    async function load(options, width, mode) {
      await page.setViewport({ width, height:width >= 1920 ? (width === 2560 ? 1440 : 1080) : 844 });
      await page.setContent(searchPage(options));
      await page.addStyleTag({ content:css });
      await page.addScriptTag({ content:bundle.outputFiles[0].text });
      await page.evaluate(async ({ engine, mode }) => {
        // Count active native observers and callbacks, without changing their semantics.
        const NativeObserver = window.MutationObserver;
        window.observerStats = { active:0, callbacks:0 };
        window.MutationObserver = class extends NativeObserver {
          constructor(callback) { super((...args) => { observerStats.callbacks++; callback(...args); }); }
          observe(...args) { if (!this.attached) observerStats.active++; this.attached=true; return super.observe(...args); }
          disconnect() { if (this.attached) observerStats.active--; this.attached=false; super.disconnect(); }
        };
        window.boot = await SearchLayoutTest.bootSearchPage(document, `https://www.${engine}.com/search?q=test`, {},
          { prefs:{ columnMode:mode, autoPage:false }, attachScroll:false });
      }, { engine:options.engine ?? "google", mode });
    }
    async function geometry() {
      return page.evaluate(() => {
        const rect = el => { const r=el.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom }; };
        const box = document.getElementById("bsp-results");
        return { box:rect(box), cards:[...box.children].map(rect), ai:document.getElementById("ai-overview") ? rect(document.getElementById("ai-overview")) : null,
          navBorder:getComputedStyle(document.getElementById("unrelated-nav")).borderTopWidth,
          aiInner:document.querySelector(".ai-inner")?.getAttribute("style"),
          rhsVisible:document.getElementById("rhs") ? getComputedStyle(document.getElementById("rhs")).display !== "none" : true };
      });
    }
    let scenarios = 0;
    for (const engine of ["google", "bing"]) for (const mode of ["single-center", "double"]) {
      for (const width of [1920,2560,390,320]) for (const count of [3,10]) {
        let baseline;
        for (const ai of [false,true]) {
          await load({ engine,count,ai }, width,mode);
          const g=await geometry();
          const label=JSON.stringify({engine,mode,width,count,ai});
          assert.equal(g.cards.length,count,label);
          if (!ai) baseline=g;
          else {
            assert.ok(Math.abs(g.box.width-baseline.box.width)<1,`${label}: ${JSON.stringify({baseline,g})}`);
            assert.ok(Math.abs(g.cards[0].width-baseline.cards[0].width)<1,label);
            assert.ok(g.ai.bottom<=g.box.y+1,label);
            assert.equal(g.aiInner,'display:flex;gap:13px',label);
          }
          const columns=mode === "double" && width>=768 ? 2 : 1;
          assert.ok(Math.abs(g.cards[0].width-(g.box.width-(columns-1)*24)/columns)<1,label);
          assert.ok(g.box.right<=width && g.box.x>=0,label);
          assert.equal(g.navBorder,"0px",label);
          assert.equal(g.rhsVisible,true,label);
          for(let i=columns;i<g.cards.length;i++) assert.ok(g.cards[i].y>=g.cards[i-columns].bottom+21,label);
          await page.evaluate(()=>boot.dispose());
          assert.equal(await page.evaluate(()=>observerStats.active),0,label);
          scenarios++;
        }
      }
    }
    // AI inside a native grid must not constrain cards or donate its citation as a card.
    await load({engine:"google",ai:true,placement:"inner",count:3},1920,"double");
    assert.equal((await geometry()).cards.length,3);
    assert.ok((await geometry()).box.width>1000);
    await page.evaluate(()=>boot.dispose());
    // AI arrives beside the result column after initial boot, with unchanged viewport.
    await load({engine:"google",count:3},1920,"double");
    const before=await geometry();
    await page.$eval("#rcnt",(el,html)=>el.insertAdjacentHTML("afterbegin",html),aiMarkup());
    await page.waitForFunction(()=>document.getElementById("rcnt").style.flexWrap === "wrap");
    assert.equal((await geometry()).box.width,before.box.width);
    // A burst of organic results triggers collection once, including newly appended cards.
    await page.$eval("#rso",(el,html)=>el.insertAdjacentHTML("beforeend",html),
      Array.from({length:20},(_,i)=>resultMarkup("google",i+100)).join(""));
    await page.waitForFunction(()=>document.querySelectorAll("#bsp-results > .g").length===23);
    const callbacks=await page.evaluate(()=>observerStats.callbacks);
    await new Promise(resolve=>setTimeout(resolve,400));
    assert.equal(await page.evaluate(()=>observerStats.callbacks),callbacks,"observer feedback loop");
    await page.setViewport({width:390,height:844});
    await page.waitForFunction(()=>document.getElementById("bsp-results").getBoundingClientRect().width<390);
    assert.ok((await geometry()).cards[0].width>250);
    await page.evaluate(()=>boot.applyPrefs({columnMode:"original",autoPage:false}));
    assert.equal(await page.$("#bsp-results"),null);
    assert.equal(await page.$("[data-bsp-results-path]"),null);
    await page.evaluate(()=>boot.dispose());
    assert.equal(await page.evaluate(()=>observerStats.active),0);
    // Exercise fetched-page ingestion in addition to engine-side DOM insertion.
    await load({engine:"google",count:3},1920,"double");
    await page.evaluate(html=>{
      boot.applyPrefs({columnMode:"double",autoPage:true});
      const next=new DOMParser().parseFromString(html,"text/html");
      assertIngest(boot.session.ingest(next));
      function assertIngest(result) { if(result.added!==7) throw new Error("Expected seven fresh results"); }
    },searchPage({engine:"google",count:10,ai:true,placement:"inner"}));
    assert.equal((await geometry()).cards.length,10);
    assert.equal(await page.$("#bsp-results #ai-overview"),null);
    await page.evaluate(()=>boot.dispose());
    // Bing original mode must retain the engine's native 648px width.
    await load({engine:"bing"},1920,"double");
    await page.evaluate(()=>boot.applyPrefs({columnMode:"original",autoPage:false}));
    assert.equal(await page.$eval("#b_results",el=>el.getBoundingClientRect().width),648);
    assert.notEqual(await page.$eval("#b_context",el=>getComputedStyle(el).display),"none");
    await page.evaluate(()=>boot.dispose());
    assert.deepEqual(errors,[]);
    await mkdir(".scratch",{recursive:true});
    await load({engine:"google",ai:true,count:10},1920,"double");
    await page.screenshot({path:".scratch/ai-layout-desktop.png",fullPage:true});
    await page.evaluate(()=>boot.dispose());
    // Run the actual content entry and its History API wrapper on a locally served fixture.
    await page.setRequestInterception(true);
    page.on("request",request=>request.respond({status:200,contentType:"text/html",body:searchPage()}));
    await page.goto("https://www.google.com/search?q=test");
    await page.evaluate(()=>{
      window.chrome = { runtime:{id:"layout-test"}, storage:{
        sync:{get:async()=>({prefs:{columnMode:"double",autoPage:false}})},
        onChanged:{addListener(){},removeListener(){}} } };
    });
    const entry=await esbuild.build({entryPoints:["src/content.mjs"],bundle:true,write:false,format:"iife"});
    await page.addScriptTag({content:entry.outputFiles[0].text});
    await page.waitForFunction(()=>window.__bspContentController?.lifecycle.getActive());
    await page.evaluate(()=>history.replaceState(null,"","/search?q=next"));
    await page.waitForFunction(()=>window.__bspContentController?.lifecycle.getActive() && document.querySelector("#bsp-results"));
    await page.evaluate(()=>window.__bspContentController.disposeAll());
    assert.deepEqual(errors,[]);
    console.log(`Passed ${scenarios} matrix scenarios plus dynamic, responsive, restoration and disposal checks.`);
  } finally { await browser.close(); }
});
