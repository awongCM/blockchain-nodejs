export const MAX_STEPS = 128;
export const MAX_STACK = 64;
export const MAX_STORAGE_KEYS = 32;
export const STORAGE_KEY = /^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/;

const OPS = new Set([
  'push',
  'load',
  'store',
  'add',
  'sub',
  'mul',
  'eq',
  'lt',
  'dup',
  'pop',
  'caller',
  'value',
  'balance',
  'transfer',
  'halt',
]);

/**
 * @param {unknown[]} inst
 * @returns {boolean}
 */
export function validateInstruction(inst) {
  if (!Array.isArray(inst) || typeof inst[0] !== 'string' || !OPS.has(inst[0])) {
    return false;
  }
  const [op, arg] = inst;
  switch (op) {
    case 'push':
      return (
        inst.length === 2 &&
        (typeof arg === 'number' || typeof arg === 'string') &&
        (typeof arg !== 'number' || Number.isSafeInteger(arg))
      );
    case 'load':
    case 'store':
      return inst.length === 2 && typeof arg === 'string' && STORAGE_KEY.test(arg);
    case 'add':
    case 'sub':
    case 'mul':
    case 'eq':
    case 'lt':
    case 'dup':
    case 'pop':
    case 'caller':
    case 'value':
    case 'balance':
    case 'transfer':
    case 'halt':
      return inst.length === 1;
    default:
      return false;
  }
}

/**
 * @param {unknown[]} body
 * @returns {boolean}
 */
export function validateMethodBody(body) {
  return (
    Array.isArray(body) &&
    body.length > 0 &&
    body.length <= 32 &&
    body.every(validateInstruction)
  );
}
