import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/**
 * Lint rules, chosen for correctness rather than style.
 *
 * TypeScript here already runs with `strict`, `noUnusedLocals`,
 * `noUnusedParameters`, `noFallthroughCasesInSwitch` and
 * `noUncheckedIndexedAccess`, so the usual crop of lint findings — unused
 * variables, implicit any, unchecked array access — cannot occur. There is no
 * point running rules that restate what the compiler already refuses.
 *
 * What the compiler cannot see, and what this config exists for:
 *
 *   - **Floating promises.** An Electron app is almost entirely async IPC. An
 *     un-awaited promise that rejects is an unhandled rejection that silently
 *     does nothing, and the symptom is a button that appears to work and
 *     doesn't.
 *   - **Promises passed where a synchronous function is expected** — an async
 *     function handed to something that ignores its return value, so the error
 *     goes nowhere and the caller carries on as though it succeeded.
 *   - **React hook dependencies.** A stale dependency array is the classic
 *     "why didn't the screen update", and it is invisible to both the compiler
 *     and the tests.
 *
 * Formatting is deliberately absent. Prettier owns that, and a lint error
 * about a space is noise standing between somebody and a real finding.
 */
export default tseslint.config(
  {
    // Build output, dependencies, and the installers. Nothing here is ours.
    ignores: ['out/**', 'release/**', 'node_modules/**', 'resources/**', '*.tsbuildinfo']
  },

  js.configs.recommended,

  /*
    Type-aware linting, which needs the compiler rather than just the parser.
    It is slower — it type-checks the project to answer questions like "is this
    expression a promise" — and it is the only way the rules above can work at
    all.
  */
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  },

  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      /*
        The four that justify the whole setup. Errors, not warnings: a warning
        in a project with no lint history is a warning nobody ever clears.
      */
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          /*
            React Router 7's `navigate()` returns a promise, and nothing in
            this app or any other awaits it — routing is not an operation you
            wait for. Left alone it reported every navigation in the app as a
            floating promise, which is nine call sites of noise standing in
            front of the real findings.

            Allowed here rather than by writing `void navigate(...)` at each
            site. The `void` idiom in this codebase means "this genuinely is
            async, and I am deliberately not waiting for it" — worth reading
            when it appears on an IPC call or a query invalidation, and worth
            nothing at all if it also decorates every route change.
          */
          allowForKnownSafeCalls: [
            { from: 'package', package: 'react-router', name: 'NavigateFunction' }
          ]
        }
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: {
            /*
              Off for the same reason `navigate` is allowed above: 27 of the 32
              findings here were `onClick={() => navigate('/somewhere')}`, which
              is the ordinary way to write a link-shaped button and not a defect.

              The other five were checked by hand rather than assumed. Four
              already caught their own errors and put them on screen; the fifth,
              `browse` in FirstRun, did not, and that was a real hole — see the
              comment there.

              `arguments` and `returns` stay on. Those catch an async function
              handed to something that will not wait for it, which is the shape
              of this mistake that actually loses data.
            */
            attributes: false
          }
        }
      ],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',

      /*
        `any` is worth knowing about but is not automatically a defect, and the
        unsafe-* family fires several times per `any`. Warnings, so they are
        visible without drowning the errors that need acting on.
      */
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',

      // The compiler already enforces these, and enforces them better.
      '@typescript-eslint/no-unused-vars': 'off',

      /*
        Byte-order marks, which this app handles deliberately in both
        directions: every CSV it writes begins with one so Excel opens the file
        as UTF-8 instead of mangling every pound sign, and every bank statement
        it reads has one stripped so the mark does not become part of the first
        column heading. Written as a literal U+FEFF, it reads to this rule as
        stray whitespace. Code outside a literal is still checked, which is
        where a stray non-breaking space would actually be a problem.
      */
      'no-irregular-whitespace': [
        'error',
        { skipStrings: true, skipTemplates: true, skipRegExps: true, skipComments: true }
      ],

      /*
        The only control characters in this codebase are `\x00-\x1f` in the two
        regexes that strip characters Windows forbids in a filename. That is
        precisely what the class is for, and both sites are commented. A rule
        that fires only on correct code is a rule that teaches people to ignore
        the linter.
      */
      'no-control-regex': 'off',

      /*
        Deliberate discards. `void somePromise()` is how this codebase says "I
        am starting this and not waiting for it", which is a real intention and
        reads better than an empty `.catch()`.
      */
      '@typescript-eslint/no-confusing-void-expression': 'off'
    }
  },

  /* The renderer: a browser, and the only place React runs. */
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },

  /* The main process and the build scripts: Node, not a browser. */
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node }
  },

  /*
    Tooling that sits outside the two tsconfigs.

    `eslint.config.mjs`, the build scripts and the vitest config are not part
    of `tsconfig.node.json` or `tsconfig.web.json`, and adding them purely to
    satisfy the linter would put build tooling into the app's own compilation.
    So they are linted without type information: the type-aware rules cannot
    run on them, and every other rule still can. Left as they were, each of
    these files reported a parsing error and was therefore not linted at all.
  */
  {
    files: ['*.mjs', '*.ts', 'scripts/**/*.mjs'],
    ignores: ['src/**'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: false, project: false }
    }
  },

  /*
    Tests. Vitest's `expect(...)` chains are expressions whose value is
    deliberately unused, and a test file asserting on a promise it has already
    awaited is not a floating promise.
  */
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-explicit-any': 'off',

      /*
        Assertions read arguments back off a mock, where a fetch body is typed
        as the union of everything a body can be. Stringifying one to check it
        is the assertion, not a mistake.
      */
      '@typescript-eslint/no-base-to-string': 'off',

      /*
        A test that makes something reject with a string is testing what
        happens when a non-Error arrives, which is a case the code has to
        survive. Requiring an Error here would delete the scenario.
      */
      '@typescript-eslint/only-throw-error': 'off'
    }
  }
)
