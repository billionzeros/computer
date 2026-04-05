/**
 * Code Generation eval dataset.
 *
 * Tests whether Anton produces correct, clean, working code
 * across common programming tasks. Scored on correctness,
 * completeness, and code quality.
 *
 * These test the CORE value prop — "is the code Anton writes any good?"
 */

import type { EvalDataset } from '../types.js'

export const codeGenerationDataset: EvalDataset = {
  name: 'chat-code-generation',
  description: 'Does Anton produce correct, clean, working code for common programming tasks?',
  cases: [
    // ── Pure function: algorithm ────────────────────────────────────
    {
      input:
        'Write a TypeScript function called `debounce` that takes a callback and delay in ms, and returns a debounced version. Include the type signature.',
      expected:
        'A generic debounce function with proper TypeScript types. Should use setTimeout/clearTimeout, return a function with the same signature, and handle `this` context correctly.',
      tags: ['typescript', 'algorithm', 'utility'],
    },

    // ── Data transformation ─────────────────────────────────────────
    {
      input:
        'Write a function `groupBy<T>(items: T[], key: keyof T): Record<string, T[]>` in TypeScript that groups an array of objects by a given key.',
      expected:
        'A generic groupBy function that iterates over items, uses the key to extract group values, and builds a Record. Should handle the case where the key value is used as a string index.',
      tags: ['typescript', 'data-transformation', 'generics'],
    },

    // ── Error handling pattern ──────────────────────────────────────
    {
      input:
        'Write a TypeScript function `fetchWithRetry(url: string, maxRetries: number): Promise<Response>` that retries failed fetch calls with exponential backoff.',
      expected:
        'An async function that catches fetch errors, implements exponential backoff (delay doubles each retry), respects maxRetries limit, and throws after all retries exhausted. Should use await and a loop or recursion.',
      tags: ['typescript', 'async', 'error-handling', 'networking'],
    },

    // ── React component ─────────────────────────────────────────────
    {
      input:
        'Write a React component called `SearchInput` that debounces user input by 300ms before calling an `onSearch` prop. Use hooks.',
      expected:
        'A functional React component using useState for the input value and useEffect (or useCallback with setTimeout) for debouncing. Should clean up the timeout on unmount or value change. Has an onSearch callback prop.',
      tags: ['react', 'hooks', 'component', 'debounce'],
    },

    // ── CLI script ──────────────────────────────────────────────────
    {
      input:
        'Write a Node.js script that reads a JSON file from a path given as a CLI argument, counts the number of keys in the top-level object, and prints the count.',
      expected:
        'Uses process.argv to get the file path, fs.readFileSync or fs.promises.readFile to read the file, JSON.parse to parse it, Object.keys().length to count keys, and console.log to print. Should handle missing argument and file-not-found errors.',
      tags: ['node', 'cli', 'filesystem', 'json'],
    },

    // ── SQL query ───────────────────────────────────────────────────
    {
      input:
        'Write a SQL query to find the top 5 customers by total order amount, including their name and total spent. Tables: customers(id, name, email) and orders(id, customer_id, amount, created_at).',
      expected:
        'A SELECT with JOIN between customers and orders, GROUP BY customer, SUM(amount) as total, ORDER BY total DESC, LIMIT 5. Should select customer name and the summed amount.',
      tags: ['sql', 'query', 'aggregation', 'join'],
    },

    // ── Bash/shell script ───────────────────────────────────────────
    {
      input:
        'Write a bash script that finds all .log files older than 7 days in /var/log and deletes them, printing how many files were deleted.',
      expected:
        'Uses find with -name "*.log" -mtime +7 -type f. Either uses -delete or -exec rm. Counts files (wc -l or a counter variable) and prints the count. Should handle the case where no files match.',
      tags: ['bash', 'filesystem', 'maintenance'],
    },

    // ── Type system / advanced TS ───────────────────────────────────
    {
      input:
        'Write a TypeScript type `DeepPartial<T>` that makes all properties of an object (and nested objects) optional, recursively.',
      expected:
        'A mapped type that iterates over keys of T, checks if the value is an object (using conditional type), and recursively applies DeepPartial. Should handle arrays and primitives correctly.',
      tags: ['typescript', 'types', 'advanced', 'recursive'],
    },

    // ── API endpoint ────────────────────────────────────────────────
    {
      input:
        'Write an Express.js POST endpoint at /api/users that validates the request body has name (string) and email (string), creates a user object with a generated id, and returns it as JSON with status 201.',
      expected:
        'An app.post handler that checks req.body for name and email, returns 400 if missing, generates an id (uuid or Date.now), constructs the user object, and responds with res.status(201).json(user).',
      tags: ['express', 'api', 'validation', 'rest'],
    },

    // ── Test writing ────────────────────────────────────────────────
    {
      input:
        'Write unit tests for a function `isPalindrome(str: string): boolean` that checks if a string reads the same forwards and backwards, ignoring case and non-alphanumeric characters. Use any test framework.',
      expected:
        'Tests covering: simple palindrome ("racecar"), mixed case ("RaceCar"), with spaces/punctuation ("A man, a plan, a canal: Panama"), empty string, single character, non-palindrome ("hello"), numbers ("12321").',
      tags: ['testing', 'unit-test', 'edge-cases'],
    },
  ],
}
