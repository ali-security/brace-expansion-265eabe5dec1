var test = require('tape');
var expand = require('..');

// `performance` is only a global from Node 16 on; perf_hooks is built in
// since Node 8.5, so fall back to it on older runtimes.
var performance = (typeof globalThis !== 'undefined' && globalThis.performance)
  || require('perf_hooks').performance;

function repeat(str, times) {
  return new Array(times + 1).join(str);
}

function joinRepeat(str, times, sep) {
  var parts = [];
  for (var i = 0; i < times; i++) {
    parts.push(str);
  }
  return parts.join(sep);
}

function totalLength(list) {
  return list.reduce(function(sum, s) { return sum + s.length; }, 0);
}

// Bypass of CVE-2026-14257's mitigation: each comma-separated alternative
// (`{alt,alt,...}`) is expanded independently, and `maxLength` only bounded
// each alternative's own output, not the running total accumulated across
// all of them. Many alternatives - each individually far under `maxLength` -
// could still sum to an unbounded intermediate array before the final
// `combine` call ever got a chance to truncate.
test('total length across comma alternatives is bounded', function(t) {
  var alt = '{1..5}';
  var str = '{' + joinRepeat(alt, 1000, ',') + '}';
  var startTime = performance.now();
  var expanded = expand(str, { maxLength: 50 });
  var timeTaken = performance.now() - startTime;

  var total = totalLength(expanded);
  t.ok(
    total <= 50,
    'Expected total length (' + total + ') to respect maxLength'
  );
  t.ok(expanded.length > 0, 'still returns a (truncated) result');
  t.ok(
    timeTaken < 500,
    'Expected time (' + timeTaken + 'ms) to be less than 500ms'
  );

  // Regression case from the report: 400 alternatives, each individually
  // bounded by maxLength but unbounded in aggregate before the fix. Every
  // alternative is a padded sequence of 100,000 elements, so the intermediate
  // `values` array used to hold 40,000,000 strings - gigabytes - before
  // `combine` ever saw them.
  var part = '{' + repeat('0', 50) + '1..100000}';
  var bigStr = '{' + joinRepeat(part, 400, ',') + '}';
  var bigStart = performance.now();
  var bigExpanded;
  try {
    bigExpanded = expand(bigStr);
  } catch (err) {
    t.fail(err.message);
    t.end();
    return;
  }
  var bigElapsed = performance.now() - bigStart;
  var bigTotal = totalLength(bigExpanded);
  t.ok(
    bigTotal <= 4000000,
    'Expected total length (' + bigTotal + ') to stay bounded'
  );
  t.ok(bigExpanded.length > 0, 'still returns a (truncated) result');
  t.ok(
    bigElapsed < 5000,
    'Expected time (' + bigElapsed + 'ms) to be less than 5000ms'
  );

  t.end();
});

// A padded sequence's element width follows the input, so generating every
// element before `combine` could discard them cost time and memory
// proportional to the sequence length times that width - a ~400KB input
// blocked the event loop for over two minutes (and exhausted the heap).
test('padded sequences respect maxLength while generating', function(t) {
  var str = '{' + repeat('0', 400000) + '1..100000}';
  var startTime = performance.now();
  var expanded;
  try {
    expanded = expand(str);
  } catch (err) {
    t.fail(err.message);
    t.end();
    return;
  }
  var elapsed = performance.now() - startTime;

  var total = totalLength(expanded);
  t.ok(
    total <= 4000000,
    'Expected total length (' + total + ') to stay bounded'
  );
  t.ok(expanded.length > 0, 'still returns a (truncated) result');
  t.ok(
    elapsed < 5000,
    'Expected time (' + elapsed + 'ms) to be less than 5000ms'
  );

  // The same shape under an explicit, much smaller `maxLength`.
  var small = expand(str, { maxLength: 1000000 });
  t.ok(
    totalLength(small) <= 1000000,
    'Expected total length to respect an explicit maxLength'
  );

  t.end();
});

// Truncating while generating must not change results that fit within the
// bound - the bound only ever removes what `combine` would have dropped.
test('bounded generation leaves small expansions untouched', function(t) {
  t.same(
    expand('{01..10}'),
    ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'],
    'padded sequences under the bound are unaffected'
  );
  t.same(expand('{1..5}'), ['1', '2', '3', '4', '5']);
  t.same(expand('{a..e}'), ['a', 'b', 'c', 'd', 'e']);
  t.same(expand('{a,b,c}'), ['a', 'b', 'c']);
  t.same(expand('x{a,b}y{c,d}z'), ['xaycz', 'xaydz', 'xbycz', 'xbydz']);
  t.same(expand('{a,,b}'), ['a', 'b'], 'empty alternatives are still dropped');
  t.same(expand('x{a,,b}y'), ['xay', 'xy', 'xby'], 'kept empties survive');

  // A full 1..1000 numeric sequence stays complete: the bound is on
  // characters, not on the number of results.
  var seq = expand('{1..1000}');
  t.equal(seq.length, 1000, 'no result-count cap was introduced');
  t.equal(seq[999], '1000');

  t.end();
});
