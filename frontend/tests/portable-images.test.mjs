import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownImageRanges, transformMarkdownImages, rebaseMarkdownImages } from '../src/portable-images.js';
import { protectEmbeddedImages, exceedsAIInputLimit } from '../src/ai-input.js';
import { detectAISensitiveContent, restoreAISensitiveContent, restoreAISuggestions } from '../src/ai-privacy.js';

const data = 'data:image/webp;base64,UklGRg==';

test('portable markdown preserves code, escaped images, titles and ordinary links', async () => {
 const source='![a](a.webp "title")\n\n`![a](a.webp)`\n\n\\![a](a.webp)\n\n```md\n![a](a.webp)\n```\n\n[text](a.webp)';
 const actual=await transformMarkdownImages(source,()=>data,{portable:true});
 assert.equal(actual,source.replace('![a](a.webp "title")',`![a](<${data}> "title")`));
});
test('reference images are inlined without changing shared link definitions', async()=>{
 const source='![x][id]\n\n![id][]\n\n![id]\n\n[text][id]\n\n[id]: <a.webp> "title"';
 const actual=await transformMarkdownImages(source,()=>data,{portable:true});
 assert.equal((actual.match(/data:image/g)||[]).length,3);
 assert.ok(actual.endsWith('[text][id]\n\n[id]: <a.webp> "title"'));
});
test('nested quotes, list code, and repeated identical image sources use exact offsets', async()=>{
 const source='> ```\n> ![x](a.webp)\n> ```\n>\n> ![x](a.webp)\n\n- `![x](a.webp)` and ![x](a.webp)';
 const result=await transformMarkdownImages(source,()=>data,{portable:true});
 assert.equal((result.match(/data:image/g)||[]).length,2);
 assert.ok(result.includes('> ![x](a.webp)\n> ```'));
 assert.ok(result.includes('`![x](a.webp)`'));
});
test('HTML image source replacement retains width and excludes comments',async()=>{
 const source='<div><img src="a.webp" width="50%"><!-- <img src="keep.webp"> --></div>';
 const result=await transformMarkdownImages(source,()=>data,{portable:true});
 assert.equal(result,`<div><img src="${data}" width="50%"><!-- <img src="keep.webp"> --></div>`);
 assert.equal(markdownImageRanges("<img src='a.webp'>")[0].ref,'a.webp');
});
test('portable exports stop on remote, missing and complex images instead of partial export',async()=>{
 await assert.rejects(transformMarkdownImages('![x](https://example.com/a.webp)',()=>{throw Error('must not fetch')},{portable:true}),/PORTABLE_REMOTE/);
 await assert.rejects(transformMarkdownImages('![x](a.webp)',()=>'',{portable:true}),/PORTABLE_IMAGE_MISSING/);
 await assert.rejects(transformMarkdownImages('<img src="a.webp" srcset="b.webp 2x">',()=>data,{portable:true}),/PORTABLE_UNSUPPORTED/);
});
test('size and image-count limits prevent unreadable portable output',async()=>{
 await assert.rejects(transformMarkdownImages('![x](a.webp)',()=> 'data:image/png;base64,'+'A'.repeat(64*1024*1024),{portable:true}),/PORTABLE_TOO_LARGE/);
 await assert.rejects(transformMarkdownImages(Array.from({length:257},(_,i)=>`![x](${i}.webp)`).join('\n'),()=>data,{portable:true}),/PORTABLE_IMAGE_LIMIT/);
});
test('repeated images are read only once',async()=>{
 let reads=0;
 await transformMarkdownImages('![a](a.webp) ![b](a.webp)',()=>{reads++;return data},{portable:true});
 assert.equal(reads,1);
});
test('cross-directory save rebases local images, not code or online links',()=>{
 const source='![x](assets/图%20片.webp)\n\n`![x](assets/a.webp)`\n\n![x](https://example.com/a.webp)';
 const rebased=rebaseMarkdownImages(source,'D:\\文档');
 assert.ok(rebased.includes('file:///D:/%E6%96%87%E6%A1%A3/assets/%E5%9B%BE%20%E7%89%87.webp'));
 assert.ok(rebased.includes('`![x](assets/a.webp)`'));
 assert.ok(rebased.includes('https://example.com/a.webp'));
 assert.equal(rebaseMarkdownImages('![x](a.webp)','/home/me'),'![x](<file:///home/me/a.webp>)');
});
test('AI omits encoded images from input limits and restores the exact original',()=>{
 const image='data:image/webp;base64,'+'A'.repeat(2_000_001);
 const source=`# Title\n![x](${image})`;
 const prepared=protectEmbeddedImages(source);
 assert.equal(exceedsAIInputLimit(source),false);
 assert.equal(prepared.text.includes('data:image'),false);
 assert.equal(restoreAISensitiveContent(prepared.text,prepared.replacements),source);
 assert.equal(detectAISensitiveContent('![x](data:image/png;base64,123456789012345678)').length,0);
 assert.throws(()=>restoreAISensitiveContent(prepared.replacements[0].placeholder.repeat(40),prepared.replacements),/AI_RESPONSE_TOO_LARGE/);
});

test('HTML parsing matches the real src attribute rather than data-src or quoted alt text', async()=>{
 const source='<img data-src="keep.webp" alt="src=\'keep.webp\'" src="a.webp" width="50%">';
 assert.equal(await transformMarkdownImages(source,()=>data,{portable:true}),source.replace('src="a.webp"',`src="${data}"`));
 assert.equal(markdownImageRanges('<img src=a.webp>')[0].ref,'a.webp');
});

test('existing embedded images are validated and large encoded lines do not overflow the stack',async()=>{
 const image='data:image/webp;base64,'+'A'.repeat(3_000_001);
 let reads=0;
 const source=`![x](${image})`;
 assert.equal(await transformMarkdownImages(source,ref=>{reads++;return ref},{portable:true}),`![x](<${image}>)`);
 assert.equal(reads,1);
 await assert.rejects(transformMarkdownImages(`![x](${data})`,()=>{throw Error('IMAGE_EMBED_TYPE')},{portable:true}),/IMAGE_EMBED_TYPE/);
});

test('AI review restores within a total byte budget across suggestions',()=>{
 const value='A'.repeat(2_000_001), placeholder='QUILLITE_TEST_IMAGE';
 assert.throws(()=>restoreAISuggestions(Array.from({length:20},()=>({original:placeholder,replacement:placeholder})),[{value,placeholder}]),/AI_RESPONSE_TOO_LARGE/);
});
