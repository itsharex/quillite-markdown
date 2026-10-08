import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');
function harness() {
 let resolve, reject;
 const promise = new Promise((yes,no)=>{resolve=yes;reject=no;});
 const controls = new Map();
 const control = id => {
  if (!controls.has(id)) controls.set(id, {value:'',textContent:'',classList:{add(){},remove(){}},focus(){},select(){}});
  return controls.get(id);
 };
 const calls=[];
 const state={currentFile:{path:'/old.md',name:'old.md',content:'unsaved',revision:'disk'},savedContent:'baseline',editing:true,dirty:true,documentSession:1};
 const context=vm.createContext({state,$:control,els:{editorFileName:{}},document:{body:{classList:{add(){},remove(){}}},querySelector:()=>null},requestAnimationFrame:callback=>callback(),window:{quilliteMarkdown:{renameDocument:()=>promise}},editorContent:()=>state.currentFile.content,syncDocumentIdentity(){},updateWindowTitle(){},resetDocumentSummary(){},addRecentDocument(){},refreshLibraryAfterReplacement:async()=>{},pathIsInsideRoot:()=>false,refreshExplorer:async()=>{},renderFileList(){},renderCurrentDocument(){},scheduleRecoverySnapshot:()=>calls.push('backup'),showToast:key=>calls.push(key),t:key=>key,authoringError:()=> 'renameFailed',openDocumentConflict:async()=>calls.push('conflict')});
 vm.runInContext(source.slice(source.indexOf('let renameSession = null;'),source.indexOf('function resetDocumentConflict(')),context);
 return {context,state,calls,control,resolve,reject};
}

test('rename preserves unsaved content and saved baseline and schedules recovery',async()=>{
 const h=harness(); h.context.openRenameDocument(); h.control('#renameDocumentName').value='new.md';
 const renaming=h.context.confirmRenameDocument();
 h.state.currentFile.content='later edits';
 h.resolve({path:'/new.md',name:'new.md',content:'baseline',revision:'disk'});
 await renaming;
 assert.equal(h.state.currentFile.content,'later edits');
 assert.equal(h.state.savedContent,'baseline');
 assert.equal(h.state.dirty,true);
 assert.equal(h.state.documentSession,2);
 assert.equal(h.state.saving,false);
 assert.ok(h.calls.includes('backup'));
});

test('late rename cannot replace a different or reopened document',async()=>{
 for (const path of ['/other.md','/old.md']) {
  const h=harness(); h.context.openRenameDocument(); const renaming=h.context.confirmRenameDocument();
  h.state.documentSession++; h.state.currentFile={path,content:'other unsaved'};
  h.resolve({path:'/new.md',name:'new.md',content:'disk'}); await renaming;
  assert.equal(h.state.currentFile.path,path); assert.equal(h.state.currentFile.content,'other unsaved');
  assert.deepEqual(h.calls,[]);
 }
});

test('rename cancellation and existing-name rejection preserve editor identity',async()=>{
 const h=harness(); h.context.openRenameDocument(); h.context.closeRenameDocument();
 await h.context.confirmRenameDocument(); assert.equal(h.state.saving,undefined);
 h.context.openRenameDocument(); const renaming=h.context.confirmRenameDocument();
 h.reject(Error('DOCUMENT_COPY_EXISTS')); await renaming;
 assert.equal(h.state.currentFile.path,'/old.md'); assert.equal(h.state.currentFile.content,'unsaved');
 assert.equal(h.state.dirty,true); assert.equal(h.control('#renameDocumentStatus').textContent,'renameFailed');
 assert.equal(h.control('#confirmRenameDocument').disabled,false);
});

test('portable export cancellation preserves options and missing assets never start writing',async()=>{
 const sourceFunction=source.slice(source.indexOf('async function performExportCenter('),source.indexOf('function openPDFTutorial('));
 for (const missing of [false,true]) {
  let writes=0,closed=false;
  const options={format:'markdown-portable'};
  const context=vm.createContext({state:{editing:false,currentFile:{path:'/a.md',directory:'/',content:'doc'}},els:{exportCenterStatus:{}},setExportInProgress(){},readExportDraft:()=>options,PANDOC_EXPORT_FORMATS:new Set(),transformMarkdownImages:async()=>{if(missing)throw Error('PORTABLE_IMAGE_MISSING');return 'portable';},window:{quilliteMarkdown:{exportPortableMarkdown:async()=>{writes++;return '';}}},showToast(){},authoringError:()=> 'missing',closeExportCenter:()=>{closed=true;},t:key=>key});
  vm.runInContext(sourceFunction,context); await context.performExportCenter();
  assert.equal(writes,missing?0:1); assert.equal(closed,false); assert.equal(context.state.exportDraft,options);
 }
});
