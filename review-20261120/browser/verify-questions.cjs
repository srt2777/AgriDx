const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const cases = [
  {
    model: '8R-2304(G4)',
    question: '冬季启动前，辅助加热器该如何使用？请引用原手册页码。',
    entryId: 'KB-JD-8RG4-OMTA30801-G3-CN-100',
    answerTerms: ['已浸入冷却液', '接地故障保护', '074001', '075000'],
    irrelevantTerms: ['座椅'],
    printedPage: '20A-2'
  },
  {
    model: '5E-850',
    question: '换了前大灯后怎么在墙上检查近光高度？',
    entryId: 'KB-JD-5E-OMSU55602-G9-SV-F0526BDC',
    answerTerms: ['7.5 米', '10%'],
    irrelevantTerms: [],
    printedPage: '110-4'
  }
];

async function check() {
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE });
  try {
    const page = await browser.newPage();
    await page.goto(process.argv[2] || 'https://agridx-v4-development.orangeglade33.chatgpt.site/');
    await page.getByText('知识库', { exact: true }).first().click();
    await page.waitForFunction(() => performance.getEntriesByType('resource').some(e => /\/api-[^/]+\.js$/.test(e.name)));
    const results = await page.evaluate(async cases => {
      let api;
      for (const resource of performance.getEntriesByType('resource')) {
        if (/\/api-[^/]+\.js$/.test(resource.name)) {
          api = (await import(resource.name)).previewFetch;
          if (api) break;
        }
      }
      const results = [];
      for (const item of cases) {
        const response = await api('/api/chat', {
          method: 'POST',
          body: JSON.stringify({
            diagnosisMode: 'knowledge_only', machineType: '拖拉机', brand: '约翰迪尔', model: item.model,
            messages: [{ role: 'user', content: item.model + ' ' + item.question }]
          })
        });
        const data = await response.json();
        const first = data.knowledgeSources?.[0];
        results.push({
          model: item.model, question: item.question, status: response.status,
          entryId: first?.entryId, locator: first?.locator,
          answer: data.choices?.[0]?.message?.content || ''
        });
      }
      return { commit: document.querySelector('meta[name="agridx-build-commit"]').content, results };
    }, cases);
    console.log(JSON.stringify(results, null, 2));
    for (const [i, row] of results.results.entries()) {
      const item = cases[i];
      assert.equal(row.status, 200);
      assert.equal(row.entryId, item.entryId);
      assert.ok(row.locator.includes(item.printedPage));
      const answer = row.answer.split('\n\n')[0];
      for (const term of item.answerTerms) assert.ok(row.answer.includes(term), term);
      for (const term of item.irrelevantTerms) assert.ok(!answer.includes(term), term);
    }
  } finally {
    await browser.close();
  }
}
check().catch(error => { console.error(error); process.exitCode = 1; });
