const dottedCode = '\\d{1,7}\\.\\d{1,2}';
const controller = '[A-Z][A-Z0-9]{1,7}';
const powertrainCode = 'P[A-F0-9]{4}';
const displayCode = 'ERROR[-‐‑–]\\s*(?:[0-9]{1,3}|ENG|ECU|ACU|NET)';
const threeFieldCode = '\\d[ \\t]*[/／][ \\t]*\\d{3}[ \\t]*[/／][ \\t]*\\d{2}';
const namedCode = `(?:${powertrainCode}|${displayCode})`;
const partialThreeFieldCode = '(?:\\d[ \\t]*[/／][ \\t]*\\d{1,3}[ \\t]*[/／][ \\t]*\\d{1,2}|\\d{3}[ \\t]*[/／][ \\t]*\\d{2}|\\d[ \\t]*[/／][ \\t]*\\d{3})';
const fullCode = new RegExp(`^(?:(${controller})[ \\t]+(${dottedCode})|(${namedCode}))$`, 'i');
export const displayFaultCodePattern = new RegExp(`(?<![a-z0-9_.-])${displayCode}(?![a-z0-9_.-])`, 'gi');
export const threeFieldFaultCodePattern = new RegExp(`(?<![a-z0-9_./／-])${threeFieldCode}(?![a-z0-9_./／-])`, 'gi');
const incompleteFaultCodePattern = new RegExp(`^${partialThreeFieldCode}(?![a-z0-9_.-]|[ \\t]*[/／])`, 'i');

/** Only an explicit documentary field assigns a code to the card. */
export function documentedFaultCodes(body: string): string[] {
  const codes = new Set<string>();
  for (const field of body.matchAll(/^[-*]\s+(?:故障码|诊断故障码)[：:]([^\r\n]+)$/gm)) {
    for (const value of field[1].split(/[、，,；;]/)) {
      const code = value.trim().replace(/。$/, '');
      if (isThreeFieldFaultCode(code)) {
        codes.add(faultCodeKey(code));
        continue;
      }
      const match = fullCode.exec(code);
      if (match) codes.add(match[3] ? faultCodeKey(match[3]) : `${match[1].toUpperCase()} ${match[2]}`);
    }
  }
  return [...codes];
}

export interface FaultCodeQuery {
  number: string;
  controller?: string;
  explicit: boolean;
  incomplete?: true;
}

const exactThreeFieldPattern = new RegExp(`^${threeFieldCode}$`);
function isThreeFieldFaultCode(text: string) {
  return exactThreeFieldPattern.test(text);
}

/** Normalize lookup punctuation while keeping zero padding in three-field display codes. */
export function faultCodeKey(code: string) {
  if (code.includes('/') || code.includes('／')) return code.replace(/[ \t]/g, '').replaceAll('／', '/');
  return code.includes('.') ? code.replace(/\d+/g, digits => String(Number(digits))) :
    code.toUpperCase().replace(/^ERROR[-‐‑–]\s*/, 'ERROR-');
}

export function requestedFaultCodes(query: string, reported: readonly string[]): FaultCodeQuery[] {
  const requests = new Map<string, FaultCodeQuery>();
  const label = /(?:故障码|报码|报警码|错误码|\b(?:dtc|fault code|error code)\b)\s*[：:=]?\s*/gi;
  const codePattern = new RegExp(`(?<![a-z0-9_.-])(?:(?:(${controller})[ \\t]+)?(${dottedCode})|(${namedCode}))(?![a-z0-9_.-])`, 'gi');
  function read(text: string, explicit: boolean) {
    const standalone = text.trim().replace(/[?？。！!]+$/u, '');
    for (const match of text.matchAll(codePattern)) {
      const prefix = match[1]?.toUpperCase();
      const wholeCode = explicit || match[0] === standalone;
      if (!prefix && !wholeCode && !match[3]) continue;
      const number = match[3] ? faultCodeKey(match[3]) : match[2];
      const key = `${prefix ?? ''} ${number}`;
      requests.set(key, { number, controller: prefix, explicit: wholeCode || requests.get(key)?.explicit === true });
    }
  }
  function readIncomplete(text: string) {
    if (isThreeFieldFaultCode(text)) return;
    const number = faultCodeKey(text);
    if (!requests.has(` ${number}`)) requests.set(` ${number}`, { number, explicit: true, incomplete: true });
  }
  // Inspect labeled values and unlabelled qualified codes separately. A measurement
  // elsewhere in the same sentence must not inherit the fault-code label.
  const labeledCode = new RegExp(`^(?:(?:${controller}[ \\t]+)?${dottedCode}|${namedCode})(?![a-z0-9_.-])`, 'i');
  for (const match of query.matchAll(label)) {
    const suffix = query.slice(match.index + match[0].length);
    const value = labeledCode.exec(suffix);
    if (value) read(value[0], true);
    const incomplete = incompleteFaultCodePattern.exec(suffix);
    if (incomplete) readIncomplete(incomplete[0]);
  }
  read(query.replace(label, ' '), false);
  const bare = query.trim().replace(/[?？。！!]+$/u, '');
  for (const match of query.matchAll(threeFieldFaultCodePattern)) {
    const [code] = match;
    const number = faultCodeKey(code);
    const labelBeforeCode = /(?:故障码|报码|报警码|错误码|\b(?:dtc|fault code|error code)\b|(?:仪表|屏幕)\s*(?:显示|跳出))\s*[：:=]?\s*$/i;
    requests.set(` ${number}`, { number, explicit: code === bare || labelBeforeCode.test(query.slice(0, match.index)) });
  }
  if (incompleteFaultCodePattern.exec(bare)?.[0] === bare) readIncomplete(bare);
  for (const value of reported) {
    const text = value.replace(label, '').trim();
    if (isThreeFieldFaultCode(text)) {
      const number = faultCodeKey(text);
      requests.set(` ${number}`, { number, explicit: true });
    } else if (incompleteFaultCodePattern.exec(text)?.[0] === text) readIncomplete(text);
    if (fullCode.test(text) || new RegExp(`^${dottedCode}$`).test(text)) read(text, true);
  }
  // When both the query and the structured context carry the same code, use the
  // explicitly supplied controller instead of adding a second bare request.
  const qualifiedNumbers = new Set([...requests.values()].filter(request => request.controller).map(request => faultCodeKey(request.number)));
  return [...requests.values()].filter(request => request.controller || !qualifiedNumbers.has(faultCodeKey(request.number)));
}
