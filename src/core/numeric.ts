/** Small arithmetic parser: never evaluates JavaScript or property expressions. */
export function parseNumericExpression(text: string, base: number, displayScale = 1): number | null {
  let expression = text.trim().toLowerCase();
  if (!expression) return null;
  const relative = expression.match(/^([+\-*/])=/);
  if (relative) expression = expression.slice(2);
  const tokens = expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:cm|mm|m|deg|rad|°)?|pi|[()+\-*/]/g);
  if (!tokens || tokens.join('') !== expression.replace(/\s+/g,'')) return null;
  let index = 0;
  const atom = (): number => {
    const token = tokens[index++];
    if (token === '+') return atom();
    if (token === '-') return -atom();
    if (token === '(') { const value = sum(); if (tokens[index++] !== ')') throw Error(); return value; }
    if (token === 'pi') return Math.PI;
    if (!token) throw Error();
    const match = token.match(/^((?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(cm|mm|m|deg|rad|°)?$/);
    if (!match) throw Error();
    let value = Number(match[1]);
    const unit = match[2];
    if (unit) {
      if (displayScale === 100 && ['cm','mm','m'].includes(unit)) value *= unit === 'm' ? 100 : unit === 'mm' ? .1 : 1;
      else if (Math.abs(displayScale - 180 / Math.PI) < .00001 && ['deg','rad','°'].includes(unit)) value *= unit === 'rad' ? 180 / Math.PI : 1;
      else throw Error();
    }
    return value;
  };
  const product = (): number => { let value = atom(); while (tokens[index] === '*' || tokens[index] === '/') { const op = tokens[index++]; const next = atom(); value = op === '*' ? value * next : value / next; } return value; };
  const sum = (): number => { let value = product(); while (tokens[index] === '+' || tokens[index] === '-') { const op = tokens[index++]; const next = product(); value = op === '+' ? value + next : value - next; } return value; };
  try {
    let result = sum();
    if (index !== tokens.length) return null;
    if (relative) result = relative[1] === '+' ? base + result : relative[1] === '-' ? base - result : relative[1] === '*' ? base * result : base / result;
    return Number.isFinite(result) ? result : null;
  } catch { return null; }
}

export function adjustNumericValue(value: number, step: number, direction: number, options: {shiftKey?:boolean;altKey?:boolean;integer?:boolean;min?:number;max?:number} = {}): number {
  const multiplier = options.shiftKey ? 10 : options.altKey && !options.integer ? .1 : 1;
  let next = Number((value + step * direction * multiplier).toPrecision(12));
  next = Math.max(options.min ?? -Infinity,Math.min(options.max ?? Infinity,next));
  return options.integer ? Math.round(next) : next;
}
