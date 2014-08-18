(function(global){
  
  function parseInt10(val) { return parseInt(val, 10); }
  
  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
  
  function log10(val) { return Math.log(val) / Math.LN10; }
  
  function strip(str) { return str.replace(/^\s+|\s+$/g, ''); }
  
  function roundToPlaces(num, dec) { return Math.round(num * Math.pow(10, dec)) / Math.pow(10, dec); }
  
  // Splits a multiline string before the lines that contain a character in the first column
  // (a "top tag") in a GenBank-style text file
  function topTagsAsArray(field) {
    return field.replace(/\n([A-Za-z\/\*])/g, "\n\001$1").split("\001");
  }
  
  // Splits a multiline string before the lines that contain a character not in the first column
  // but within the next tagSize columns, which is a "sub tag" in a GenBank-style text file
  function subTagsAsArray(field, tagSize) {
    if (!isFinite(tagSize) || tagSize < 2) { throw "invalid tagSize"; }
    var re = new RegExp("\\n(\\s{1," + (tagSize - 1) + "}\\S)", "g");
    return field.replace(re, "\n\001$1").split("\001");
  }
  
  // Returns a new string with the first tagSize columns from field removed
  function fetchField(field, tagSize) {
    if (!isFinite(tagSize) || tagSize < 1) { throw "invalid tagSize"; }
    var re = new RegExp("(^|\\n).{0," + tagSize + "}", "g")
    return strip(field.replace(re, "$1"));
  }
  
  // Gets a tag from a field by trimming it out of the first tagSize characters of the field
  function getTag(field, tagSize) { 
    if (!isFinite(tagSize) || tagSize < 1) { throw "invalid tagSize"; }
    return strip(field.substring(0, tagSize).toLowerCase());
  }
  
  function ensureUnique(key, hash) {
    var i = 1, keyCheck = key;
    while (!_.isUndefined(hash[keyCheck])) { keyCheck = key + '_' + i++; }
    return keyCheck;
  }
  
  // ================================================================
  // = CustomGenomes, the module exported to the global environment =
  // ================================================================
  
  var CustomGenomes = {
    parse: function(text, metadata) {
      metadata = metadata || {};
      if (!metadata.format) { metadata.format = this.guessFormat(text); }
      var genome = new CustomGenome(metadata.format, metadata);
      genome.parse(text);
      return genome;
    },
    
    guessFormat: function(text) {
      if (text.substring(0, 5) == 'LOCUS') { return "genbank"; }
      if (/^[A-Z]{2} {3}/.test(text)) { return "embl"; }
      if (/^[>;]/.test(text)) { return "fasta"; }
      // default is fasta
      return "fasta";
    }
  };
  
  // ================================================================================================
  // = CustomGenome represents a genome specification that can produce options for $.ui.genobrowser =
  // ================================================================================================
  
  function CustomGenome(givenFormat, metadata) {
    this._parsed = false;
    this._format = (givenFormat && givenFormat.toLowerCase()) || "chromsizes";
    var format = this.format();
    if (format === null) { throw new Error("Unsupported genome format '"+format+"' encountered"); }
    
    // this.opts holds everything that $.ui.genobrowser will need to construct a view (see CustomGenome.defaults below)
    this.opts = _.extend({}, deepClone(this.constructor.defaults), deepClone(format.defaults || {}));
    
    // this.sequence holds the sequence if provided
    this.sequence = null;
    
    // this.parseOpts holds information external to the parsed text passed in from the browser (e.g. filename, metadata)
    this.metadata = metadata;
    // this.data holds anything additionally parsed from the genome file (metadata, references, etc.)
    this.data = {};
    
    format.init && format.init.call(this)
  }
  
  CustomGenome.defaults = {
    // The following keys should be overridden while parsing the genome file
    genome: 'custom',
    species: 'Custom Genome',
    assemblyDate: '',
    tileDir: null,
    overzoomBppps: [],
    ntsBelow: [1, 0.1],
    availTracks: [
      {
        fh: {},
        n: "ruler",
        s: ["dense"],
        h: 25
      }
    ],
    genomeSize: 0,
    chrLengths: {},
    chrOrder: [],
    chrBands: null,
    tileWidth: 1000,
    subdirForBpppsUnder: 330,
    ideogramsAbove: 1000,
    maxNtRequest: 20000,
    tracks: [{n: "ruler"}],
    trackDesc: {
      ruler: {
        cat: "Mapping and Sequencing Tracks",
        sm: "Base Position"
      }
    },
    // These last three will be overridden using knowledge of the window's width
    bppps: [],
    bpppNumbersBelow: [],
    initZoom: null
  };
  
  CustomGenome.formats = {
    
    chromsizes: {
      init: function() {
        var m = this.metadata,
          o = this.opts;
        o.species = m.species || 'Custom Genome';
        o.assemblyDate = m.assemblyDate || '';
      },
      
      parse: function(text) {
        var lines = text.split("\n"),
          o = this.opts;
        _.each(lines, function(line, i) {
          var chrsize = strip(line).split(/\s+/, 2),
            chr = chrsize[0],
            size = parseInt10(chrsize[1]);
          if (_.isNaN(size)) { return; }
          o.chrOrder.push(chr);
          o.chrLengths[chr] = size;
          o.genomeSize += size;
        });
      }
    },
    
    fasta: {
      init: function() {},
      parse: function(text) {}
    },
    
    genbank: {
      init: function() {
        // Note that we call GenBank field names like "LOCUS", "DEFINITION", etc. tags instead of keys.
        // We do this because: 1) certain field names can be repeated (e.g. REFERENCE) which is more 
        // evocative of "tags" as opposed to the behavior of keys in a hash.  Also, 2) this is the
        // nomenclature picked by BioRuby.
        
        this.tagSize = 12; // how wide the column for tags is in a GenBank file
        this.featureTagSize = 21; // how wide the column for tags is in the feature table section
                                  // see section 4.1 of http://www.insdc.org/files/feature_table.html
        
        this.data = {
          contigs: [],
          trackLines: {
            source: [],
            genes: [],
            other: []
          }
        };
      },
      
      parseLocus: function(contig) {
        var locusLine = contig.orig.locus;
        if (locusLine) {
          if (locusLine.length > 75) { // after Rel 126.0
            contig.entryId  = strip(locusLine.substring(12, 28));
            contig.length   = parseInt10(locusLine.substring(29, 40));
            contig.strand   = strip(locusLine.substring(44, 47));
            contig.natype   = strip(locusLine.substring(47, 53));
            contig.circular = strip(locusLine.substring(55, 63));
            contig.division = strip(locusLine.substring(63, 67));
            contig.date     = strip(locusLine.substring(68, 79));
          } else {
            contig.entryId  = strip(locusLine.substring(12, 22));
            contig.length   = parseInt10(locusLine.substring(22, 30));
            contig.strand   = strip(locusLine.substring(33, 36));
            contig.natype   = strip(locusLine.substring(36, 40));
            contig.circular = strip(locusLine.substring(42, 52));
            contig.division = strip(locusLine.substring(52, 55));
            contig.date     = strip(locusLine.substring(62, 73));
          }
        }
      },
      
      parseHeaderFields: function(contig) {
        var tagSize = this.tagSize,
          headerFieldsToParse = {
            simple: ['definition', 'accession', 'version'],
            deep: ['source'] // could add references, but we don't care about those here
          };
        
        // Parse simple fields (tag --> content)
        _.each(headerFieldsToParse.simple, function(tag) {
          contig[tag] = fetchField(contig.orig[tag], tagSize);
        });
        
        // Parse tags that can repeat and have subtags
        _.each(headerFieldsToParse.deep, function(tag) {
          var data = [],
            items = contig.orig[tag].replace(/\n([A-Za-z\/\*])/g, "\n\001$1").split("\001");
          _.each(items, function(item) {
            var subTags = subTagsAsArray(item, tagSize),
              itemName = fetchField(subTags.shift(), tagSize), 
              itemData = {_name: itemName};
            _.each(subTags, function(subTagField) {
              var tag = getTag(0, tagSize);
              itemData[tag] = fetchField(subTagField, tagSize);
            });
            data.push(itemData);
          });
          contig[tag] = data;
        });
      },
      
      parseFeatureTable: function(chr, contigData) {
        var self = this,
          featureTagSize = self.featureTagSize,
          tagsToSkip = ["features"],
          tagsRelatedToGenes = ["CDS", "gene"],
          contigLine = "ACCESSION   " + chr + "\n";
        if (contigData.orig.features) {
          var subTags = subTagsAsArray(contigData.orig.features, tagSize);
          self.trackLines.source.push(contigLine);
          self.trackLines.genes.push(contigLine);
          self.trackLines.other.push(contigLine);
          _.each(subTags, function(subTagField) {
            var tag = getTag(0, featureTagSize);
            if (tagsToSkip.indexOf(tag) === -1) { return; }
            else if (tag === "source") { self.trackLines.source.push(subTagField); }
            else if (tagsRelatedToGenes.indexOf(tag) === -1) { self.trackLines.genes.push(subTagField);  }
            else { self.trackLines.other.push(subTagField); }
          });
        }
      },
      
      parse: function(text) {
        var self = this,
          o = self.opts,
          contigDelimiter = "\n//\n",
          contigs = text.split(contigDelimiter),
          firstContig = null;
        
        _.each(contigs, function(contig) {
          if (!strip(contig).length) { return; }
                               // Splits on any lines with a character in the first column
          var contigData = {orig: {}},
            chr, size;
          
          _.each(topTagsAsArray(contig), function(field) {
            var tag = getTag(0, self.tagSize);
            if (_.isUndefined(contigData.orig[tag])) { contigData.orig[tag] = field; }
            else { contigData.orig[tag] += field; }
          });
          
          self.data.contigs.push(contigData);
          self.format().parseLocus(contigData);
          self.format().parseHeaderFields(contigData);
          
          chr = contigData.accession || contigData.entryId;
          chr = ensureUnique(chr, o.chrLengths);
          size = contigData.length;
          
          o.chrOrder.push(chr);
          o.chrLengths[chr] = size;
          o.genomeSize += size;
          
          self.format().parseFeatureTable(chr, contigData);
          self.format().parseSequence(chr, contigData);
          
          // TODO: parse sequence
          
          firstContig = firstContig || contigData;
        });
        
        if (firstContig.source) { o.species = firstContig.source[0].organism.split("\n")[0]; }
        if (firstContig.date) { o.assemblyDate = firstContig.date; }
        
        console.log(self.data);
      }
    },
    
    embl: {
      
    }
    
  };
  
  // These functions branch to different methods depending on the .type() of the track
  // _.each(['parse'], function(fn) {
  //   CustomGenome.prototype[fn] = function() {
  //     var args = _.toArray(arguments),
  //       format = this.format();
  //     if (!format[fn]) { throw "Unimplemented"; }
  //     return format[fn].apply(this, args);
  //   }
  // });
  
  CustomGenome.prototype.parse = function() {
    this.format().parse.apply(this, _.toArray(arguments));
    this.setGenomeString();
    this._parsed = true;
  };
  
  CustomGenome.prototype.format = function(format) {
    var self = this;
    if (_.isUndefined(format)) { format = self._format; }
    var FormatWrapper = function() { _.extend(this, self.constructor.formats[format]); return this; };
    FormatWrapper.prototype = self;
    return new FormatWrapper();
  };
  
  CustomGenome.prototype.setGenomeString = function() {
    var self = this,
      o = self.opts,
      exceptions = ['file', 'acc', 'url', 'ucsc'],
      exception = _.find(exceptions, function(v) { return !_.isUndefined(self.metadata[v]); }),
      pieces = [];
    if (exception) { o.genome = exception + ":" + self.metadata[exception]; }
    else {
      pieces = ['custom' + (self.metadata.name ? ':' + self.metadata.name : '')];
      _.each(o.chrOrder, function(chr) {
        pieces.push(chr + ':' + o.chrLengths[chr]);
      });
      o.genome = pieces.join('|');
    }
  };
  
  CustomGenome.prototype.setBppps = function(windowOpts) {
    var o = this.opts,
      windowOpts = windowOpts || {},
      windowWidth = (windowOpts.width * 0.6) || 1000,
      bppp = Math.round(o.genomeSize / windowWidth),
      lowestBppp = windowOpts.lowestBppp || 0.1,
      maxBppps = 100,
      bppps = [], i = 0, log;
    
    // comparable to part of UCSCClient#make_config in lib/ucsc_stitch.rb
    while (bppp >= lowestBppp && i < maxBppps) {
      bppps.push(bppp);
      log = roundToPlaces(log10(bppp), 4);
      bppp = (Math.ceil(log) - log < 0.481) ? 3.3 * Math.pow(10, Math.ceil(log) - 1) : Math.pow(10, Math.floor(log));
      i++;
    }
    o.bppps = bppps;
    o.bpppNumbersBelow = bppps.slice(0, 2);
    o.initZoom = bppps[0];
  };
  
  CustomGenome.prototype.options = function(windowOpts) {
    if (!this._parsed) { throw "Cannot generate options before parsing the genome file"; }
    this.setBppps(windowOpts);
    return this.opts;
  }
  
  global.CustomGenomes = CustomGenomes;
  
})(this);