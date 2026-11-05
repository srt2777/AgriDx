import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Comparison, type ComparisonView } from '../src/pages/WorkbenchPage/Comparison';
const rows = [
 {id:'a',label:'A voltage',unit:'V',points:[{at:1000,value:10},{at:2000,value:20}]},
 {id:'b',label:'B voltage',unit:'V',points:[{at:1000,value:30},{at:2000,value:40}]},
];
const render = (view:ComparisonView, data=rows) => renderToStaticMarkup(createElement(Comparison,{rows:data,view,lang:'zh',sampleMs:1000}));
test('all comparison modes render real samples and labeled series without invalid geometry',()=>{
 for(const view of ['overlay','compare-bars','ratios','numbers'] as const){const html=render(view);assert.match(html,/A voltage/);assert.match(html,/B voltage/);assert.doesNotMatch(html,/NaN|Infinity/);}
 assert.match(render('ratios'),/33.3%/);assert.match(render('ratios'),/66.7%/);
 assert.match(render('overlay'),/共同时间游标/);
});
test('mixed units normalize comparison and do not generate a combined share chart',()=>{
 const mixed=[rows[0],{...rows[1],unit:'A'}];
 assert.match(render('overlay',mixed),/每路按自己的仿真量程归一化/);
 assert.doesNotMatch(render('ratios',mixed),/所选读数占比/);
 assert.doesNotMatch(render('ratios',rows.map(r=>({...r,unit:'°C'}))),/所选读数占比/);
 assert.match(render('numbers',[]),/选择两路以上/);
});
