// --- JSthon ---
class Environment {
    constructor(parent = null, isFunctionScope = false) {
        this.variables = {};
        this.parent = parent;
        this.isFunctionScope = isFunctionScope;
    }
    set(name, valueObj) {
        this.variables[name] = { value: valueObj.value, type: valueObj.type };
    }
    get(name) {
        if (name in this.variables) return this.variables[name];
        if (this.parent) return this.parent.get(name);
        throw new Error(`NameError: name '${name}' is not defined`);
    }
    setGlobal(name, valueObj) {
        let env = this;
        while (env.parent) env = env.parent;
        env.set(name, valueObj);
    }
    setNonlocal(name, valueObj) {
        let env = this.parent;
        while (env) {
            if (env.isFunctionScope && name in env.variables) { env.set(name, valueObj); return; }
            env = env.parent;
        }
        throw new Error(`NameError: no binding for nonlocal '${name}' found`);
    }
    getNonlocal(name) {
        let env = this.parent;
        while (env) {
            if (env.isFunctionScope && name in env.variables) return env.variables[name];
            env = env.parent;
        }
        throw new Error(`NameError: no binding for nonlocal '${name}' found`);
    }
}

async function runCompiler() {
    const editor = document.getElementById('editor');
    const consoleDiv = document.getElementById('console');
    const code = editor.value;
    consoleDiv.innerText = '';
    const globalEnv = new Environment();

    function outputToConsole(text) {
        const line = document.createElement('div');
        const format = (v) => {
            if (v === null) return 'None';
            if (v === true) return 'True';
            if (v === false) return 'False';
            if (Array.isArray(v)) return '[' + v.map(format).join(', ') + ']';
            if (typeof v === 'string') return `'${v}'`;
            if (v && typeof v === 'object' && v.stop !== undefined) {
                return v.step !== 1
                    ? `range(${v.start}, ${v.stop}, ${v.step})`
                    : `range(${v.start}, ${v.stop})`;
            }
            return v;
        };
        if (Array.isArray(text)) {
            line.textContent = text.map(item => typeof item === 'string' ? item : format(item)).join(' ');
        } else {
            line.textContent = format(text);
        }
        consoleDiv.appendChild(line);
    }

    function tokenize(expr) {
        const regex = /"(?:\\"|[^"])*"|'(?:\\'|[^'])*'|\d+\.\d+|\d+|[a-zA-Z_]\w*|==|!=|>=|<=|\/\/|\+=|-=|[+\-*/%()<>!=,\[\]]/g;
        return expr.match(regex) || [];
    }

    async function resolveFString(raw, env) {
        const inner = raw.slice(2, -1);
        let result = '';
        let i = 0;
        while (i < inner.length) {
            if (inner[i] === '{') {
                let depth = 1, j = i + 1;
                while (j < inner.length && depth > 0) {
                    if (inner[j] === '{') depth++;
                    else if (inner[j] === '}') depth--;
                    j++;
                }
                const exprStr = inner.slice(i + 1, j - 1);
                const val = await evaluate(exprStr, env);
                const fmt = (v) => {
                    if (v === null) return 'None';
                    if (v === true) return 'True';
                    if (v === false) return 'False';
                    if (Array.isArray(v)) return '[' + v.map(fmt).join(', ') + ']';
                    return String(v);
                };
                result += fmt(val.value);
                i = j;
            } else {
                result += inner[i++];
            }
        }
        return { value: result, type: 'str' };
    }

    // --- parser ---
    function parseParams(paramStr) {
        const params = [];
        let cur = '', depth = 0, inStr = false, strChar = '';
        const flush = () => {
            const part = cur.trim();
            cur = '';
            if (!part) return;
            const eqIdx = part.indexOf('=');
            if (eqIdx !== -1) {
                params.push({ name: part.slice(0, eqIdx).trim(), defaultExpr: part.slice(eqIdx + 1).trim() });
            } else {
                params.push({ name: part, defaultExpr: null });
            }
        };
        for (let i = 0; i <= paramStr.length; i++) {
            const c = paramStr[i];
            if (i === paramStr.length) { flush(); break; }
            if (inStr) { cur += c; if (c === strChar) inStr = false; }
            else if (c === '"' || c === "'") { inStr = true; strChar = c; cur += c; }
            else if (c === '(' || c === '[') { depth++; cur += c; }
            else if (c === ')' || c === ']') { depth--; cur += c; }
            else if (c === ',' && depth === 0) { flush(); }
            else { cur += c; }
        }
        return params;
    }

    async function evaluate(expr, env) {
        if (typeof expr === 'string') {
            const s = expr.trim();
            if (/^f["']/.test(s)) return await resolveFString(s, env);
            expr = tokenize(s);
        }
        if (expr.length === 0) return { value: null, type: 'None' };
        if (expr.length === 2 && expr[0] === 'f' && /^["']/.test(String(expr[1]))) {
            return await resolveFString('f' + expr[1], env);
        }

        for (let logicOp of ['or', 'and']) {
            let depth = 0;
            for (let i = 0; i < expr.length; i++) {
                const t = expr[i];
                if (t === '(' || t === '[') depth++;
                else if (t === ')' || t === ']') depth--;
                else if (depth === 0 && t === logicOp) {
                    const left = await evaluate(expr.slice(0, i), env);
                    if (logicOp === 'or' && left.value) return { value: true, type: 'bool' };
                    if (logicOp === 'and' && !left.value) return { value: false, type: 'bool' };
                    const right = await evaluate(expr.slice(i + 1), env);
                    return { value: Boolean(right.value), type: 'bool' };
                }
            }
        }

        if (expr[0] === 'not') {
            const val = await evaluate(expr.slice(1), env);
            return { value: !val.value, type: 'bool' };
        }

        let open;
        while ((open = expr.lastIndexOf('(')) !== -1) {
            let close = expr.indexOf(')', open);
            const inner = expr.slice(open + 1, close);
            let args = []; let sub = []; let bal = 0;
            for (let t of inner) {
                if (t === '[' || t === '(') bal++; if (t === ']' || t === ')') bal--;
                if (t === ',' && bal === 0) { args.push(await evaluate(sub, env)); sub = []; }
                else sub.push(t);
            }
            if (sub.length > 0) args.push(await evaluate(sub, env));

            if (open > 0 && /^[a-zA-Z_]\w*$/.test(expr[open - 1]) && !['+', '-', '*', '/', '%'].includes(expr[open - 1])) {
                const func = expr[open - 1]; let res;
                if (func === 'int') res = { value: parseInt(args[0].value), type: 'int' };
                else if (func === 'float') res = { value: parseFloat(args[0].value), type: 'float' };
                else if (func === 'range') {
                    let start, stop, step;
                    if (args.length === 1) { start = 0; stop = args[0].value; step = 1; }
                    else if (args.length === 2) { start = args[0].value; stop = args[1].value; step = 1; }
                    else { start = args[0].value; stop = args[1].value; step = args[2].value; }
                    res = { value: { start, stop, step }, type: 'range' };
                }
                else if (func === 'len') res = { value: args[0].value.length, type: 'int' };
                else if (func === 'str') res = { value: String(args[0].value), type: 'str' };
                else if (func === 'input') {
                    const promptText = args.length > 0 ? String(args[0].value) : '';
                    const userValue = await new Promise((resolve) => {
                        const row = document.createElement('div');
                        row.style.display = 'flex';
                        row.style.alignItems = 'center';
                        row.style.gap = '4px';
                        if (promptText) {
                            const label = document.createElement('span');
                            label.textContent = promptText;
                            row.appendChild(label);
                        }
                        const field = document.createElement('input');
                        field.type = 'text';
                        field.style.cssText = 'border:none; outline:none; background:transparent; font:inherit; color:inherit; flex:1; min-width:4ch;';
                        row.appendChild(field);
                        consoleDiv.appendChild(row);
                        field.focus();
                        field.addEventListener('keydown', (e) => {
                            if (e.key === 'Enter') {
                                const val = field.value;
                                field.replaceWith(document.createTextNode(val));
                                resolve(val);
                            }
                        });
                    });
                    res = { value: userValue, type: 'str' };
                }
                else {
                    const fnObj = env.get(func);
                    if (!fnObj || fnObj.type !== 'func') throw new Error(`TypeError: '${func}' is not callable`);
                    const { params, body: fnBody, closure } = fnObj.value;
                    const fnEnv = new Environment(closure, true);
                    for (let pi = 0; pi < params.length; pi++) {
                        const { name: pname, defaultExpr } = params[pi];
                        if (pi < args.length) {
                            fnEnv.set(pname, args[pi]);
                        } else if (defaultExpr !== null) {
                            fnEnv.set(pname, await evaluate(defaultExpr, closure));
                        } else {
                            throw new Error(`TypeError: missing required argument '${pname}'`);
                        }
                    }
                    try {
                        await executeBlock(fnBody, fnEnv);
                        res = { value: null, type: 'None' };
                    } catch (ret) {
                        if (ret && ret.__return__) {
                            res = ret.typedResult ?? { value: ret.value, type: 'obj' };
                        } else throw ret;
                    }
                }
                expr.splice(open - 1, (close - open) + 2, res);
            } else {
                expr.splice(open, (close - open) + 1, args[0] || { value: null, type: 'None' });
            }
        }

        let bOpen;
        while ((bOpen = expr.lastIndexOf('[')) !== -1) {
            let bClose = expr.indexOf(']', bOpen);
            if (bOpen > 0 && (/^[a-zA-Z_]\w*$/.test(expr[bOpen - 1]) || typeof expr[bOpen - 1] === 'object')) {
                const target = await evaluate([expr[bOpen - 1]], env);
                const idx = (await evaluate(expr.slice(bOpen + 1, bClose), env)).value;
                const finalIdx = idx < 0 ? target.value.length + idx : idx;
                if (!Array.isArray(target.value) || finalIdx < 0 || finalIdx >= target.value.length) {
                    throw new Error(`IndexError: list index out of range`);
                }
                expr.splice(bOpen - 1, (bClose - bOpen) + 2, { value: target.value[finalIdx], type: 'obj' });
            } else {
                let items = []; let sub = []; let bal = 0;
                for (let t of expr.slice(bOpen + 1, bClose)) {
                    if (t === '[' || t === '(') bal++; if (t === ']' || t === ')') bal--;
                    if (t === ',' && bal === 0) { items.push((await evaluate(sub, env)).value); sub = []; }
                    else sub.push(t);
                }
                if (sub.length > 0) items.push((await evaluate(sub, env)).value);
                expr.splice(bOpen, (bClose - bOpen) + 1, { value: items, type: 'list' });
            }
        }

        const ops = [['==', '!=', '<', '>', '<=', '>='], ['+', '-'], ['*', '/', '//', '%']];
        for (let group of ops) {
            for (let i = expr.length - 1; i > 0; i--) {
                if (group.includes(expr[i])) {
                    if (expr[i] === '-' && (i === 0 || ops.flat().includes(expr[i - 1]))) continue;
                    const left = await evaluate(expr.slice(0, i), env);
                    const right = await evaluate(expr.slice(i + 1), env);
                    let v;
                    if (expr[i] === '+') v = (Array.isArray(left.value) && Array.isArray(right.value)) ? [...left.value, ...right.value] : left.value + right.value;
                    else if (expr[i] === '-') v = left.value - right.value;
                    else if (expr[i] === '*') v = left.value * right.value;
                    else if (expr[i] === '/') v = left.value / right.value;
                    else if (expr[i] === '//') v = Math.floor(left.value / right.value);
                    else if (expr[i] === '%') v = ((left.value % right.value) + right.value) % right.value;
                    else if (expr[i] === '==') v = left.value == right.value;
                    else if (expr[i] === '!=') v = left.value != right.value;
                    else if (expr[i] === '<') v = left.value < right.value;
                    else if (expr[i] === '>') v = left.value > right.value;
                    else if (expr[i] === '<=') v = left.value <= right.value;
                    else if (expr[i] === '>=') v = left.value >= right.value;
                    return { value: v, type: 'obj' };
                }
            }
        }

        if (expr[0] === '-') return { value: -(await evaluate(expr.slice(1), env)).value, type: 'int' };
        const item = expr[0];
        if (typeof item === 'object') return item;
        if (item === 'True') return { value: true, type: 'bool' };
        if (item === 'False') return { value: false, type: 'bool' };
        if (item === 'None') return { value: null, type: 'None' };
        if (!isNaN(item)) return { value: parseFloat(item), type: 'num' };
        if (item.startsWith('"') || item.startsWith("'")) return { value: item.slice(1, -1), type: 'str' };
        return env.get(item);
    }

    function collectBlock(lines, startIdx, headerIndent) {
        const body = [];
        let j = startIdx;
        while (j < lines.length) {
            const raw = lines[j];
            const rawText = raw.toString();
            if (rawText.trim() === '') { body.push(raw); j++; continue; }
            const lineIndent = rawText.match(/^(\s*)/)[0].length;
            if (lineIndent > headerIndent) { body.push(raw); j++; }
            else break;
        }
        return { body, next: j };
    }

    // Tag strings with line num
    function tagLine(text, srcLine) {
        const t = new String(text);
        t.__srcLine = srcLine;
        return t;
    }

    async function executeBlock(lines, env, lineOffset = 1) {
        // Expand semicolons
        const expanded = [];
        for (let ri = 0; ri < lines.length; ri++) {
            const raw = lines[ri];
            const srcLine = raw.__srcLine ?? (lineOffset + ri);
            const rawText = raw.toString();
            const indentStr = rawText.match(/^(\s*)/)[0];

            let cur = '', inStr = false, strChar = '';
            const stmts = [];
            for (let ci = 0; ci < rawText.length; ci++) {
                const c = rawText[ci];
                if (inStr) { cur += c; if (c === strChar) inStr = false; }
                else if (c === '"' || c === "'") { inStr = true; strChar = c; cur += c; }
                else if (c === ';') { stmts.push(cur); cur = indentStr; }
                else { cur += c; }
            }
            stmts.push(cur);
            for (const s of stmts) { if (s.trim()) expanded.push(tagLine(s, srcLine)); }
        }
        lines = expanded;

        const globalVars = new Set();
        const nonlocalVars = new Set();

        let i = 0;
        while (i < lines.length) {
            const raw = lines[i];
            const srcLine = raw.__srcLine;
            const rawText = raw.toString();

            // Strip inline comments
            let stripped = '', inS = false, sC = '';
            for (let ci = 0; ci < rawText.length; ci++) {
                const c = rawText[ci];
                if (inS) { stripped += c; if (c === sC) inS = false; }
                else if (c === '"' || c === "'") { inS = true; sC = c; stripped += c; }
                else if (c === '#') break;
                else stripped += c;
            }

            if (!stripped.trim()) { i++; continue; }
            const trimmed = stripped.trim();
            const indent = stripped.match(/^(\s*)/)[0].length;

            // Inline block expansion
            const colonIdx = (() => {
                let depth = 0, inS = false, sc = '';
                for (let ci = 0; ci < trimmed.length; ci++) {
                    const c = trimmed[ci];
                    if (inS) { if (c === sc) inS = false; continue; }
                    if (c === '"' || c === "'") { inS = true; sc = c; continue; }
                    if (c === '(' || c === '[') depth++;
                    else if (c === ')' || c === ']') depth--;
                    else if (c === ':' && depth === 0) return ci;
                }
                return -1;
            })();

            const blockHeaderRe = /^(if |elif |else\s*:|for |while |def )/;
            if (blockHeaderRe.test(trimmed) && colonIdx !== -1) {
                const afterColon = trimmed.slice(colonIdx + 1).trim();
                if (afterColon) {
                    const header = tagLine(' '.repeat(indent) + trimmed.slice(0, colonIdx + 1), srcLine);
                    const bodyLine = tagLine(' '.repeat(indent + 4) + afterColon, srcLine);
                    lines = [...lines.slice(0, i), header, bodyLine, ...lines.slice(i + 1)];
                    continue; // re-process same index
                }
            }

            try {
                // --- global ---
                if (trimmed.match(/^global\s+/)) {
                    trimmed.slice(7).split(',').map(n => n.trim()).forEach(n => globalVars.add(n));
                    i++; continue;
                }

                // --- nonlocal ---
                if (trimmed.match(/^nonlocal\s+/)) {
                    trimmed.slice(9).split(',').map(n => n.trim()).forEach(n => nonlocalVars.add(n));
                    i++; continue;
                }

                // --- assignment ---
                const assignMatch = trimmed.match(/^([a-zA-Z_]\w*(?:\[.*?\])?)\s*(\+|-)?=(?!=)\s*(.*)$/);
                if (assignMatch) {
                    const target = assignMatch[1].trim();
                    const newVal = await evaluate(assignMatch[3], env);
                    if (target.includes('[')) {
                        const name = target.split('[')[0].trim();
                        const idx = (await evaluate(target.match(/\[(.*)\]/)[1], env)).value;
                        const list = env.get(name).value;
                        list[idx < 0 ? list.length + idx : idx] = newVal.value;
                    } else {
                        const baseName = target;
                        if (globalVars.has(baseName)) {
                            if (assignMatch[2]) {
                                const curr = env.get(baseName);
                                const v = assignMatch[2] === '+' ?
                                    ((Array.isArray(curr.value) && Array.isArray(newVal.value)) ? [...curr.value, ...newVal.value] : curr.value + newVal.value) :
                                    curr.value - newVal.value;
                                env.setGlobal(baseName, { value: v, type: 'obj' });
                            } else { env.setGlobal(baseName, newVal); }
                        } else if (nonlocalVars.has(baseName)) {
                            if (assignMatch[2]) {
                                const curr = env.getNonlocal(baseName);
                                const v = assignMatch[2] === '+' ?
                                    ((Array.isArray(curr.value) && Array.isArray(newVal.value)) ? [...curr.value, ...newVal.value] : curr.value + newVal.value) :
                                    curr.value - newVal.value;
                                env.setNonlocal(baseName, { value: v, type: 'obj' });
                            } else { env.setNonlocal(baseName, newVal); }
                        } else {
                            if (!assignMatch[2]) env.set(target, newVal);
                            else {
                                let curr = env.get(target);
                                let v = assignMatch[2] === '+' ?
                                    ((Array.isArray(curr.value) && Array.isArray(newVal.value)) ? [...curr.value, ...newVal.value] : curr.value + newVal.value) :
                                    curr.value - newVal.value;
                                env.set(target, { value: v, type: 'obj' });
                            }
                        }
                    }
                    i++; continue;
                }

                // --- return ---
                if (trimmed.startsWith('return')) {
                    const retExpr = trimmed.slice(6).trim();
                    const retTyped = retExpr ? await evaluate(retExpr, env) : { value: null, type: 'None' };
                    throw { __return__: true, value: retTyped.value, typedResult: retTyped };
                }

                // --- def ---
                if (trimmed.match(/^def\s+[a-zA-Z_]\w*\s*\(.*\)\s*:$/)) {
                    const m = trimmed.match(/^def\s+([a-zA-Z_]\w*)\s*\((.*)\)\s*:$/);
                    const name = m[1];
                    const params = parseParams(m[2]); // parses "x, y=10, z='hi'" correctly
                    const { body: fnBody, next } = collectBlock(lines, i + 1, indent);
                    env.set(name, { value: { params, body: fnBody, closure: env }, type: 'func' });
                    i = next; continue;
                }

                // --- print ---
                if (trimmed.startsWith('print(')) {
                    const content = trimmed.match(/^print\((.*)\)$/)[1];
                    let args = []; let sub = []; let bal = 0; let inStr = false;
                    for (let c of content) {
                        if (c === '"' || c === "'") inStr = !inStr;
                        if (c === '(' || c === '[') bal++; if (c === ')' || c === ']') bal--;
                        if (c === ',' && bal === 0 && !inStr) { args.push(await evaluate(sub.join(''), env)); sub = []; }
                        else sub.push(c);
                    }
                    if (sub.length) args.push(await evaluate(sub.join(''), env));
                    outputToConsole(args.map(a => a.value));
                    i++; continue;
                }

                // --- if/elif/else ---
                if (trimmed.match(/^if .+:$/)) {
                    let k = i;
                    let executed = false;
                    while (k < lines.length) {
                        const curRaw = lines[k];
                        if (!curRaw.toString().trim()) { k++; continue; }
                        const curIndent = curRaw.toString().match(/^(\s*)/)[0].length;
                        if (curIndent !== indent && k !== i) break;
                        const curTrimmed = curRaw.toString().trim();
                        const m = curTrimmed.match(/^(if|elif|else)\s*(.*?):$/);
                        if (!m) break;
                        const { body, next } = collectBlock(lines, k + 1, indent);
                        if (!executed) {
                            const condResult = (m[1] === 'else') ? true : (await evaluate(m[2], env)).value;
                            if (condResult) {
                                await executeBlock(body, env, srcLine);
                                executed = true;
                            }
                        }
                        k = next;
                        let peek = k;
                        while (peek < lines.length && !lines[peek].toString().trim()) peek++;
                        if (peek >= lines.length) break;
                        const peekIndent = lines[peek].toString().match(/^(\s*)/)[0].length;
                        if (peekIndent !== indent) break;
                        if (!lines[peek].toString().trim().match(/^(elif|else)/)) break;
                        k = peek;
                    }
                    i = k; continue;
                }

                // --- for / while ---
                if (trimmed.startsWith('for ') || trimmed.startsWith('while ')) {
                    const { body, next } = collectBlock(lines, i + 1, indent);
                    if (trimmed.startsWith('for ')) {
                        const m = trimmed.match(/^for\s+(.+)\s+in\s+(.+):$/);
                        const iter = await evaluate(m[2], env);
                        let vals;
                        if (iter.type === 'range') {
                            vals = [];
                            const { start, stop, step } = iter.value;
                            if (step > 0) { for (let v = start; v < stop; v += step) vals.push(v); }
                            else { for (let v = start; v > stop; v += step) vals.push(v); }
                        } else { vals = iter.value; }
                        for (let v of vals) {
                            env.set(m[1], { value: v, type: 'obj' });
                            await executeBlock(body, env, srcLine);
                        }
                    } else {
                        const cond = trimmed.match(/^while\s+(.+):$/)[1];
                        while ((await evaluate(cond, env)).value === true) await executeBlock(body, env, srcLine);
                    }
                    i = next; continue;
                }

                // --- standalone call ---
                if (/^[a-zA-Z_]\w*\s*\(/.test(trimmed)) {
                    await evaluate(trimmed, env);
                    i++; continue;
                }

            } catch (e) {
                if (e && e.__return__) throw e;
                outputToConsole(`ERROR on line ${srcLine}: ${e.message}`);
                return;
            }
            i++;
        }
    }

    const sourceLines = code.split('\n').map((text, idx) => tagLine(text, idx + 1));
    await executeBlock(sourceLines, globalEnv, 1);
}

console.log("Powered by JSthon v1.0.0");