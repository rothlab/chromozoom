// =====================================================================
// = bigBed format: http://genome.ucsc.edu/goldenPath/help/bigBed.html =
// =====================================================================

var utils = require('./utils/utils.js'),
  floorHack = utils.floorHack;
var IntervalTree = require('./utils/IntervalTree.js').IntervalTree;
var RemoteTrack = require('./utils/RemoteTrack.js').RemoteTrack;
var bed = require('./bed.js');

// Intended to be loaded into CustomTrack.types.bigbed
var BigBedFormat = {
  defaults: _.extend({}, bed.defaults, {
    chromosomes: '',
    drawLimit: {squish: 500, pack: 100},
    // Data for how many nts should be fetched in one go? (0 means guess this from the index's summary stats)
    optimalFetchWindow: 0,
    // Above what tile width (in nts) do we avoid fetching data altogether? (0 means guess this from the index's summary stats)
    maxFetchWindow: 0
  }),
  
  // Magic bytes that identify this format
  magicBytes: [0x8789F2EB, 0xEBF28987],

  init: function() {
    if (!this.opts.bigDataUrl) {
      throw new Error("Required parameter bigDataUrl not found for bigBed track at " + JSON.stringify(this.opts) + (this.opts.lineNum + 1));
    }
    this.type('bed').initOpts.call(this);
  },
  
  applyOpts: function() {
    // Ensures that options and derived properties are equal across Web Worker and DOM contexts
    this.syncProps(['opts', 'isSearchable']);
  },
  
  parse: function(lines) {
    var self = this,
      middleishPos = self.browserOpts.genomeSize / 2,
      cache = new IntervalTree(floorHack(middleishPos), {startKey: 'start', endKey: 'end'}),
      ajaxUrl = self.ajaxDir() + 'bigbed.php?' + $.param({url: self.opts.bigDataUrl, density: 'pack'}),
      remote;
    
    remote = new RemoteTrack(cache, function(start, end, storeIntervals) {
      // Note: bigBed tools expect regions in 0-based, right-OPEN coordinates.
      range = self.chrRange(start, end, true).join(' ');
      $.ajax(ajaxUrl, {
        type: range.length > 500 ? 'POST' : 'GET',
        data: { range: range },
        success: function(data) {
          var lines = _.filter(data.split('\n'), function(l) { var m = l.match(/\t/g); return m && m.length >= 2; });
          var intervals = _.map(lines, function(l) { 
            var itvl = self.type('bed').parseLine.call(self, l);
            // Use BioPerl's Bio::DB:BigBed strategy for deduplicating re-fetched intervals:
            // "Because BED files don't actually use IDs, the ID is constructed from the feature's name (if any), chromosome coordinates, strand and block count."
            if (_.isUndefined(itvl.id)) {
              itvl.id = [itvl.name, itvl.chrom, itvl.chromStart, itvl.chromEnd, itvl.strand, itvl.blockCount].join("\t");
            }
            return itvl;
          });
          storeIntervals(intervals);
        }
      });
    });
      
    self.data = {cache: cache, remote: remote};
    self.heights = {max: null, min: 15, start: 15};
    self.sizes = ['dense', 'squish', 'pack'];
    self.mapSizes = ['pack'];
    self.isSearchable = self.opts.searchable;
    // self.expectsSequence is enabled in .initOpts() if codon drawing is enabled
    self.renderSequenceCallbacks = {};
    
    return true;
  },
  
  // Before the RemoteTrack can start caching data, we need to use general info on the bigBed track to setup its binning scheme.
  // We defer this in a .finishSetup() method because it's potentially expensive HTTP GET that is only necessary if the track
  // is actually going to be displayed in the browser.
  finishSetup: function() {
    var self = this,
      ajaxUrl = self.ajaxDir() + 'bigbed.php',
      remote = self.data.remote;
    
    $.ajax(ajaxUrl, {
      data: { url: self.opts.bigDataUrl },
      success: function(data) {
        // If extraIndex'es are available, we can search this track.
        self.isSearchable = self.opts.searchable = data.extraIndexCount > 0;
        
        // Set maxFetchWindow to avoid overfetching data.
        if (!self.opts.maxFetchWindow) {
          var meanItemsPerBp = data.itemCount / self.browserOpts.genomeSize,
            maxItemsToDraw = _.max(_.values(self.opts.drawLimit));
          self.opts.maxFetchWindow = maxItemsToDraw / meanItemsPerBp;
          self.opts.optimalFetchWindow = Math.floor(self.opts.maxFetchWindow / 3);
        }
        self.type('bigbed').applyOpts.call(self);
        
        remote.setupBins(self.browserOpts.genomeSize, self.opts.optimalFetchWindow, self.opts.maxFetchWindow);
      }
    });
  },

  prerender: function(start, end, density, precalc, callback) {
    var self = this,
      width = precalc.width,
      sequence = precalc.sequence,
      data = self.data,
      bppp = (end - start) / width,
      // Note: bigBed tools expect regions in 0-based, right-OPEN coordinates.
      range = this.chrRange(start, end, true).join(' '),
      url;
    
    function lineNum(d, setTo) {
      var key = bppp + '_' + density;
      if (!_.isUndefined(setTo)) { 
        if (!d.line) { d.line = {}; }
        return (d.line[key] = setTo);
      }
      return d.line && d.line[key]; 
    }
    
    function parseDenseData(data) {
      var drawSpec = [], 
        lines;
      lines = data.split(/\s+/g);
      _.each(lines, function(line, x) { 
        if (line != 'n/a' && line.length) { drawSpec.push({x: x, w: 1, v: parseFloat(line) * 1000}); } 
      });
      callback(drawSpec);
    }
    
    // Don't even attempt to fetch the data if density is not 'dense' and we can reasonably
    // estimate that we will fetch too many rows (>500 features), as this will only delay other requests.
    if (density != 'dense' && self.opts.maxFetchWindow > 0 && (end - start) > self.opts.maxFetchWindow) {
      callback({tooMany: true});
    } else {
      if (density == 'dense') {
        url = self.ajaxDir() + 'bigbed.php?' + $.param({url: self.opts.bigDataUrl, width: width, density: density});
        $.ajax(url, {
          type: range.length > 500 ? 'POST' : 'GET',
          data: { range: range },
          success: parseDenseData
        });
      } else {
        self.data.remote.fetchAsync(start, end, function(intervals) {
          var calcPixInterval, drawSpec = {};
          if (intervals.tooMany) { return callback(intervals); }
          calcPixInterval = new utils.pixIntervalCalculator(start, width, bppp, density == 'pack');
          
          if (!sequence) {
            // First drawing pass: draw the intervals, including possibly introns/exons and codon stripes
            drawSpec.layout = self.type('bed').stackedLayout.call(self, intervals, width, calcPixInterval, lineNum);
          } else {
            // Second drawing pass: draw codon sequences
            drawSpec.codons = self.type('bed').codons.call(self, intervals, width, calcPixInterval, lineNum, 
                                                           start, end, sequence);
          }
          drawSpec.width = width;
          drawSpec.bppp = bppp;
          callback(drawSpec);
        });
      }
    }
  },

  render: function(canvas, start, end, density, callback) {
    var self = this;
    self.prerender(start, end, density, {width: canvas.unscaledWidth()}, function(drawSpec) {
      var callbackKey = start + '-' + end + '-' + density;
      self.type('bed').drawSpec.call(self, canvas, drawSpec, density);
      
      // Have we been waiting to draw sequence data too? If so, do that now, too.
      if (_.isFunction(self.renderSequenceCallbacks[callbackKey])) {
        self.renderSequenceCallbacks[callbackKey]();
        delete self.renderSequenceCallbacks[callbackKey];
      }
      
      if (_.isFunction(callback)) { callback(); }
    });
  },
  
  renderSequence: function(canvas, start, end, density, sequence, callback) {
    var self = this,
      width = canvas.unscaledWidth(),
      drawCodons = self.opts.drawCodons,
      drawCodonsUnder = self.opts.drawCodonsUnder;
    
    // If we're not drawing codons or we weren't able to fetch sequence, there is no reason to proceed.
    if (!drawCodons || !sequence || (end - start) / width > drawCodonsUnder) { return false; }
    
    function renderSequenceCallback() {
      self.prerender(start, end, density, {width: width, sequence: sequence}, function(drawSpec) {
        self.type('bed').drawSpec.call(self, canvas, drawSpec, density);
        if (_.isFunction(callback)) { callback(); }
      });
    }
    
    // Check if the canvas was already rendered (by lack of the class 'unrendered').
    // If yes, go ahead and execute renderSequenceCallback(); if not, save it for later.
    if ((' ' + canvas.className + ' ').indexOf(' unrendered ') > -1) {
      self.renderSequenceCallbacks[start + '-' + end + '-' + density] = renderSequenceCallback;
    } else {
      renderSequenceCallback();
    }
  },
  
  // Searches the extraIndex'es on the bigBed for fields prefixed by `query`
  search: function(query, callback) {
    var self = this,
      ajaxUrl = self.ajaxDir() + 'bigbed.php';
    
    $.ajax(ajaxUrl, {
      data: {url: self.opts.bigDataUrl, search: query},
      success: function(data) {
        var response = {choices: []},
          customNameFunc = self.type().nameFunc,         // this permits inheriting track formats to override these
          tipTipDataCallback = self.type().tipTipData,   // " "
          nameFunc = _.isFunction(customNameFunc) ? customNameFunc : utils.defaultNameFunc,
          lines = _.filter(data.split('\n'), function(l) { var m = l.match(/\t/g); return m && m.length >= 2; });
        if (!_.isFunction(tipTipDataCallback)) { tipTipDataCallback = self.type('bed').tipTipData; }
        
        _.each(lines, function(line) {
          var match = self.type('bed').parseLine.call(self, line);
          if (match === null) { return; }  // matches on contigs not in this genome layout may be returned here as null
          
          var tipTipData = tipTipDataCallback.call(self, match),
            niceName = nameFunc(match),
            stdName = match.name || match.id || '',
            pos = match.chrom + ':' + match.chromStart + '-' + match.chromEnd,
            choice = {
              name: niceName,
              desc: (tipTipData.description || pos),
              pos: pos
            };
          
          if (stdName && stdName != niceName) { choice.altName = stdName; }
          response.choices.push(choice);
        });
        // Prioritize exact matches
        response.choices = _.first(_.sortBy(response.choices, function(choice) { 
          return choice.name.toLowerCase() == query.toLowerCase() ? 0 : 1; 
        }), 10);
        callback(response);
      }
    });
  },
  
  loadOpts: function() { return this.type('bed').loadOpts.apply(this, arguments); },
  
  saveOpts: function() { return this.type('bed').saveOpts.apply(this, arguments); }
};

module.exports = BigBedFormat;