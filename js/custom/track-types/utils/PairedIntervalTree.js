(function(exports){
  
var IntervalTree = require('./IntervalTree.js').IntervalTree;  

// TODO: backport this code for JavaScript 1.5? using underscore.js
/**
 * Wraps two of Shin Suzuki's IntervalTrees to store intervals that *may*
 * be paired.
 *
 * @see IntervalTree()
 **/
function PairedIntervalTree(center, options) {
  this.unpaired = new IntervalTree(center, options);
  this.paired = new IntervalTree(center, options);
}


/**
 * public methods
 **/


/**
 * add new range
 **/
PairedIntervalTree.prototype.add = function(data, id) {
  // TODO: add to each of this.paired and this.unpaired.
};


/**
 * add new range only if it is new, based on whether the id was already registered
 **/
PairedIntervalTree.prototype.addIfNew = function(data, id) {
  // TODO: add to each of this.paired and this.unpaired.
  this.unpaired.addIfNew(data, id);
}


/**
 * search
 *
 * @param (integer) val:
 * @return (array)
 **/
PairedIntervalTree.prototype.search = function(val1, val2, paired) {
  console.log(paired);
  return this.unpaired.search(val1, val2);
};


/**
 * remove: unimplemented for now
 **/
PairedIntervalTree.prototype.remove = function(interval_id) {
  throw ".remove() is currently unimplemented";
};


exports.PairedIntervalTree = PairedIntervalTree;

})(module && module.exports || this);