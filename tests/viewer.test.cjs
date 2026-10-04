// Browser tests use only synthetic fixtures. The shipped HTML needs no Node/npm.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'claude_viewer.html'),'utf8').replace(/\r\n/g,'\n');
const out=path.join(root,'_local','tests');
const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const zipContext={module:{exports:{}},exports:{},setTimeout,clearTimeout,setImmediate,Uint8Array,Uint16Array,Uint32Array,ArrayBuffer,Buffer,Promise};
vm.runInNewContext(scripts.find(s=>s.includes('/* JSZip 3.10.1 */')),zipContext);
const Zip=zipContext.module.exports;
const stamp='2026-10-04T00:00:00Z';
const attack='<img src="data:image/png;base64,broken" onerror="window.__xss=1"><svg onload="window.__xss=2"></svg><a href="javascript:window.__xss=3">danger</a><script>window.__xss=4</script><div data-export-memory="0" id="exp-md" style="position:fixed" class="modal">plain</div><img src="https://example.invalid/tracker.png"><iframe src="https://example.invalid/"></iframe><form><button formaction="https://example.invalid/">submit</button></form><math><mtext><img src=x onerror="window.__xss=5"></mtext></math>';
const rich='# Heading\n\n**bold** and $x^2+1$\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```html\n<img onerror="literal code">\n```\n\n<details><summary>More</summary>folded text</details>\n\n'+attack;
const tool='工具结果\n'.repeat(1000)+'TOOL_END';
const attachment='附件正文\n'.repeat(150)+'ATTACHMENT_END';
const thinking='思考过程\n'.repeat(250)+'THINKING_END';
const conversation={uuid:'11111111-1111-1111-1111-111111111111',name:'完整性与安全测试',created_at:stamp,updated_at:stamp,chat_messages:[
  {uuid:'m1',sender:'human',created_at:stamp,content:[{type:'text',text:'请检查这段记录'}]},
  {uuid:'m2',sender:'assistant',created_at:stamp,content:[
    {type:'thinking',thinking,summaries:[{summary:'摘要 '+attack}]},
    {type:'tool_use',name:'本地工具',input:{query:'INPUT_END',html:attack}},
    {type:'tool_result',content:tool},
    {type:'text',text:rich}
  ],attachments:[{file_name:'附件.txt',extracted_content:attachment}]}
]};
let browser;
async function zipBuffer(entries){
  const z=new Zip();for(const [name,value]of Object.entries(entries))z.file(name,JSON.stringify(value));
  return z.generateAsync({type:'nodebuffer'});
}
async function session(t,{instrument=false,width=1280}={}){
  const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true});
  t.after(()=>context.close());
  await context.setOffline(true);
  await context.addInitScript(()=>{localStorage.setItem('cv_cachemode','never');});
  const page=await context.newPage();
  const requests=[],errors=[];
  context.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(root,instrument?'_local/tests/instrumented.html':'claude_viewer.html')).href);
  await page.waitForFunction(()=>typeof window.DOMPurify==='function');
  return{page,context,requests,errors};
}
async function importOld(page){
  await page.locator('#file-input').setInputFiles({name:'legacy.zip',mimeType:'application/zip',buffer:await zipBuffer({
    'conversations.json':[conversation],
    'users.json':[{uuid:'test-user',full_name:'Synthetic'}],
    'memories.json':[{conversations_memory:rich,memory_files:[{path:'memory.md',content:rich}]}]
  })});
  await page.locator('#main-screen').waitFor({state:'visible'});
}
async function downloadText(page,click){
  const downloaded=page.waitForEvent('download');await click();
  const d=await downloaded;return fs.readFileSync(await d.path(),'utf8');
}
before(async()=>{
  fs.mkdirSync(out,{recursive:true});
  // Expose pure helpers in a test-only copy, never in the delivered application.
  const seam='})();\n</script>\n</body>';
  assert.equal(html.split(seam).length,2);
  fs.writeFileSync(path.join(out,'instrumented.html'),html.replace(seam,
    'window.__test={safeMarkdown,convToMd,buildPrintHtml,renderMdForExport,loadExportFolder,checkExportSet,getData:()=>appData};\n'+seam));
  browser=await chromium.launch({headless:true,...(process.env.TEST_BROWSER_CHANNEL?{channel:process.env.TEST_BROWSER_CHANNEL}:{})});
});
after(async()=>{if(browser)await browser.close();});

