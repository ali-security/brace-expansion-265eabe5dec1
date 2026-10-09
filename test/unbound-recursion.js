var test = require('tape');
var expand = require('..');

// `performance` is only a global from Node 16 on; perf_hooks is built in
// since Node 8.5, so fall back to it on older runtimes.
var performance = (typeof globalThis !== 'undefined' && globalThis.performance)
  || require('perf_hooks').performance;

// https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-3jxr-9vmj-r5cp
test('unbound recursion', function(t) {
  // A run of non-expanding `{}` groups used to expand `post` once per group,
  // doubling the work on every group. This 30-group, 90 byte input blocked
  // for minutes.
  var str = 'a{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}';
  var startTime = performance.now();
  var expanded = expand(str);
  var endTime = performance.now();
  var timeTaken = endTime - startTime;
  t.deepEqual(expanded, [str], 'does not expand');
  t.ok(
    timeTaken < 1000,
    'Expected time (' + timeTaken + 'ms) to be less than 1000ms'
  );
  t.end();
});
