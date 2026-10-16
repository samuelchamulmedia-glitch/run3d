import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4186/');
 await page.getByRole('tab',{name:'Data',exact:true}).click();
 await page.getByLabel('Data position',{exact:true}).selectOption('middle');
 await page.getByLabel('Data alignment',{exact:true}).selectOption('center');
 await page.getByLabel('Data size',{exact:true}).selectOption('large');
 await page.getByLabel('Panel color',{exact:true}).fill('#eee8dd');
 await page.getByLabel('Text color',{exact:true}).fill('#202b32');
 await page.screenshot({path:'evidence/aesthetics-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'evidence/aesthetics-mobile.png'});
 const box=await page.evaluate(()=>({w:document.documentElement.scrollWidth,v:innerWidth}));assert(box.w<=box.v);
 await page.getByRole('tab',{name:'Style',exact:true}).click();
 await page.getByLabel('Scene background',{exact:true}).fill('#162536');
 assert.deepEqual(errors,[]);console.log('Desktop/mobile controls passed; no page errors or horizontal overflow.');
} finally {await browser.close();}
