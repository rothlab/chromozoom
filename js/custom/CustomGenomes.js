module.exports = (function(global){
  
  var _ = require('../underscore.min.js');
  if (!global.CustomTracks) { require('./CustomTracks.js')(global); }
  
  // The class that represents a singular custom genome object
  var CustomGenome = require('./CustomGenome')(global);
  
  // ================================================================
  // = CustomGenomes, the module exported to the global environment =
  // ================================================================
  //
  // Broadly speaking this is a factory for CustomGenome objects that can delegate the
  // work of parsing to a Web Worker thread.
  
  var CustomGenomes = {
    parse: function(text, metadata) {
      metadata = metadata || {};
      if (!metadata.format) { metadata.format = this.guessFormat(text); }
      var genome = new CustomGenome(metadata.format, metadata);
      genome.parse(text);
      return genome;
    },
    
    blank: function() {
      var genome = new CustomGenome("chromsizes", {species: "Blank Genome"});
      genome.parse("blank\t50000");
      return genome;
    },
    
    guessFormat: function(text) {
      if (text.substring(0, 5) == 'LOCUS') { return "genbank"; }
      if (/^[A-Z]{2} {3}/.test(text)) { return "embl"; }
      if (/^[>;]/.test(text)) { return "fasta"; }
      // default is fasta
      return "fasta";
    },
    
    error: function(e) {
      // Can be overridden by a parent library to handle errors more gracefully.
      console.log(e);
    },
    
    _workerScript: 'build/CustomGenomeWorker.js',
    _disableWorkers: false,
    worker: global.CustomTracks.worker,
    
    async: global.CustomTracks.async,
    
    parseAsync: function() {
      this.async(this, 'parse', arguments, [], function(genome) {
        // This has been serialized, so it must be hydrated into a real CustomGenome object.
        // We replace .getSequence() with an asynchronous version.
        return _.extend(new CustomGenome(false), genome, {
          getSequence: function() { CustomGenome.prototype.getSequenceAsync.apply(this, arguments); }
        });
      });
    }
  };
  
  global.CustomGenomes = CustomGenomes;
  
});