test('original HTML: legacy ZIP import, full single and batch Markdown downloads',async t=>{
  const {page,requests,errors}=await session(t);
  await importOld(page);
  await page.locator('#sb-scroll .s-card').first().click();
  const md=await downloadText(page,()=>page.locator('#exp-md').click());
  for(const tail of ['TOOL_END','ATTACHMENT_END','THINKING_END','INPUT_END'])assert.ok(md.includes(tail),tail);
  assert.ok(!md.includes('已截断'));
  const got=page.waitForEvent('download');await page.getByText('↓ 全部导出',{exact:true}).click();
  const z=await Zip.loadAsync(fs.readFileSync(await(await got).path()));
  const files=Object.values(z.files).filter(f=>!f.dir);
  assert.equal(files.length,1);
  assert.equal(await files[0].async('string'),md);
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});

test('original HTML: chat and both memory views sanitize active HTML while retaining formatting',async t=>{
  const {page,requests,errors}=await session(t);
  await importOld(page);await page.locator('#sb-scroll .s-card').first().click();
  const bubble=page.locator('.bubble.assistant');
  assert.equal(await bubble.locator('table').count(),1);
  assert.ok(await bubble.locator('.katex').count()>0);
  assert.equal(await bubble.locator('pre code').textContent(),'<img onerror="literal code">\n');
  assert.equal(await bubble.locator('details').count(),1);
  assert.equal(await bubble.locator('[onerror],[onload],script,svg,[data-export-memory],#exp-md').count(),0);
  assert.equal(await bubble.locator('a').getAttribute('href'),null);
  await bubble.locator('summary').click();
  assert.equal(await bubble.locator('details').getAttribute('open'),'');
  await page.locator('[data-tab="memories"]').click();
  const cards=page.locator('#sb-scroll .s-card');assert.equal(await cards.count(),2);
  for(let i=0;i<2;i++){
    await cards.nth(i).click();
    assert.equal(await page.locator('.mem-md [onerror],.mem-md script,.mem-md svg,.mem-md [data-export-memory]').count(),0);
    assert.equal(await page.locator('.mem-md table').count(),1);
  }
  assert.equal(await page.evaluate(()=>window.__xss||0),0);
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});

