var test = require('tape');
var expand = require('..');

// `performance` is only a global from Node 16 on; perf_hooks is built in
// since Node 8.5, so fall back to it on older runtimes.
var performance = (typeof globalThis !== 'undefined' && globalThis.performance)
  || require('perf_hooks').performance;

// Bash keeps a quirk where a brace group followed by a comma set still expands
// (`{a},b}`). The parser rewrites the string and restarts the scan, absorbing
// one `}` per pass, so `n` trailing braces cost `n` passes over a string that
// itself grows by one `escClose` sentinel each time - quadratic in `n`. 128KB
// of this shape blocked the event loop for 27 seconds to produce 2 results.
test('the {a},b} rewrite does not run in quadratic time', function (t) {
  var build = function (n) { return '{a}' + '}'.repeat(n) + ',z}' }

  var startTime = performance.now()
  expand(build(128000))
  var elapsed = performance.now() - startTime
  t.ok(elapsed < 2000, 'Expected time (' + elapsed + 'ms) to be less than 2000ms')

  // The output bound does not apply: the payload yields a couple of results at
  // any size, so the cost is all in parsing.
  t.doesNotThrow(function () { expand(build(128000), { maxLength: 1 }) })

  t.end();
})

test('maxRewrites option bounds the rescan count', function (t) {
  var build = function (n) { return '{a}' + '}'.repeat(n) + ',z}' }

  // Real `{a},b}` input needs a handful of passes, and is untouched.
  t.deepEqual(expand('{a},b}'), ['a}', 'b'])
  t.deepEqual(expand('a{},b}c'), ['a}c', 'abc'])

  // Below the bound the result matches an unbounded expansion exactly.
  var ns = [1, 10, 100]
  for (var i = 0; i < ns.length; i++) {
    t.deepEqual(
      expand(build(ns[i]), { maxRewrites: 1000 }),
      expand(build(ns[i]), { maxRewrites: 100000 }),
      ns[i] + ' trailing braces are unchanged below the bound'
    )
  }

  // Past it the scan stops restarting and the rest stays literal, rather than
  // throwing - the same way `maxLength` and `maxDepth` truncate.
  t.deepEqual(expand('{a},b}', { maxRewrites: 0 }), ['{a},b}'])
  t.ok(
    expand(build(50), { maxRewrites: 10 })[0].indexOf('{a}') === 0,
    'past the bound the group comes back literal'
  )

  t.end();
})

// The bound is per scan, not per stretch of it: a group that already expanded
// ahead of the payload must not hand the rewrite loop a fresh budget, and a
// run of non-expanding groups ahead of a comma set (`{a}{a}{q,z}`) restarts the
// scan once per group, re-walking every remaining brace each time.
test('other shapes of the {a},b} rewrite are bounded too', function (t) {
  var build = function (n) { return '{a}' + '}'.repeat(n) + ',z}' }

  var chainedStart = performance.now()
  var chained = expand('{x,y}' + build(128000))
  var chainedElapsed = performance.now() - chainedStart
  t.equal(chained.length, 2, 'the leading group still expands')
  t.ok(
    chainedElapsed < 2000,
    'Expected time (' + chainedElapsed + 'ms) to be less than 2000ms'
  )
  t.deepEqual(expand('{x,y}{a},b}'), ['xa}', 'xb', 'ya}', 'yb'])

  var groupsStart = performance.now()
  expand('{a}'.repeat(20000) + '{q,z}')
  var groupsElapsed = performance.now() - groupsStart
  t.ok(
    groupsElapsed < 5000,
    'Expected time (' + groupsElapsed + 'ms) to be less than 5000ms'
  )

  // Below the bound a run of groups still expands as Bash does; past it the
  // input comes back literal.
  var groups = '{a}{a}{a}{a}{a}'
  t.deepEqual(expand(groups + '{q,z}'), [groups + 'q', groups + 'z'])
  t.deepEqual(expand(groups + '{q,z}', { maxRewrites: 2 }), [groups + '{q,z}'])

  t.end();
})
