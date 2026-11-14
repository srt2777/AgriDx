const dottedCode = '\\d{1,7}\\.\\d{1,2}';
const controller = '[A-Z][A-Z0-9]{1,7}';
const powertrainCode = 'P[A-F0-9]{4}';
const fullCode = new RegExp(`^(?:(${controller})[ \\t]+(${dottedCode})|(${powertrainCode}))$`, 'i');

/** Only an explicit documentary field assigns a code to the card. */
export function documentedFaultCodes(body: string): string[] {
  const codes = new Set<string>();
  for (const field of body.matchAll(/^[-*]\s+(?:故障码|诊断故障码)[：:]([^\r\n]+)$/gm)) {
    for (const value of field[1].split(/[、，,；;]/)) {
      const match = fullCode.exec(value.trim().replace(/。$/, ''));
      if (match) codes.add(match[3]?.toUpperCase() ?? `${match[1].toUpperCase()} ${match[2]}`);
    }
  }
  return [...codes];
}

export interface FaultCodeQuery {
  number: string;
  controller?: string;
  explicit: boolean;
}

/** Use a canonical numeric identity for SPN/FMI lookup while retaining the printed code on the card. */
export function faultCodeKey(code: string) {
  return code.includes('.') ? code.replace(/\d+/g, digits => String(Number(digits))) : code.toUpperCase();
}

export function requestedFaultCodes(query: string, reported: readonly string[]): FaultCodeQuery[] {
  const requests = new Map<string, FaultCodeQuery>();
  const label = /(?:故障码|报码|报警码|错误码|\b(?:dtc|fault code|error code)\b)\s*[：:=]?\s*/gi;
  const codePattern = new RegExp(`(?<![a-z0-9_.])(?:(?:(${controller})[ \\t]+)?(${dottedCode})|(${powertrainCode}))(?![a-z0-9_.])`, 'gi');
  function read(text: string, explicit: boolean) {
    const standalone = text.trim().replace(/[?？。！!]+$/u, '');
    for (const match of text.matchAll(codePattern)) {
      const prefix = match[1]?.toUpperCase();
      const wholeCode = explicit || match[0] === standalone;
      if (!prefix && !wholeCode && !match[3]) continue;
      const number = match[3]?.toUpperCase() ?? match[2];
      const key = `${prefix ?? ''} ${number}`;
      requests.set(key, { number, controller: prefix, explicit: wholeCode || requests.get(key)?.explicit === true });
    }
  }
  // Inspect labeled values and unlabelled qualified codes separately. A measurement
  // elsewhere in the same sentence must not inherit the fault-code label.
  const labeledCode = new RegExp(`^(?:(?:${controller}[ \\t]+)?${dottedCode}|${powertrainCode})(?![a-z0-9_.])`, 'i');
  for (const match of query.matchAll(label)) {
    const value = labeledCode.exec(query.slice(match.index + match[0].length));
    if (value) read(value[0], true);
  }
  read(query.replace(label, ' '), false);
  for (const value of reported) {
    const text = value.replace(label, '').trim();
    if (fullCode.test(text) || new RegExp(`^${dottedCode}$`).test(text)) read(text, true);
  }
  // When both the query and the structured context carry the same code, use the
  // explicitly supplied controller instead of adding a second bare request.
  const qualifiedNumbers = new Set([...requests.values()].filter(request => request.controller).map(request => faultCodeKey(request.number)));
  return [...requests.values()].filter(request => request.controller || !qualifiedNumbers.has(faultCodeKey(request.number)));
}
