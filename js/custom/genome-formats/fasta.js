// ===========================================================
// = FASTA format: http://en.wikipedia.org/wiki/FASTA_format =
// ===========================================================

var utils = require('./utils/utils.js'),
  ensureUnique = utils.ensureUnique;

var FastaFormat = {
  init: function() {
    var self = this,
      m = self.metadata,
      o = self.opts;
      
    self.data = {};
  },
  
  parse: function(text) {
    var lines = text.split("\n"),
      self = this,
      o = self.opts,
      chr = null,
      unnamedCounter = 1,
      chrseq = [];
      
    self.data.sequence = [];
    
    _.each(lines, function(line, i) {
      var chrLine = line.match(/^[>;](.+)/),
        cleanedLine = line.replace(/\s+/g, '');
      if (chrLine) {
        chr = chrLine[1].replace(/^\s+|\s+$/g, '');
        if (!chr.length) { chr = "unnamedChr"; }
        chr = ensureUnique(chr, o.chrLengths);
        o.chrOrder.push(chr);
      } else {
        self.data.sequence.push(cleanedLine);
        o.chrLengths[chr] = (o.chrLengths[chr] || 0) + cleanedLine.length;
        o.genomeSize += cleanedLine.length;
      }
    });
    
    self.data.sequence = self.data.sequence.join('');
    self.canGetSequence = true;
  }
};

module.exports = FastaFormat;