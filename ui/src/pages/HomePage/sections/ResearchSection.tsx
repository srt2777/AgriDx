import { ArrowUpRight, BookOpen } from 'lucide-react';
import { useLang } from '@/hooks/useLang';

export default function ResearchSection() {
  const lang = useLang();
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const papers = [
    {
      year: '2025', venue: t('农业工程学报 期刊论文', 'Transactions of the CSAE journal paper'),
      title: t('基于大语言模型与知识图谱的水稻病虫害专家系统', 'Rice pest and disease expert system using LLMs and knowledge graphs'),
      insight: t('借鉴实体、属性与关系的分阶段整理方法，让农业资料逐步形成可核对的结构。', 'Stage the extraction of entities, attributes and relationships to organize agricultural documents into a checkable structure.'),
      boundary: t('研究对象为水稻病虫害；论文效果不代表本项目农机诊断效果。', 'The study concerns rice pests and diseases; its results are not this platform’s machinery diagnosis results.'),
      url: 'https://www.aeeisp.com/nygcxb/article/doi/10.11975/j.issn.1002-6819.202504254',
    },
    {
      year: '2026', venue: 'AAAI ' + t('会议论文', 'conference paper'),
      title: 'You Don’t Need Pre-Built Graphs for RAG: Retrieval Augmented Generation with Adaptive Reasoning Structures',
      insight: t('复杂故障可以拆成相互依赖的子问题，按顺序取证，再综合判断。', 'Split complex questions into dependent subquestions, retrieve evidence in order, then combine the findings.'),
      boundary: t('作为诊断链路研究参考；当前未实现论文提出的自适应推理结构。', 'A reference for diagnostic research; the proposed adaptive reasoning structures are not implemented here.'),
      url: 'https://ojs.aaai.org/index.php/AAAI/article/view/40278',
    },
    {
      year: '2026', venue: 'arXiv ' + t('预印本', 'preprint'),
      title: 'Use Graph When It Needs: Efficiently and Adaptively Integrating Retrieval-Augmented Generation with Graphs',
      insight: t('根据问题复杂度选择检索方式，为后续兼顾证据深度与响应成本提供研究方向。', 'Choose retrieval approaches based on question complexity to study the trade-off between evidence depth and response cost.'),
      boundary: t('当前仍使用本地资料检索；尚未接入图检索或论文中的学习策略。', 'The platform currently retrieves local documents; graph retrieval and the paper’s learned strategy are not connected.'),
      url: 'https://arxiv.org/abs/2602.03578',
    },
  ];
  return <section id="research" className="research-section" data-home-beat="research" data-home-side="end">
    <div className="page-container">
      <div className="research-heading"><div className="section-heading"><div className="section-eyebrow">{t('研究依据 面向下一步', 'RESEARCH REFERENCES INFORMING WHAT’S NEXT')}</div><h2>{t('有论文启发，也有实测边界。', 'Research informs. Validation distinguishes.')}</h2><p className="mt-4">{t('从农业知识组织到按需检索，把研究思路转成可验证的建设步骤。论文结论、当前能力和本项目效果分别说明。', 'From agricultural knowledge organization to adaptive retrieval, translate research ideas into verifiable steps. Paper findings, current capabilities and project outcomes remain distinct.')}</p></div><BookOpen size={42} strokeWidth={1.1} aria-hidden="true" /></div>
      <div className="research-grid">{papers.map(paper => <article className="research-paper" key={paper.url}><div className="research-paper-meta"><span>{paper.year}</span><span>{paper.venue}</span></div><h3><a href={paper.url} target="_blank" rel="noreferrer">{paper.title}</a></h3><p>{paper.insight}</p><div className="research-paper-boundary">{paper.boundary}</div><a className="hero-text-link" href={paper.url} target="_blank" rel="noreferrer">{t('阅读原文', 'Read the paper')}<ArrowUpRight size={15} /></a></article>)}</div>
      <p className="research-verification-note">{t('本轮改进的可检查结果：资料能按层级浏览、来源与缺口可见、诊断可携带机型。诊断准确率、维修效率与减损效果仍需独立评测。', 'Checkable outcomes of this iteration: hierarchical browsing, visible sources and gaps, and machine-aware diagnosis handoff. Accuracy, repair efficiency and loss reduction still need independent evaluation.')}</p>
    </div>
  </section>;
}
