/**
 * Spring route parsing: pure functions with no dependency on the vscode API, so
 * the logic can be unit tested on its own.
 *
 * A Spring URL is assembled from a class level @RequestMapping prefix and a
 * method level mapping. The full path never exists as a string in the source,
 * so both halves are parsed separately and then joined.
 */

export interface ParsedRoute {
  httpMethod: string;
  fullPath: string;
  handler: string;
  line: number;
}

/** Annotations hold expressions, not final paths; resolve them after constants are known. */
export interface RawRoute {
  httpMethod: string;
  handler: string;
  line: number;
  classExpressions: string[];
  methodExpressions: string[];
}

export interface FileScan {
  className: string;
  constants: Map<string, string>;
  routes: RawRoute[];
}

export interface ConstantTable {
  simple: Map<string, string[]>;
  qualified: Map<string, string>;
}

export type ReferenceResolver = (reference: string) => string | undefined;

const MAPPING_NAMES = [
  'RequestMapping',
  'GetMapping',
  'PostMapping',
  'PutMapping',
  'DeleteMapping',
  'PatchMapping',
];

const TYPE_DECLARATION = /\b(?:class|interface|enum|record)\s+(\w+)/;

const METHOD_MODIFIERS =
  'public|protected|private|static|final|abstract|synchronized|native|default|strictfp';

/**
 * The declaration must start a line and the return type may not contain
 * whitespace. Both constraints keep matching from degrading into quadratic
 * backtracking on malformed input.
 */
const METHOD_DECLARATION = new RegExp(
  `^[ \\t]*(?:@\\w+(?:\\([^()]*\\))?[ \\t]*)*`
    + `(?:(?:${METHOD_MODIFIERS})[ \\t]+)*`
    + `[\\w.$]+(?:<[^<>]*(?:<[^<>]*>[^<>]*)*>)?(?:[ \\t]*\\[\\])*`
    + `[ \\t]+(\\w+)[ \\t]*\\(`,
  'gm'
);

// Real code declares the handler right after the mapping annotation, so stop
// looking past this window instead of scanning the rest of a malformed file.
const HANDLER_LOOKAHEAD_LINES = 40;
const HANDLER_LOOKAHEAD_CHARS = 4000;

const STATIC_CONSTANT = /(?:static\s+final|final\s+static)\s+String\s+(\w+)\s*=\s*"([^"]*)"/g;
const INTERFACE_CONSTANT = /(?:^|[;{\s])(?:public\s+|protected\s+|private\s+)?String\s+(\w+)\s*=\s*"([^"]*)"/gm;
const REQUEST_METHOD = /RequestMethod\.(\w+)/;

interface AnnotationOccurrence {
  name: string;
  body: string;
  start: number;
  end: number;
}

interface PendingRoute {
  httpMethod: string;
  handler: string;
  handlerIndex: number;
  classExpressions: string[];
  methodExpressions: string[];
}

export function scanJavaFile(source: string): FileScan {
  const masked = maskComments(source);
  const inString = markStrings(masked);
  const depths = computeDepths(masked, inString);

  const typeMatch = TYPE_DECLARATION.exec(masked);
  if (!typeMatch || inString[typeMatch.index]) {
    return emptyScan();
  }

  const className = typeMatch[1];
  const typeKeyword = typeMatch[0].trim().split(/\s+/)[0];
  const typeEnd = typeMatch.index + typeMatch[0].length;
  const bodyStart = findBodyStart(masked, depths, typeEnd);
  if (bodyStart < 0) {
    return { className, constants: new Map(), routes: [] };
  }

  const annotations = collectAnnotations(masked, inString);
  const constants = collectConstants(masked, inString, depths, typeKeyword);
  // Annotations before the type declaration form the path prefix; use the one
  // closest to the declaration, or fall back to the root path.
  const classAnnotation = annotations
    .filter((annotation) => annotation.start < bodyStart)
    .pop();
  const classExpressions = classAnnotation ? pathExpressions(classAnnotation.body) : [''];

  const pending: PendingRoute[] = [];
  // Mappings inside nested types sit at a deeper brace level and are skipped, so
  // an inner class is not mistaken for a controller.
  for (const annotation of annotations) {
    if (annotation.start < bodyStart || depths[annotation.start] !== 1) {
      continue;
    }
    const handler = findHandler(masked, inString, annotation.end);
    if (!handler) {
      continue;
    }
    pending.push({
      httpMethod: httpMethodOf(annotation.name, annotation.body),
      handler: handler.name,
      handlerIndex: handler.index,
      classExpressions,
      methodExpressions: pathExpressions(annotation.body),
    });
  }

  // Build the line index once instead of counting newlines per route.
  const lineStarts = pending.length > 0 ? buildLineStarts(source) : [];
  const routes: RawRoute[] = pending.map((route) => ({
    httpMethod: route.httpMethod,
    handler: route.handler,
    line: lineOf(lineStarts, route.handlerIndex),
    classExpressions: route.classExpressions,
    methodExpressions: route.methodExpressions,
  }));

  return { className, constants, routes };
}

