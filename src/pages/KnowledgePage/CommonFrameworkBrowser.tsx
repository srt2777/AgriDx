import { useUiCopy } from '@/ui/useUiCopy';
import { Link } from 'react-router-dom';
import { ArrowRight, ClipboardList } from 'lucide-react';
import { buildCommonDiagnosisQuestion, type CommonKnowledgeFramework } from '@shared/common-knowledge';
import './common-framework.css';

interface Props {
  framework: CommonKnowledgeFramework;
  lang: string;
  onSymptomChange: (id: string) => void;
  diagnosisState: { machineType?: string; brand?: string; model?: string; configurationText?: string };
}

export default function CommonFrameworkBrowser({ framework, lang, onSymptomChange, diagnosisState }: Props) {
  const { t, format, separator } = useUiCopy(lang);
  const symptom = framework.symptoms.find(x => x.id === framework.selectedSymptom);
  const relevantTargets = symptom ? new Set(symptom.performanceIds) : undefined;
  const systems = framework.systems.filter(x => !relevantTargets || x.performanceTargets.some(p => relevantTargets.has(p.id)));
  const prompt = symptom ? buildCommonDiagnosisQuestion(symptom, diagnosisState.configurationText) : '';
  return <section className="common-framework" aria-labelledby="common-framework-heading">
    <div className="common-heading"><div><div className="section-eyebrow">{t('拖拉机通用框架', 'COMMON TRACTOR FRAMEWORK')}</div>
      <h2 id="common-framework-heading">{t('先描述表现，再匹配本机依据。', 'Describe the behavior, then match the machine.')}</h2>
      <p>{t('共用系统、性能与问诊分类。具体原因、检查和处置由对应机型资料提供。', 'Shared systems, performance topics and intake questions. Causes, checks and actions come from the matching machine documents.')}</p></div><ClipboardList size={28} aria-hidden="true" /></div>
    <div className="common-controls"><label><span>{t('运行表现', 'Observed behavior')}</span><select aria-label={t('通用运行表现', 'Common observed behavior')}
      value={framework.selectedSymptom || ''} onChange={e => onSymptomChange(e.target.value)}>
      <option value="">{t('查看全部系统与性能', 'All systems and performance topics')}</option>
      {framework.symptoms.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
    </select></label>{symptom && <Link className="catalog-action" to="/chat" state={{ brand: diagnosisState.brand || '', model: diagnosisState.model || '',
      machineType: diagnosisState.machineType || (symptom.systemIds.includes('navigation') ? '' : '拖拉机'), question: prompt }}>
      {t('带表现去问诊', 'Discuss this behavior')}<ArrowRight size={16} /></Link>}</div>
    {symptom && <div className="common-inquiry"><h3>{t('先记录这些信息', 'Record these details first')}</h3>
      <ul>{framework.questions.map(q => <li key={q}>{q}</li>)}</ul>
      <p>{t('选择下方品牌与完整型号后，可查看关联的原始知识条目。', 'Choose the brand and complete model below to view linked source entries.')}</p></div>}
    <div className="common-matrix-heading"><strong>{t('性能与诊断阶段资料矩阵', 'Performance and diagnostic reference matrix')}</strong>
      <span>{framework.scope === 'model' ? t('当前型号目录 · 配置仍需核对', 'Current model directory · check configuration') : t('库内跨机型线索 · 使用前匹配本机', 'References across models · match before use')}</span></div>
    <p className="common-matrix-note">{t('“有线索”表示已关联相应阶段的资料，完整检查程序、判定参数与实车验证仍须核对。“待补”表示尚未建立该阶段关联。', 'A reference is a linked source for that stage; complete procedures, criteria and field validation still require checking. A gap means no stage reference has been mapped.')}</p>
    <div className="common-systems">{systems.map(system => <details key={system.id}>
      <summary><span>{system.name}</span><small>{t(`${system.performanceTargets.length} 项性能目标`, `${system.performanceTargets.length} performance topics`)}</small></summary>
      <p>{system.configurationNotes}</p>
      <div className="common-table-scroll" tabIndex={0} aria-label={`${system.name} ${t('资料矩阵', 'reference matrix')}`}><table>
        <thead><tr><th scope="col">{t('性能目标', 'Performance topic')}</th>{framework.stages.map(s => <th scope="col" key={s.id}>{s.name}</th>)}</tr></thead>
        <tbody>{system.performanceTargets.filter(target => !relevantTargets || relevantTargets.has(target.id)).map(target => <tr key={target.id}>
          <th scope="row">{target.name}</th>{framework.stages.map(stage => {
            const cell = framework.cells.find(x => x.performanceId === target.id && x.stageId === stage.id)!;
            return <td key={stage.id}><span className={cell.status === 'gap' ? 'common-gap' : 'common-reference'}
              title={cell.entryIds.join('、')}>{cell.status === 'gap' ? t('待补', 'Gap') : t(`有线索 ${cell.entryIds.length}`, `${cell.entryIds.length} refs`)}</span></td>;
          })}</tr>)}</tbody>
      </table></div>
    </details>)}</div>
  </section>;
}
