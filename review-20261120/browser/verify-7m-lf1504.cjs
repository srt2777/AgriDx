const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const cases = [
  ['约翰迪尔', '7M-2304', '整机序列号 100001', true],
  ['约翰迪尔', '7M-2504', '整机序列号 108901', true],
  ['约翰迪尔', '7M-2304', '整机序列号 100000', false],
  ['约翰迪尔', '7M-2304', '零件号 100001', false],
  ['约翰迪尔', '7M-2304', '', false],
  ['约翰迪尔', '7M-2204', '整机序列号 100001', false],
  ['东方红', 'LF1504', '国三', true],
  ['东方红', 'LF1504', '国四', false],
  ['东方红', 'LF1504-C', '国三', false]
].map(([brand, model, identity, eligible]) => {
  const deere = brand === '约翰迪尔';
  return {
    brand, model, identity, eligible,
    query: deere ? '初级空气滤芯吹洗的气压、喷嘴距离和气流方向，手册怎么说？' : '空调压缩机与风扇供电的保险丝和继电器，手册怎么说？',
    expected: deere ? 'KB-JD-7M-OMAL249107-100001-CN-053' : 'KB-YTO-LF1504-ELEC-007',
    prefix: deere ? 'KB-JD-7M-OMAL249107-' : 'KB-YTO-LF1504-ELEC-',
    page: deere ? '220A-2' : '2-27'
  };
});

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE });
  try {
    const page = await browser.newPage();
    await page.goto(process.argv[2] || 'https://agridx-v4-development.orangeglade33.chatgpt.site/');
    await page.getByText('知识库', { exact: true }).first().click();
    await page.waitForFunction(() => performance.getEntriesByType('resource').some(r => /\/api-[^/]+\.js$/.test(r.name)));
    const report = await page.evaluate(async cases => {
      let api;
      for (const resource of performance.getEntriesByType('resource')) {
        if (/\/api-[^/]+\.js$/.test(resource.name)) {
          api = (await import(resource.name)).previewFetch;
          if (api) break;
        }
      }
      const results = [];
      for (const {brand, model, identity, query, prefix} of cases) {
        const content = [brand, model, identity, query].filter(Boolean).join(' ');
        const response = await api('/api/chat', {
          method: 'POST',
          body: JSON.stringify({ diagnosisMode: 'knowledge_only', machineType: '拖拉机', brand, model,
            messages: [{role: 'user', content}] })
        });
        const data = await response.json();
        results.push({ content, status: response.status, answer: data.choices?.[0]?.message?.content?.split('\n\n')[0],
          batchCitations: (data.knowledgeSources || []).filter(s => s.entryId?.startsWith(prefix)).map(s => [s.entryId, s.locator]) });
      }
      return {commit: document.querySelector('meta[name="agridx-build-commit"]').content, results};
    }, cases);
    console.log(JSON.stringify(report,null,2));
    for (const [i, row] of report.results.entries()) {
      const test = cases[i];
      assert.equal(row.status, 200);
      if (test.eligible) {
        assert.equal(row.batchCitations[0]?.[0], test.expected);
        assert.ok(row.batchCitations[0][1].includes(test.page));
        if (test.brand === '约翰迪尔') {
          for (const term of ['5 bar','50 mm','3 mm']) assert.ok(row.answer.includes(term), term);
        }
      } else {
        assert.deepEqual(row.batchCitations, [], row.content);
      }
    }
  } finally {
    await browser.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