export function collectConstantTable(scans: FileScan[]): ConstantTable {
  const simple = new Map<string, string[]>();
  const qualified = new Map<string, string>();
  for (const scan of scans) {
    for (const [name, value] of scan.constants) {
      qualified.set(`${scan.className}.${name}`, value);
      simple.set(name, [...(simple.get(name) ?? []), value]);
    }
  }
  return { simple, qualified };
}

/** Constants may live in this file, a sibling type, or another class; resolve nearest first. */
export function makeResolver(
  table: ConstantTable,
  localConstants: Map<string, string>
): ReferenceResolver {
  return (reference) => {
    const name = reference.trim();
    if (!name) {
      return undefined;
    }
    const local = localConstants.get(name);
    if (local !== undefined) {
      return local;
    }
    if (name.includes('.')) {
      return table.qualified.get(name);
    }
    const candidates = table.simple.get(name);
    // Only substitute a bare name when it maps to exactly one value, otherwise
    // keep the placeholder rather than point at the wrong path.
    return candidates && new Set(candidates).size === 1 ? candidates[0] : undefined;
  };
}

export function resolveRoutes(scan: FileScan, resolve: ReferenceResolver): ParsedRoute[] {
  const routes: ParsedRoute[] = [];
  for (const raw of scan.routes) {
    for (const classExpression of raw.classExpressions) {
      const prefix = resolveExpression(classExpression, resolve);
      if (prefix === undefined) {
        continue;
      }
      for (const methodExpression of raw.methodExpressions) {
        const methodPath = resolveExpression(methodExpression, resolve);
        if (methodPath === undefined) {
          continue;
        }
        routes.push({
          httpMethod: raw.httpMethod,
          fullPath: joinPath(prefix, methodPath),
          handler: raw.handler,
          line: raw.line,
        });
      }
    }
  }
  return routes;
}

function emptyScan(): FileScan {
  return { className: '', constants: new Map(), routes: [] };
}

/** Annotations inside comments must be ignored, or commented-out endpoints pollute the index. */
export function maskComments(source: string): string {
  const chars = source.split('');
  let index = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let quote: string | null = null;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      } else {
        chars[index] = ' ';
      }
      index++;
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        chars[index] = ' ';
        chars[index + 1] = ' ';
        inBlockComment = false;
        index += 2;
        continue;
      }
      if (char !== '\n') {
        chars[index] = ' ';
      }
      index++;
      continue;
    }
    if (quote) {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      index++;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      index++;
      continue;
    }
    if (char === '/' && next === '/') {
      chars[index] = ' ';
      inLineComment = true;
      index++;
      continue;
    }
    if (char === '/' && next === '*') {
      chars[index] = ' ';
      inBlockComment = true;
      index++;
      continue;
    }
    index++;
  }
  return chars.join('');
}

