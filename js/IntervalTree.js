(function(exports){
// TODO: backport this code for JavaScript 1.5? using underscore.js
/**
 * By Shin Suzuki, MIT license
 * https://github.com/shinout/interval-tree
 * IntervalTree
 *
 * @param (object) data:
 * @param (number) center:
 * @param (object) options:
 *   center:
 *
 **/
function IntervalTree(center, options) {
  options || (options = {});

  this.startKey     = options.startKey || 0; // start key
  this.endKey       = options.endKey   || 1; // end key
  this.intervalHash = {};                    // id => interval object
  this.pointTree = new SortedList({          // b-tree of start, end points 
    compare: function(a, b) {
      if (a == null) return -1;
      if (b == null) return  1;
      var c = a[0]- b[0];
      return (c > 0) ? 1 : (c == 0)  ? 0 : -1;
    }
  });

  this._autoIncrement = 0;

  // index of the root node
  if (!center || typeof center != 'number') {
    throw new Error('you must specify center index as the 2nd argument.');
  }

  this.root = new Node(center, this);
}


/**
 * public methods
 **/


/**
 * add new range
 **/
IntervalTree.prototype.add = function(data, id) {
  if (this.intervalHash[id]) {
    throw new DuplicateError('id ' + id + ' is already registered.');
  }

  if (id == undefined) {
    while (this.intervalHash[this._autoIncrement]) {
      this._autoIncrement++;
    }
    id = this._autoIncrement;
  }

  var itvl = new Interval(data, id, this.startKey, this.endKey);
  this.pointTree.insert([itvl.start, id]);
  this.pointTree.insert([itvl.end,   id]);
  this.intervalHash[id] = itvl;
  this._autoIncrement++;
  //try {
    _insert.call(this, this.root, itvl);
  //} catch (e) {
  //  if (e instanceof RangeError) { console.log (data); }
  //}
};


/**
 * add new range only if it is new, based on whether the id was already registered
 **/
IntervalTree.prototype.addIfNew = function(data, id) {
  try {
    this.add(data, id);
  } catch (e) {
    if (e instanceof DuplicateError) { return; }
    throw e;
  }
}


/**
 * search
 *
 * @param (integer) val:
 * @return (array)
 **/
IntervalTree.prototype.search = function(val1, val2) {
  var ret = [];
  if (typeof val1 != 'number') {
    throw new Error(val1 + ': invalid input');
  }

  if (val2 == undefined) {
    _pointSearch.call(this, this.root, val1, ret);
  }
  else if (typeof val2 == 'number') {
    _rangeSearch.call(this, val1, val2, ret);
  }
  else {
    throw new Error(val1 + ',' + val2 + ': invalid input');
  }
  return ret;
};


/**
 * remove: 
 **/
IntervalTree.prototype.remove = function(interval_id) {
};



/**
 * private methods
 **/

// the shift-right-and-fill operator, extended beyond the range of an int32
function _bitShiftRight(num) {
  if (num > 2147483647 || num < -2147483648) { return Math.floor(num / 2); }
  return num >>> 1;
}

/**
 * _insert
 **/
function _insert(node, itvl) {
  while (true) {
    if (itvl.end < node.idx) {
      if (!node.left) {
        node.left = new Node(_bitShiftRight(itvl.start + itvl.end), this);
      }
      node = node.left;
    } else if (node.idx < itvl.start) {
      if (!node.right) {
        node.right = new Node(_bitShiftRight(itvl.start + itvl.end), this);
      }
      node = node.right;
    } else {
      return node.insert(itvl);
    }
  }
}


/**
 * _pointSearch
 * @param (Node) node
 * @param (integer) idx 
 * @param (Array) arr
 **/
function _pointSearch(node, idx, arr) {
  while (true) {
    if (!node) break;
    if (idx < node.idx) {
      node.starts.arr.every(function(itvl) {
        var bool = (itvl.start <= idx);
        if (bool) arr.push(itvl.result());
        return bool;
      });
      node = node.left;
    } else if (idx > node.idx) {
      node.ends.arr.every(function(itvl) {
        var bool = (itvl.end >= idx);
        if (bool) arr.push(itvl.result());
        return bool;
      });
      node = node.right;
    } else {
      node.starts.arr.map(function(itvl) { arr.push(itvl.result()) });
      break;
    }
  }
}



/**
 * _rangeSearch
 * @param (integer) start
 * @param (integer) end
 * @param (Array) arr
 **/
function _rangeSearch(start, end, arr) {
  if (end - start <= 0) {
    throw new Error('end must be greater than start. start: ' + start + ', end: ' + end);
  }
  var resultHash = {};

  var wholeWraps = [];
  _pointSearch.call(this, this.root, _bitShiftRight(start + end), wholeWraps, true);

  wholeWraps.forEach(function(result) {
    resultHash[result.id] = true;
  });


  var idx1 = this.pointTree.bsearch([start, null]);
  while (idx1 >= 0 && this.pointTree.arr[idx1][0] == start) {
    idx1--;
  }

  var idx2 = this.pointTree.bsearch([end,   null]);
  var len = this.pointTree.arr.length - 1;
  while (idx2 == -1 || (idx2 <= len && this.pointTree.arr[idx2][0] <= end)) {
    idx2++;
  }

  this.pointTree.arr.slice(idx1 + 1, idx2).forEach(function(point) {
    var id = point[1];
    resultHash[id] = true;
  }, this);

  Object.keys(resultHash).forEach(function(id) {
    var itvl = this.intervalHash[id];
    arr.push(itvl.result(start, end));
  }, this);

}



/**
 * subclasses
 * 
 **/


/**
 * Node : prototype of each node in a interval tree
 * 
 **/
function Node(idx) {
  this.idx = idx;
  this.starts = new SortedList({
    compare: function(a, b) {
      if (a == null) return -1;
      if (b == null) return  1;
      var c = a.start - b.start;
      return (c > 0) ? 1 : (c == 0)  ? 0 : -1;
    }
  });

  this.ends = new SortedList({
    compare: function(a, b) {
      if (a == null) return -1;
      if (b == null) return  1;
      var c = a.end - b.end;
      return (c < 0) ? 1 : (c == 0)  ? 0 : -1;
    }
  });
};

/**
 * insert an Interval object to this node
 **/
Node.prototype.insert = function(interval) {
  this.starts.insert(interval);
  this.ends.insert(interval);
};



/**
 * Interval : prototype of interval info
 **/
function Interval(data, id, s, e) {
  this.id     = id;
  this.start  = data[s];
  this.end    = data[e];
  this.data   = data;

  if (typeof this.start != 'number' || typeof this.end != 'number') {
    throw new Error('start, end must be number. start: ' + this.start + ', end: ' + this.end);
  }

  if ( this.start >= this.end) {
    throw new Error('start must be smaller than end. start: ' + this.start + ', end: ' + this.end);
  }
}

/**
 * get result object
 **/
Interval.prototype.result = function(start, end) {
  var ret = {
    id   : this.id,
    data : this.data
  };
  if (typeof start == 'number' && typeof end == 'number') {
    /**
     * calc overlapping rate
     **/
    var left  = Math.max(this.start, start);
    var right = Math.min(this.end,   end);
    var lapLn = right - left;
    ret.rate1 = lapLn / (end - start);
    ret.rate2 = lapLn / (this.end - this.start);
  }
  return ret;
};

function DuplicateError(message) {
    this.name = 'DuplicateError';
    this.message = message;
    this.stack = (new Error()).stack;
}
DuplicateError.prototype = new Error;

exports.IntervalTree = IntervalTree;

})(this);