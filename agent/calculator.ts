/** Recursive descent parser: no eval, Function, properties, calls or identifiers. */
export function calculator(expression: string): number {
  const tokens = expression.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+*/%-]|[^\s]/g) ?? [];
  if (tokens.length > 300 || expression.length > 2000) throw new Error('表达式过长');
  let i=0;
  const atom = (): number => {
    const token=tokens[i++];
    if (token==='+' || token==='-') return (token==='-' ? -1 : 1)*atom();
    if (token==='(') { const v=sum(); if(tokens[i++]!==')') throw new Error('缺少右括号'); return v; }
    if (!token || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) throw new Error('仅允许数字、+ - * / % 和括号');
    return Number(token);
  };
  const product = (): number => { let v=atom(); while(['*','/','%'].includes(tokens[i])) { const op=tokens[i++],rhs=atom(); v=op==='*'?v*rhs:op==='/'?v/rhs:v%rhs; } return v; };
  const sum = (): number => { let v=product(); while(['+','-'].includes(tokens[i])) { const op=tokens[i++],rhs=product(); v=op==='+'?v+rhs:v-rhs; } return v; };
  const result=sum(); if(i!==tokens.length || !Number.isFinite(result)) throw new Error('表达式不合法或除数为零'); return result;
}

