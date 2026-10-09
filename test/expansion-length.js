var test = require('tape');
var expand = require('..');

// `performance` is only a global from Node 16 on; perf_hooks is built in
// since Node 8.5, so fall back to it on older runtimes.
var performance = (typeof globalThis !== 'undefined' && globalThis.performance)
  || require('perf_hooks').performance;

function repeat(str, times) {
  return new Array(times + 1).join(str);
}

function totalLength(list) {
  return list.reduce(function(sum, s) { return sum + s.length; }, 0);
}

// CVE-2026-14257: nothing bounded the *length* of the expansions, so chaining
// many brace groups kept each result small in count while every result grew
// with the number of groups. Building those long results (and the intermediate
// arrays combined along the way) exhausted memory and crashed the process with
// an uncatchable out-of-memory error.
test('total expansion length is bounded', function(t) {
  var str = repeat('{a,b}', 1500);
  var startTime = performance.now();
  var expanded = expand(str);
  var endTime = performance.now();
  var timeTaken = endTime - startTime;

  var total = totalLength(expanded);
  t.ok(
    total <= 4000000,
    'Expected total length (' + total + ') to be bounded'
  );
  t.ok(expanded.length > 0, 'still returns a (truncated) result');
  t.ok(
    expanded.every(function(s) { return /^[ab]+$/.test(s); }),
    'results are valid expansions'
  );
  t.ok(
    timeTaken < 5000,
    'Expected time (' + timeTaken + 'ms) to be less than 5000ms'
  );

  // The bound is a single accumulator, not a per-level limit, so it holds no
  // matter how many brace groups are chained - not `groups * maxLength`.
  var groupCounts = [100, 1500, 5000];
  for (var i = 0; i < groupCounts.length; i++) {
    var groups = groupCounts[i];
    var chained = totalLength(expand(repeat('{a,b}', groups)));
    t.ok(
      chained <= 4000000,
      'Expected total length (' + chained + ') to stay bounded at ' + groups + ' groups'
    );
  }
  t.end();
});

// Expanding the tail iteratively (rather than recursing once per brace group)
// keeps native stack depth constant, so deeply chained input that used to throw
// `RangeError: Maximum call stack size exceeded` around ~2,700 groups now
// returns a bounded result.
test('deep chaining does not overflow the stack', function(t) {
  var str = repeat('{a,b}', 50000);
  var expanded;
  try {
    expanded = expand(str);
  } catch (err) {
    t.fail(err.message);
    t.end();
    return;
  }
  t.ok(expanded.length > 0, 'still returns a (truncated) result');
  t.ok(totalLength(expanded) <= 4000000, 'output stays bounded');
  t.end();
});

test('maxLength option bounds output size', function(t) {
  var expanded = expand(repeat('{a,b}', 1500), { maxLength: 100000 });
  var total = totalLength(expanded);
  t.ok(
    total <= 100000,
    'Expected total length (' + total + ') to respect maxLength'
  );

  // The `${...}` literal branch combines its body with the expanded tail and
  // must be bounded the same way.
  var dollar = '${x}' + repeat('{a,b}', 20);
  var expandedDollar = expand(dollar, { maxLength: 100000 });
  var dollarLength = totalLength(expandedDollar);
  t.ok(
    dollarLength <= 100000,
    'Expected total length (' + dollarLength + ') to respect maxLength'
  );

  // The optional options argument must not change the no-argument behaviour.
  t.deepEqual(expand('{a,b}{c,d}'), ['ac', 'ad', 'bc', 'bd']);
  t.end();
});
