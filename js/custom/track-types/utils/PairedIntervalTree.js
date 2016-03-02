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
  this.pairingDisabled = false;
  this.pairingMinDistance = this.pairingMaxDistance = null;
}


/**
 * public methods
 **/


/**
 * Disables pairing. Effectively makes this equivalent, externally, to an IntervalTree.
 * This is useful if we discover that this data source doesn't contain paired reads.
 **/
PairedIntervalTree.prototype.disablePairing = function() {
  this.pairingDisabled = true;
  this.paired = this.unpaired;
};


/**
 * Set an interval within which paired mates will be saved as a continuous feature in .paired
 *
 * @param (number) min: Minimum distance, in bp
 * @param (number) max: Maximum distance, in bp
 **/
PairedIntervalTree.prototype.setPairingInterval = function(min, max) {
  if (typeof min != 'number') { throw new Error('you must specify min as the 1st argument.'); }
  if (typeof max != 'number') { throw new Error('you must specify max as the 2nd argument.'); }
  if (this.pairingMinDistance !== null) { throw new Error('Can only be called once. You can\'t change the pairing interval.'); }
  
  this.pairingMinDistance = min;
  this.pairingMaxDistance = max;
};


/**
 * add new range only if it is new, based on whether the id was already registered
 **/
PairedIntervalTree.prototype.addIfNew = function(data, id) {
  var mated = false;
  if (this.pairingMinDistance === null) { throw new Error('Can only add data after the pairing interval has been set!'); }
  
  // .unpaired contains every alignment, separately.
  this.unpaired.addIfNew(data, id);
  
  // .paired contains alignments that may be mated if they are within the pairing interval of each other
  // instead of storing them with the given id, the QNAME is used as the id.
  if (!this.pairingDisabled) {
    // As intervals are added, we check if a read with the same QNAME already exists in the .paired IntervalTree. 
    if (this.paired.contains(data.qname)) {
      // If yes: is this read within the acceptable range of the other to mate?
      if (false) { // TODO
        // If yes: mate the read 
        
        mated = true; 
      }
    }
    if (!mated) {
      // If we couldn't mate the read, insert into .paired as a separate read (with a different id)
    
    }
  }

}


/**
 * alias .add() to .addIfNew()
 **/
PairedIntervalTree.prototype.add = PairedIntervalTree.prototype.addIfNew;


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