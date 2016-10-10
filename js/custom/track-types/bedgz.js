// ====================================================================
// = BED.gz format: http://genome.ucsc.edu/FAQ/FAQformat.html#format1 =
// =                + http://www.htslib.org/doc/tabix.html            =
// ====================================================================

var bigbed = require('./bigbed.js');
var utils = require('./utils/utils.js'),
  floorHack = utils.floorHack;
var IntervalTree = require('./utils/IntervalTree.js').IntervalTree;
var RemoteTrack = require('./utils/RemoteTrack.js').RemoteTrack;

// Intended to be loaded into CustomTrack.types.bedgz
var BedGzFormat = _.extend({}, bigbed, {
  
  parse: function(lines) {
    var self = this,
      middleishPos = self.browserOpts.genomeSize / 2,
      cache = new IntervalTree(floorHack(middleishPos), {startKey: 'start', endKey: 'end'}),
      ajaxUrl = self.ajaxDir() + 'tabix.php',
      remote;
    
    remote = new RemoteTrack(cache, function(start, end, storeIntervals) {
      range = self.chrRange(start, end);
      $.ajax(ajaxUrl, {
        data: {range: range, url: self.opts.bigDataUrl, density: 'pack'},
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
    
    return true;
  },
  
  // Before the RemoteTrack can start caching data, we need to use general info on the bedGz track to setup its binning scheme.
  // We defer this in a .finishSetup() method because it's potentially expensive HTTP GET that is only necessary if the track
  // is actually going to be displayed in the browser.
  finishSetup: function() {
    var self = this,
      ajaxUrl = self.ajaxDir() + 'tabix.php',
      sampleWindow = 100000,
      infoChrRange = self.chrRange(Math.round(self.browserOpts.pos), Math.round(self.browserOpts.pos + sampleWindow)),
      remote = self.data.remote;
   
    $.ajax(ajaxUrl, {
      data: {info: 4, range: infoChrRange, url: self.opts.bigDataUrl},
      success: function(data) {
        var o = self.opts,
          infoParts = data.split("\n\n"),
          bedChrs = infoParts[0].split("\n"),
          bedSample;
          
        if (infoParts[0] == '' || infoParts.length == 1) { throw new Error("tabix failed to retrieve data for this track."); }
        
        bedSample = infoParts[1];
        // Set maxFetchWindow to avoid overfetching data.
        if (!o.maxFetchWindow) {
          // FIXME: bedSample.length is capped at 500, so we may have to detect that and shrink the sampleWindow
          var meanItemsPerBp = bedSample.length / sampleWindow,
            maxItemsToDraw = _.max(_.values(o.drawLimit));
          o.maxFetchWindow = maxItemsToDraw / meanItemsPerBp;
          o.optimalFetchWindow = Math.floor(o.maxFetchWindow / 3);
        }
        
        remote.setupBins(self.browserOpts.genomeSize, self.opts.optimalFetchWindow, self.opts.maxFetchWindow);
      }
    });
    
  },
  
  prerender: function(start, end, density, precalc, callback) {
    var self = this,
      width = precalc.width,
      data = self.data,
      bppp = (end - start) / width,
      range = this.chrRange(start, end);
    
    function lineNum(d, setTo) {
      var key = bppp + '_' + density;
      if (!_.isUndefined(setTo)) { 
        if (!d.line) { d.line = {}; }
        return (d.line[key] = setTo);
      }
      return d.line && d.line[key]; 
    }
    
    // Don't even attempt to fetch the data if density is not 'dense' and we can reasonably
    // estimate that we will fetch too many rows (>500 features), as this will only delay other requests.
    if (self.opts.maxFetchWindow > 0 && (end - start) > self.opts.maxFetchWindow) {
      callback({tooMany: true});
    } else {
      self.data.remote.fetchAsync(start, end, function(intervals) {
        var calcPixInterval, drawSpec = [];
        if (intervals.tooMany) { return callback(intervals); }
        calcPixInterval = new utils.pixIntervalCalculator(start, width, bppp, density == 'pack');
        if (density == 'dense') {
          _.each(intervals, function(itvl) {
            drawSpec.push(calcPixInterval(itvl.data));
          });
        } else {
          drawSpec = {layout: self.type('bed').stackedLayout.call(self, intervals, width, calcPixInterval, lineNum)};
          drawSpec.width = width;
        }
        callback(drawSpec);
      });
    }
  },
  
  render: function(canvas, start, end, density, callback) {
    var self = this,
      drawLimit = self.opts.drawLimit && self.opts.drawLimit[density];
    self.prerender(start, end, density, {width: canvas.width}, function(drawSpec) {
      // Need to add an extra check for tooMany because .bed.gz can max out on 'dense' density, unlike BED/bigBed.
      if ((drawLimit && drawSpec.layout && drawSpec.layout.length > drawLimit) || drawSpec.tooMany) { 
        canvas.height = 0;
        // This applies styling that indicates there was too much data to load/draw and that the user needs to zoom to see more
        canvas.className = canvas.className + ' too-many';
      } else {
        self.type('bed').drawSpec.call(self, canvas, drawSpec, density);
      }
      if (_.isFunction(callback)) { callback(); }
    });
  }
  
});

module.exports = BedGzFormat;