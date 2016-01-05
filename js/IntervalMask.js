(function(exports){
  
/**
 * IntervalMask
 *
 * A data structure for storing a series of non-overlapping intervals within a larger range.
 * As intervals are added to the IntervalMask, they replace or are merged with overlapping intervals.
 * 
 **/
  
function IntervalMask(min, max) {
  if (typeof min != 'number') { throw new Error('you must specify the minimum value as the 1st argument.'); }
  if (typeof max != 'number') { throw new Error('you must specify the maximum value as the 2nd argument.'); }
  
  this.min = min;
  this.max = max;
  
  this.starts = new SortedList(null, "number");
  this.ends = new SortedList(null, "number");
}

/**
 * public methods
 **/


// Search for and return all stored subintervals that overlap with the interval from `start` to `end`.
IntervalMask.prototype.search = function(start, end) {
  if (typeof start != 'number') { throw new Error('you must specify the start value as the 1st argument.'); }
  if (typeof end != 'number') { throw new Error('you must specify the end value as the 2nd argument.'); }
  
  var indices = _search(this, start, end);
  return this.slice(indices.startIndex, indices.endIndex);
};

// Return an array of {start: start, end: end} intervals stored between the provided indices, 
// using the Array.prototype.slice() convention of not including endIndex in the output.
IntervalMask.prototype.slice = function(startIndex, endIndex) {
  var ret = [],
    size = this.size();
  startIndex = typeof startIndex == 'number' ? Math.max(startIndex, 0) : 0;
  endIndex = typeof endIndex == 'number' ? Math.min(endIndex, size) : size;
  for (var i = Math.max(startIndex, 0); i < endIndex; i++) {
    ret.push({start: this.starts.get(i), end: this.ends.get(i)});
  }
  return ret;
}

// How many individual subintervals are stored in this IntervalMask?
IntervalMask.prototype.size = function() {
  return this.starts.size();
}

// Convert to an array of intervals using .slice() conventions above.
IntervalMask.prototype.toArray = function() {
  return this.slice();
}

// Subtracts the contents of the IntervalMask from the specified interval.
//
// Returns the parts of the interval that are not already in the IntervalMask, in the form of
// an array of {start: start, end: end} objects.
IntervalMask.prototype.subtractFrom = function(start, end) {
  if (typeof start != 'number') { throw new Error('you must specify the start value as the 1st argument.'); }
  if (typeof end != 'number') { throw new Error('you must specify the end value as the 2nd argument.'); }
  start = Math.max(start, this.min);
  end = Math.min(end, this.max);
  
  var indices = _search(this, start, end),
    results = this.slice(indices.startIndex, indices.endIndex);
  
  return _subtract(results, {start: start, end: end});
}

// Add a new interval to the IntervalMask.
//
// Returns the parts of the added interval that were not already in the IntervalMask, in the form of
// an array of {start: start, end: end} objects.
IntervalMask.prototype.add = function(start, end) {
  if (typeof start != 'number') { throw new Error('you must specify the start value as the 1st argument.'); }
  if (typeof end != 'number') { throw new Error('you must specify the end value as the 2nd argument.'); }
  start = Math.max(start, this.min);
  end = Math.min(end, this.max);
  
  var indices = _search(this, start, end),
    results = this.slice(indices.startIndex, indices.endIndex),
    previousInterval = this.slice(indices.startIndex - 1, indices.startIndex)[0],
    nextInterval = this.slice(indices.endIndex, indices.endIndex + 1)[0],
    replacementInterval = {start: start, end: end},
    newlyAdded = _subtract(results, {start: start, end: end});
  
  // Expand results to adjacent intervals that are touching the interval to be added (to join them all into one)
  if (previousInterval && previousInterval.end == start) {
    results.unshift(previousInterval);
    indices.startIndex--;
  }
  if (nextInterval && nextInterval.start == end) {
    results.push(nextInterval);
    indices.endIndex++;
  }
  
  // Delete intervals that will be replaced by the new interval
  if (results.length > 0) {
    replacementInterval.start = Math.min(results[0].start, replacementInterval.start);
    replacementInterval.end = Math.max(results[results.length - 1].end, replacementInterval.end);
  
    this.starts.massRemove(indices.startIndex, indices.endIndex - indices.startIndex);
    this.ends.massRemove(indices.startIndex, indices.endIndex - indices.startIndex);
  }
  
  // Add the replacement interval
  this.starts.insert(replacementInterval.start);
  this.ends.insert(replacementInterval.end);
  
  // Return areas of the added interval that were not already in the IntervalMask
  return newlyAdded;
}


/**
 * private methods
 **/

// Returns the start and end indices for stored intervals that overlap with double-open interval (start, end).
// In other words, stored intervals that *touch* (start, end) do not count.
function _search(itvalMask, start, end) {
  start = Math.max(start, itvalMask.min);
  end = Math.min(end, itvalMask.max);
  
  var startIndex = itvalMask.ends.bsearch(start) + 1,
    endIndex = itvalMask.starts.bsearch(end);
  
  if (itvalMask.starts.get(endIndex) === end) { endIndex--; }
  return {startIndex: startIndex, endIndex: endIndex + 1};
}


// Subtracts `intervals` (given as an array of {start: start, end: end}, as produced by `_slice()` above) from the 
// `from` interval, also given as {start: start, end: end}.
//
// `intervals` can only be sorted and non-touching intervals that overlap `from`, as produced by `_slice()` above.
//
// Returns an array of {start: start, end: end} intervals.
function _subtract(intervals, from) {
  var remaining = [from],
    currentInterval,
    lastRemaining;

  for (var i = 0; i < intervals.length; i++) {
    currentInterval = intervals[i];
    lastRemaining = remaining[remaining.length - 1];
    
    if (currentInterval.start <= lastRemaining.start) {
      if (currentInterval.end >= lastRemaining.end) {
        // Special case: `intervals` must completely cover `from`
        return [];
      } else if (currentInterval.end > lastRemaining.start) {
        // chop off the beginning of this interval
        lastRemaining.start = currentInterval.end;
      }
    } else if (currentInterval.start < lastRemaining.end) {
      if (currentInterval.end < lastRemaining.end) {
        // have to split this interval into two
        remaining.push({start: currentInterval.end, end: lastRemaining.end});
      }
      // chop off the end of this interval
      lastRemaining.end = currentInterval.start;
    }
  }
  
  return remaining;
}


exports.IntervalMask = IntervalMask;

})(this);