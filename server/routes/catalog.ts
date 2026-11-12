import { getLiterature } from '../knowledge/literature';
import { Router } from 'express';
import { CATALOG_FILTER_KEYS, canonicalCatalogBrand, validCatalogCondition, type CatalogFilters } from '../../shared/knowledge-catalog';
import type { ServerRuntime } from '../runtime';
import { getCausalEdges } from '../knowledge/causal';
import { pageKnowledgeRelations, relationsForCatalog } from '../knowledge/relations';
import { getCommunityReports, pageCommunityReports } from '../knowledge/community-reports';

export function createCatalogRoutes(getCatalog: ServerRuntime['getCatalog']): Router {
  const router = Router();
  router.get('/knowledge/literature', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(await getLiterature(new URL(req.originalUrl, 'http://localhost').searchParams)); }
    catch (error) {
      if (error instanceof RangeError) { res.status(400).json({error: error.message}); return; }
      console.error('[literature]', error); res.status(503).json({error: '文献目录暂时不可用，请稍后重试。'});
    }
  });
  router.get('/knowledge/causal-edges', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(getCausalEdges()); }
    catch (error) { console.error('[causal-edges] unexpected error:', error); res.status(500).json({ error: '因果边暂时无法读取。', code: 'causal_edges_unavailable' }); }
  });
  router.get('/knowledge/relations', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(pageKnowledgeRelations(relationsForCatalog(getCatalog()), new URL(req.originalUrl, 'http://localhost').searchParams)); }
    catch (error) { if (error instanceof RangeError) { res.status(400).json({ error: error.message, code: 'bad_request' }); return; } console.error('[relations] unexpected error:', error); res.status(500).json({ error: '知识关系暂时无法读取。', code: 'relations_unavailable' }); }
  });
  router.get('/knowledge/community-reports', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const params = new URL(req.originalUrl, 'http://localhost').searchParams;
      const readFilter = (field: string): string | undefined => {
        const value = params.get(field);
        if (value === null) return undefined;
        if (!value.trim() || value.length > 100) {
          throw new RangeError('社区报告筛选须为非空文本（各上限100字符）');
        }
        return value.trim();
      };
      const brand = canonicalCatalogBrand(readFilter('brand'));
      const model = readFilter('model');
      const component = readFilter('component');
      if ((model && !brand) || (component && !model)) {
        res.status(400).json({ error: '请依次选择品牌、完整型号、组件', code: 'bad_request' });
        return;
      }
      const set = getCommunityReports();
      const reports = (brand || model || component)
        ? set.reports.filter((report) =>
          (!brand || report.brand === brand) && (!model || report.model === model) && (!component || report.componentId === component))
        : set.reports;
      if (reports.length === 0) {
        res.status(404).json({ error: '未找到对应的社区报告', code: 'community_report_not_found' });
        return;
      }
      const selected = reports === set.reports ? set : { ...set, reports, totalReports: reports.length };
      res.json(pageCommunityReports(selected, params));
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: error.message, code: 'bad_request' }); return; }
      console.error('[community-reports] unexpected error:', error);
      res.status(500).json({ error: '社区报告暂时无法读取。', code: 'community_reports_unavailable' });
    }
  });
  router.get('/knowledge/catalog', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const filters: CatalogFilters = {};
    for (const field of CATALOG_FILTER_KEYS) {
      const value = req.query[field];
      if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > 100)) {
        res.status(400).json({ error: '目录筛选须为非空文本（各上限100字符）', code: 'bad_request' });
        return;
      }
      if (typeof value === 'string') {
        if (!validCatalogCondition(field, value.trim())) {
          res.status(400).json({ error: '配置或排放筛选值无效', code: 'bad_request' });
          return;
        }
        Object.assign(filters, { [field]: value.trim() });
      }
    }
    if ((filters.model && !filters.brand) || (filters.component && !filters.model) || (filters.part && !filters.component)) {
      res.status(400).json({ error: '请依次选择品牌、完整型号、组件和零部件', code: 'bad_request' });
      return;
    }
    try {
      res.json(getCatalog(filters));
    } catch (error) {
      if (error instanceof RangeError) {
        res.status(404).json({ error: error.message, code: 'knowledge_not_found' });
        return;
      }
      console.error('[catalog] unexpected error:', error);
      res.status(500).json({ error: '知识目录暂时无法读取，请稍后重试', code: 'catalog_unavailable' });
    }
  });
  return router;
}
