import { describeSource, type KnowledgeChunk } from './retriever';
import { resolveScope, type RetrievalContext } from './scope';
import { buildRoleFlow, formatRoleFlow, hasRoleFlow } from './roles';

/** Without a model service, report retrieved evidence instead of synthesizing a diagnosis. */
export function generateLocalKnowledgeReply(
  query: string,
  retrieved: KnowledgeChunk[],
  opts: RetrievalContext = {},
  fallbackReason?: 'not_configured' | 'provider_unavailable',
  displayQuery: string = query,
  clarificationNeeded: boolean = false,
): string {
  const machineDesc = [opts.machineType, opts.brand, opts.model].filter(Boolean).join(' ') || '农机设备';
  const primary = retrieved[0];
  const serviceNotice = fallbackReason === 'not_configured'
    ? '**【服务状态】**\n当前未启用外部模型，本次仅提供本地资料和信息补充建议。\n\n'
    : fallbackReason === 'provider_unavailable'
      ? '**【服务状态】**\n外部模型本次暂不可用，已回退为本地资料回复。可稍后重试以获得模型辅助分析。\n\n'
      : '';
  const identityQuestions = [
    !opts.machineType && '农机类型',
    !opts.brand && '品牌',
    !opts.model && '完整型号',
  ].filter(Boolean).join('、');

  if (clarificationNeeded) {
    return `${serviceNotice}**【需要确认机型】**\n你已否定此前的机型信息，本次暂停引用旧机型资料。请确认${identityQuestions || '本次咨询的农机类型、品牌和完整型号'}；确认后继续此前故障咨询。`;
  }

  if (!primary) {
    const identityNotice = resolveScope(query, opts).identityConflict
      ? '已填写的农机信息与问题中的类型、品牌或型号不一致。请确认本次咨询对象，修改已填写信息或问题中的机型后再检索。\n'
      : '';
    return `${serviceNotice}**【故障现象分析】**
收到关于「${machineDesc}」的咨询：“${displayQuery}”。

**【当前资料不足】**
${identityNotice}未检索到与问题及已知机型相符的知识条目，不能据此确定原因或提供操作参数。

**【需要补充】**
${identityQuestions ? `- 请补充${identityQuestions}，以便匹配对应手册。\n` : ''}- 故障是在启动、行驶还是带机具作业时出现？出现前是否有保养、更换或碰撞？
- 请记录异常位置、报警／故障代码及伴随现象，并确认出厂配置与版本。

**【安全提醒】**
故障原因未确认前不要继续危险作业、绕过安全装置或盲目拆修。电动／无人机型请按本机安全规程处理，并联系具备相应资质的维修人员。`;
  }

  if (!primary.entryId) {
    return `${serviceNotice}**【咨询现象】**
收到关于「${machineDesc}」的咨询：“${displayQuery}”。

**【当前资料不足】**
仅命中整理者编写的信息收集提示，未取得本次咨询所需的匹配手册证据。以下问题不是操作／维修依据，不能据此判断故障原因、提供维修步骤、操作参数或保养周期。

**【信息收集】**
### ${primary.heading}
${primary.text}

**【提示来源】**
${describeSource(primary)}
这是信息收集清单的文件位置，不是原厂手册的证据引用。

**【需要补充的资料】**
请提供品牌、完整型号及后缀、市场／排放、配置、手册版本和已经观察到的现象或已有检测记录；取得匹配手册及具体章节后再核对。不能用其他品牌或相近机型填补缺口。

**【安全提醒】**
本清单不要求新增测量、拆检或试操作。现场安全处置请向本机厂家或具备相应资质的维修支持确认，并核对本机匹配安全规程。`;
  }

  const learning = retrieved.filter(chunk => chunk.entryType === '通识学习' && chunk.diagnosticEvidence === false);
  const learningBlock = learning.length ? `\n\n**【通识参考（待验证）】**\n${learning.slice(0, 2).map(chunk =>
    `### ${chunk.heading}\n${chunk.text}\n\n主题：${chunk.locator}；核验状态：${chunk.status}。`).join('\n\n')}\n\n以上原理可辅助理解现象，不能据此确定本机故障、维修步骤或专用参数。` : '';
  if (primary.entryType === '通识学习') {
    return `${serviceNotice}**【农机知识参考】**\n针对“${displayQuery}”检索到以下通识资料。${learningBlock}\n\n如需分析具体车辆，请结合完整机型、配置及已观察到的现象核对匹配手册。涉及现场操作时遵守本机安全规程。`;
  }

  const scopeNotice = primary.applicability === 'matched'
    ? '已找到对应品牌／型号的资料；市场、配置和手册版本仍需确认。下面是来源事实摘录，不代表已确诊。'
    : '已找到该品牌／系列的参考资料，具体车辆适用性待核实。不能直接套用操作步骤或参数。';
  const background = ['机型资料', '资料缺口', '资料索引', '资料核验', '系统适用边界'].includes(primary.entryType ?? '');

  const flow = buildRoleFlow(retrieved);
  const roleBlock = !background && hasRoleFlow(flow)
    ? `\n\n**【按角色整理（现象 → 原因／检查 → 处理）】**\n${formatRoleFlow(flow)}\n角色依据正文字段标签或人工核对；未标注条目不代表缺少该内容。`
    : '';
  // Show the best matching entry intact so its safety conditions and evidence stay together.
  return `${serviceNotice}**【故障现象分析】**
针对「${machineDesc}」的咨询：“${displayQuery}”。

**【${background ? '来源与适用信息' : '初步判断'}】**
${scopeNotice}${background ? '该资料仅用于来源、适用范围或资料缺口说明，不是操作／维修依据。' : ''}

**【检索到的知识】**
### ${primary.heading}
${primary.text}${roleBlock}${learningBlock}

**【知识依据】**
${describeSource(primary)}

**【当前资料不足】**
请确认完整机型、市场、配置和原手册版本；条目中的待核实内容不能用其他品牌或相近机型补齐。${background ? '来源索引、封面核验或报道摘要不构成已审核的操作／维修步骤；请查本机匹配原件及具体章节。' : '故障表中的可能原因需要检测验证，不能据单一症状决定换件。'}

**【安全提醒】**
遵守本机手册的停机与安全隔离规程；不要绕过安全联锁、带压拆修或在悬空机具下作业。高温、高压、电池高压和无人作业相关检查应交具备相应资质的人员处理。`;
}


