/**
 * Minimal Lua-value parser for WoW SavedVariables.
 *
 * Supports the subset that WoW writes:
 *   - Numbers (int + float, optionally negative)
 *   - Booleans, nil
 *   - Single- and double-quoted strings with \n \t \" \' \\ \xNN escapes
 *   - Tables with mixed keys: ["k"] = v, [123] = v, name = v, or positional values
 *   - Trailing commas and line comments (-- ...)
 *
 * Returns a parsed object keyed by the top-level `NAME = { ... }` statements.
 */

export type LuaValue =
  | string
  | number
  | boolean
  | null
  | LuaValue[]
  | { [k: string]: LuaValue };

export type LuaTable = { [k: string]: LuaValue };

class Parser {
  private i = 0;
  constructor(private src: string) {}

  parseFile(): Record<string, LuaValue> {
    const out: Record<string, LuaValue> = {};
    this.skipWs();
    while (this.i < this.src.length) {
      const name = this.readIdent();
      this.skipWs();
      this.expect('=');
      this.skipWs();
      const value = this.readValue();
      out[name] = value;
      this.skipWs();
    }
    return out;
  }

  private skipWs() {
    while (this.i < this.src.length) {
      const c = this.src.charCodeAt(this.i);
      // whitespace
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
        this.i++;
        continue;
      }
      // line comment --
      if (c === 0x2d && this.src.charCodeAt(this.i + 1) === 0x2d) {
        // skip long comment --[[ ... ]] (not used by WoW SV, but be safe)
        if (this.src.startsWith('--[[', this.i)) {
          const end = this.src.indexOf(']]', this.i + 4);
          this.i = end === -1 ? this.src.length : end + 2;
          continue;
        }
        const nl = this.src.indexOf('\n', this.i);
        this.i = nl === -1 ? this.src.length : nl + 1;
        continue;
      }
      break;
    }
  }

  private expect(ch: string) {
    if (this.src[this.i] !== ch) {
      throw new Error(`Expected '${ch}' at ${this.posInfo()}`);
    }
    this.i++;
  }

  private posInfo() {
    const upto = this.src.slice(0, this.i);
    const line = upto.split('\n').length;
    const col = this.i - upto.lastIndexOf('\n');
    return `line ${line} col ${col}`;
  }

  private readIdent(): string {
    const start = this.i;
    while (this.i < this.src.length) {
      const c = this.src.charCodeAt(this.i);
      const isLetter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 0x5f;
      const isDigit = c >= 48 && c <= 57;
      if (isLetter || (this.i > start && isDigit)) {
        this.i++;
      } else {
        break;
      }
    }
    if (start === this.i) throw new Error(`Expected identifier at ${this.posInfo()}`);
    return this.src.slice(start, this.i);
  }

  private readValue(): LuaValue {
    this.skipWs();
    const c = this.src[this.i];
    if (c === '"' || c === "'") return this.readString();
    if (c === '{') return this.readTable();
    if (c === '-' || (c >= '0' && c <= '9')) return this.readNumber();
    // identifier-ish: true / false / nil
    const ident = this.peekIdent();
    if (ident === 'true') {
      this.i += 4;
      return true;
    }
    if (ident === 'false') {
      this.i += 5;
      return false;
    }
    if (ident === 'nil') {
      this.i += 3;
      return null;
    }
    throw new Error(`Unexpected value at ${this.posInfo()}: ${this.src.slice(this.i, this.i + 20)}`);
  }

  private peekIdent(): string {
    const start = this.i;
    let j = start;
    while (j < this.src.length) {
      const c = this.src.charCodeAt(j);
      const isLetter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 0x5f;
      if (!isLetter) break;
      j++;
    }
    return this.src.slice(start, j);
  }

  private readString(): string {
    const quote = this.src[this.i];
    this.i++;
    let out = '';
    while (this.i < this.src.length) {
      const c = this.src[this.i];
      if (c === '\\') {
        const n = this.src[this.i + 1];
        this.i += 2;
        switch (n) {
          case 'n':
            out += '\n';
            break;
          case 't':
            out += '\t';
            break;
          case 'r':
            out += '\r';
            break;
          case '"':
            out += '"';
            break;
          case "'":
            out += "'";
            break;
          case '\\':
            out += '\\';
            break;
          case 'x': {
            const hex = this.src.slice(this.i, this.i + 2);
            this.i += 2;
            out += String.fromCharCode(Number.parseInt(hex, 16));
            break;
          }
          default: {
            // numeric escape \ddd
            if (n >= '0' && n <= '9') {
              let digits = n;
              while (
                digits.length < 3 &&
                this.src[this.i] >= '0' &&
                this.src[this.i] <= '9'
              ) {
                digits += this.src[this.i];
                this.i++;
              }
              out += String.fromCharCode(Number.parseInt(digits, 10));
            } else {
              out += n ?? '';
            }
          }
        }
        continue;
      }
      if (c === quote) {
        this.i++;
        return out;
      }
      out += c;
      this.i++;
    }
    throw new Error(`Unterminated string at ${this.posInfo()}`);
  }

  private readNumber(): number {
    const start = this.i;
    if (this.src[this.i] === '-') this.i++;
    while (this.i < this.src.length) {
      const c = this.src[this.i];
      if ((c >= '0' && c <= '9') || c === '.' || c === 'e' || c === 'E' || c === '+' || c === '-') {
        this.i++;
      } else {
        break;
      }
    }
    const n = Number(this.src.slice(start, this.i));
    if (!Number.isFinite(n)) throw new Error(`Bad number at ${this.posInfo()}`);
    return n;
  }

  private readTable(): LuaValue {
    this.expect('{');
    this.skipWs();
    // We'll decide array vs object after parsing entries — return as object if there
    // is any non-positional key, otherwise as array.
    const map: { [k: string]: LuaValue } = {};
    const arr: LuaValue[] = [];
    let hasNamedKey = false;
    let nextPosIdx = 1;

    while (this.src[this.i] !== '}') {
      this.skipWs();
      if (this.src[this.i] === '}') break;
      // Entry forms:
      //   ["k"] = v
      //   [123] = v
      //   ident = v
      //   v (positional)
      let key: string | number | null = null;
      if (this.src[this.i] === '[') {
        this.i++;
        this.skipWs();
        const k = this.readValue();
        this.skipWs();
        this.expect(']');
        this.skipWs();
        if (this.src[this.i] === '=') {
          this.i++;
          this.skipWs();
          key = typeof k === 'number' ? k : String(k);
        } else {
          // [v] without = shouldn't happen in SV, but treat as positional
          arr.push(k);
          this.afterEntry();
          continue;
        }
      } else {
        // try ident = ... lookahead
        const savedI = this.i;
        const ident = this.peekIdent();
        if (ident.length > 0) {
          const probe = this.i + ident.length;
          let k = probe;
          while (k < this.src.length && /\s/.test(this.src[k])) k++;
          if (this.src[k] === '=') {
            this.i = k + 1;
            this.skipWs();
            key = ident;
          } else {
            this.i = savedI;
          }
        }
      }

      const val = this.readValue();
      if (key === null) {
        arr.push(val);
        nextPosIdx++;
      } else {
        hasNamedKey = true;
        map[String(key)] = val;
      }
      this.afterEntry();
    }
    this.expect('}');

    if (!hasNamedKey) return arr;
    // Merge any positional values under integer keys so callers can still access them.
    arr.forEach((v, idx) => {
      map[String(idx + 1)] = v;
    });
    return map;
  }

  private afterEntry() {
    this.skipWs();
    if (this.src[this.i] === ',' || this.src[this.i] === ';') {
      this.i++;
      this.skipWs();
    }
  }
}

export function parseLuaSavedVariables(src: string): Record<string, LuaValue> {
  return new Parser(src).parseFile();
}