function markStrings(masked: string): Uint8Array {
  const inString = new Uint8Array(masked.length);
  let quote: string | null = null;
  for (let index = 0; index < masked.length; index++) {
    const char = masked[index];
    if (quote) {
      inString[index] = 1;
      if (char === '\\') {
        if (index + 1 < masked.length) {
          inString[index + 1] = 1;
        }
        index++;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      inString[index] = 1;
    }
  }
  return inString;
}

/** Track the brace depth of every character to tell class members from nested types and bodies. */
function computeDepths(masked: string, inString: Uint8Array): Int32Array {
  const depths = new Int32Array(masked.length);
  let depth = 0;
  for (let index = 0; index < masked.length; index++) {
    depths[index] = depth;
    if (inString[index]) {
      continue;
    }
    const char = masked[index];
    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  return depths;
}

function findBodyStart(masked: string, depths: Int32Array, from: number): number {
  for (let index = from; index < masked.length; index++) {
    if (masked[index] === '{' && depths[index] === 0) {
      return index;
    }
  }
  return -1;
}

function collectAnnotations(masked: string, inString: Uint8Array): AnnotationOccurrence[] {
  const occurrences: AnnotationOccurrence[] = [];
  const pattern = new RegExp(`@(${MAPPING_NAMES.join('|')})\\b`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(masked)) !== null) {
    if (inString[match.index]) {
      continue;
    }
    let cursor = match.index + match[0].length;
    while (cursor < masked.length && /\s/.test(masked[cursor])) {
      cursor++;
    }
    let body = '';
    let end = cursor;
    if (masked[cursor] === '(') {
      const balanced = readBalanced(masked, cursor, inString);
      if (balanced) {
        body = balanced.body;
        end = balanced.end;
      }
    }
    occurrences.push({ name: match[1], body, start: match.index, end });
  }
  return occurrences;
}

function readBalanced(masked: string, openIndex: number, inString: Uint8Array) {
  let depth = 0;
  for (let index = openIndex; index < masked.length; index++) {
    if (inString[index]) {
      continue;
    }
    const char = masked[index];
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth === 0) {
        return { body: masked.slice(openIndex + 1, index), end: index + 1 };
      }
    }
  }
  return undefined;
}

/**
 * The handler for a mapping is declared right after its annotation.
 *
 * Search only between the annotation's line and a bounded window after it: a
 * malformed file can follow an annotation with a very long stretch of text with
 * no parenthesis, and scanning all of it turned parsing quadratic.
 */
function findHandler(masked: string, inString: Uint8Array, from: number) {
  const windowStart = masked.lastIndexOf('\n', from) + 1;
  const windowEnd = handlerWindowEnd(masked, from);
  const window = masked.slice(windowStart, windowEnd);
  const pattern = new RegExp(METHOD_DECLARATION.source, METHOD_DECLARATION.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(window)) !== null) {
    const matchIndex = windowStart + match.index;
    if (inString[matchIndex]) {
      continue;
    }
    const between = masked.slice(from, matchIndex);
    // An assignment, statement end or block means the annotation is separated
    // from the method by a field or another statement; do not guess a name here,
    // or a constructor call would be reported as the handler.
    if (/[=;{}]/.test(between)) {
      return undefined;
    }
    const parenIndex = matchIndex + match[0].length - 1;
    let nameEnd = parenIndex;
    while (nameEnd > matchIndex && /\s/.test(masked[nameEnd - 1])) {
      nameEnd--;
    }
    return { name: match[1], index: nameEnd - match[1].length };
  }
  return undefined;
}

function handlerWindowEnd(masked: string, from: number): number {
  const charLimit = Math.min(masked.length, from + HANDLER_LOOKAHEAD_CHARS);
  let end = from;
  let lines = 0;
  while (end < charLimit && lines < HANDLER_LOOKAHEAD_LINES) {
    if (masked[end] === '\n') {
      lines++;
    }
    end++;
  }
  return end;
}

function httpMethodOf(annotationName: string, body: string): string {
  if (annotationName !== 'RequestMapping') {
    return annotationName.replace('Mapping', '').toUpperCase();
  }
  const found = REQUEST_METHOD.exec(body);
  return found ? found[1] : 'ANY';
}