/** Short default view; the complete quotation and applicability conditions remain expandable. */
export function localReplySummary(
  symptom: string, retrieved: KnowledgeChunk[], scope: RetrievalContext,
  reason: 'not_configured' | 'provider_unavailable' | 'local_selected', clarificationNeeded = false,
): string {
  const status = reason === 'not_configured'
    ? '当前未启用大模型，本次只有本地检索，没有模型补充分析。'
    : reason === 'local_selected' ? '本次直接使用本地资料，未调用外部 AI。' : '大模型本次连接失败，暂时展示本地检索结果。';
  const known = [scope.brand, scope.model].filter(Boolean).join(' ');
  const plain = (value: string) => value.replace(/[\r\n]+/g, ' ').replace(/[<>]/g, '');
  const primary = retrieved.find(chunk => chunk.entryId);
  const intro = `**【继续确认】** ${known ? `已记下：${plain(known)}。` : ''}当前关注：${plain(symptom).slice(0, 180) || '故障现象待补充'}。`;
  if (clarificationNeeded || resolveScope(symptom, scope).identityConflict) {
    return `**【服务状态】** ${status}\n\n${intro}\n\n请确认本次设备的品牌与完整型号，确认前暂停引用机型资料。`;
  }
  if (primary?.entryType === '通识学习') {
    return `**【服务状态】** ${status}\n\n**【通识参考（待验证）】** ${plain(primary.heading)}\n\n${primary.text.slice(0, 600)}\n\n主题：${primary.locator}。${primary.status}。可用于原理理解，不能确定本机故障、维修步骤或专用参数。`;
  }
  const evidence = primary
    ? `找到候选章节“${plain(primary.heading)}”，尚未确认适用于你的车辆或支持本次故障判断。展开下方资料可核对原文、页码及限制；不要直接据此换件。`
    : '未找到能直接支持本次诊断的匹配手册。信息收集提示不作为维修依据。';
  const questions = [
    !scope.model ? '能提供铭牌上的完整型号或照片吗？暂时不知道也可以。' : '是否有报警或故障码？请提供原文。',
    /动力不足|没劲|没力气/.test(symptom)
      ? '热车后是发动机转速也上不去，还是转速正常但行驶／牵引无力？只描述已经观察到的现象即可。'
      : '问题在什么工况下出现，有哪些同时发生的现象？',
  ];
  return `**【服务状态】** ${status}\n\n${intro}\n\n**【本地资料】** ${evidence}\n\n**【先确认两点】**\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\n**【提醒】** 不必为回答问题新增试车或拆检；出现危险征兆时停止作业并联系专业维修人员。`;
}