test('original HTML: PDF options, full print output and script prohibition',async t=>{
  const {page,context,requests,errors}=await session(t);
  await importOld(page);await page.locator('#sb-scroll .s-card').first().click();
  await page.locator('#exp-pdf').click();
  assert.equal(await page.locator('#pdf-tools').isChecked(),false);
  assert.equal(await page.locator('#pdf-attachments').isChecked(),false);
  await page.locator('#pdf-tools').check();await page.locator('#pdf-attachments').check();
  await page.evaluate(()=>{
    const original=window.open;window.open=function(...args){
      const win=original.apply(this,args);if(win)win.print=()=>{window.__printCalls=(window.__printCalls||0)+1;};return win;
    };
  });
  const next=page.waitForEvent('popup');await page.locator('#pdf-print').click();
  const popup=await next;await popup.waitForLoadState();
  await popup.waitForFunction(()=>Array.from(document.querySelectorAll('details')).every(d=>d.open));
  await page.waitForFunction(()=>window.__printCalls===1);
  const body=await popup.locator('body').textContent();
  for(const tail of ['TOOL_END','ATTACHMENT_END','THINKING_END','INPUT_END'])assert.ok(body.includes(tail),tail);
  assert.equal(await popup.locator('script,[onerror],[onload],a[href^="javascript:"]').count(),0);
  assert.equal(await popup.evaluate(()=>window.__xss||0),0);
  assert.ok(await popup.locator('.katex').count()>0);
  assert.match(await popup.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'),/script-src 'none'/);
  // Browser execution, not a string assertion: injected inline handlers must be blocked by print CSP.
  await popup.evaluate(()=>{
    const b=document.createElement('button');b.setAttribute('onclick','window.__printScriptExecuted=1');document.body.append(b);b.click();b.remove();
  });
  assert.equal(await popup.evaluate(()=>window.__printScriptExecuted||0),0);
  await popup.pdf({path:path.join(out,'print-preview.pdf'),format:'A4',printBackground:true});
  await popup.screenshot({path:path.join(out,'print-preview.png'),fullPage:false});
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});

test('print defaults retain full thinking and omit only optional tool and attachment bodies',async t=>{
  const {page}=await session(t,{instrument:true});
  const result=await page.evaluate(c=>{
    const d=new DOMParser().parseFromString(__test.buildPrintHtml(c,c.chat_messages),'text/html');
    return{body:d.body.textContent,code:d.querySelector('pre code').textContent,tools:d.querySelectorAll('.tool').length};
  },conversation);
  assert.ok(result.body.includes('THINKING_END'));assert.ok(result.body.includes('附件.txt'));
  assert.ok(!result.body.includes('TOOL_END'));assert.ok(!result.body.includes('ATTACHMENT_END'));
  assert.equal(result.tools,0);assert.equal(result.code,'<img onerror="literal code">\n');
});

test('sanitizer fail-closed fallback and long export boundary checks',async t=>{
  const {page,requests}=await session(t,{instrument:true});
  for(const size of [499,500,501,799,800,801,3999,4000,4001,20000]){
    const text='x'.repeat(size)+'END_'+size;
    const c=structuredClone(conversation);
    c.chat_messages[1].content=[{type:'thinking',thinking:text},{type:'tool_result',content:text}];
    c.chat_messages[1].attachments=[{file_name:'a',extracted_content:text}];
    const result=await page.evaluate(c=>({md:__test.convToMd(c,c.chat_messages),pdf:__test.buildPrintHtml(c,c.chat_messages,{tools:true,attachments:true})}),c);
    assert.equal(result.md.split('END_'+size).length-1,3);
    assert.equal(result.pdf.split('END_'+size).length-1,3);
  }
  const result=await page.evaluate(raw=>{
    const sanitizer=window.DOMPurify;
    window.DOMPurify=undefined;
    const missing=__test.safeMarkdown(raw),print=__test.renderMdForExport(raw);
    window.DOMPurify={isSupported:true,sanitize(){throw new Error('test failure');}};
    const failed=__test.safeMarkdown(raw);
    window.DOMPurify=sanitizer;
    const d=document.createElement('div');d.innerHTML=missing;document.body.append(d);
    return{missing,failed,print,text:d.textContent,unsafe:d.querySelectorAll('script,img,a').length};
  },attack);
  assert.equal(result.missing,result.failed);assert.equal(result.missing,result.print);
  assert.equal(result.text,attack);assert.equal(result.unsafe,0);
  assert.deepEqual(requests,[]);
});

test('folder import: manifest and split ZIPs populate all categories; missing part is reported',async t=>{
  const {page,requests,errors}=await session(t,{instrument:true});
  const entries={
    'conversations-000.zip':{'conversations.json':[conversation]},
    'conversations-001.zip':{'conversations.json':[{...conversation,uuid:'22222222-2222-2222-2222-222222222222'}]},
    'projects-000.zip':{'projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json':{uuid:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',name:'test project',prompt_template:'test'}},
    'memories-000.zip':{'memories/test-user.json':{conversations_memory:'MEMORY',memory_files:[{path:'m.md',content:'FILE_MEMORY'}]}},
    'feedback-000.zip':{'reflections/test-user.json':{reflections:[]}},
    'light_metadata-000.zip':{'users.json':[{uuid:'test-user',full_name:'Synthetic'}],'login_history.json':{login_events:[]}}
  };
  const files=[];for(const[name,content]of Object.entries(entries))files.push({name,bytes:Array.from(await zipBuffer(content))});
  const result=await page.evaluate(async files=>{
    const manifest={created_at:'2026-10-04',data_files:files.map(f=>({filename:f.name}))};
    const picked={name:'synthetic-folder',files:files.map(f=>({path:f.name,file:new File([new Uint8Array(f.bytes)],f.name)}))};
    picked.files.push({path:'manifest-test.json',file:new File([JSON.stringify(manifest)],'manifest-test.json')});
    await __test.loadExportFolder(picked);
    const data=__test.getData();
    return{convs:data.convs.length,projects:data.projects.length,memory:data.memories.conversations_memory,
      memoryFiles:data.globalMemory.length,reflections:data.reflections.reflections.length,login:data.loginHistory.length,
      user:data.account.full_name,missing:__test.checkExportSet({files:manifest.data_files},files.slice(1).map(f=>f.name))};
  },files);
  assert.deepEqual(result,{convs:2,projects:1,memory:'MEMORY',memoryFiles:1,reflections:0,login:0,user:'Synthetic',
    missing:{strict:true,total:6,missing:['conversations-000.zip']}});
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});

test('original HTML: PDF options fit a narrow dark viewport and Escape restores focus',async t=>{
  const {page,errors}=await session(t,{width:390});
  await page.locator('#demo-btn').click();
  await page.locator('#dark-btn').click();
  await page.locator('#sb-scroll .s-card').first().click();
  await page.locator('#exp-pdf').click();
  const box=await page.locator('#pdf-options').boundingBox();
  assert.ok(box.x>=0&&box.x+box.width<=390);
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.screenshot({path:path.join(out,'mobile-dark.png')});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#pdf-options').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'exp-pdf');
  assert.deepEqual(errors,[]);
});