/** Keep only value/path attributes; strings in produces, method, etc. are not paths. */
function pathExpressions(body: string): string[] {
  if (!body.trim()) {
    return [''];
  }
  const expressions: string[] = [];
  for (const parameter of splitTopLevel(body, ',')) {
    const equals = topLevelEquals(parameter);
    if (equals < 0) {
      // Only the first positional argument is a path, as in @GetMapping("/a").
      if (expressions.length === 0) {
        expressions.push(...flattenArray(parameter));
      }
      continue;
    }
    const name = parameter.slice(0, equals).trim();
    if (name === 'value' || name === 'path') {
      expressions.push(...flattenArray(parameter.slice(equals + 1)));
    }
  }
  return expressions.length > 0 ? expressions : [''];
}

function flattenArray(expression: string): string[] {
  const trimmed = expression.trim();
  if (!trimmed.startsWith('{')) {
    return [trimmed];
  }
  const closing = trimmed.lastIndexOf('}');
  const inner = trimmed.slice(1, closing < 0 ? undefined : closing);
  return splitTopLevel(inner, ',').map((item) => item.trim());
}

/** Resolve expressions such as "/api" + "/list"; unresolved constants become *. */
function resolveExpression(
  expression: string,
  resolve: ReferenceResolver
): string | undefined {
  // An empty expression means "no path", e.g. a method on a class mapped at "/api".
  if (!expression.trim()) {
    return '';
  }
  let resolved = '';
  let hasConcretePart = false;
  for (const term of splitTopLevel(expression, '+')) {
    const literal = quotedLiteral(term);
    if (literal !== undefined) {
      resolved += literal;
      hasConcretePart = hasConcretePart || literal.length > 0;
      continue;
    }
    const constant = resolve(term);
    if (constant !== undefined) {
      resolved += constant;
      hasConcretePart = hasConcretePart || constant.length > 0;
      continue;
    }
    resolved += '*';
  }
  return hasConcretePart ? resolved : undefined;
}

function quotedLiteral(term: string): string | undefined {
  const trimmed = term.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return undefined;
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      current += char;
      if (char === '\\') {
        current += text[index + 1] ?? '';
        index++;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(' || char === '{' || char === '[') {
      depth++;
    } else if (char === ')' || char === '}' || char === ']') {
      depth--;
    } else if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function topLevelEquals(parameter: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < parameter.length; index++) {
    const char = parameter[index];
    if (quote) {
      if (char === '\\') {
        index++;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(' || char === '{' || char === '[') {
      depth++;
    } else if (char === ')' || char === '}' || char === ']') {
      depth--;
    } else if (char === '=' && depth === 0) {
      const previous = parameter[index - 1];
      const next = parameter[index + 1];
      if (next !== '=' && previous !== '=' && previous !== '!' && previous !== '<' && previous !== '>') {
        return index;
      }
    }
  }
  return -1;
}

function collectConstants(
  masked: string,
  inString: Uint8Array,
  depths: Int32Array,
  typeKeyword: string
): Map<string, string> {
  const constants = new Map<string, string>();
  const patterns = typeKeyword === 'interface'
    ? [STATIC_CONSTANT, INTERFACE_CONSTANT]
    : [STATIC_CONSTANT];
  for (const pattern of patterns) {
    const matcher = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(masked)) !== null) {
      if (inString[match.index] || depths[match.index] !== 1) {
        continue;
      }
      constants.set(match[1], match[2]);
    }
  }
  return constants;
}

function joinPath(prefix: string, methodPath: string): string {
  const combined = `/${prefix}/${methodPath}`.replace(/\/{2,}/g, '/');
  const trimmed = combined.length > 1 ? combined.replace(/\/+$/, '') : combined;
  return trimmed || '/';
}

function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\n') {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineOf(lineStarts: number[], index: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (lineStarts[middle] <= index) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low + 1;
}
