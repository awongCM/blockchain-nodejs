import {
  MAX_STACK,
  MAX_STEPS,
  MAX_STORAGE_KEYS,
  STORAGE_KEY,
  validateMethodBody,
} from './opcodes.js';

/**
 * @param {object} params
 * @param {Record<string, any[][]>} params.code
 * @param {Record<string, number|string>} params.storage
 * @param {number} params.balance
 * @param {string} params.fromAddress
 * @param {number} params.amount
 * @param {string} params.method
 * @param {Array<number|string>} [params.args]
 */
export function executeMethod({
  code,
  storage,
  balance,
  fromAddress,
  amount,
  method,
  args = [],
}) {
  const body = code?.[method];
  if (!body || !validateMethodBody(body)) {
    throw new Error(`Unknown or invalid method: ${method}`);
  }

  const stack = [...args];
  if (stack.length > MAX_STACK) {
    throw new Error('Stack overflow');
  }

  let contractBalance = balance + amount;
  if (!Number.isSafeInteger(contractBalance) || contractBalance < 0) {
    throw new Error('Invalid balance');
  }

  /** @type {Record<string, number|string>} */
  const nextStorage = { ...storage };
  /** @type {{ to: string, amount: number }[]} */
  const effects = [];
  let steps = 0;

  const push = (value) => {
    if (stack.length >= MAX_STACK) {
      throw new Error('Stack overflow');
    }
    stack.push(value);
  };

  const pop = () => {
    if (stack.length === 0) {
      throw new Error('Stack underflow');
    }
    return stack.pop();
  };

  for (const inst of body) {
    steps += 1;
    if (steps > MAX_STEPS) {
      throw new Error('Max steps exceeded');
    }

    const [op, arg] = inst;
    switch (op) {
      case 'push':
        push(arg);
        break;
      case 'load':
        push(Object.hasOwn(nextStorage, arg) ? nextStorage[arg] : 0);
        break;
      case 'store': {
        const value = pop();
        if (!STORAGE_KEY.test(arg)) {
          throw new Error('Invalid storage key');
        }
        if (
          !Object.hasOwn(nextStorage, arg) &&
          Object.keys(nextStorage).length >= MAX_STORAGE_KEYS
        ) {
          throw new Error('Storage key limit');
        }
        nextStorage[arg] = value;
        break;
      }
      case 'add':
      case 'sub':
      case 'mul': {
        const b = pop();
        const a = pop();
        if (typeof a !== 'number' || typeof b !== 'number') {
          throw new Error('Arithmetic requires numbers');
        }
        const result = op === 'add' ? a + b : op === 'sub' ? a - b : a * b;
        if (!Number.isSafeInteger(result)) {
          throw new Error('Arithmetic overflow');
        }
        push(result);
        break;
      }
      case 'eq': {
        const b = pop();
        const a = pop();
        push(a === b ? 1 : 0);
        break;
      }
      case 'lt': {
        const b = pop();
        const a = pop();
        if (typeof a !== 'number' || typeof b !== 'number') {
          throw new Error('lt requires numbers');
        }
        push(a < b ? 1 : 0);
        break;
      }
      case 'dup': {
        const top = pop();
        push(top);
        push(top);
        break;
      }
      case 'pop':
        pop();
        break;
      case 'caller':
        push(fromAddress);
        break;
      case 'value':
        push(amount);
        break;
      case 'balance':
        push(contractBalance);
        break;
      case 'transfer': {
        const transferAmount = pop();
        const to = pop();
        if (typeof to !== 'string' || !to) {
          throw new Error('transfer to must be address string');
        }
        if (
          typeof transferAmount !== 'number' ||
          !Number.isSafeInteger(transferAmount) ||
          transferAmount <= 0
        ) {
          throw new Error('transfer amount must be positive integer');
        }
        if (transferAmount > contractBalance) {
          throw new Error('Insufficient contract balance');
        }
        contractBalance -= transferAmount;
        effects.push({ to, amount: transferAmount });
        break;
      }
      case 'halt':
        return {
          storage: nextStorage,
          balance: contractBalance,
          effects,
          steps,
        };
      default:
        throw new Error(`Unknown opcode: ${op}`);
    }
  }

  return {
    storage: nextStorage,
    balance: contractBalance,
    effects,
    steps,
  };
}
