export const MAX_STEPS = 128;
export const MAX_STACK = 64;
export const MAX_STORAGE_KEYS = 32;
export const MAX_LITERAL_STRING = 256;
export const STORAGE_KEY = /^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/;

const FORBIDDEN_STORAGE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

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
 * @param {string} key
 * @returns {boolean}
 */
export function isValidStorageKey(key) {
  return (
    typeof key === 'string' &&
    STORAGE_KEY.test(key) &&
    !FORBIDDEN_STORAGE_KEYS.has(key)
  );
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidLiteral(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value);
  }
  if (typeof value === 'string') {
    return value.length <= MAX_LITERAL_STRING;
  }
  return false;
}

/** @alias isValidLiteral */
export const isValidCallArg = isValidLiteral;

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
      return inst.length === 2 && isValidLiteral(arg);
    case 'load':
    case 'store':
      return inst.length === 2 && isValidStorageKey(arg);
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
    body.length <= MAX_STEPS &&
    body.every(validateInstruction)
  );
}

/**
 * Clone contract storage into a null-prototype object.
 * @param {Record<string, unknown>} [storage]
 * @returns {Record<string, number|string>}
 */
export function cloneStorage(storage = {}) {
  return Object.assign(Object.create(null), storage);
}
