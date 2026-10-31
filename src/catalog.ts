export const keywords = ['assign', 'as', 'reassign', 'show', 'if', 'else', 'while', 'function', 'be', 'return', 'err', 'true', 'false'];
export const types = ['int', 'float', 'bool', 'string', 'result'];
export interface Callable { name: string; parameters: string[]; result: string; description: string; optional?: boolean }
const builtin = (name: string, parameters: string[], result: string, description: string, optional = false): Callable => ({ name, parameters, result, description, optional });
export const builtins: Callable[] = [
  builtin('abs', ['x: int | float'], 'int | float', 'Absolute value; preserves the scalar type. Integer overflow is checked.'),
  builtin('sqrt', ['x: float'], 'float', 'Square root. Requires a float; sqrt(9.0) is valid, sqrt(9) is not.'),
  builtin('min', ['a: int | float', 'b: int | float'], 'int | float', 'Minimum. Widens to float when either argument is float.'),
  builtin('max', ['a: int | float', 'b: int | float'], 'int | float', 'Maximum. Widens to float when either argument is float.'),
  builtin('len', ['value: numeric array | string'], 'int', 'Array element count or Unicode scalar count for a string.'),
  builtin('sum', ['values: numeric array'], 'int | float', 'Ordered sum; integer addition checks overflow.'),
  builtin('input', ['prompt: string'], 'string', 'Read a UTF-8 line. EOF and read failures stop the program.', true),
  builtin('try_input', ['prompt: string'], 'result<string>', 'Read a UTF-8 line with explicit EOF and error handling.', true),
  builtin('parse_int', ['text: string'], 'result<int>', 'Strict signed decimal parsing.'),
  builtin('parse_float', ['text: string'], 'result<float>', 'Strict finite decimal parsing.'),
  builtin('to_string', ['value: int | float | bool | string'], 'string', 'Explicit scalar conversion to string.'),
  builtin('ok', ['value: T'], 'result<T>', 'Construct a successful scalar result.'),
  builtin('err', ['code: int'], 'result<T>', 'Construct an error with an explicit scalar payload type: err<int>(8).'),
  builtin('is_ok', ['value: result<T>'], 'bool', 'Test whether a result is successful.'),
  builtin('is_eof', ['value: result<T>'], 'bool', 'Test whether input reached EOF.'),
  builtin('error_code', ['value: result<T>'], 'int', 'Read a result status code.'),
  builtin('error_message', ['value: result<T>'], 'string', 'Describe a result status.'),
  builtin('unwrap', ['value: result<T>'], 'T', 'Extract a successful payload. Failure stops the program; check is_ok first.')
];
export const keywordHelp: Record<string, string> = {
  assign: 'Declare an inferred variable: assign name as expression. The initializer can read an outer binding before introducing the new name.',
  reassign: 'Update an existing variable: reassign name as expression. The declared type must be preserved, with int-to-float widening allowed.',
  as: 'Required separator between a variable name and its value.',
  show: 'Print a scalar or string followed by a newline: show expression.',
  function: 'Declare a top-level function: function name(x: int) be int { return x }. Functions cannot capture top-level variables.',
  be: 'Required separator before a function return type.',
  return: 'Return a value from a function. Every path must return a value.',
  if: 'Conditional block: if condition { ... } else { ... }. The condition must be bool.',
  else: 'Alternative branch of an if statement.',
  while: 'Repeat a block while a bool condition holds.',
  int: 'Signed 64-bit integer. Arithmetic overflow is checked.',
  float: '64-bit floating point. Integer-to-float widening is supported.',
  bool: 'Boolean: true or false.',
  string: 'Immutable UTF-8 string. Escapes: \\n, \\r, \\t, \\\\, and \\".',
  result: 'Explicit success/error result with a scalar payload: result<int>, result<float>, result<bool>, or result<string>.'
};
export function signature(callable: Callable): string {
  const name = callable.name === 'err' ? 'err<T>' : callable.name;
  return `${name}(${callable.parameters.map(p => callable.optional ? `[${p}]` : p).join(', ')}) be ${callable.result}`;
}
